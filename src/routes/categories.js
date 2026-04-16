const express = require('express');
const { getDb } = require('../db');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// カテゴリ一覧取得
router.get('/', requireLogin, (req, res) => {
  const db = getDb();
  const categories = db.prepare(`
    SELECT c.*, COUNT(m.id) as manual_count
    FROM categories c
    LEFT JOIN manuals m ON m.category_id = c.id AND m.is_deleted = 0
    GROUP BY c.id
    ORDER BY c.sort_order, c.name
  `).all();
  res.json(categories);
});

// カテゴリ作成（管理者のみ）
router.post('/', requireAdmin, (req, res) => {
  const { name, description, sort_order } = req.body;

  if (!name) return res.status(400).json({ error: 'カテゴリ名は必須です' });

  const db = getDb();
  try {
    const result = db.prepare(`
      INSERT INTO categories (name, description, sort_order)
      VALUES (?, ?, ?)
    `).run(name, description || null, sort_order || 0);
    res.status(201).json({ id: result.lastInsertRowid, message: 'カテゴリを作成しました' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: '同じ名前のカテゴリがすでに存在します' });
    }
    throw e;
  }
});

// カテゴリ更新（管理者のみ）
router.put('/:id', requireAdmin, (req, res) => {
  const { name, description, sort_order } = req.body;
  const { id } = req.params;

  if (!name) return res.status(400).json({ error: 'カテゴリ名は必須です' });

  const db = getDb();
  const result = db.prepare(`
    UPDATE categories SET name = ?, description = ?, sort_order = ? WHERE id = ?
  `).run(name, description || null, sort_order || 0, id);

  if (result.changes === 0) return res.status(404).json({ error: 'カテゴリが見つかりません' });
  res.json({ message: 'カテゴリを更新しました' });
});

// カテゴリ削除（管理者のみ）
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  // カテゴリを削除するとマニュアルのcategory_idがNULLになる（ON DELETE SET NULL）
  const result = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'カテゴリが見つかりません' });
  res.json({ message: 'カテゴリを削除しました' });
});

module.exports = router;
