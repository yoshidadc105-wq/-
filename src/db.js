const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const os = require('os');

// データはユーザーフォルダに保存（ZIPを再展開してもデータが消えない）
const DATA_DIR = path.join(os.homedir(), 'ManualSystemData');
const DB_PATH = path.join(DATA_DIR, 'manual_system.db');

let db;

function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

function initializeDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      last_login TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'all',
      parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(name, parent_id)
    )
  `);

  // 既存DBへのマイグレーション（parent_idカラムがない場合は追加）
  try {
    db.exec('ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL');
  } catch (e) { /* すでに存在する場合は無視 */ }

  // グループテーブル（スタッフの部署・役割グループ）
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // ユーザーとグループの紐付け
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_groups (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups_table(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, group_id)
    )
  `);

  // カテゴリとグループの紐付け（特定グループのみ閲覧可能）
  db.exec(`
    CREATE TABLE IF NOT EXISTS category_groups (
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups_table(id) ON DELETE CASCADE,
      PRIMARY KEY (category_id, group_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS manuals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL CHECK(type IN ('pdf', 'rich_text', 'steps')),
      content TEXT,
      file_path TEXT,
      file_name TEXT,
      file_size INTEGER,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Migration: add 'steps' type support for existing DBs
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='manuals'").get();
    if (tableInfo && tableInfo.sql && !tableInfo.sql.includes("'steps'")) {
      const originalCount = db.prepare('SELECT COUNT(*) as n FROM manuals').get().n;
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`CREATE TABLE manuals_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL CHECK(type IN ('pdf', 'rich_text', 'steps')),
        content TEXT,
        file_path TEXT,
        file_name TEXT,
        file_size INTEGER,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        created_by INTEGER NOT NULL REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        is_deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      )`);
      db.exec('INSERT INTO manuals_v2 SELECT * FROM manuals');
      const newCount = db.prepare('SELECT COUNT(*) as n FROM manuals_v2').get().n;
      if (newCount === originalCount) {
        db.exec('DROP TABLE manuals');
        db.exec('ALTER TABLE manuals_v2 RENAME TO manuals');
        db.exec('PRAGMA foreign_keys = ON');
        console.log(`manualsテーブルをマイグレーションしました（${newCount}件のデータを保持）`);
      } else {
        db.exec('DROP TABLE IF EXISTS manuals_v2');
        db.exec('PRAGMA foreign_keys = ON');
        console.error('マイグレーション失敗：データ件数不一致のためロールバックしました');
      }
    }
  } catch (e) {
    try { db.exec('DROP TABLE IF EXISTS manuals_v2'); } catch (_) {}
    try { db.exec('PRAGMA foreign_keys = ON'); } catch (_) {}
    console.error('マイグレーション失敗:', e.message);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS view_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manual_id INTEGER NOT NULL REFERENCES manuals(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      viewed_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manual_id INTEGER NOT NULL REFERENCES manuals(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      checked_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(manual_id, user_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_manuals_category ON manuals(category_id);
    CREATE INDEX IF NOT EXISTS idx_manuals_deleted ON manuals(is_deleted);
    CREATE INDEX IF NOT EXISTS idx_view_history_user ON view_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_manual_checks_user ON manual_checks(user_id);
    CREATE INDEX IF NOT EXISTS idx_manual_checks_manual ON manual_checks(manual_id);
  `);

  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (username, display_name, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `).run('admin', '管理者', 'admin@example.com', hash, 'admin');
    console.log('初期管理者アカウントを作成しました: admin / admin123');
  }

  const categoryExists = db.prepare('SELECT id FROM categories LIMIT 1').get();
  if (!categoryExists) {
    // Level 1
    const l1names = [
      ['01.のびのびマニュアル', 1], ['02.技工', 2], ['03.Dr.', 3],
      ['04.プライムスキャン / プライムミル', 4], ['05.入社時に確認する内容', 5],
      ['06.作成完了　みんなチェックしてねマニュアル', 6], ['07.修正中　作成中　完了待ち', 7],
      ['08.ゆ未完成', 8], ['09.吉田未完成', 9],
      ['10.編集が必要なマニュアル', 10], ['11.使ってないマニュアル', 11]
    ];
    const stL1 = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
    for (const [n, s] of l1names) stL1.run(n, s);

    // Level 2 - INSERT...SELECT でparent IDをSQL内で解決
    const stL2 = db.prepare(`
      INSERT INTO categories (name, sort_order, parent_id)
      SELECT ?, ?, id FROM categories WHERE name = ? AND parent_id IS NULL
    `);
    const l2data = [
      // [子名, sort, 親名]
      ['01.診療関係', 1, '01.のびのびマニュアル'],
      ['02.滅菌・消毒室', 2, '01.のびのびマニュアル'],
      ['03.ユニット関係、案内', 3, '01.のびのびマニュアル'],
      ['04.矯正', 4, '01.のびのびマニュアル'],
      ['05.インプラント', 5, '01.のびのびマニュアル'],
      ['06.レントゲン、口腔内写真', 6, '01.のびのびマニュアル'],
      ['07.ホワイトニング', 7, '01.のびのびマニュアル'],
      ['08..技術操作', 8, '01.のびのびマニュアル'],
      ['09.機械の操作', 9, '01.のびのびマニュアル'],
      ['10.受付、電話', 10, '01.のびのびマニュアル'],
      ['11.器具の個数', 11, '01.のびのびマニュアル'],
      ['12.品物管理、棚', 12, '01.のびのびマニュアル'],
      ['13.朝の準備', 13, '01.のびのびマニュアル'],
      ['14.帰りの片付け', 14, '01.のびのびマニュアル'],
      ['18.手が空いたときにやること', 18, '01.のびのびマニュアル'],
      ['19.ミーティング、勉強会', 19, '01.のびのびマニュアル'],
      ['21.ヘルプ', 21, '01.のびのびマニュアル'],
      ['22.訪問', 22, '01.のびのびマニュアル'],
      ['23.ほとんど使ってない機械など', 23, '01.のびのびマニュアル'],
      ['24.小児矯正', 24, '01.のびのびマニュアル'],
      ['99.その他', 99, '01.のびのびマニュアル'],
      ['プライムスキャン', 1, '04.プライムスキャン / プライムミル'],
      ['プライムミル', 2, '04.プライムスキャン / プライムミル'],
      ['01.オリエンテーション', 1, '05.入社時に確認する内容'],
      ['02.アカウント登録', 2, '05.入社時に確認する内容'],
      ['DHミーティング', 1, '08.ゆ未完成'],
      ['DrHRマニュアル', 2, '08.ゆ未完成'],
      ['説明', 3, '08.ゆ未完成'],
    ];
    for (const [n, s, p] of l2data) stL2.run(n, s, p);

    // Level 3 - INSERT...SELECT with JOIN to resolve grandparent
    const stL3 = db.prepare(`
      INSERT INTO categories (name, sort_order, parent_id)
      SELECT ?, ?, c.id
      FROM categories c
      JOIN categories p ON c.parent_id = p.id
      WHERE c.name = ? AND p.name = ?
    `);
    const l3data = [
      // [子名, sort, 親名, 祖父母名]
      ['01.C処・形成・セット関係', 1, '01.診療関係', '01.のびのびマニュアル'],
      ['02.根治関係・コア', 2, '01.診療関係', '01.のびのびマニュアル'],
      ['03.外科関係', 3, '01.診療関係', '01.のびのびマニュアル'],
      ['04.その他', 4, '01.診療関係', '01.のびのびマニュアル'],
      ['DH業務', 5, '01.診療関係', '01.のびのびマニュアル'],
      ['01.案内・片付け', 1, '03.ユニット関係、案内', '01.のびのびマニュアル'],
      ['02.ユニットのこと', 2, '03.ユニット関係、案内', '01.のびのびマニュアル'],
      ['01.検査', 1, '04.矯正', '01.のびのびマニュアル'],
      ['02.急速拡大', 2, '04.矯正', '01.のびのびマニュアル'],
      ['03.エンジェル', 3, '04.矯正', '01.のびのびマニュアル'],
      ['04.アライナー', 4, '04.矯正', '01.のびのびマニュアル'],
      ['05.インビザ', 5, '04.矯正', '01.のびのびマニュアル'],
      ['06.その他', 6, '04.矯正', '01.のびのびマニュアル'],
      ['01.アポツール関係', 1, '10.受付、電話', '01.のびのびマニュアル'],
      ['02.レジ関係', 2, '10.受付、電話', '01.のびのびマニュアル'],
      ['03.レセコン関係（資格証明書・医療書・マイナンバー）', 3, '10.受付、電話', '01.のびのびマニュアル'],
      ['04.電話関係', 4, '10.受付、電話', '01.のびのびマニュアル'],
      ['05.朝準備・締め作業', 5, '10.受付、電話', '01.のびのびマニュアル'],
      ['朝の準備サブ', 1, '13.朝の準備', '01.のびのびマニュアル'],
    ];
    for (const [n, s, p, gp] of l3data) stL3.run(n, s, p, gp);
  }

  // 既存DBマイグレーション：サブカテゴリが未登録なら追加
  const hasSubCats = db.prepare('SELECT id FROM categories WHERE parent_id IS NOT NULL LIMIT 1').get();
  if (!hasSubCats) {
    const stL2m = db.prepare(`
      INSERT OR IGNORE INTO categories (name, sort_order, parent_id)
      SELECT ?, ?, id FROM categories WHERE name = ? AND parent_id IS NULL
    `);
    const stL3m = db.prepare(`
      INSERT OR IGNORE INTO categories (name, sort_order, parent_id)
      SELECT ?, ?, c.id FROM categories c
      JOIN categories p ON c.parent_id = p.id
      WHERE c.name = ? AND p.name = ?
    `);
    const l2m = [
      ['01.診療関係', 1, '01.のびのびマニュアル'],
      ['02.滅菌・消毒室', 2, '01.のびのびマニュアル'],
      ['03.ユニット関係、案内', 3, '01.のびのびマニュアル'],
      ['04.矯正', 4, '01.のびのびマニュアル'],
      ['05.インプラント', 5, '01.のびのびマニュアル'],
      ['06.レントゲン、口腔内写真', 6, '01.のびのびマニュアル'],
      ['07.ホワイトニング', 7, '01.のびのびマニュアル'],
      ['08..技術操作', 8, '01.のびのびマニュアル'],
      ['09.機械の操作', 9, '01.のびのびマニュアル'],
      ['10.受付、電話', 10, '01.のびのびマニュアル'],
      ['11.器具の個数', 11, '01.のびのびマニュアル'],
      ['12.品物管理、棚', 12, '01.のびのびマニュアル'],
      ['13.朝の準備', 13, '01.のびのびマニュアル'],
      ['14.帰りの片付け', 14, '01.のびのびマニュアル'],
      ['18.手が空いたときにやること', 18, '01.のびのびマニュアル'],
      ['19.ミーティング、勉強会', 19, '01.のびのびマニュアル'],
      ['21.ヘルプ', 21, '01.のびのびマニュアル'],
      ['22.訪問', 22, '01.のびのびマニュアル'],
      ['23.ほとんど使ってない機械など', 23, '01.のびのびマニュアル'],
      ['24.小児矯正', 24, '01.のびのびマニュアル'],
      ['99.その他', 99, '01.のびのびマニュアル'],
      ['プライムスキャン', 1, '04.プライムスキャン / プライムミル'],
      ['プライムミル', 2, '04.プライムスキャン / プライムミル'],
      ['01.オリエンテーション', 1, '05.入社時に確認する内容'],
      ['02.アカウント登録', 2, '05.入社時に確認する内容'],
      ['DHミーティング', 1, '08.ゆ未完成'],
      ['DrHRマニュアル', 2, '08.ゆ未完成'],
      ['説明', 3, '08.ゆ未完成'],
    ];
    for (const [n, s, p] of l2m) stL2m.run(n, s, p);
    const l3m = [
      ['01.C処・形成・セット関係', 1, '01.診療関係', '01.のびのびマニュアル'],
      ['02.根治関係・コア', 2, '01.診療関係', '01.のびのびマニュアル'],
      ['03.外科関係', 3, '01.診療関係', '01.のびのびマニュアル'],
      ['04.その他', 4, '01.診療関係', '01.のびのびマニュアル'],
      ['DH業務', 5, '01.診療関係', '01.のびのびマニュアル'],
      ['01.案内・片付け', 1, '03.ユニット関係、案内', '01.のびのびマニュアル'],
      ['02.ユニットのこと', 2, '03.ユニット関係、案内', '01.のびのびマニュアル'],
      ['01.検査', 1, '04.矯正', '01.のびのびマニュアル'],
      ['02.急速拡大', 2, '04.矯正', '01.のびのびマニュアル'],
      ['03.エンジェル', 3, '04.矯正', '01.のびのびマニュアル'],
      ['04.アライナー', 4, '04.矯正', '01.のびのびマニュアル'],
      ['05.インビザ', 5, '04.矯正', '01.のびのびマニュアル'],
      ['06.その他', 6, '04.矯正', '01.のびのびマニュアル'],
      ['01.アポツール関係', 1, '10.受付、電話', '01.のびのびマニュアル'],
      ['02.レジ関係', 2, '10.受付、電話', '01.のびのびマニュアル'],
      ['03.レセコン関係（資格証明書・医療書・マイナンバー）', 3, '10.受付、電話', '01.のびのびマニュアル'],
      ['04.電話関係', 4, '10.受付、電話', '01.のびのびマニュアル'],
      ['05.朝準備・締め作業', 5, '10.受付、電話', '01.のびのびマニュアル'],
      ['朝の準備サブ', 1, '13.朝の準備', '01.のびのびマニュアル'],
    ];
    for (const [n, s, p, gp] of l3m) stL3m.run(n, s, p, gp);
  }

  console.log('データベースを初期化しました');
}

module.exports = { getDb, initializeDb };
