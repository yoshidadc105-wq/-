const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// PDF アップロード設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', '..', 'uploads'));
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_\u3000-\u9fff\u30a0-\u30ff\u3040-\u309f]/g, '_');
    cb(null, `${timestamp}_${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('PDFファイルのみアップロードできます'));
    }
  }
});

const uploadMany = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('PDFファイルのみアップロードできます'));
  }
});

// マニュアル一覧取得（検索・フィルタ対応）
router.get('/', requireLogin, (req, res) => {
  const { search, category_id, type, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const db = getDb();
  let conditions = ['m.is_deleted = 0'];
  const params = [];

  if (search) {
    conditions.push('(m.title LIKE ? OR m.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category_id) {
    conditions.push('m.category_id = ?');
    params.push(parseInt(category_id));
  }
  if (type) {
    conditions.push('m.type = ?');
    params.push(type);
  }

  const where = conditions.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) as count FROM manuals m WHERE ${where}`).get(...params).count;

  const manuals = db.prepare(`
    SELECT
      m.id, m.title, m.description, m.type, m.file_name, m.file_size,
      m.category_id, c.name as category_name,
      m.created_by, u.display_name as created_by_name,
      m.created_at, m.updated_at
    FROM manuals m
    LEFT JOIN categories c ON c.id = m.category_id
    LEFT JOIN users u ON u.id = m.created_by
    WHERE ${where}
    ORDER BY m.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ manuals, total, page: parseInt(page), limit: parseInt(limit) });
});

// マニュアル詳細取得
router.get('/:id', requireLogin, (req, res) => {
  const db = getDb();
  const manual = db.prepare(`
    SELECT
      m.*,
      c.name as category_name,
      u.display_name as created_by_name,
      u2.display_name as updated_by_name
    FROM manuals m
    LEFT JOIN categories c ON c.id = m.category_id
    LEFT JOIN users u ON u.id = m.created_by
    LEFT JOIN users u2 ON u2.id = m.updated_by
    WHERE m.id = ? AND m.is_deleted = 0
  `).get(req.params.id);

  if (!manual) return res.status(404).json({ error: 'マニュアルが見つかりません' });

  // 閲覧履歴を記録
  db.prepare(`INSERT INTO view_history (manual_id, user_id) VALUES (?, ?)`).run(manual.id, req.session.userId);

  res.json(manual);
});

// リッチテキストマニュアル作成
router.post('/text', requireLogin, (req, res) => {
  const { title, description, content, category_id } = req.body;

  if (!title) return res.status(400).json({ error: 'タイトルは必須です' });
  if (!content) return res.status(400).json({ error: '本文は必須です' });

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO manuals (title, description, type, content, category_id, created_by, updated_by)
    VALUES (?, ?, 'rich_text', ?, ?, ?, ?)
  `).run(title, description || null, content, category_id || null, req.session.userId, req.session.userId);

  res.status(201).json({ id: result.lastInsertRowid, message: 'マニュアルを作成しました' });
});

// PDFマニュアルアップロード
router.post('/pdf', requireLogin, upload.single('pdf'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDFファイルを選択してください' });

  const { title, description, category_id } = req.body;
  const fixedName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const manualTitle = title || path.parse(fixedName).name;

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO manuals (title, description, type, file_path, file_name, file_size, category_id, created_by, updated_by)
    VALUES (?, ?, 'pdf', ?, ?, ?, ?, ?, ?)
  `).run(
    manualTitle, description || null,
    req.file.filename, req.file.originalname, req.file.size,
    category_id || null, req.session.userId, req.session.userId
  );

  res.status(201).json({ id: result.lastInsertRowid, message: 'PDFをアップロードしました' });
});

// マニュアル更新
router.put('/:id', requireLogin, (req, res) => {
  const db = getDb();
  const manual = db.prepare('SELECT * FROM manuals WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!manual) return res.status(404).json({ error: 'マニュアルが見つかりません' });

  const { title, description, content, category_id } = req.body;
  if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

  db.prepare(`
    UPDATE manuals
    SET title = ?, description = ?, content = ?, category_id = ?,
        updated_by = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(title, description || null, content || manual.content, category_id || null, req.session.userId, req.params.id);

  res.json({ message: 'マニュアルを更新しました' });
});

// PDFの差し替え
router.put('/:id/pdf', requireLogin, upload.single('pdf'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDFファイルを選択してください' });

  const db = getDb();
  const manual = db.prepare('SELECT * FROM manuals WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!manual) return res.status(404).json({ error: 'マニュアルが見つかりません' });

  // 古いファイルを削除
  if (manual.file_path) {
    const oldPath = path.join(__dirname, '..', '..', 'uploads', manual.file_path);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  const { title, description, category_id } = req.body;
  db.prepare(`
    UPDATE manuals
    SET title = ?, description = ?, file_path = ?, file_name = ?, file_size = ?,
        category_id = ?, updated_by = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(
    title || manual.title, description || manual.description,
    req.file.filename, req.file.originalname, req.file.size,
    category_id || null, req.session.userId, req.params.id
  );

  res.json({ message: 'PDFを更新しました' });
});

// マニュアル削除（論理削除）
router.delete('/:id', requireLogin, (req, res) => {
  const db = getDb();
  const manual = db.prepare('SELECT * FROM manuals WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!manual) return res.status(404).json({ error: 'マニュアルが見つかりません' });

  // 管理者または作成者のみ削除可能
  if (req.session.role !== 'admin' && manual.created_by !== req.session.userId) {
    return res.status(403).json({ error: 'このマニュアルを削除する権限がありません' });
  }

  db.prepare("UPDATE manuals SET is_deleted = 1, updated_at = datetime('now', 'localtime') WHERE id = ?").run(req.params.id);
  res.json({ message: 'マニュアルを削除しました' });
});

// PDF一括アップロード
router.post('/bulk-pdf', requireLogin, uploadMany.array('pdfs', 200), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'PDFファイルを選択してください' });
  }

  const { category_id } = req.body;
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO manuals (title, type, file_path, file_name, file_size, category_id, created_by, updated_by)
    VALUES (?, 'pdf', ?, ?, ?, ?, ?, ?)
  `);

  const results = [];
  for (const file of req.files) {
    const raw = file.originalname;
    const asUtf8  = Buffer.from(raw, 'latin1').toString('utf8');
    const asBin   = Buffer.from(raw).toString('hex');
    console.log('[DEBUG filename]', JSON.stringify(raw), '→', JSON.stringify(asUtf8), 'hex:', asBin.slice(0, 40));
    const fixedName = asUtf8.includes('\uFFFD') ? raw : asUtf8;
    const title = path.parse(fixedName).name;
    const result = insert.run(
      title, file.filename, fixedName, file.size,
      category_id || null, req.session.userId, req.session.userId
    );
    results.push({ id: result.lastInsertRowid, title });
  }

  res.status(201).json({ message: `${results.length}件のPDFを登録しました`, results });
});

// 最近閲覧したマニュアル
router.get('/history/recent', requireLogin, (req, res) => {
  const db = getDb();
  const history = db.prepare(`
    SELECT DISTINCT m.id, m.title, m.type, m.category_id, c.name as category_name,
           MAX(vh.viewed_at) as last_viewed
    FROM view_history vh
    JOIN manuals m ON m.id = vh.manual_id AND m.is_deleted = 0
    LEFT JOIN categories c ON c.id = m.category_id
    WHERE vh.user_id = ?
    GROUP BY m.id
    ORDER BY last_viewed DESC
    LIMIT 10
  `).all(req.session.userId);
  res.json(history);
});

module.exports = router;
