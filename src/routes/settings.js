const express = require('express');
const { getDb } = require('../db');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// クイズモード状態取得（ログイン済み全員）
router.get('/quiz-mode', requireLogin, (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'quiz_mode'").get();
  res.json({ quiz_mode: row ? row.value === '1' : false });
});

// クイズモード切替（管理者のみ）
router.post('/quiz-mode', requireAdmin, (req, res) => {
  const { enabled } = req.body;
  const db = getDb();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'quiz_mode'").run(enabled ? '1' : '0');
  res.json({ quiz_mode: !!enabled, message: enabled ? 'クイズモードをONにしました' : 'クイズモードをOFFにしました' });
});

module.exports = router;
