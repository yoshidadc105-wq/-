const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dental-inventory-secret-key-2024';

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });

  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, displayName: user.display_name });
});

router.post('/register', async (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password || !displayName) return res.status(400).json({ error: '全ての項目を入力してください' });

  try {
    const hashed = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password, display_name) VALUES ($1, $2, $3) RETURNING id',
      [username, hashed, displayName]
    );
    const token = jwt.sign({ id: result.rows[0].id, username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, displayName });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'そのユーザー名は既に使われています' });
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

router.get('/me', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '未認証' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query('SELECT id, username, display_name FROM users WHERE id = $1', [payload.id]);
    res.json(rows[0]);
  } catch {
    res.status(401).json({ error: 'トークンが無効です' });
  }
});

module.exports = router;
