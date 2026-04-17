const express = require('express');
const { getDb } = require('../db');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// 全カテゴリをフラットリストで返す（フロントでツリー構築）
router.get('/', requireLogin, (req, res) => {
  const db = getDb();
  const isAdmin = req.session.role === 'admin';

  let categories;
  if (isAdmin) {
    categories = db.prepare(`
      SELECT c.*, COUNT(m.id) as manual_count
      FROM categories c
      LEFT JOIN manuals m ON m.category_id = c.id AND m.is_deleted = 0
      GROUP BY c.id
      ORDER BY c.parent_id, c.sort_order, c.name
    `).all();
  } else {
    categories = db.prepare(`
      SELECT DISTINCT c.*, COUNT(m.id) as manual_count
      FROM categories c
      LEFT JOIN manuals m ON m.category_id = c.id AND m.is_deleted = 0
      WHERE c.visibility = 'all'
         OR c.visibility = 'group' AND EXISTS (
           SELECT 1 FROM category_groups cg
           JOIN user_groups ug ON ug.group_id = cg.group_id
           WHERE cg.category_id = c.id AND ug.user_id = ?
         )
      GROUP BY c.id
      ORDER BY c.parent_id, c.sort_order, c.name
    `).all(req.session.userId);
  }
  res.json(categories);
});

// カテゴリ作成
router.post('/', requireAdmin, (req, res) => {
  const { name, description, sort_order, visibility, parent_id } = req.body;
  if (!name) return res.status(400).json({ error: 'カテゴリ名は必須です' });

  const db = getDb();
  try {
    const result = db.prepare(`
      INSERT INTO categories (name, description, sort_order, visibility, parent_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, description || null, sort_order || 0, visibility || 'all', parent_id || null);
    res.status(201).json({ id: result.lastInsertRowid, message: 'カテゴリを作成しました' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: '同じ名前のカテゴリがすでに同じ階層に存在します' });
    }
    throw e;
  }
});

// カテゴリ更新
router.put('/:id', requireAdmin, (req, res) => {
  const { name, description, sort_order, visibility, parent_id, group_ids } = req.body;
  const { id } = req.params;
  if (!name) return res.status(400).json({ error: 'カテゴリ名は必須です' });

  // 自分自身を親にはできない
  if (parent_id && parseInt(parent_id) === parseInt(id)) {
    return res.status(400).json({ error: '自分自身を親カテゴリにはできません' });
  }

  const db = getDb();
  const result = db.prepare(`
    UPDATE categories SET name = ?, description = ?, sort_order = ?, visibility = ?, parent_id = ? WHERE id = ?
  `).run(name, description || null, sort_order || 0, visibility || 'all', parent_id || null, id);

  if (result.changes === 0) return res.status(404).json({ error: 'カテゴリが見つかりません' });

  db.prepare('DELETE FROM category_groups WHERE category_id = ?').run(id);
  if (visibility === 'group' && Array.isArray(group_ids) && group_ids.length > 0) {
    const ins = db.prepare('INSERT INTO category_groups (category_id, group_id) VALUES (?, ?)');
    group_ids.forEach(gid => ins.run(id, gid));
  }

  res.json({ message: 'カテゴリを更新しました' });
});

// カテゴリ削除
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'カテゴリが見つかりません' });
  res.json({ message: 'カテゴリを削除しました' });
});

module.exports = router;
