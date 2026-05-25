const express = require('express');
const { pool } = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// プレビュー（バリデーションして返す）
router.post('/preview', authMiddleware, (req, res) => {
  const products = req.body;
  if (!Array.isArray(products)) return res.status(400).json({ error: '配列で送信してください' });

  // Validate each entry
  const validated = products.map((p, i) => ({
    name: p.name || '',
    maker: p.maker || '',
    item_code: p.item_code || '',
    category: p.category || '',
    stock: parseInt(p.stock) || 0,
    alert_threshold: parseInt(p.alert_threshold) || 5,
    expiry_date: p.expiry_date || '',
  }));

  res.json(validated);
});

// 取込実行
router.post('/execute', authMiddleware, async (req, res) => {
  const products = req.body;
  if (!Array.isArray(products)) return res.status(400).json({ error: '配列で送信してください' });

  let count = 0;
  for (const p of products) {
    if (!p.name) continue;
    const result = await pool.query(
      'INSERT INTO products (name, maker, item_code, category, stock, alert_threshold) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [p.name, p.maker || null, p.item_code || null, p.category || null, parseInt(p.stock) || 0, parseInt(p.alert_threshold) || 5]
    );

    // If expiry_date provided, add a lot
    const newId = result.rows[0].id;
    if (p.expiry_date && newId) {
      const qty = parseInt(p.stock) || 0;
      if (qty > 0) {
        await pool.query('INSERT INTO product_lots (product_id, expiry_date, quantity) VALUES ($1, $2, $3)', [newId, p.expiry_date, qty]);
      }
    }
    count++;
  }

  res.json({ count, message: `${count}件の商品を取り込みました` });
});

module.exports = router;
