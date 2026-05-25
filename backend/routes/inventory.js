const express = require('express');
const { pool } = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// 全商品の統合履歴
router.get('/history', authMiddleware, async (req, res) => {
  const { rows: useLogs } = await pool.query(`
    SELECT ul.id, ul.product_id, ul.quantity, u.display_name, ul.logged_at, 'use' as type, NULL as expiry_date, p.name as product_name
    FROM usage_logs ul
    LEFT JOIN users u ON ul.user_id = u.id
    LEFT JOIN products p ON ul.product_id = p.id
    ORDER BY ul.logged_at DESC
    LIMIT 200
  `);
  const { rows: stockLogs } = await pool.query(`
    SELECT sl.id, sl.product_id, sl.quantity, u.display_name, sl.logged_at, 'receive' as type, sl.expiry_date, p.name as product_name
    FROM stock_logs sl
    LEFT JOIN users u ON sl.user_id = u.id
    LEFT JOIN products p ON sl.product_id = p.id
    ORDER BY sl.logged_at DESC
    LIMIT 200
  `);
  const combined = [...useLogs, ...stockLogs].sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at)).slice(0, 200);
  res.json(combined);
});

// 使用記録（在庫を減らす）- FIFO lot deduction
router.post('/use', authMiddleware, async (req, res) => {
  const { product_id, quantity, note } = req.body;
  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '商品と数量を正しく入力してください' });
  }

  const { rows: productRows } = await pool.query('SELECT * FROM products WHERE id = $1', [product_id]);
  const product = productRows[0];
  if (!product) return res.status(404).json({ error: '商品が見つかりません' });
  if (product.stock < quantity) {
    return res.status(400).json({ error: `在庫が不足しています（現在: ${product.stock}個）` });
  }

  // FIFO: deduct from lots with earliest expiry_date first
  const { rows: lots } = await pool.query('SELECT * FROM product_lots WHERE product_id = $1 AND quantity > 0 ORDER BY expiry_date ASC', [product_id]);
  let remaining = parseInt(quantity);
  for (const lot of lots) {
    if (remaining <= 0) break;
    const deduct = Math.min(lot.quantity, remaining);
    await pool.query('UPDATE product_lots SET quantity = quantity - $1 WHERE id = $2', [deduct, lot.id]);
    remaining -= deduct;
  }
  // Delete empty lots
  await pool.query('DELETE FROM product_lots WHERE product_id = $1 AND quantity <= 0', [product_id]);

  await pool.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [quantity, product_id]);
  await pool.query('INSERT INTO usage_logs (product_id, quantity, user_id, note) VALUES ($1, $2, $3, $4)', [product_id, quantity, req.user.id, note || null]);

  const { rows: updatedRows } = await pool.query('SELECT stock FROM products WHERE id = $1', [product_id]);
  res.json({ message: '使用を記録しました', remaining_stock: updatedRows[0].stock });
});

// 入荷記録（在庫を増やす）
router.post('/receive', authMiddleware, async (req, res) => {
  const { product_id, quantity, note, expiry_date } = req.body;
  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '商品と数量を正しく入力してください' });
  }

  await pool.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [quantity, product_id]);
  await pool.query('INSERT INTO stock_logs (product_id, quantity, expiry_date, user_id, note) VALUES ($1, $2, $3, $4, $5)', [product_id, quantity, expiry_date || null, req.user.id, note || null]);

  if (expiry_date) {
    // Add or update lot
    const { rows: existingLots } = await pool.query('SELECT * FROM product_lots WHERE product_id = $1 AND expiry_date = $2', [product_id, expiry_date]);
    const existingLot = existingLots[0];
    if (existingLot) {
      await pool.query('UPDATE product_lots SET quantity = quantity + $1 WHERE id = $2', [quantity, existingLot.id]);
    } else {
      await pool.query('INSERT INTO product_lots (product_id, expiry_date, quantity) VALUES ($1, $2, $3)', [product_id, expiry_date, quantity]);
    }
  }

  const { rows: updatedRows } = await pool.query('SELECT stock FROM products WHERE id = $1', [product_id]);
  res.json({ message: '入荷を記録しました', current_stock: updatedRows[0].stock });
});

// 使用履歴
router.get('/usage/:product_id', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT ul.*, u.display_name FROM usage_logs ul
    LEFT JOIN users u ON ul.user_id = u.id
    WHERE ul.product_id = $1
    ORDER BY ul.logged_at DESC
    LIMIT 50
  `, [req.params.product_id]);
  res.json(rows);
});

// 入荷履歴
router.get('/stock/:product_id', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT sl.*, u.display_name FROM stock_logs sl
    LEFT JOIN users u ON sl.user_id = u.id
    WHERE sl.product_id = $1
    ORDER BY sl.logged_at DESC
    LIMIT 50
  `, [req.params.product_id]);
  res.json(rows);
});

// 統合履歴（使用 + 入荷）
router.get('/history/:product_id', authMiddleware, async (req, res) => {
  const { rows: useLogs } = await pool.query(`
    SELECT ul.quantity, u.display_name, ul.logged_at, 'use' as type, NULL as expiry_date
    FROM usage_logs ul
    LEFT JOIN users u ON ul.user_id = u.id
    WHERE ul.product_id = $1
  `, [req.params.product_id]);

  const { rows: stockLogs } = await pool.query(`
    SELECT sl.quantity, u.display_name, sl.logged_at, 'receive' as type, sl.expiry_date
    FROM stock_logs sl
    LEFT JOIN users u ON sl.user_id = u.id
    WHERE sl.product_id = $1
  `, [req.params.product_id]);

  const combined = [...useLogs, ...stockLogs].sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at));
  res.json(combined);
});

module.exports = router;
