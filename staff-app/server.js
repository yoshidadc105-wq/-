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
app.get('/api/records', (req, res) => {
  const records = loadDB();
  res.json(records.slice(0, 50).map(r => ({
    date: r.date,
    staffName: r.staffName,
    patientNo: r.patientNo,
    items: r.items,
    counseling: r.counseling,
    reviews: r.reviews,
    freeText: r.freeText,
  })));
});

// 患者番号の重複チェック
app.get('/api/check-patient/:patientNo', (req, res) => {
  const records = loadDB();
  const exists = records.some(r => r.patientNo === req.params.patientNo);
  res.json({ exists });
});

app.post('/submit', (req, res) => {
  const d = req.body;
  if (!d || !d.staffName || !d.date || !d.patientNo) {
    return res.status(400).json({ error: 'invalid data' });
  }

  const records = loadDB();

  // 患者番号の重複チェック
  if (records.some(r => r.patientNo === d.patientNo.trim())) {
    return res.status(409).json({ error: 'duplicate', message: `患者番号 ${d.patientNo} はすでに登録されています` });
  }

  records.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    date: d.date,
    staffName: d.staffName.trim(),
    patientNo: d.patientNo.trim(),
    items: d.items || 'なし',
    counseling: d.counseling || 'なし',
    reviews: d.reviews || 'なし',
    sealant: d.sealant || 'なし',
    xray: d.xray || 'なし',
    fluoride: d.fluoride || 'なし',
    cleaning: d.cleaning || 'なし',
    tbi: d.tbi || 'なし',
    freeText: d.freeText || '',
  });
  saveDB(records);
  console.log(`実績登録: ${d.staffName} 患者${d.patientNo} (${d.date})`);
  res.status(200).json({ ok: true });
});

