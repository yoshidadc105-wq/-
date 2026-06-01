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

// 使用記録（在庫を減らす）
router.post('/use', authMiddleware, async (req, res) => {
  const { product_id, quantity, note, lot_id } = req.body;
  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '商品と数量を正しく入力してください' });
  }

  const { rows: productRows } = await pool.query('SELECT * FROM products WHERE id = $1', [product_id]);
  const product = productRows[0];
  if (!product) return res.status(404).json({ error: '商品が見つかりません' });
  if (product.stock < quantity) {
    return res.status(400).json({ error: `在庫が不足しています（現在: ${product.stock}${product.unit || '個'}）` });
  }

  if (lot_id) {
    // 指定ロットから減らす
    const { rows: lotRows } = await pool.query('SELECT * FROM product_lots WHERE id = $1', [lot_id]);
    const lot = lotRows[0];
    if (!lot) return res.status(404).json({ error: 'ロットが見つかりません' });
    if (lot.quantity < quantity) {
      return res.status(400).json({ error: `このロットの在庫が不足しています（残: ${lot.quantity}${product.unit || '個'}）` });
    }
    await pool.query('UPDATE product_lots SET quantity = quantity - $1 WHERE id = $2', [quantity, lot_id]);
  } else {
    // FIFO: 期限が早い順に減らす
    const { rows: lots } = await pool.query('SELECT * FROM product_lots WHERE product_id = $1 AND quantity > 0 ORDER BY expiry_date ASC NULLS LAST', [product_id]);
    let remaining = parseInt(quantity);
    for (const lot of lots) {
      if (remaining <= 0) break;
      const deduct = Math.min(lot.quantity, remaining);
      await pool.query('UPDATE product_lots SET quantity = quantity - $1 WHERE id = $2', [deduct, lot.id]);
      remaining -= deduct;
    }
  }
  await pool.query('DELETE FROM product_lots WHERE product_id = $1 AND quantity <= 0', [product_id]);
  await pool.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [quantity, product_id]);
  await pool.query('INSERT INTO usage_logs (product_id, quantity, user_id, note) VALUES ($1, $2, $3, $4)', [product_id, quantity, req.user.id, note || null]);

  const { rows: updatedRows } = await pool.query('SELECT stock FROM products WHERE id = $1', [product_id]);
  res.json({ message: '使用を記録しました', remaining_stock: updatedRows[0].stock });
});

// 入荷記録（在庫を増やす）
router.post('/receive', authMiddleware, async (req, res) => {
  const { product_id, quantity, note, expiry_date, package_label, supplier_name, unit_price } = req.body;
  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '商品と数量を正しく入力してください' });
  }

  await pool.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [quantity, product_id]);
  await pool.query(
    'INSERT INTO stock_logs (product_id, quantity, expiry_date, user_id, note, supplier_name, unit_price) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [product_id, quantity, expiry_date || null, req.user.id, note || null, supplier_name || null, unit_price ? parseInt(unit_price) : null]
  );

  // Add or update lot (match on both expiry_date and package_label)
  const { rows } = await pool.query(
    'SELECT * FROM product_lots WHERE product_id = $1 AND expiry_date IS NOT DISTINCT FROM $2 AND package_label IS NOT DISTINCT FROM $3',
    [product_id, expiry_date || null, package_label || null]
  );
  const existingLot = rows[0];
  if (existingLot) {
    await pool.query('UPDATE product_lots SET quantity = quantity + $1 WHERE id = $2', [quantity, existingLot.id]);
  } else {
    await pool.query('INSERT INTO product_lots (product_id, expiry_date, quantity, package_label) VALUES ($1, $2, $3, $4)', [product_id, expiry_date || null, quantity, package_label || null]);
  }

  const { rows: updatedRows } = await pool.query('SELECT stock FROM products WHERE id = $1', [product_id]);
  res.json({ message: '入荷を記録しました', current_stock: updatedRows[0].stock });
});

