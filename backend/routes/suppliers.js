const express = require('express');
const { pool } = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM suppliers ORDER BY sort_order ASC, id ASC');
  res.json(rows);
});

router.post('/', authMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '名前を入力してください' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO suppliers (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'すでに登録されています' });
    throw e;
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  await pool.query('DELETE FROM suppliers WHERE id = $1', [req.params.id]);
  res.json({ message: '削除しました' });
});

module.exports = router;
