const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const MONGODB_URI = process.env.MONGODB_URI;
const DB_FILE = path.join(__dirname, 'data', 'records.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB接続
let mongoCol = null;
if (MONGODB_URI) {
  const client = new MongoClient(MONGODB_URI);
  client.connect()
    .then(() => {
      mongoCol = client.db('nobinobi').collection('staff_records');
      console.log('MongoDB接続成功');
    })
    .catch(err => console.error('MongoDB接続失敗（JSONファイルで継続）:', err.message));
}

async function loadDB() {
  if (mongoCol) {
    return await mongoCol.find({}).sort({ createdAt: -1 }).toArray();
  }
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; }
}

async function saveRecord(record) {
  if (mongoCol) {
    await mongoCol.insertOne(record);
    return;
  }
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    const records = (() => { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; } })();
    records.unshift(record);
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
  const pass = Buffer.from(auth.slice(6), 'base64').toString().slice(
    Buffer.from(auth.slice(6), 'base64').toString().indexOf(':') + 1
  );
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

// 最近の入力を全員分返す（フォーム画面用）
app.get('/api/records', async (req, res) => {
  const records = await loadDB();
  res.json(records.slice(0, 50).map(r => ({
    date: r.date,
    staffName: r.staffName,
    patientNo: r.patientNo || '',
    entryType: r.entryType || 'patient',
    action: r.action || '',
    actionCategory: r.actionCategory || '',
    itemName: r.itemName || '',
    otherText: r.otherText || '',
    freeText: r.freeText || '',
  })));
});

// 患者番号の重複チェック（患者実績のみ対象）
app.get('/api/check-patient/:patientNo', async (req, res) => {
  const records = await loadDB();
  const exists = records.some(r => r.entryType !== 'behavior' && r.patientNo === req.params.patientNo);
  res.json({ exists });
});

const ACTION_CATEGORY = {
  '物品販売': 'item',
  '口コミ獲得': 'review',
  'インプラント': 'counseling',
  'マウスピース矯正': 'counseling',
  'ホワイトニング': 'counseling',
  'シーラント': 'treatment',
  'レントゲン': 'treatment',
  'フッ素塗布': 'treatment',
  'その他': 'treatment',
};

app.post('/submit', async (req, res) => {
  const d = req.body;
  if (!d || !d.staffName || !d.date) return res.status(400).json({ error: 'invalid data' });

  if (d.entryType === 'behavior') {
    if (!d.freeText) return res.status(400).json({ error: 'invalid data' });
    await saveRecord({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entryType: 'behavior',
      date: d.date,
      staffName: d.staffName.trim(),
      freeText: d.freeText.trim(),
    });
    console.log(`行動記録: ${d.staffName} (${d.date})`);
    return res.status(200).json({ ok: true });
  }

  // 患者実績記録
  if (!d.patientNo || !d.action) return res.status(400).json({ error: 'invalid data' });
  const records = await loadDB();
  if (records.some(r => r.entryType !== 'behavior' && r.patientNo === d.patientNo.trim())) {
    return res.status(409).json({ error: 'duplicate', message: `患者番号 ${d.patientNo} はすでに登録されています` });
  }

  await saveRecord({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    entryType: 'patient',
    date: d.date,
    staffName: d.staffName.trim(),
    patientNo: d.patientNo.trim(),
    action: d.action,
    actionCategory: ACTION_CATEGORY[d.action] || 'treatment',
    itemName: d.itemName ? d.itemName.trim() : '',
    otherText: d.otherText ? d.otherText.trim() : '',
  });
  console.log(`患者実績登録: ${d.staffName} 患者${d.patientNo} ${d.action} (${d.date})`);
  res.status(200).json({ ok: true });
});

