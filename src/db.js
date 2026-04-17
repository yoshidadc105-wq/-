const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'manual_system.db');

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
      type TEXT NOT NULL CHECK(type IN ('pdf', 'rich_text')),
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS view_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manual_id INTEGER NOT NULL REFERENCES manuals(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      viewed_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_manuals_category ON manuals(category_id);
    CREATE INDEX IF NOT EXISTS idx_manuals_deleted ON manuals(is_deleted);
    CREATE INDEX IF NOT EXISTS idx_view_history_user ON view_history(user_id);
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
    const ins = db.prepare('INSERT INTO categories (name, sort_order, parent_id) VALUES (?, ?, ?)');
    const l1 = (name, sort) => ins.run(name, sort, null).lastInsertRowid;
    const l2 = (name, sort, pid) => ins.run(name, sort, pid).lastInsertRowid;

    // Level 1
    const nobinobiId = l1('01.のびのびマニュアル', 1);
    l1('02.技工', 2);
    l1('03.Dr.', 3);
    const primeId  = l1('04.プライムスキャン / プライムミル', 4);
    const nyushaId = l1('05.入社時に確認する内容', 5);
    l1('06.作成完了　みんなチェックしてねマニュアル', 6);
    l1('07.修正中　作成中　完了待ち', 7);
    const yuId     = l1('08.ゆ未完成', 8);
    l1('09.吉田未完成', 9);
    l1('10.編集が必要なマニュアル', 10);
    l1('11.使ってないマニュアル', 11);

    // Level 2 — 01.のびのびマニュアル
    const shinryoId = l2('01.診療関係', 1, nobinobiId);
    l2('02.滅菌・消毒室', 2, nobinobiId);
    const unitId    = l2('03.ユニット関係、案内', 3, nobinobiId);
    const kyoseiId  = l2('04.矯正', 4, nobinobiId);
    l2('05.インプラント', 5, nobinobiId);
    l2('06.レントゲン、口腔内写真', 6, nobinobiId);
    l2('07.ホワイトニング', 7, nobinobiId);
    l2('08..技術操作', 8, nobinobiId);
    l2('09.機械の操作', 9, nobinobiId);
    const uketsukId = l2('10.受付、電話', 10, nobinobiId);
    l2('11.器具の個数', 11, nobinobiId);
    l2('12.品物管理、棚', 12, nobinobiId);
    const asaId     = l2('13.朝の準備', 13, nobinobiId);
    l2('14.帰りの片付け', 14, nobinobiId);
    l2('18.手が空いたときにやること', 18, nobinobiId);
    l2('19.ミーティング、勉強会', 19, nobinobiId);
    l2('21.ヘルプ', 21, nobinobiId);
    l2('22.訪問', 22, nobinobiId);
    l2('23.ほとんど使ってない機械など', 23, nobinobiId);
    l2('24.小児矯正', 24, nobinobiId);
    l2('99.その他', 99, nobinobiId);

    // Level 2 — 04.プライムスキャン / プライムミル
    l2('プライムスキャン', 1, primeId);
    l2('プライムミル', 2, primeId);

    // Level 2 — 05.入社時に確認する内容
    l2('01.オリエンテーション', 1, nyushaId);
    l2('02.アカウント登録', 2, nyushaId);

    // Level 2 — 08.ゆ未完成
    l2('DHミーティング', 1, yuId);
    l2('DrHRマニュアル', 2, yuId);
    l2('説明', 3, yuId);

    // Level 3 — 01.診療関係
    l2('01.C処・形成・セット関係', 1, shinryoId);
    l2('02.根治関係・コア', 2, shinryoId);
    l2('03.外科関係', 3, shinryoId);
    l2('04.その他', 4, shinryoId);
    l2('DH業務', 5, shinryoId);

    // Level 3 — 03.ユニット関係、案内
    l2('01.案内・片付け', 1, unitId);
    l2('02.ユニットのこと', 2, unitId);

    // Level 3 — 04.矯正
    l2('01.検査', 1, kyoseiId);
    l2('02.急速拡大', 2, kyoseiId);
    l2('03.エンジェル', 3, kyoseiId);
    l2('04.アライナー', 4, kyoseiId);
    l2('05.インビザ', 5, kyoseiId);
    l2('06.その他', 6, kyoseiId);

    // Level 3 — 10.受付、電話
    l2('01.アポツール関係', 1, uketsukId);
    l2('02.レジ関係', 2, uketsukId);
    l2('03.レセコン関係（資格証明書・医療書・マイナンバー）', 3, uketsukId);
    l2('04.電話関係', 4, uketsukId);
    l2('05.朝準備・締め作業', 5, uketsukId);

    // Level 3 — 13.朝の準備
    l2('朝の準備サブ', 1, asaId);
  }

  // 既存DBマイグレーション：サブカテゴリが未登録なら追加
  const hasSubCats = db.prepare('SELECT id FROM categories WHERE parent_id IS NOT NULL LIMIT 1').get();
  if (!hasSubCats) {
    const get = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    const ins2 = db.prepare('INSERT OR IGNORE INTO categories (name, sort_order, parent_id) VALUES (?, ?, ?)');
    const m = (name, sort, pid) => ins2.run(name, sort, pid).lastInsertRowid;

    const nobinobi = get('01.のびのびマニュアル');
    const prime    = get('04.プライムスキャン / プライムミル');
    const nyusha   = get('05.入社時に確認する内容');
    const yu       = get('08.ゆ未完成');

    if (nobinobi) {
      const shinryoId = m('01.診療関係', 1, nobinobi.id);
      m('02.滅菌・消毒室', 2, nobinobi.id);
      const unitId    = m('03.ユニット関係、案内', 3, nobinobi.id);
      const kyoseiId  = m('04.矯正', 4, nobinobi.id);
      m('05.インプラント', 5, nobinobi.id);
      m('06.レントゲン、口腔内写真', 6, nobinobi.id);
      m('07.ホワイトニング', 7, nobinobi.id);
      m('08..技術操作', 8, nobinobi.id);
      m('09.機械の操作', 9, nobinobi.id);
      const uketsukId = m('10.受付、電話', 10, nobinobi.id);
      m('11.器具の個数', 11, nobinobi.id);
      m('12.品物管理、棚', 12, nobinobi.id);
      const asaId     = m('13.朝の準備', 13, nobinobi.id);
      m('14.帰りの片付け', 14, nobinobi.id);
      m('18.手が空いたときにやること', 18, nobinobi.id);
      m('19.ミーティング、勉強会', 19, nobinobi.id);
      m('21.ヘルプ', 21, nobinobi.id);
      m('22.訪問', 22, nobinobi.id);
      m('23.ほとんど使ってない機械など', 23, nobinobi.id);
      m('24.小児矯正', 24, nobinobi.id);
      m('99.その他', 99, nobinobi.id);

      m('01.C処・形成・セット関係', 1, shinryoId);
      m('02.根治関係・コア', 2, shinryoId);
      m('03.外科関係', 3, shinryoId);
      m('04.その他', 4, shinryoId);
      m('DH業務', 5, shinryoId);

      m('01.案内・片付け', 1, unitId);
      m('02.ユニットのこと', 2, unitId);

      m('01.検査', 1, kyoseiId);
      m('02.急速拡大', 2, kyoseiId);
      m('03.エンジェル', 3, kyoseiId);
      m('04.アライナー', 4, kyoseiId);
      m('05.インビザ', 5, kyoseiId);
      m('06.その他', 6, kyoseiId);

      m('01.アポツール関係', 1, uketsukId);
      m('02.レジ関係', 2, uketsukId);
      m('03.レセコン関係（資格証明書・医療書・マイナンバー）', 3, uketsukId);
      m('04.電話関係', 4, uketsukId);
      m('05.朝準備・締め作業', 5, uketsukId);

      m('朝の準備サブ', 1, asaId);
    }
    if (prime)  { m('プライムスキャン', 1, prime.id); m('プライムミル', 2, prime.id); }
    if (nyusha) { m('01.オリエンテーション', 1, nyusha.id); m('02.アカウント登録', 2, nyusha.id); }
    if (yu)     { m('DHミーティング', 1, yu.id); m('DrHRマニュアル', 2, yu.id); m('説明', 3, yu.id); }
  }

  console.log('データベースを初期化しました');
}

module.exports = { getDb, initializeDb };
