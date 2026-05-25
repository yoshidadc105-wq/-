const express = require('express');
const db = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ロット削除（在庫から差し引く）
router.delete('/:id', authMiddleware, (req, res) => {
  const lot = db.prepare('SELECT * FROM product_lots WHERE id = ?').get(req.params.id);
  if (!lot) return res.status(404).json({ error: 'ロットが見つかりません' });

  // Subtract lot quantity from product stock
  db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?').run(lot.quantity, lot.product_id);
  db.prepare('DELETE FROM product_lots WHERE id = ?').run(req.params.id);

  res.json({ message: 'ロットを削除しました' });
});

module.exports = router;
