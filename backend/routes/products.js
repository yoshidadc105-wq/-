const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

// 写真からAIで商品情報を読み取る
router.post('/scan', authMiddleware, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '写真をアップロードしてください' });

  try {
    const imageData = fs.readFileSync(req.file.path);
    const base64 = imageData.toString('base64');
    const mimeType = req.file.mimetype;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 },
          },
          {
            type: 'text',
            text: `この歯科材料・医療用品の画像から商品情報を読み取ってください。
以下のJSON形式で返してください（読み取れない項目はnullにしてください）：
{
  "name": "商品名",
  "maker": "メーカー名",
  "item_code": "品番・品目コード"
}
JSONのみ返してください。説明文は不要です。`,
          },
        ],
      }],
    });

    const text = message.content[0].text.trim();
    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      parsed = { name: null, maker: null, item_code: null };
    }

    res.json({
      ...parsed,
      photo_path: `/uploads/${req.file.filename}`,
    });
  } catch (e) {
    console.error('AI scan error:', e);
    res.status(500).json({ error: 'AI読み取りに失敗しました。手動で入力してください。' });
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