app.get('/dashboard', async (req, res) => {
  if (!checkAuth(req, res)) return;

  const records = await loadDB();
  const byStaff = {};
  for (const r of records) {
    if (!byStaff[r.staffName]) {
      byStaff[r.staffName] = { itemsMap: {}, counselingMap: {}, reviews: 0, treatmentMap: {}, patients: new Set(), freePhrases: [] };
    }
    const s = byStaff[r.staffName];
    if (r.entryType === 'behavior') {
      if (r.freeText) s.freePhrases.push(r.freeText);
    } else {
      const cat = r.actionCategory || ACTION_CATEGORY[r.action] || 'treatment';
      const label = r.action + (r.itemName ? `（${r.itemName}）` : '') + (r.otherText ? `（${r.otherText}）` : '');
      if (cat === 'item')       s.itemsMap[label] = (s.itemsMap[label] || 0) + 1;
      if (cat === 'counseling') s.counselingMap[r.action] = (s.counselingMap[r.action] || 0) + 1;
      if (cat === 'review')     s.reviews++;
      if (cat === 'treatment')  s.treatmentMap[r.action] = (s.treatmentMap[r.action] || 0) + 1;
      if (r.patientNo) s.patients.add(r.patientNo);
    }
  }

  const staffList = Object.entries(byStaff).sort((a, b) => {
    const score = s => Object.values(s.itemsMap).reduce((x,y)=>x+y,0) + Object.values(s.counselingMap).reduce((x,y)=>x+y,0) + s.reviews;
    return score(b[1]) - score(a[1]);
  });

  const summaryRows = staffList.map(([name, s], i) => {
    const itemsTotal = Object.values(s.itemsMap).reduce((x,y)=>x+y,0);
    const counselingTotal = Object.values(s.counselingMap).reduce((x,y)=>x+y,0);
    const counselingDetail = Object.entries(s.counselingMap).map(([k,v])=>`${k}:${v}`).join('、') || '-';
    const treatmentDetail = Object.entries(s.treatmentMap).map(([k,v])=>`${k}:${v}`).join('、') || '-';
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
    return `
      <tr>
        <td>${medal} <strong>${esc(name)}</strong></td>
        <td class="num">${s.patients.size}</td>
        <td class="num">${itemsTotal}</td>
        <td class="num">${counselingTotal}<br><small style="color:#666;font-size:11px">${esc(counselingDetail)}</small></td>
        <td class="num">${s.reviews}</td>
        <td style="font-size:12px;color:#555">${esc(treatmentDetail)}</td>
        <td>
          <a href="/certificate?name=${encodeURIComponent(name)}" target="_blank" class="btn-cert">賞状</a>
          <a href="/evaluation?name=${encodeURIComponent(name)}" target="_blank" class="btn-eval">評価表</a>
        </td>
      </tr>`;
  }).join('');

  const detailRows = records.map(r => {
    const its = Array.isArray(r.selectedItems) ? r.selectedItems : [];
    const itemStr = its.map(i => i.label).join('、') || '-';
    return `
      <tr>
        <td>${esc(r.date)}</td>
        <td><strong>${esc(r.staffName)}</strong></td>
        <td>${esc(r.patientNo)}</td>
        <td style="font-size:12px">${esc(itemStr)}</td>
        <td style="font-size:12px">${esc(r.freeText)}</td>
      </tr>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>スタッフ実績ダッシュボード | のびのび歯科</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: sans-serif; background: #f3f4f6; color: #333; }
header { background: #2aab96; color: #fff; padding: 14px 24px; }
header h1 { font-size: 17px; font-weight: bold; }
.container { padding: 20px; max-width: 1200px; margin: 0 auto; }
h2 { font-size: 15px; color: #065f46; margin: 20px 0 10px; font-weight: bold; border-left: 4px solid #2aab96; padding-left: 8px; }
table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 30px; font-size: 13px; }
th { background: #e8f7f5; padding: 8px 10px; text-align: left; color: #065f46; white-space: nowrap; }
th.num, td.num { text-align: right; }
td { padding: 8px 10px; border-top: 1px solid #e5e7eb; vertical-align: top; }
.empty { text-align: center; padding: 40px; color: #9ca3af; }
.btn-cert { background: #f59e0b; color: #fff; padding: 3px 10px; border-radius: 4px; text-decoration: none; font-size: 12px; margin-right: 4px; display: inline-block; }
.btn-eval { background: #3b82f6; color: #fff; padding: 3px 10px; border-radius: 4px; text-decoration: none; font-size: 12px; display: inline-block; }
</style>
</head>
<body>
<header><h1>スタッフ実績ダッシュボード｜のびのび歯科</h1></header>
<div class="container">
  <h2>スタッフ別 累計実績</h2>
  <div style="overflow-x:auto">
  <table>
    <thead><tr>
      <th>スタッフ名</th><th class="num">担当患者数</th><th class="num">物品販売</th>
      <th class="num">カウンセリング成約</th><th class="num">口コミ獲得</th>
      <th>処置内訳</th><th>出力</th>
    </tr></thead>
    <tbody>${summaryRows || '<tr><td colspan="11" class="empty">まだデータがありません</td></tr>'}</tbody>
  </table>
  </div>
  <h2>入力履歴（新しい順）</h2>
  <div style="overflow-x:auto">
  <table>
    <thead><tr>
      <th>日付</th><th>スタッフ</th><th>患者番号</th><th>実施内容</th><th>自由記入</th>
    </tr></thead>
    <tbody>${detailRows || '<tr><td colspan="7" class="empty">まだデータがありません</td></tr>'}</tbody>
  </table>
  </div>
</div>
</body>
</html>`);
});

// 賞状ページ
app.get('/certificate', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const name = req.query.name || '';
  const records = await loadDB();
  const staffRecords = records.filter(r => r.staffName === name);
  let itemsTotal = 0, counselingTotal = 0, reviewsTotal = 0;
  for (const r of staffRecords) {
    if (r.entryType === 'behavior') continue;
    const cat = r.actionCategory || ACTION_CATEGORY[r.action] || 'treatment';
    if (cat === 'item') itemsTotal++;
    if (cat === 'counseling') counselingTotal++;
    if (cat === 'review') reviewsTotal++;
  }
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const freePhrases = [...new Set(staffRecords.filter(r => r.freeText).map(r => r.freeText))].slice(0, 3);

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>賞状 - ${esc(name)}</title>
<style>
@media print { .no-print { display: none; } }
body { font-family: "游明朝", "Yu Mincho", serif; background: #fffdf5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
.cert { border: 8px double #b8860b; padding: 60px 70px; max-width: 700px; width: 100%; text-align: center; background: #fffdf5; position: relative; }
.cert::before { content: ''; position: absolute; inset: 10px; border: 2px solid #d4a017; pointer-events: none; }
h1 { font-size: 42px; letter-spacing: 0.3em; color: #8b6914; margin-bottom: 40px; }
.name { font-size: 36px; font-weight: bold; border-bottom: 2px solid #333; display: inline-block; padding-bottom: 4px; margin: 20px 0; }
.body { font-size: 17px; line-height: 2.2; color: #333; margin: 30px 0; }
.achievements { font-size: 14px; color: #555; margin: 20px 0; line-height: 2; }
.date { font-size: 14px; color: #666; margin-top: 40px; }
.clinic { font-size: 18px; font-weight: bold; margin-top: 10px; }
.print-btn { display: block; margin: 30px auto 0; padding: 10px 30px; background: #2aab96; color: #fff; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; }
</style>
</head>
<body>
<div class="cert">
  <h1>賞　状</h1>
  <div class="name">${esc(name)}　殿</div>
  <div class="body">
    あなたは日々の診療において<br>
    患者様への真摯な対応と<br>
    卓越した実績を積み重ねてきました。<br>
    ここにその功績を称え、表彰いたします。
  </div>
  <div class="achievements">
    【実績】物品販売 ${itemsTotal}件　／　カウンセリング成約 ${counselingTotal}件　／　口コミ獲得 ${reviewsTotal}件
    ${freePhrases.length ? '<br>【特記】' + freePhrases.map(p => esc(p)).join('　／　') : ''}
  </div>
  <div class="date">${today}</div>
  <div class="clinic">のびのび歯科・矯正歯科</div>
  <button class="print-btn no-print" onclick="window.print()">印刷する</button>
</div>
</body>
</html>`);
});

// 個人評価表ページ
app.get('/evaluation', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const name = req.query.name || '';
  const records = await loadDB();
  const staffRecords = records.filter(r => r.staffName === name);
  if (!staffRecords.length) return res.status(404).send('データがありません');

  const itemsMap2 = {}, counselingMap2 = {}, treatmentMap2 = {};
  let reviews2 = 0;
  const freePhrases2 = [];

  for (const r of staffRecords) {
    if (r.entryType === 'behavior') {
      if (r.freeText) freePhrases2.push({ date: r.date, text: r.freeText });
      continue;
    }
    const cat = r.actionCategory || ACTION_CATEGORY[r.action] || 'treatment';
    const label = r.action + (r.itemName ? `（${r.itemName}）` : '') + (r.otherText ? `（${r.otherText}）` : '');
    if (cat === 'item')       itemsMap2[label] = (itemsMap2[label] || 0) + 1;
    if (cat === 'counseling') counselingMap2[r.action] = (counselingMap2[r.action] || 0) + 1;
    if (cat === 'review')     reviews2++;
    if (cat === 'treatment')  treatmentMap2[r.action] = (treatmentMap2[r.action] || 0) + 1;
  }
  const itemsTotal2 = Object.values(itemsMap2).reduce((a,b)=>a+b,0);
  const counselingTotal2 = Object.values(counselingMap2).reduce((a,b)=>a+b,0);
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

  const rows = [
    ['担当患者数', staffRecords.length + '名'],
    ['物品販売数', itemsTotal2 + '件'],
    ['カウンセリング成約数', counselingTotal2 + '件' + (counselingTotal2 ? '（' + Object.entries(counselingMap2).map(([k,v])=>`${k}:${v}`).join('、') + '）' : '')],
    ['口コミ獲得数', reviews2 + '件'],
    ['処置内訳', Object.entries(treatmentMap2).map(([k,v])=>`${k}:${v}件`).join('、') || 'なし'],
  ].map(([label, val]) => `<tr><td class="label">${esc(label)}</td><td>${esc(val)}</td></tr>`).join('');

  const freeRows = [...new Map(freePhrases2.map(p => [p.text, p])).values()].slice(0, 10)
    .map(p => `<tr><td class="label">${esc(p.date)}</td><td>${esc(p.text)}</td></tr>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>個人評価表 - ${esc(name)}</title>
<style>
@media print { .no-print { display: none; } }
body { font-family: sans-serif; background: #fff; margin: 0; padding: 30px; color: #333; }
h1 { font-size: 20px; border-bottom: 3px solid #2aab96; padding-bottom: 8px; margin-bottom: 20px; }
.meta { font-size: 13px; color: #666; margin-bottom: 20px; }
.name-big { font-size: 28px; font-weight: bold; color: #065f46; }
h2 { font-size: 14px; background: #e8f7f5; padding: 6px 12px; border-left: 4px solid #2aab96; margin: 20px 0 10px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px; }
td { padding: 8px 12px; border: 1px solid #e5e7eb; }
td.label { background: #f9fafb; font-weight: bold; width: 40%; color: #374151; }
.print-btn { margin: 20px 0; padding: 10px 30px; background: #2aab96; color: #fff; border: none; border-radius: 6px; font-size: 15px; cursor: pointer; }
.date { font-size: 13px; color: #888; margin-top: 30px; text-align: right; }
</style>
</head>
<body>
<h1>個人実績評価表</h1>
<div class="meta">出力日：${today}</div>
<div class="name-big">${esc(name)}</div>
<h2>実績サマリー</h2>
<table>${rows}</table>
<h2>特記事項・行動評価</h2>
<table>
  <tr><td class="label">日付</td><td>内容</td></tr>
  ${freeRows || '<tr><td colspan="2" style="color:#9ca3af;text-align:center">記録なし</td></tr>'}
</table>
<button class="print-btn no-print" onclick="window.print()">印刷する</button>
</body>
</html>`);
});

app.get('/health', (_req, res) => res.send('OK'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`スタッフ実績サーバー起動: port=${PORT}`));
