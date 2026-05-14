const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAdmin } = require('../middleware/auth');
const { resetDb, getDataDir, initializeDb } = require('../db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// DBファイルのアップロード・復元
router.post('/db', requireAdmin, upload.single('db'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ファイルがありません' });
  const dbPath = path.join(getDataDir(), 'manual_system.db');
  resetDb();
  fs.writeFileSync(dbPath, req.file.buffer);
  initializeDb();
  res.json({ message: 'データベースを復元しました！' });
});

// uploadsフォルダのZIPアップロード・展開
router.post('/uploads', requireAdmin, upload.single('uploads'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ファイルがありません' });
  const uploadsDir = path.join(getDataDir(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // ZIPを手動で展開（adm-zipなしで対応）
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(req.file.buffer);
    zip.extractAllTo(uploadsDir, true);
    res.json({ message: 'PDFファイルを復元しました！' });
  } catch(e) {
    res.status(500).json({ error: 'ZIP展開に失敗しました: ' + e.message });
  }
});

module.exports = router;
