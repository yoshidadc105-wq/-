const express = require('express');
const { getDb } = require('../db');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');
const os = require('os');

const router = express.Router();

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), 'ManualSystemData');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// URL解決（ログイン済みユーザー向け）
router.get('/resolve', requireLogin, (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required' });
  const db = getDb();
  const trimmed = url.trim();
  const withoutSlash = trimmed.replace(/\/$/, '');
  const mapping =
    db.prepare('SELECT manual_id FROM url_redirects WHERE old_url = ?').get(trimmed) ||
    db.prepare('SELECT manual_id FROM url_redirects WHERE old_url = ?').get(withoutSlash) ||
    db.prepare('SELECT manual_id FROM url_redirects WHERE old_url = ?').get(withoutSlash + '/');
  if (!mapping) return res.status(404).json({ error: 'Not found' });
  res.json({ manual_id: mapping.manual_id });
});

// PDFをスキャンして埋め込みURLを抽出（管理者のみ）
router.get('/scan-pdfs', requireAdmin, (req, res) => {
  const db = getDb();
  const pdfManuals = db.prepare(
    "SELECT id, title, file_path FROM manuals WHERE type = 'pdf' AND file_path IS NOT NULL AND is_deleted = 0"
  ).all();

  const registeredUrls = new Set(
    db.prepare('SELECT old_url FROM url_redirects').all().map(r => r.old_url)
  );

  const results = [];

  for (const manual of pdfManuals) {
    const filePath = path.join(UPLOAD_DIR, manual.file_path);
    if (!fs.existsSync(filePath)) continue;

    try {
      const buffer = fs.readFileSync(filePath);
      const text = buffer.toString('latin1');
      const urls = new Set();
      const pattern = /\/URI\s*\(([^)]+)\)/g;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const url = match[1].trim();
        if (url.startsWith('http')) urls.add(url);
      }
      if (urls.size > 0) {
        results.push({
          manual_id: manual.id,
          manual_title: manual.title,
          urls: [...urls].map(url => ({
            url,
            already_registered: registeredUrls.has(url)
          }))
        });
      }
    } catch (e) {
      // skip unreadable files
    }
  }

  res.json(results);
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

// 一括登録（管理者のみ）
router.post('/bulk', requireAdmin, (req, res) => {
  const { mappings } = req.body;
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return res.status(400).json({ error: 'mappings配列が必要です' });
  }
  const db = getDb();
  let inserted = 0, skipped = 0;
  const insert = db.prepare('INSERT OR IGNORE INTO url_redirects (old_url, manual_id) VALUES (?, ?)');
  for (const { old_url, manual_id } of mappings) {
    if (!old_url || !manual_id) continue;
    const result = insert.run(old_url.trim(), parseInt(manual_id));
    if (result.changes > 0) inserted++;
    else skipped++;
  }
  res.json({
    message: `${inserted}件を登録しました${skipped > 0 ? `（${skipped}件はすでに登録済みのためスキップ）` : ''}`,
    inserted,
    skipped
  });
});

// 更新（管理者のみ）
router.put('/:id', requireAdmin, (req, res) => {
  const { old_url, manual_id } = req.body;
  if (!old_url || !manual_id) return res.status(400).json({ error: 'old_url と manual_id は必須です' });
  const db = getDb();
  const existing = db.prepare('SELECT id FROM url_redirects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '見つかりません' });
  try {
    db.prepare('UPDATE url_redirects SET old_url = ?, manual_id = ? WHERE id = ?')
      .run(old_url.trim(), parseInt(manual_id), req.params.id);
    res.json({ message: '更新しました' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'このURLはすでに別のエントリに登録されています' });
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
