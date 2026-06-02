const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const DB_FILE = path.join(__dirname, 'data', 'records.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; }
}

function saveDB(records) {
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2), 'utf8');
  } catch (err) { console.error('DB保存エラー:', err.message); }
}

function checkAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    res.status(401).send('認証が必要です');
    return false;
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const pass = decoded.slice(decoded.indexOf(':') + 1);
  if (pass !== ADMIN_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    res.status(401).send('パスワードが違います');
    return false;
  }
  return true;
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

app.post('/submit', (req, res) => {
  const d = req.body;
  if (!d || !d.staffName || !d.date) return res.status(400).json({ error: 'invalid data' });
  const records = loadDB();
  records.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    date: d.date,
    staffName: d.staffName.trim(),
    items: parseInt(d.items) || 0,
    counseling: parseInt(d.counseling) || 0,
    reviews: parseInt(d.reviews) || 0,
    note: d.note || '',
  });
  saveDB(records);
  console.log(`実績登録: ${d.staffName} (${d.date})`);
  res.status(200).json({ ok: true });
});

app.get('/dashboard', (req, res) => {
  if (!checkAuth(req, res)) return;

  const records = loadDB();
  const byStaff = {};
  for (const r of records) {
    if (!byStaff[r.staffName]) {
      byStaff[r.staffName] = { items: 0, counseling: 0, reviews: 0, days: new Set() };
    }
    byStaff[r.staffName].items += r.items;
    byStaff[r.staffName].counseling += r.counseling;
    byStaff[r.staffName].reviews += r.reviews;
    byStaff[r.staffName].days.add(r.date);
  }

  const summaryRows = Object.entries(byStaff)
    .sort((a, b) => (b[1].items + b[1].counseling + b[1].reviews) - (a[1].items + a[1].counseling + a[1].reviews))
    .map(([name, s]) => `
      <tr>
        <td><strong>${esc(name)}</strong></td>
        <td class="num">${s.items}</td>
        <td class="num">${s.counseling}</td>
        <td class="num">${s.reviews}</td>
        <td class="num">${s.items + s.counseling + s.reviews}</td>
        <td class="num">${s.days.size}</td>
      </tr>`).join('');

  const detailRows = records.map(r => `
      <tr>
        <td>${esc(r.date)}</td>
        <td><strong>${esc(r.staffName)}</strong></td>
        <td class="num">${r.items}</td>
        <td class="num">${r.counseling}</td>
        <td class="num">${r.reviews}</td>
        <td>${esc(r.note)}</td>
      </tr>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>スタッフ実績ダッシュボード | のびのび歯科</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: sans-serif; background: #f3f4f6; color: #333; }
header { background: #2aab96; color: #fff; padding: 14px 24px; }
header h1 { font-size: 17px; font-weight: bold; }
.container { padding: 20px; max-width: 1100px; margin: 0 auto; }
h2 { font-size: 15px; color: #065f46; margin: 20px 0 10px; font-weight: bold; }
table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 30px; }
th { background: #e8f7f5; padding: 10px 14px; text-align: left; font-size: 13px; color: #065f46; white-space: nowrap; }
th.num, td.num { text-align: right; }
td { padding: 10px 14px; border-top: 1px solid #e5e7eb; font-size: 14px; vertical-align: top; }
.empty { text-align: center; padding: 40px; color: #9ca3af; }
</style>
</head>
<body>
<header><h1>スタッフ実績ダッシュボード｜のびのび歯科</h1></header>
<div class="container">
  <h2>スタッフ別 累計実績</h2>
  <table>
    <thead><tr>
      <th>スタッフ名</th>
      <th class="num">物品販売</th>
      <th class="num">カウンセリング成約</th>
      <th class="num">口コミ獲得</th>
      <th class="num">合計</th>
      <th class="num">入力日数</th>
    </tr></thead>
    <tbody>${summaryRows || '<tr><td colspan="6" class="empty">まだデータがありません</td></tr>'}</tbody>
  </table>
  <h2>入力履歴（新しい順）</h2>
  <table>
    <thead><tr>
      <th>日付</th><th>スタッフ名</th>
      <th class="num">物品販売</th>
      <th class="num">カウンセリング成約</th>
      <th class="num">口コミ獲得</th>
      <th>メモ</th>
    </tr></thead>
    <tbody>${detailRows || '<tr><td colspan="6" class="empty">まだデータがありません</td></tr>'}</tbody>
  </table>
</div>
</body>
</html>`);
});

app.get('/health', (_req, res) => res.send('OK'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`スタッフ実績サーバー起動: port=${PORT}`));
