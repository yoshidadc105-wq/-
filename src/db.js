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
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'all',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

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
    const insert = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
    insert.run('01.のびのびマニュアル', 1);
    insert.run('02.技工', 2);
    insert.run('03.Dr.', 3);
    insert.run('04.プライムスキャン / プライムミル', 4);
    insert.run('05.入社時に確認する内容', 5);
    insert.run('06.作成完了　みんなチェックしてねマニュアル', 6);
    insert.run('07.修正中　作成中　完了待ち', 7);
    insert.run('08.ゆ未完成', 8);
    insert.run('09.吉田未完成', 9);
    insert.run('10.編集が必要なマニュアル', 10);
    insert.run('11.使ってないマニュアル', 11);
  }

  console.log('データベースを初期化しました');
}

module.exports = { getDb, initializeDb };
