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
  const { username, display_name, email, password, role } = req.body;

  if (!username || !display_name || !email || !password) {
    return res.status(400).json({ error: 'ユーザー名・表示名・メール・パスワードは必須です' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
  }

  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare(`
      INSERT INTO users (username, display_name, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, display_name, email, hash, role === 'admin' ? 'admin' : 'user');
    res.status(201).json({ id: result.lastInsertRowid, message: 'ユーザーを作成しました' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'そのユーザー名またはメールアドレスはすでに使用されています' });
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
  const { id } = req.params;

  if (parseInt(id) === req.session.userId) {
    return res.status(400).json({ error: '自分のアカウントは削除できません' });
  }

  const db = getDb();
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  res.json({ message: 'ユーザーを削除しました' });
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
