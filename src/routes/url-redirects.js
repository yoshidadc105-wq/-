const express = require('express');
const { getDb } = require('../db');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// URL解決（ログイン済みユーザー向け）
router.get('/resolve', requireLogin, (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required' });
  const db = getDb();
  const mapping = db.prepare('SELECT manual_id FROM url_redirects WHERE old_url = ?').get(url);
  if (!mapping) return res.status(404).json({ error: 'Not found' });
  res.json({ manual_id: mapping.manual_id });
});

// 一覧取得（管理者のみ）
router.get('/', requireAdmin, (req, res) => {
  const db = getDb();
  const redirects = db.prepare(`
    SELECT r.id, r.old_url, r.manual_id, m.title as manual_title, r.created_at
    FROM url_redirects r
    JOIN manuals m ON m.id = r.manual_id
    ORDER BY r.created_at DESC
  `).all();
  res.json(redirects);
});

// 追加（管理者のみ）
router.post('/', requireAdmin, (req, res) => {
  const { old_url, manual_id } = req.body;
  if (!old_url || !manual_id) return res.status(400).json({ error: 'old_url と manual_id は必須です' });
  const db = getDb();
  try {
    const result = db.prepare('INSERT INTO url_redirects (old_url, manual_id) VALUES (?, ?)').run(old_url.trim(), parseInt(manual_id));
    res.status(201).json({ id: result.lastInsertRowid, message: '登録しました' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'このURLはすでに登録されています' });
    throw e;
  }
});

// 削除（管理者のみ）
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM url_redirects WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: '見つかりません' });
  res.json({ message: '削除しました' });
});

module.exports = router;
