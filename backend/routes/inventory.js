const express = require('express');
const db = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// 使用記録（在庫を減らす）- FIFO lot deduction
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

  // FIFO: deduct from lots with earliest expiry_date first
  const lots = db.prepare('SELECT * FROM product_lots WHERE product_id = ? AND quantity > 0 ORDER BY expiry_date ASC').all(product_id);
  let remaining = parseInt(quantity);
  for (const lot of lots) {
    if (remaining <= 0) break;
    const deduct = Math.min(lot.quantity, remaining);
    db.prepare('UPDATE product_lots SET quantity = quantity - ? WHERE id = ?').run(deduct, lot.id);
    remaining -= deduct;
  }
  // Delete empty lots
  db.prepare('DELETE FROM product_lots WHERE product_id = ? AND quantity <= 0').run(product_id);

  db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(quantity, product_id);
  db.prepare('INSERT INTO usage_logs (product_id, quantity, user_id, note) VALUES (?, ?, ?, ?)').run(product_id, quantity, req.user.id, note || null);

  const updated = db.prepare('SELECT stock FROM products WHERE id = ?').get(product_id);
  res.json({ message: '使用を記録しました', remaining_stock: updated.stock });
});

// 入荷記録（在庫を増やす）
router.post('/receive', authMiddleware, (req, res) => {
  const { product_id, quantity, note, expiry_date } = req.body;
  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '商品と数量を正しく入力してください' });
  }

  db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(quantity, product_id);
  db.prepare('INSERT INTO stock_logs (product_id, quantity, expiry_date, user_id, note) VALUES (?, ?, ?, ?, ?)').run(product_id, quantity, expiry_date || null, req.user.id, note || null);

  if (expiry_date) {
    // Add or update lot
    const existingLot = db.prepare('SELECT * FROM product_lots WHERE product_id = ? AND expiry_date = ?').get(product_id, expiry_date);
    if (existingLot) {
      db.prepare('UPDATE product_lots SET quantity = quantity + ? WHERE id = ?').run(quantity, existingLot.id);
    } else {
      db.prepare('INSERT INTO product_lots (product_id, expiry_date, quantity) VALUES (?, ?, ?)').run(product_id, expiry_date, quantity);
    }
  }

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

// 統合履歴（使用 + 入荷）
router.get('/history/:product_id', authMiddleware, (req, res) => {
  const useLogs = db.prepare(`
    SELECT ul.quantity, u.display_name, ul.logged_at, 'use' as type, NULL as expiry_date
    FROM usage_logs ul
    LEFT JOIN users u ON ul.user_id = u.id
    WHERE ul.product_id = ?
  `).all(req.params.product_id);

  const stockLogs = db.prepare(`
    SELECT sl.quantity, u.display_name, sl.logged_at, 'receive' as type, sl.expiry_date
    FROM stock_logs sl
    LEFT JOIN users u ON sl.user_id = u.id
    WHERE sl.product_id = ?
  `).all(req.params.product_id);

  const combined = [...useLogs, ...stockLogs].sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at));
  res.json(combined);
});

module.exports = router;
