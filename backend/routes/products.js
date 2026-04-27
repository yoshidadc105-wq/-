const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');
const db = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => { console.log('multer: 保存先設定'); cb(null, path.join(__dirname, '../uploads')); },
  filename: (req, file, cb) => { console.log('multer: ファイル名設定'); cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`); },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

// 全商品一覧
router.get('/', authMiddleware, (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY name ASC').all();
  res.json(products);
});

// 在庫不足商品
router.get('/low-stock', authMiddleware, (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE stock <= alert_threshold ORDER BY stock ASC').all();
  res.json(products);
});

// 商品詳細
router.get('/:id', authMiddleware, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: '商品が見つかりません' });
  res.json(product);
});

// 写真からGoogle Vision APIで商品情報を読み取る（JSON受け取り）
router.post('/scan', authMiddleware, async (req, res) => {
  const { base64, filename } = req.body;
  if (!base64) return res.status(400).json({ error: '写真データがありません' });

  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Google Vision APIキーが設定されていません' });

  // 写真をファイルに保存
  const ext = (filename || 'photo.jpg').split('.').pop();
  const savedFilename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const savedPath = path.join(__dirname, '../uploads', savedFilename);
  fs.writeFileSync(savedPath, Buffer.from(base64, 'base64'));

  try {
    console.log('スキャン開始...');
    console.log(`画像受信完了(${Math.round(base64.length * 0.75 / 1024)}KB)、Vision APIへ送信中...`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        requests: [{
          image: { content: base64 },
          features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
          imageContext: { languageHints: ['ja', 'en'] },
        }]
      })
    });
    clearTimeout(timeout);
    console.log('Vision API応答:', response.status);

    const data = await response.json();

    if (data.error) {
      console.error('Google Vision API error:', JSON.stringify(data.error));
      return res.status(500).json({ error: `Google Vision エラー: ${data.error.message}` });
    }

    const fullText = data.responses?.[0]?.fullTextAnnotation?.text || '';
    const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 1);

    const nameLine = lines.find(l => l.length >= 2 && !/^[0-9\s\-\/\.]+$/.test(l)) || null;
    const codeMatch = fullText.match(/[A-Z]{1,4}[-\s]?\d{3,8}/);
    const itemCode = codeMatch ? codeMatch[0].trim() : null;

    res.json({
      name: nameLine,
      maker: null,
      item_code: itemCode,
      photo_path: `/uploads/${savedFilename}`,
      raw_text: lines.slice(0, 8).join(' / '),
    });
  } catch (e) {
    console.error('Google Vision error:', e);
    res.status(500).json({ error: 'OCR読み取りに失敗しました。手動で入力してください。' });
  }
});

// 商品登録
router.post('/', authMiddleware, upload.single('photo'), (req, res) => {
  const { name, maker, item_code, stock, alert_threshold, photo_path } = req.body;
  if (!name) return res.status(400).json({ error: '商品名は必須です' });

  const photoPath = req.file ? `/uploads/${req.file.filename}` : (photo_path || null);

  const result = db.prepare(
    'INSERT INTO products (name, maker, item_code, stock, alert_threshold, photo_path) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, maker || null, item_code || null, parseInt(stock) || 0, parseInt(alert_threshold) || 5, photoPath);

  res.json({ id: result.lastInsertRowid, message: '商品を登録しました' });
});

// 商品更新
router.put('/:id', authMiddleware, upload.single('photo'), (req, res) => {
  const { name, maker, item_code, alert_threshold } = req.body;
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: '商品が見つかりません' });

  const photoPath = req.file ? `/uploads/${req.file.filename}` : product.photo_path;

  db.prepare(
    'UPDATE products SET name=?, maker=?, item_code=?, alert_threshold=?, photo_path=? WHERE id=?'
  ).run(name || product.name, maker ?? product.maker, item_code ?? product.item_code, parseInt(alert_threshold) || product.alert_threshold, photoPath, req.params.id);

  res.json({ message: '商品を更新しました' });
});

// 商品削除
router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ message: '商品を削除しました' });
});

module.exports = router;
