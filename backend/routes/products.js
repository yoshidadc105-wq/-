const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');
const { pool } = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => { console.log('multer: 保存先設定'); cb(null, path.join(__dirname, '../uploads')); },
  filename: (req, file, cb) => { console.log('multer: ファイル名設定'); cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`); },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

// 全商品一覧
router.get('/', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT p.*,
      COALESCE(
        json_agg(
          json_build_object('id', pl.id, 'package_label', pl.package_label, 'expiry_date', pl.expiry_date, 'quantity', pl.quantity)
          ORDER BY pl.expiry_date ASC NULLS LAST
        ) FILTER (WHERE pl.id IS NOT NULL AND pl.quantity > 0),
        '[]'
      ) as lots
    FROM products p
    LEFT JOIN product_lots pl ON pl.product_id = p.id
    GROUP BY p.id
    ORDER BY p.name ASC
  `);
  res.json(rows);
});

// 在庫不足商品
router.get('/low-stock', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM products WHERE stock <= alert_threshold ORDER BY stock ASC');
  res.json(rows);
});

// 使用期限間近商品
router.get('/expiring', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT p.id, p.name, p.maker, p.photo_path, pl.expiry_date
    FROM products p
    JOIN product_lots pl ON pl.product_id = p.id
    WHERE pl.quantity > 0
      AND pl.expiry_date IS NOT NULL
      AND pl.expiry_date <= to_char(CURRENT_DATE + INTERVAL '30 days', 'YYYY-MM')
    ORDER BY pl.expiry_date ASC
  `);
  res.json(rows);
});

// 商品詳細
router.get('/:id', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  const product = rows[0];
  if (!product) return res.status(404).json({ error: '商品が見つかりません' });
  res.json(product);
});

// ロット一覧
router.get('/:id/lots', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM product_lots WHERE product_id = $1 ORDER BY expiry_date ASC NULLS LAST', [req.params.id]);
  res.json(rows);
});

// ロット追加
router.post('/:id/lots', authMiddleware, async (req, res) => {
  const { expiry_date, quantity, package_label } = req.body;
  if (!quantity || quantity <= 0) return res.status(400).json({ error: '数量を正しく入力してください' });

  const qty = parseInt(quantity);
  const result = await pool.query(
    'INSERT INTO product_lots (product_id, expiry_date, quantity, package_label) VALUES ($1, $2, $3, $4) RETURNING id',
    [req.params.id, expiry_date || null, qty, package_label || null]
  );
  await pool.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [qty, req.params.id]);

  res.json({ id: result.rows[0].id, message: 'ロットを追加しました' });
});

// 写真からGoogle Vision APIで商品情報を読み取る（JSON受け取り）
router.post('/scan', authMiddleware, async (req, res) => {
  const { base64, filename } = req.body;
  console.log('scan: base64=', base64 ? `${Math.round(base64.length/1024)}KB` : 'なし');

  if (!base64) return res.status(400).json({ error: '写真データがありません' });

  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  console.log('scan: apiKey=', apiKey ? '設定済み' : '未設定');
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
router.post('/', authMiddleware, upload.single('photo'), async (req, res) => {
  const { name, maker, item_code, stock, alert_threshold, photo_path, category, expiry_date, supplier_url, unit, package_label } = req.body;
  if (!name) return res.status(400).json({ error: '商品名は必須です' });

  const photoPath = req.file ? `/uploads/${req.file.filename}` : (photo_path || null);
  const stockQty = parseInt(stock) || 0;

  const result = await pool.query(
    'INSERT INTO products (name, maker, item_code, stock, alert_threshold, photo_path, category, supplier_url, unit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
    [name, maker || null, item_code || null, stockQty, parseInt(alert_threshold) || 5, photoPath, category || null, supplier_url || null, unit || null]
  );

  const productId = result.rows[0].id;
  if (stockQty > 0 && (expiry_date || package_label)) {
    await pool.query(
      'INSERT INTO product_lots (product_id, expiry_date, quantity, package_label) VALUES ($1, $2, $3, $4)',
      [productId, expiry_date || null, stockQty, package_label || null]
    );
  }

  res.json({ id: productId, message: '商品を登録しました' });
});

// 商品更新
router.put('/:id', authMiddleware, upload.single('photo'), async (req, res) => {
  const { name, maker, item_code, alert_threshold, category, supplier_url, unit } = req.body;
  const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  const product = rows[0];
  if (!product) return res.status(404).json({ error: '商品が見つかりません' });

  const photoPath = req.file ? `/uploads/${req.file.filename}` : product.photo_path;

  await pool.query(
    'UPDATE products SET name=$1, maker=$2, item_code=$3, alert_threshold=$4, photo_path=$5, category=$6, supplier_url=$7, unit=$8 WHERE id=$9',
    [name || product.name, maker ?? product.maker, item_code ?? product.item_code, parseInt(alert_threshold) || product.alert_threshold, photoPath, category !== undefined ? category : product.category, supplier_url !== undefined ? supplier_url : product.supplier_url, unit !== undefined ? (unit || null) : product.unit, req.params.id]
  );

  res.json({ message: '商品を更新しました' });
});

// 商品削除
router.delete('/:id', authMiddleware, async (req, res) => {
  await pool.query('DELETE FROM product_lots WHERE product_id = $1', [req.params.id]);
  await pool.query('DELETE FROM usage_logs WHERE product_id = $1', [req.params.id]);
  await pool.query('DELETE FROM stock_logs WHERE product_id = $1', [req.params.id]);
  await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.json({ message: '商品を削除しました' });
});

module.exports = router;
