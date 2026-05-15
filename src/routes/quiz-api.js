const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getDb } = require('../db');

const router = express.Router();

const UPLOAD_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'uploads')
  : path.join(os.homedir(), 'ManualSystemData', 'uploads');

function checkApiKey(req, res) {
  const key = req.headers['x-quiz-api-key'];
  const expected = process.env.QUIZ_API_KEY;
  if (!expected) { res.status(500).json({ error: 'QUIZ_API_KEY未設定' }); return false; }
  if (key !== expected) { res.status(401).json({ error: '認証エラー' }); return false; }
  return true;
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// マニュアル一覧
router.get('/manuals', (req, res) => {
  if (!checkApiKey(req, res)) return;
  const db = getDb();
  const manuals = db.prepare(`
    SELECT m.id, m.title, m.type,
      COALESCE(parent.name, c.name) as main_category,
      CASE WHEN parent.id IS NOT NULL THEN c.name ELSE NULL END as sub_category
    FROM manuals m
    LEFT JOIN categories c ON c.id = m.category_id
    LEFT JOIN categories parent ON parent.id = c.parent_id
    WHERE m.is_deleted = 0
    ORDER BY
      COALESCE(parent.name, c.name, 'zzz'),
      CASE WHEN parent.id IS NOT NULL THEN c.name ELSE '' END,
      m.title
  `).all();
  res.json(manuals);
});

// マニュアルのテキスト取得
router.get('/manuals/:id/text', async (req, res) => {
  if (!checkApiKey(req, res)) return;
  const db = getDb();
  const manual = db.prepare(`SELECT * FROM manuals WHERE id = ? AND is_deleted = 0`).get(req.params.id);
  if (!manual) return res.status(404).json({ error: 'マニュアルが見つかりません' });

  if (manual.type === 'rich_text') {
    return res.json({ id: manual.id, title: manual.title, text: stripHtml(manual.content) });
  }

  if (manual.type === 'pdf' && manual.file_path) {
    const filePath = path.join(UPLOAD_DIR, path.basename(manual.file_path));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'PDFファイルが見つかりません' });
    try {
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(filePath);
      const data = await pdfParse(buf);
      return res.json({ id: manual.id, title: manual.title, text: data.text });
    } catch (err) {
      return res.status(500).json({ error: 'PDF読み込みエラー: ' + err.message });
    }
  }

  res.status(400).json({ error: 'テキストを取得できないマニュアルタイプです' });
});

module.exports = router;
