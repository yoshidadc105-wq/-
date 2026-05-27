const express = require('express');
const { pool } = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const PERIOD_CONFIG = {
  week:     { startSql: "DATE_TRUNC('week', CURRENT_DATE)",          groupSql: "DATE_TRUNC('day', logged_at)" },
  month:    { startSql: "DATE_TRUNC('month', CURRENT_DATE)",         groupSql: "DATE_TRUNC('week', logged_at)" },
  '3months':{ startSql: "CURRENT_DATE - INTERVAL '3 months'",        groupSql: "DATE_TRUNC('month', logged_at)" },
  '6months':{ startSql: "CURRENT_DATE - INTERVAL '6 months'",        groupSql: "DATE_TRUNC('month', logged_at)" },
  year:     { startSql: "CURRENT_DATE - INTERVAL '1 year'",          groupSql: "DATE_TRUNC('month', logged_at)" },
  all:      { startSql: "'1970-01-01'::date",                        groupSql: "DATE_TRUNC('month', logged_at)" },
};

// 購入統計
router.get('/purchases', authMiddleware, async (req, res) => {
  const { period, month } = req.query;

  // 特定の月が指定された場合
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const startSql = `DATE_TRUNC('month', '${month}-01'::date)`;
    const endSql   = `DATE_TRUNC('month', '${month}-01'::date) + INTERVAL '1 month'`;
    const groupSql = "DATE_TRUNC('day', logged_at)";
    const whereClause = `logged_at >= ${startSql} AND logged_at < ${endSql}`;

    const [{ rows: summary }, { rows: bySupplier }, { rows: logs }] = await Promise.all([
      pool.query(`
        SELECT ${groupSql} as period_start,
          SUM(quantity * COALESCE(unit_price, 0)) as total_amount,
          SUM(quantity) as total_qty, COUNT(*) as purchase_count
        FROM stock_logs WHERE ${whereClause}
        GROUP BY ${groupSql} ORDER BY ${groupSql}
      `),
      pool.query(`
        SELECT COALESCE(supplier_name, '未記入') as supplier_name,
          SUM(quantity * COALESCE(unit_price, 0)) as total_amount,
          COUNT(*) as purchase_count
        FROM stock_logs WHERE ${whereClause}
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
        WHERE ${whereClause}
        ORDER BY sl.logged_at DESC LIMIT 500
      `),
    ]);
    return res.json({ summary, bySupplier, logs, periodType: 'month_day' });
  }

  const cfg = PERIOD_CONFIG[period] || PERIOD_CONFIG.month;

  const [{ rows: summary }, { rows: bySupplier }, { rows: logs }] = await Promise.all([
    pool.query(`
      SELECT ${cfg.groupSql} as period_start,
        SUM(quantity * COALESCE(unit_price, 0)) as total_amount,
        SUM(quantity) as total_qty, COUNT(*) as purchase_count
      FROM stock_logs
      WHERE logged_at >= ${cfg.startSql}
      GROUP BY ${cfg.groupSql} ORDER BY ${cfg.groupSql}
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
      ORDER BY sl.logged_at DESC LIMIT 500
    `),
  ]);

  res.json({ summary, bySupplier, logs, periodType: period === 'week' || period === 'month' ? (period === 'week' ? 'week_day' : 'month_week') : 'multi_month' });
});

// データが存在する月の一覧
router.get('/months', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT TO_CHAR(DATE_TRUNC('month', logged_at), 'YYYY-MM') as month
    FROM stock_logs
    GROUP BY DATE_TRUNC('month', logged_at)
    ORDER BY DATE_TRUNC('month', logged_at) DESC
  `);
  res.json(rows.map(r => r.month));
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
