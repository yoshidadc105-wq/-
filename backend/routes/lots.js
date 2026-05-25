const express = require('express');
const { pool } = require('../database');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

router.delete('/:id', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM product_lots WHERE id = $1', [req.params.id]);
  const lot = rows[0];
  if (!lot) return res.status(404).json({ error: 'ロットが見つかりません' });

  await pool.query('UPDATE products SET stock = GREATEST(0, stock - $1) WHERE id = $2', [lot.quantity, lot.product_id]);
  await pool.query('DELETE FROM product_lots WHERE id = $1', [req.params.id]);

  res.json({ message: 'ロットを削除しました' });
});

module.exports = router;