// 在庫修正（入荷・使用記録なし）
router.post('/adjust', authMiddleware, async (req, res) => {
  const { product_id, delta } = req.body;
  const qty = parseInt(delta);
  if (!product_id || isNaN(qty) || qty === 0) {
    return res.status(400).json({ error: '商品と数量を入力してください' });
  }

  const { rows: productRows } = await pool.query('SELECT * FROM products WHERE id = $1', [product_id]);
  const product = productRows[0];
  if (!product) return res.status(404).json({ error: '商品が見つかりません' });

  const { rows: lots } = await pool.query(
    'SELECT * FROM product_lots WHERE product_id = $1 AND quantity > 0 ORDER BY expiry_date ASC NULLS LAST',
    [product_id]
  );

  if (lots.length > 0) {
    if (qty > 0) {
      await pool.query(
        'INSERT INTO product_lots (product_id, quantity, package_label) VALUES ($1, $2, $3)',
        [product_id, qty, '在庫修正']
      );
    } else {
      const absQty = Math.abs(qty);
      if (product.stock < absQty) {
        return res.status(400).json({ error: `在庫が不足しています（現在: ${product.stock}${product.unit || '個'}）` });
      }
      let remaining = absQty;
      for (const lot of lots) {
        if (remaining <= 0) break;
        const deduct = Math.min(lot.quantity, remaining);
        await pool.query('UPDATE product_lots SET quantity = quantity - $1 WHERE id = $2', [deduct, lot.id]);
        remaining -= deduct;
      }
      await pool.query('DELETE FROM product_lots WHERE product_id = $1 AND quantity <= 0', [product_id]);
    }
    await pool.query(
      'UPDATE products SET stock = (SELECT COALESCE(SUM(quantity), 0) FROM product_lots WHERE product_id = $1) WHERE id = $1',
      [product_id]
    );
  } else {
    if (qty < 0 && product.stock < Math.abs(qty)) {
      return res.status(400).json({ error: `在庫が不足しています（現在: ${product.stock}${product.unit || '個'}）` });
    }
    await pool.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [qty, product_id]);
  }

  const { rows: updated } = await pool.query('SELECT stock FROM products WHERE id = $1', [product_id]);
  res.json({ message: '在庫を修正しました', current_stock: updated[0].stock });
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
    SELECT ul.id, ul.quantity, u.display_name, ul.logged_at, 'use' as type, NULL as expiry_date
    FROM usage_logs ul
    LEFT JOIN users u ON ul.user_id = u.id
    WHERE ul.product_id = $1
  `, [req.params.product_id]);

  const { rows: stockLogs } = await pool.query(`
    SELECT sl.id, sl.quantity, u.display_name, sl.logged_at, 'receive' as type, sl.expiry_date
    FROM stock_logs sl
    LEFT JOIN users u ON sl.user_id = u.id
    WHERE sl.product_id = $1
  `, [req.params.product_id]);

  const combined = [...useLogs, ...stockLogs].sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at));
  res.json(combined);
});

// 使用記録を削除して在庫を復元
router.delete('/usage-log/:id', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM usage_logs WHERE id = $1', [req.params.id]);
  const log = rows[0];
  if (!log) return res.status(404).json({ error: '記録が見つかりません' });

  await pool.query('DELETE FROM usage_logs WHERE id = $1', [req.params.id]);

  const { rows: lots } = await pool.query(
    'SELECT * FROM product_lots WHERE product_id = $1 AND quantity > 0',
    [log.product_id]
  );
  if (lots.length > 0) {
    await pool.query(
      'INSERT INTO product_lots (product_id, quantity, package_label) VALUES ($1, $2, $3)',
      [log.product_id, log.quantity, '使用削除']
    );
    await pool.query(
      'UPDATE products SET stock = (SELECT COALESCE(SUM(quantity), 0) FROM product_lots WHERE product_id = $1) WHERE id = $1',
      [log.product_id]
    );
  } else {
    await pool.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [log.quantity, log.product_id]);
  }

  res.json({ success: true });
});

module.exports = router;
