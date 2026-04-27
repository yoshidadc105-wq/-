const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

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

// 写真からGoogle Vision APIで商品情報を読み取る
router.post('/scan', authMiddleware, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '写真をアップロードしてください' });

  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Google Vision APIキーが設定されていません' });

  try {
    const base64 = fs.readFileSync(req.file.path).toString('base64');

    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64 },
          features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
          imageContext: { languageHints: ['ja', 'en'] },
        }]
      })
    });

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
      photo_path: `/uploads/${req.file.filename}`,
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
