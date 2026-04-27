const express = require('express');
const db = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// 使用記録（在庫を減らす）
router.post('/use', authMiddleware, (req, res) => {
  const { product_id, quantity, note } = req.body;
  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '商品と数量を正しく入力してください' });
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: '商品が見つかりません' });
  if (product.stock < quantity) {
    return res.status(400).json({ error: `在庫が不足しています（現在: ${product.stock}個）` });
  }

  db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run([quantity, product_id]);
  db.prepare('INSERT INTO usage_logs (product_id, quantity, user_id, note) VALUES (?, ?, ?, ?)').run([product_id, quantity, req.user.id, note || null]);

  const updated = db.prepare('SELECT stock FROM products WHERE id = ?').get(product_id);
  res.json({ message: '使用を記録しました', remaining_stock: updated.stock });
});

// 入荷記録（在庫を増やす）
router.post('/receive', authMiddleware, (req, res) => {
  const { product_id, quantity, note } = req.body;
  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '商品と数量を正しく入力してください' });
  }

  db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run([quantity, product_id]);
  db.prepare('INSERT INTO stock_logs (product_id, quantity, user_id, note) VALUES (?, ?, ?, ?)').run([product_id, quantity, req.user.id, note || null]);

  const updated = db.prepare('SELECT stock FROM products WHERE id = ?').get(product_id);
  res.json({ message: '入荷を記録しました', current_stock: updated.stock });
});

// 使用履歴
router.get('/usage/:product_id', authMiddleware, (req, res) => {
  const logs = db.prepare(`
    SELECT ul.*, u.display_name FROM usage_logs ul
    LEFT JOIN users u ON ul.user_id = u.id
    WHERE ul.product_id = ?
    ORDER BY ul.logged_at DESC
    LIMIT 50
  `).all(req.params.product_id);
  res.json(logs);
});

// 入荷履歴
router.get('/stock/:product_id', authMiddleware, (req, res) => {
  const logs = db.prepare(`
    SELECT sl.*, u.display_name FROM stock_logs sl
    LEFT JOIN users u ON sl.user_id = u.id
    WHERE sl.product_id = ?
    ORDER BY sl.logged_at DESC
    LIMIT 50
  `).all(req.params.product_id);
  res.json(logs);
});

module.exports = router;
