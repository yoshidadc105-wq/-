const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ユーザー一覧取得
router.get('/users', requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT id, username, display_name, email, role, is_active, created_at, last_login
    FROM users
    ORDER BY created_at DESC
  `).all();
  res.json(users);
});

// ユーザー作成
router.post('/users', requireAdmin, (req, res) => {
  let { username, display_name, email, password, role } = req.body;

  if (!display_name || !email || !password) {
    return res.status(400).json({ error: '表示名・メール・パスワードは必須です' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
  }

  const db = getDb();

  // ユーザー名が未指定の場合はメールアドレスから自動生成
  if (!username) {
    const base = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase() || 'user';
    let candidate = base;
    let suffix = 1;
    while (db.prepare('SELECT id FROM users WHERE username = ?').get(candidate)) {
      candidate = base + suffix;
      suffix++;
    }
    username = candidate;
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare(`
      INSERT INTO users (username, display_name, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, display_name, email, hash, role === 'admin' ? 'admin' : 'user');
    res.status(201).json({ id: result.lastInsertRowid, message: 'ユーザーを作成しました' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'そのメールアドレスはすでに使用されています' });
    }
    throw e;
  }
});

// ユーザー更新
router.put('/users/:id', requireAdmin, (req, res) => {
  const { display_name, email, role, is_active, password } = req.body;
  const { id } = req.params;

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });

  // 自分自身の管理者権限を削除・無効化は禁止
  if (parseInt(id) === req.session.userId) {
    if (role && role !== 'admin') {
      return res.status(400).json({ error: '自分の管理者権限は変更できません' });
    }
    if (is_active === 0 || is_active === false) {
      return res.status(400).json({ error: '自分のアカウントを無効化できません' });
    }
  }

  let updates = ['display_name = ?', 'email = ?', 'role = ?', 'is_active = ?'];
  let values = [
    display_name || user.display_name,
    email || user.email,
    role === 'admin' ? 'admin' : 'user',
    is_active !== undefined ? (is_active ? 1 : 0) : user.is_active
  ];

  if (password) {
    if (password.length < 6) {
      return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
    }
    updates.push('password_hash = ?');
    values.push(bcrypt.hashSync(password, 10));
  }

  values.push(id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ message: 'ユーザーを更新しました' });
});

// ユーザー削除
router.delete('/users/:id', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id);

  if (userId === req.session.userId) {
    return res.status(400).json({ error: '自分のアカウントは削除できません' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!existing) return res.status(404).json({ error: 'ユーザーが見つかりません' });

  try {
    const adminId = req.session.userId;
    // 外部キー制約を解消してから削除
    db.prepare('UPDATE manuals SET created_by = ? WHERE created_by = ?').run(adminId, userId);
    db.prepare('UPDATE manuals SET updated_by = ? WHERE updated_by = ?').run(adminId, userId);
    db.prepare('DELETE FROM view_history WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.json({ message: 'ユーザーを削除しました' });
  } catch (e) {
    res.status(500).json({ error: '削除に失敗しました: ' + e.message });
  }
});

// URL登録用マニュアル全件取得（管理者のみ）
router.get('/manuals-for-url', requireAdmin, (req, res) => {
  const db = getDb();
  const { q } = req.query;
  let sql = 'SELECT id, title, type FROM manuals WHERE is_deleted = 0';
  const params = [];
  if (q && q.trim()) {
    sql += ' AND title LIKE ?';
    params.push(`%${q.trim()}%`);
  }
  sql += ' ORDER BY title';
  const manuals = db.prepare(sql).all(...params);
  res.json(manuals);
});

// 統計情報
router.get('/stats', requireAdmin, (req, res) => {
  const db = getDb();
  const stats = {
    totalManuals: db.prepare('SELECT COUNT(*) as c FROM manuals WHERE is_deleted = 0').get().c,
    pdfManuals: db.prepare("SELECT COUNT(*) as c FROM manuals WHERE is_deleted = 0 AND type = 'pdf'").get().c,
    textManuals: db.prepare("SELECT COUNT(*) as c FROM manuals WHERE is_deleted = 0 AND type = 'rich_text'").get().c,
    totalUsers: db.prepare('SELECT COUNT(*) as c FROM users WHERE is_active = 1').get().c,
    totalCategories: db.prepare('SELECT COUNT(*) as c FROM categories').get().c,
    recentViews: db.prepare("SELECT COUNT(*) as c FROM view_history WHERE viewed_at > datetime('now', '-7 days', 'localtime')").get().c
  };
  res.json(stats);
});

module.exports = router;
