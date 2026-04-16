const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'manual_system.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initializeDb() {
  const db = getDb();

  // ユーザーテーブル
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

  // カテゴリテーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // マニュアルテーブル
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

  // 閲覧履歴テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS view_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manual_id INTEGER NOT NULL REFERENCES manuals(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      viewed_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 検索用インデックス
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_manuals_category ON manuals(category_id);
    CREATE INDEX IF NOT EXISTS idx_manuals_created_by ON manuals(created_by);
    CREATE INDEX IF NOT EXISTS idx_manuals_deleted ON manuals(is_deleted);
    CREATE INDEX IF NOT EXISTS idx_view_history_user ON view_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_view_history_manual ON view_history(manual_id);
  `);

  // 初期管理者アカウントの作成（存在しない場合のみ）
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (username, display_name, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `).run('admin', '管理者', 'admin@example.com', hash, 'admin');
    console.log('初期管理者アカウントを作成しました: admin / admin123');
  }

  // デフォルトカテゴリの作成（存在しない場合のみ）
  const categoryExists = db.prepare('SELECT id FROM categories LIMIT 1').get();
  if (!categoryExists) {
    const insert = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
    insert.run('業務マニュアル', 1);
    insert.run('規程・規則', 2);
    insert.run('研修資料', 3);
    insert.run('その他', 99);
  }

  console.log('データベースを初期化しました');
}

module.exports = { getDb, initializeDb };