app.get('/dashboard', (req, res) => {
  if (!checkAuth(req, res)) return;

  const records = loadDB();
  const byStaff = {};
  for (const r of records) {
    if (!byStaff[r.staffName]) {
      byStaff[r.staffName] = {
        items: 0, counselingMap: {}, reviews: 0,
        sealant: 0, xray: 0, fluoride: 0, cleaning: 0, tbi: 0,
        patients: new Set(), freePhrases: []
      };
    }
    const s = byStaff[r.staffName];
    if (r.items && r.items !== 'なし') s.items += parseInt(r.items) || 1;
    if (r.counseling && r.counseling !== 'なし') s.counselingMap[r.counseling] = (s.counselingMap[r.counseling] || 0) + 1;
    if (r.reviews === '獲得') s.reviews++;
    if (r.sealant === 'あり') s.sealant++;
    if (r.xray === 'あり') s.xray++;
    if (r.fluoride === 'あり') s.fluoride++;
    if (r.cleaning === 'あり') s.cleaning++;
    if (r.tbi === 'あり') s.tbi++;
    s.patients.add(r.patientNo);
    if (r.freeText) s.freePhrases.push(r.freeText);
  }

  const staffList = Object.entries(byStaff).sort((a, b) => {
    const scoreA = a[1].items + Object.values(a[1].counselingMap).reduce((x,y)=>x+y,0) + a[1].reviews;
    const scoreB = b[1].items + Object.values(b[1].counselingMap).reduce((x,y)=>x+y,0) + b[1].reviews;
    return scoreB - scoreA;
  });

  const summaryRows = staffList.map(([name, s], i) => {
    const counselingTotal = Object.values(s.counselingMap).reduce((x,y)=>x+y,0);
    const counselingDetail = Object.entries(s.counselingMap).map(([k,v])=>`${k}:${v}`).join('、') || '-';
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
    return `
      <tr>
        <td>${medal} <strong>${esc(name)}</strong></td>
        <td class="num">${s.patients.size}</td>
        <td class="num">${s.items}</td>
        <td class="num" title="${esc(counselingDetail)}">${counselingTotal}<br><small style="color:#666">${esc(counselingDetail)}</small></td>
        <td class="num">${s.reviews}</td>
        <td class="num">${s.sealant}</td>
        <td class="num">${s.xray}</td>
        <td class="num">${s.fluoride}</td>
        <td class="num">${s.cleaning}</td>
        <td class="num">${s.tbi}</td>
        <td>
          <a href="/certificate?name=${encodeURIComponent(name)}" target="_blank" class="btn-cert">賞状</a>
          <a href="/evaluation?name=${encodeURIComponent(name)}" target="_blank" class="btn-eval">評価表</a>
        </td>
      </tr>`;
  }).join('');

  const detailRows = records.map(r => `
      <tr>
        <td>${esc(r.date)}</td>
        <td><strong>${esc(r.staffName)}</strong></td>
        <td>${esc(r.patientNo)}</td>
        <td class="num">${esc(r.items)}</td>
        <td>${esc(r.counseling)}</td>
        <td>${esc(r.reviews)}</td>
        <td>${esc(r.freeText)}</td>
      </tr>`).join('');

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
      <th class="num">シーラント</th><th class="num">レントゲン</th>
      <th class="num">フッ素</th><th class="num">クリーニング</th><th class="num">TBI</th>
      <th>出力</th>
    </tr></thead>
    <tbody>${summaryRows || '<tr><td colspan="11" class="empty">まだデータがありません</td></tr>'}</tbody>
  </table>
  </div>
  <h2>入力履歴（新しい順）</h2>
  <div style="overflow-x:auto">
  <table>
    <thead><tr>
      <th>日付</th><th>スタッフ</th><th>患者番号</th>
      <th class="num">物品</th><th>カウンセリング</th><th>口コミ</th><th>自由記入</th>
    </tr></thead>
    <tbody>${detailRows || '<tr><td colspan="7" class="empty">まだデータがありません</td></tr>'}</tbody>
  </table>
  </div>
</div>
</body>
</html>`);
});

// 賞状ページ
app.get('/certificate', (req, res) => {
  if (!checkAuth(req, res)) return;
  const name = req.query.name || '';
  const records = loadDB();
  const staffRecords = records.filter(r => r.staffName === name);
  const counselingTotal = staffRecords.filter(r => r.counseling && r.counseling !== 'なし').length;
  const itemsTotal = staffRecords.reduce((s, r) => s + (parseInt(r.items) || (r.items !== 'なし' ? 1 : 0)), 0);
  const reviewsTotal = staffRecords.filter(r => r.reviews === '獲得').length;
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
app.get('/evaluation', (req, res) => {
  if (!checkAuth(req, res)) return;
  const name = req.query.name || '';
  const records = loadDB();
  const staffRecords = records.filter(r => r.staffName === name);
  if (!staffRecords.length) return res.status(404).send('データがありません');

  const counselingMap = {};
  let items = 0, reviews = 0, sealant = 0, xray = 0, fluoride = 0, cleaning = 0, tbi = 0;
  const freePhrases = [];

  for (const r of staffRecords) {
    if (r.items && r.items !== 'なし') items += parseInt(r.items) || 1;
    if (r.counseling && r.counseling !== 'なし') counselingMap[r.counseling] = (counselingMap[r.counseling] || 0) + 1;
    if (r.reviews === '獲得') reviews++;
    if (r.sealant === 'あり') sealant++;
    if (r.xray === 'あり') xray++;
    if (r.fluoride === 'あり') fluoride++;
    if (r.cleaning === 'あり') cleaning++;
    if (r.tbi === 'あり') tbi++;
    if (r.freeText) freePhrases.push({ date: r.date, text: r.freeText });
  }
  const counselingTotal = Object.values(counselingMap).reduce((a,b)=>a+b,0);
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

  const rows = [
    ['物品販売数', items + '件'],
    ['カウンセリング成約数', counselingTotal + '件（' + Object.entries(counselingMap).map(([k,v])=>`${k}:${v}`).join('、') + '）'],
    ['口コミ獲得数', reviews + '件'],
    ['シーラント', sealant + '件'],
    ['レントゲン', xray + '件'],
    ['フッ素塗布', fluoride + '件'],
    ['クリーニング', cleaning + '件'],
    ['歯磨き指導(TBI)', tbi + '件'],
    ['担当患者数', staffRecords.length + '名'],
  ].map(([label, val]) => `<tr><td class="label">${esc(label)}</td><td>${esc(val)}</td></tr>`).join('');

  const freeRows = [...new Map(freePhrases.map(p => [p.text, p])).values()].slice(0, 10)
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
