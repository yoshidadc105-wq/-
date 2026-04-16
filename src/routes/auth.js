const express = require('express');
const bcrypt = require('bcrypt');
const { getDb } = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// ログイン
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
  }

  // 最終ログイン日時を更新
  db.prepare("UPDATE users SET last_login = datetime('now', 'localtime') WHERE id = ?").run(user.id);

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.displayName = user.display_name;
  req.session.role = user.role;

  res.json({
    message: 'ログインしました',
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role
    }
  });
});

// ログアウト
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'ログアウトしました' });
  });
});

// 現在のログインユーザー情報取得
router.get('/me', requireLogin, (req, res) => {
  res.json({
    id: req.session.userId,
    username: req.session.username,
    displayName: req.session.displayName,
    role: req.session.role
  });
});

// パスワード変更
router.post('/change-password', requireLogin, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: '現在のパスワードと新しいパスワードを入力してください' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: '現在のパスワードが正しくありません' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.session.userId);

  res.json({ message: 'パスワードを変更しました' });
});

module.exports = router;
