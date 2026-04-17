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
    const insL1 = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
    const insL2 = db.prepare('INSERT INTO categories (name, sort_order, parent_id) VALUES (?, ?, ?)');
    const getId = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;

    // Level 1
    insL1.run('01.のびのびマニュアル', 1);
    insL1.run('02.技工', 2);
    insL1.run('03.Dr.', 3);
    insL1.run('04.プライムスキャン / プライムミル', 4);
    insL1.run('05.入社時に確認する内容', 5);
    insL1.run('06.作成完了　みんなチェックしてねマニュアル', 6);
    insL1.run('07.修正中　作成中　完了待ち', 7);
    insL1.run('08.ゆ未完成', 8);
    insL1.run('09.吉田未完成', 9);
    insL1.run('10.編集が必要なマニュアル', 10);
    insL1.run('11.使ってないマニュアル', 11);

    // IDを名前で取得
    const nobinobiId = getId('01.のびのびマニュアル');
    const primeId    = getId('04.プライムスキャン / プライムミル');
    const nyushaId   = getId('05.入社時に確認する内容');
    const yuId       = getId('08.ゆ未完成');

    // Level 2 — 01.のびのびマニュアル
    insL2.run('01.診療関係', 1, nobinobiId);
    insL2.run('02.滅菌・消毒室', 2, nobinobiId);
    insL2.run('03.ユニット関係、案内', 3, nobinobiId);
    insL2.run('04.矯正', 4, nobinobiId);
    insL2.run('05.インプラント', 5, nobinobiId);
    insL2.run('06.レントゲン、口腔内写真', 6, nobinobiId);
    insL2.run('07.ホワイトニング', 7, nobinobiId);
    insL2.run('08..技術操作', 8, nobinobiId);
    insL2.run('09.機械の操作', 9, nobinobiId);
    insL2.run('10.受付、電話', 10, nobinobiId);
    insL2.run('11.器具の個数', 11, nobinobiId);
    insL2.run('12.品物管理、棚', 12, nobinobiId);
    insL2.run('13.朝の準備', 13, nobinobiId);
    insL2.run('14.帰りの片付け', 14, nobinobiId);
    insL2.run('18.手が空いたときにやること', 18, nobinobiId);
    insL2.run('19.ミーティング、勉強会', 19, nobinobiId);
    insL2.run('21.ヘルプ', 21, nobinobiId);
    insL2.run('22.訪問', 22, nobinobiId);
    insL2.run('23.ほとんど使ってない機械など', 23, nobinobiId);
    insL2.run('24.小児矯正', 24, nobinobiId);
    insL2.run('99.その他', 99, nobinobiId);

    // Level 2 — 04.プライムスキャン / プライムミル
    insL2.run('プライムスキャン', 1, primeId);
    insL2.run('プライムミル', 2, primeId);

    // Level 2 — 05.入社時に確認する内容
    insL2.run('01.オリエンテーション', 1, nyushaId);
    insL2.run('02.アカウント登録', 2, nyushaId);

    // Level 2 — 08.ゆ未完成
    insL2.run('DHミーティング', 1, yuId);
    insL2.run('DrHRマニュアル', 2, yuId);
    insL2.run('説明', 3, yuId);

    // Level 3 — IDをここで取得
    const shinryoId = getId('01.診療関係');
    const unitId    = getId('03.ユニット関係、案内');
    const kyoseiId  = getId('04.矯正');
    const uketsukId = getId('10.受付、電話');
    const asaId     = getId('13.朝の準備');

    insL2.run('01.C処・形成・セット関係', 1, shinryoId);
    insL2.run('02.根治関係・コア', 2, shinryoId);
    insL2.run('03.外科関係', 3, shinryoId);
    insL2.run('04.その他', 4, shinryoId);
    insL2.run('DH業務', 5, shinryoId);

    insL2.run('01.案内・片付け', 1, unitId);
    insL2.run('02.ユニットのこと', 2, unitId);

    insL2.run('01.検査', 1, kyoseiId);
    insL2.run('02.急速拡大', 2, kyoseiId);
    insL2.run('03.エンジェル', 3, kyoseiId);
    insL2.run('04.アライナー', 4, kyoseiId);
    insL2.run('05.インビザ', 5, kyoseiId);
    insL2.run('06.その他', 6, kyoseiId);

    insL2.run('01.アポツール関係', 1, uketsukId);
    insL2.run('02.レジ関係', 2, uketsukId);
    insL2.run('03.レセコン関係（資格証明書・医療書・マイナンバー）', 3, uketsukId);
    insL2.run('04.電話関係', 4, uketsukId);
    insL2.run('05.朝準備・締め作業', 5, uketsukId);

    insL2.run('朝の準備サブ', 1, asaId);
  }

  // 既存DBマイグレーション：サブカテゴリが未登録なら追加
  const hasSubCats = db.prepare('SELECT id FROM categories WHERE parent_id IS NOT NULL LIMIT 1').get();
  if (!hasSubCats) {
    const insL2m = db.prepare('INSERT OR IGNORE INTO categories (name, sort_order, parent_id) VALUES (?, ?, ?)');
    const get = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name);

    const nobinobi = get('01.のびのびマニュアル');
    const prime    = get('04.プライムスキャン / プライムミル');
    const nyusha   = get('05.入社時に確認する内容');
    const yu       = get('08.ゆ未完成');

    if (nobinobi) {
      insL2m.run('01.診療関係', 1, nobinobi.id);
      insL2m.run('02.滅菌・消毒室', 2, nobinobi.id);
      insL2m.run('03.ユニット関係、案内', 3, nobinobi.id);
      insL2m.run('04.矯正', 4, nobinobi.id);
      insL2m.run('05.インプラント', 5, nobinobi.id);
      insL2m.run('06.レントゲン、口腔内写真', 6, nobinobi.id);
      insL2m.run('07.ホワイトニング', 7, nobinobi.id);
      insL2m.run('08..技術操作', 8, nobinobi.id);
      insL2m.run('09.機械の操作', 9, nobinobi.id);
      insL2m.run('10.受付、電話', 10, nobinobi.id);
      insL2m.run('11.器具の個数', 11, nobinobi.id);
      insL2m.run('12.品物管理、棚', 12, nobinobi.id);
      insL2m.run('13.朝の準備', 13, nobinobi.id);
      insL2m.run('14.帰りの片付け', 14, nobinobi.id);
      insL2m.run('18.手が空いたときにやること', 18, nobinobi.id);
      insL2m.run('19.ミーティング、勉強会', 19, nobinobi.id);
      insL2m.run('21.ヘルプ', 21, nobinobi.id);
      insL2m.run('22.訪問', 22, nobinobi.id);
      insL2m.run('23.ほとんど使ってない機械など', 23, nobinobi.id);
      insL2m.run('24.小児矯正', 24, nobinobi.id);
      insL2m.run('99.その他', 99, nobinobi.id);

      const getL2 = (name) => db.prepare('SELECT id FROM categories WHERE name = ? AND parent_id = ?').get(name, nobinobi.id);
      const shinryo = getL2('01.診療関係');
      const unit    = getL2('03.ユニット関係、案内');
      const kyosei  = getL2('04.矯正');
      const uketsuk = getL2('10.受付、電話');
      const asa     = getL2('13.朝の準備');

      if (shinryo) {
        insL2m.run('01.C処・形成・セット関係', 1, shinryo.id);
        insL2m.run('02.根治関係・コア', 2, shinryo.id);
        insL2m.run('03.外科関係', 3, shinryo.id);
        insL2m.run('04.その他', 4, shinryo.id);
        insL2m.run('DH業務', 5, shinryo.id);
      }
      if (unit) {
        insL2m.run('01.案内・片付け', 1, unit.id);
        insL2m.run('02.ユニットのこと', 2, unit.id);
      }
      if (kyosei) {
        insL2m.run('01.検査', 1, kyosei.id);
        insL2m.run('02.急速拡大', 2, kyosei.id);
        insL2m.run('03.エンジェル', 3, kyosei.id);
        insL2m.run('04.アライナー', 4, kyosei.id);
        insL2m.run('05.インビザ', 5, kyosei.id);
        insL2m.run('06.その他', 6, kyosei.id);
      }
      if (uketsuk) {
        insL2m.run('01.アポツール関係', 1, uketsuk.id);
        insL2m.run('02.レジ関係', 2, uketsuk.id);
        insL2m.run('03.レセコン関係（資格証明書・医療書・マイナンバー）', 3, uketsuk.id);
        insL2m.run('04.電話関係', 4, uketsuk.id);
        insL2m.run('05.朝準備・締め作業', 5, uketsuk.id);
      }
      if (asa) insL2m.run('朝の準備サブ', 1, asa.id);
    }
    if (prime)  { insL2m.run('プライムスキャン', 1, prime.id); insL2m.run('プライムミル', 2, prime.id); }
    if (nyusha) { insL2m.run('01.オリエンテーション', 1, nyusha.id); insL2m.run('02.アカウント登録', 2, nyusha.id); }
    if (yu)     { insL2m.run('DHミーティング', 1, yu.id); insL2m.run('DrHRマニュアル', 2, yu.id); insL2m.run('説明', 3, yu.id); }
  }

  console.log('データベースを初期化しました');
}

module.exports = { getDb, initializeDb };
