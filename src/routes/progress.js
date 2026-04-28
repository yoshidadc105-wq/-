const express = require('express');
const { getDb } = require('../db');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// 自分のマニュアルに確認チェックをつける
router.post('/check/:manualId', requireLogin, (req, res) => {
  const db = getDb();
  const manual = db.prepare('SELECT id FROM manuals WHERE id = ? AND is_deleted = 0').get(req.params.manualId);
  if (!manual) return res.status(404).json({ error: 'マニュアルが見つかりません' });

  try {
    db.prepare(`
      INSERT INTO manual_checks (manual_id, user_id) VALUES (?, ?)
    `).run(req.params.manualId, req.session.userId);
  } catch (e) {
    // すでにチェック済み（UNIQUE制約）は無視
  }
  res.json({ message: '確認しました' });
});

// 確認チェックを外す
router.delete('/check/:manualId', requireLogin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM manual_checks WHERE manual_id = ? AND user_id = ?')
    .run(req.params.manualId, req.session.userId);
  res.json({ message: '確認を取り消しました' });
});

// 特定マニュアルの自分のチェック状態を取得
router.get('/check/:manualId', requireLogin, (req, res) => {
  const db = getDb();
  const check = db.prepare('SELECT * FROM manual_checks WHERE manual_id = ? AND user_id = ?')
    .get(req.params.manualId, req.session.userId);
  res.json({ checked: !!check, checked_at: check ? check.checked_at : null });
});

// 自分の進捗取得
router.get('/me', requireLogin, (req, res) => {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as n FROM manuals WHERE is_deleted = 0').get().n;
  const checked = db.prepare('SELECT COUNT(*) as n FROM manual_checks WHERE user_id = ?').get(req.session.userId).n;
  const checkedList = db.prepare(`
    SELECT m.id, m.title, m.type, mc.checked_at,
           c.name as category_name
    FROM manual_checks mc
    JOIN manuals m ON m.id = mc.manual_id AND m.is_deleted = 0
    LEFT JOIN categories c ON c.id = m.category_id
    WHERE mc.user_id = ?
    ORDER BY mc.checked_at DESC
  `).all(req.session.userId);
  res.json({ total, checked, percent: total > 0 ? Math.round(checked / total * 100) : 0, checkedList });
});

// 管理者：全スタッフの進捗一覧
router.get('/users', requireAdmin, (req, res) => {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as n FROM manuals WHERE is_deleted = 0').get().n;
  const users = db.prepare(`
    SELECT u.id, u.display_name, u.username,
           COUNT(mc.id) as checked
    FROM users u
    LEFT JOIN manual_checks mc ON mc.user_id = u.id
    WHERE u.is_active = 1
    GROUP BY u.id
    ORDER BY u.display_name
  `).all();

  const result = users.map(u => ({
    ...u,
    total,
    percent: total > 0 ? Math.round(u.checked / total * 100) : 0
  }));
  res.json(result);
});

// 管理者：特定スタッフの未確認マニュアル一覧
router.get('/users/:userId/unchecked', requireAdmin, (req, res) => {
  const db = getDb();
  const manuals = db.prepare(`
    SELECT m.id, m.title, m.type, c.name as category_name
    FROM manuals m
    LEFT JOIN categories c ON c.id = m.category_id
    WHERE m.is_deleted = 0
      AND m.id NOT IN (
        SELECT manual_id FROM manual_checks WHERE user_id = ?
      )
    ORDER BY c.sort_order, m.updated_at DESC
  `).all(req.params.userId);
  res.json(manuals);
});

// 管理者：特定マニュアルの未確認スタッフ一覧
router.get('/manuals/:manualId/unchecked', requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT u.id, u.display_name, u.username
    FROM users u
    WHERE u.is_active = 1
      AND u.id NOT IN (
        SELECT user_id FROM manual_checks WHERE manual_id = ?
      )
    ORDER BY u.display_name
  `).all(req.params.manualId);
  res.json(users);
});

// 管理者：全マニュアルの確認状況
router.get('/manuals', requireAdmin, (req, res) => {
  const db = getDb();
  const totalUsers = db.prepare('SELECT COUNT(*) as n FROM users WHERE is_active = 1').get().n;
  const manuals = db.prepare(`
    SELECT m.id, m.title, m.type, c.name as category_name,
           COUNT(mc.id) as checked_count
    FROM manuals m
    LEFT JOIN categories c ON c.id = m.category_id
    LEFT JOIN manual_checks mc ON mc.manual_id = m.id
    WHERE m.is_deleted = 0
    GROUP BY m.id
    ORDER BY checked_count ASC, m.updated_at DESC
  `).all();

  res.json({ totalUsers, manuals: manuals.map(m => ({
    ...m,
    percent: totalUsers > 0 ? Math.round(m.checked_count / totalUsers * 100) : 0
  }))});
});

module.exports = router;
