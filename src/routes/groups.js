const express = require('express');
const { getDb } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// グループ一覧
router.get('/', requireAdmin, (req, res) => {
  const db = getDb();
  const groups = db.prepare(`
    SELECT g.*, COUNT(ug.user_id) as member_count
    FROM groups_table g
    LEFT JOIN user_groups ug ON ug.group_id = g.id
    GROUP BY g.id
    ORDER BY g.name
  `).all();
  res.json(groups);
});

// グループ作成
router.post('/', requireAdmin, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'グループ名は必須です' });

  const db = getDb();
  try {
    const result = db.prepare('INSERT INTO groups_table (name, description) VALUES (?, ?)').run(name, description || null);
    res.status(201).json({ id: result.lastInsertRowid, message: 'グループを作成しました' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: '同じ名前のグループがすでに存在します' });
    throw e;
  }
});

// グループ更新
router.put('/:id', requireAdmin, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'グループ名は必須です' });

  const db = getDb();
  const result = db.prepare('UPDATE groups_table SET name = ?, description = ? WHERE id = ?').run(name, description || null, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'グループが見つかりません' });
  res.json({ message: 'グループを更新しました' });
});

// グループ削除
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM groups_table WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'グループが見つかりません' });
  res.json({ message: 'グループを削除しました' });
});

// グループのメンバー一覧
router.get('/:id/members', requireAdmin, (req, res) => {
  const db = getDb();
  const members = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.email
    FROM user_groups ug
    JOIN users u ON u.id = ug.user_id
    WHERE ug.group_id = ?
  `).all(req.params.id);
  res.json(members);
});

// グループのメンバーを設定（上書き）
router.put('/:id/members', requireAdmin, (req, res) => {
  const { user_ids } = req.body;
  const db = getDb();

  db.prepare('DELETE FROM user_groups WHERE group_id = ?').run(req.params.id);
  if (Array.isArray(user_ids) && user_ids.length > 0) {
    const ins = db.prepare('INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)');
    user_ids.forEach(uid => ins.run(uid, req.params.id));
  }
  res.json({ message: 'メンバーを更新しました' });
});

module.exports = router;
