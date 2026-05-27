const express = require('express');
const { pool } = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const PERIOD_CONFIG = {
  week:    { startSql: "DATE_TRUNC('week', CURRENT_DATE)",              groupSql: "DATE_TRUNC('day', logged_at)" },
  month:   { startSql: "DATE_TRUNC('month', CURRENT_DATE)",             groupSql: "DATE_TRUNC('week', logged_at)" },
  '3months': { startSql: "CURRENT_DATE - INTERVAL '3 months'",          groupSql: "DATE_TRUNC('month', logged_at)" },
};

// 購入統計
router.get('/purchases', authMiddleware, async (req, res) => {
  const cfg = PERIOD_CONFIG[req.query.period] || PERIOD_CONFIG.month;

  const [{ rows: summary }, { rows: bySupplier }, { rows: logs }] = await Promise.all([
    pool.query(`
      SELECT ${cfg.groupSql} as period_start,
        SUM(quantity * COALESCE(unit_price, 0)) as total_amount,
        SUM(quantity) as total_qty,
        COUNT(*) as purchase_count
      FROM stock_logs
      WHERE logged_at >= ${cfg.startSql}
      GROUP BY ${cfg.groupSql}
      ORDER BY ${cfg.groupSql}
    `),
    pool.query(`
      SELECT COALESCE(supplier_name, '未記入') as supplier_name,
        SUM(quantity * COALESCE(unit_price, 0)) as total_amount,
        COUNT(*) as purchase_count
      FROM stock_logs
      WHERE logged_at >= ${cfg.startSql}
      GROUP BY COALESCE(supplier_name, '未記入')
      ORDER BY total_amount DESC NULLS LAST
    `),
    pool.query(`
      SELECT sl.id, sl.quantity, sl.logged_at, sl.expiry_date,
        sl.supplier_name, sl.unit_price,
        sl.quantity * COALESCE(sl.unit_price, 0) as total_amount,
        p.name as product_name, p.unit
      FROM stock_logs sl
      LEFT JOIN products p ON sl.product_id = p.id
      WHERE sl.logged_at >= ${cfg.startSql}
      ORDER BY sl.logged_at DESC
      LIMIT 200
    `),
  ]);

  res.json({ summary, bySupplier, logs });
});

// 発注先の一覧（サジェスト用）
router.get('/suppliers', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT supplier_name FROM stock_logs
    WHERE supplier_name IS NOT NULL AND supplier_name <> ''
    ORDER BY supplier_name
  `);
  res.json(rows.map(r => r.supplier_name));
});

module.exports = router;
