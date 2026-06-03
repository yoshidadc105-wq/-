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
let staffNamesCol = null;
if (MONGODB_URI) {
  const client = new MongoClient(MONGODB_URI);
  client.connect()
    .then(() => {
      mongoCol = client.db('nobinobi').collection('staff_records');
      staffNamesCol = client.db('nobinobi').collection('staff_names');
      console.log('MongoDB接続成功');
    })
    .catch(err => console.error('MongoDB接続失敗（JSONファイルで継続）:', err.message));
}

const NAMES_FILE = path.join(__dirname, 'data', 'staff_names.json');

async function loadStaffNames() {
  if (staffNamesCol) {
    const docs = await staffNamesCol.find({}).sort({ name: 1 }).toArray();
    return docs.map(d => d.name);
  }
  try { return JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8')); } catch { return []; }
}

async function addStaffName(name) {
  if (staffNamesCol) {
    await staffNamesCol.updateOne({ name }, { $set: { name } }, { upsert: true });
    return;
  }
  const names = await loadStaffNames();
  if (!names.includes(name)) {
    names.push(name);
    names.sort();
    fs.mkdirSync(path.dirname(NAMES_FILE), { recursive: true });
    fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 2));
  }
}

async function deleteStaffName(name) {
  if (staffNamesCol) {
    await staffNamesCol.deleteOne({ name });
    return;
  }
  const names = (await loadStaffNames()).filter(n => n !== name);
  fs.mkdirSync(path.dirname(NAMES_FILE), { recursive: true });
  fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 2));
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

// スタッフ名一覧（プルダウン用）
app.get('/api/staff-names', async (req, res) => {
  res.json(await loadStaffNames());
});

// スタッフ名追加（管理画面から）
app.post('/admin/staff-names', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'invalid' });
  await addStaffName(name.trim());
  res.json({ ok: true });
});

// スタッフ名削除（管理画面から）
app.delete('/admin/staff-names/:name', async (req, res) => {
  if (!checkAuth(req, res)) return;
  await deleteStaffName(decodeURIComponent(req.params.name));
  res.json({ ok: true });
});

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

  const allRecords = await loadDB();
  const { from, to } = req.query;
  const records = allRecords.filter(r => {
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    return true;
  });
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
.filter-bar { background:#fff; border-radius:8px; padding:14px 16px; margin-bottom:20px; box-shadow:0 1px 4px rgba(0,0,0,.08); display:flex; gap:12px; align-items:center; flex-wrap:wrap; font-size:13px; }
.filter-bar label { color:#065f46; font-weight:bold; }
.filter-bar input { border:1px solid #ccc; border-radius:6px; padding:5px 10px; font-size:13px; }
.filter-bar button { background:#2aab96; color:#fff; border:none; border-radius:6px; padding:6px 16px; font-size:13px; cursor:pointer; }
.filter-bar a { color:#9ca3af; font-size:12px; text-decoration:underline; }
</style>
</head>
<body>
<header><h1>スタッフ実績ダッシュボード｜のびのび歯科</h1></header>
<div class="container">
  <form class="filter-bar" method="get" action="/dashboard">
    <label>期間絞り込み</label>
    <input type="date" name="from" value="${esc(from || '')}" />
    <span style="color:#9ca3af">〜</span>
    <input type="date" name="to" value="${esc(to || '')}" />
    <button type="submit">絞り込む</button>
    ${from || to ? '<a href="/dashboard">リセット</a>' : ''}
    ${from || to ? `<span style="color:#f59e0b;font-size:12px">★ 期間指定中</span>` : ''}
  </form>
  <h2>スタッフ別 累計実績${from || to ? `（${from||''}〜${to||-''}）` : ''}</h2>
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

  <h2>スタッフ名管理</h2>
  <div id="staff-mgmt" style="background:#fff;border-radius:8px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:30px;max-width:400px;">
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <input type="text" id="newStaffInput" placeholder="新しいスタッフ名" style="flex:1;border:1px solid #ccc;border-radius:6px;padding:7px 10px;font-size:14px;" />
      <button onclick="addStaffName()" style="background:#2aab96;color:#fff;border:none;border-radius:6px;padding:7px 16px;font-size:14px;cursor:pointer;white-space:nowrap;">追加</button>
    </div>
    <div id="staffNameMsg" style="font-size:12px;margin-bottom:10px;min-height:16px;"></div>
    <ul id="staffNameList" style="list-style:none;padding:0;margin:0;"></ul>
  </div>
</div>
<script>
async function loadMgmtStaffNames() {
  const res = await fetch('/api/staff-names');
  const names = await res.json();
  const ul = document.getElementById('staffNameList');
  ul.innerHTML = '';
  names.forEach(n => {
    const li = document.createElement('li');
    li.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #e5e7eb;font-size:14px;';
    li.innerHTML = '<span>' + n + '</span><button onclick="deleteStaffName(' + JSON.stringify(n) + ')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:4px;padding:3px 10px;font-size:12px;cursor:pointer;">削除</button>';
    ul.appendChild(li);
  });
}
async function addStaffName() {
  const input = document.getElementById('newStaffInput');
  const name = input.value.trim();
  if (!name) return;
  const msg = document.getElementById('staffNameMsg');
  const res = await fetch('/admin/staff-names', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name}) });
  if (res.ok) { input.value=''; msg.style.color='#059669'; msg.textContent='追加しました'; loadMgmtStaffNames(); }
  else { const e = await res.json(); msg.style.color='#dc2626'; msg.textContent = e.error || 'エラー'; }
}
async function deleteStaffName(name) {
  if (!confirm(name + ' を削除しますか？')) return;
  const msg = document.getElementById('staffNameMsg');
  const res = await fetch('/admin/staff-names/' + encodeURIComponent(name), { method:'DELETE' });
  if (res.ok) { msg.style.color='#059669'; msg.textContent='削除しました'; loadMgmtStaffNames(); }
  else { msg.style.color='#dc2626'; msg.textContent='削除に失敗しました'; }
}
loadMgmtStaffNames();
</script>
</body>
</html>`);
});

// 賞状ページ
app.get('/certificate', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const name = req.query.name || '';
  if (!name) return res.status(400).send('スタッフ名が必要です');
  const allRecords = await loadDB();
  const staffRecords = allRecords.filter(r => r.staffName === name);
  let itemsTotal = 0, counselingTotal = 0, reviewsTotal = 0, treatmentTotal = 0, patientCount = 0;
  const counselingTypes = new Set();
  const itemNames = new Set();
  const behaviors = [];
  const patients = new Set();
  for (const r of staffRecords) {
    if (r.entryType === 'behavior') { if (r.freeText) behaviors.push(r.freeText); continue; }
    const cat = r.actionCategory || ACTION_CATEGORY[r.action] || 'treatment';
    if (cat === 'item') { itemsTotal++; if (r.itemName) itemNames.add(r.itemName); }
    if (cat === 'counseling') { counselingTotal++; counselingTypes.add(r.action); }
    if (cat === 'review') reviewsTotal++;
    if (cat === 'treatment') treatmentTotal++;
    if (r.patientNo) patients.add(r.patientNo);
  }
  patientCount = patients.size;
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const uniqueBehaviors = [...new Set(behaviors)].slice(0, 4);

  // 実績に応じた文章を生成
  const highlights = [];
  if (patientCount > 0) highlights.push(`${patientCount}名の患者様を丁寧に担当`);
  if (counselingTotal > 0) highlights.push(`${[...counselingTypes].join('・')}など${counselingTotal}件のカウンセリングを成約に導く`);
  if (itemsTotal > 0) highlights.push(`${itemsTotal}件の物品販売を通じて患者様の口腔ケアをサポート`);
  if (reviewsTotal > 0) highlights.push(`${reviewsTotal}件の口コミ獲得により医院の信頼向上に貢献`);
  if (treatmentTotal > 0) highlights.push(`${treatmentTotal}件の処置において正確・迅速な補助を実践`);
  if (uniqueBehaviors.length > 0) highlights.push(...uniqueBehaviors.slice(0,2));

  const highlightHtml = highlights.map(h => `<div class="hl">・${esc(h)}</div>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>賞状 - ${esc(name)}</title>
<style>
@media print { .no-print { display: none; } @page { margin: 15mm; } }
body { font-family: "游明朝", "Yu Mincho", "Hiragino Mincho Pro", serif; background: #fffdf5; display: flex; flex-direction:column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
.no-print { display:flex; gap:12px; margin-bottom:20px; }
.no-print button { padding:8px 24px; border:none; border-radius:6px; font-size:14px; cursor:pointer; }
.back-btn { background:#e5e7eb; color:#333; }
.print-btn { background:#2aab96; color:#fff; }
.cert { border: 8px double #b8860b; padding: 56px 64px; max-width: 720px; width: 100%; text-align: center; background: #fffdf5; position: relative; }
.cert::before { content:''; position:absolute; inset:10px; border:2px solid #d4a017; pointer-events:none; }
.cert::after { content:'✦'; position:absolute; top:20px; left:50%; transform:translateX(-50%); font-size:20px; color:#d4a017; }
h1 { font-size: 44px; letter-spacing: 0.4em; color: #8b6914; margin: 20px 0 36px; }
.name { font-size: 38px; font-weight: bold; border-bottom: 2px solid #333; display: inline-block; padding-bottom: 6px; margin: 16px 0 28px; letter-spacing:0.15em; }
.body { font-size: 16px; line-height: 2.4; color: #333; margin: 20px 0; text-align:left; padding: 0 10px; }
.highlights { background: #fefce8; border: 1px solid #d4a017; border-radius: 6px; padding: 16px 20px; margin: 20px 0; text-align:left; }
.hl { font-size: 14px; color: #555; line-height: 2; }
.footer { margin-top: 36px; }
.date { font-size: 14px; color: #666; }
.clinic { font-size: 20px; font-weight: bold; margin-top: 8px; letter-spacing:0.1em; }
.seal { font-size: 36px; margin-top: 4px; }
</style>
</head>
<body>
<div class="no-print">
  <button class="back-btn" onclick="history.back()">← 戻る</button>
  <button class="print-btn" onclick="window.print()">印刷する</button>
</div>
<div class="cert">
  <h1>表　彰　状</h1>
  <div class="name">${esc(name)}　殿</div>
  <div class="body">
    あなたは日々の診療業務において、患者様お一人おひとりに対して<br>
    真心のこもった対応を実践し、チームの一員として<br>
    常に高い意識と誠実な姿勢で職務に励んでまいりました。<br>
    <br>
    その献身的な取り組みと積み重ねた実績は<br>
    医院の発展と患者様の信頼向上に大きく貢献するものであり<br>
    ここにその功績を讃え、表彰いたします。
  </div>
  ${highlights.length ? `<div class="highlights">${highlightHtml}</div>` : ''}
  <div class="footer">
    <div class="date">${today}</div>
    <div class="clinic">のびのび歯科・矯正歯科</div>
    <div class="seal">院長　印</div>
  </div>
</div>
</body>
</html>`);
});

// 個人評価表ページ
app.get('/evaluation', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const name = req.query.name || '';
  if (!name) return res.status(400).send('スタッフ名が必要です');
  const allRecords = await loadDB();
  const staffRecords = allRecords.filter(r => r.staffName === name);

  const itemsMap2 = {}, counselingMap2 = {}, treatmentMap2 = {};
  let reviews2 = 0;
  const freePhrases2 = [];
  const patients = new Set();

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
    if (r.patientNo) patients.add(r.patientNo);
  }
  const itemsTotal2 = Object.values(itemsMap2).reduce((a,b)=>a+b,0);
  const counselingTotal2 = Object.values(counselingMap2).reduce((a,b)=>a+b,0);
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

  // 評価コメント自動生成
  const comments = [];
  if (patients.size >= 10) comments.push('多くの患者様を担当し、豊富な臨床経験を積んでいます。');
  else if (patients.size > 0) comments.push('患者様一人ひとりに丁寧に向き合う姿勢が見られます。');
  if (counselingTotal2 >= 5) comments.push('カウンセリング成約数が高く、患者様への説明力・提案力が優れています。');
  else if (counselingTotal2 > 0) comments.push('カウンセリングへの積極的な関与が実績に表れています。');
  if (itemsTotal2 > 0) comments.push('物品提案を通じて患者様のセルフケアをサポートできています。');
  if (reviews2 > 0) comments.push('口コミ獲得により医院の認知向上に貢献しています。');
  if (freePhrases2.length >= 3) comments.push('日常業務での積極的な取り組みが多く記録されており、チームへの貢献度が高いです。');
  if (comments.length === 0) comments.push('引き続き日々の業務に取り組み、実績を積み上げていきましょう。');

  const rows = [
    ['担当患者数', patients.size + '名'],
    ['物品販売数', itemsTotal2 + '件' + (itemsTotal2 ? '（' + Object.entries(itemsMap2).map(([k,v])=>`${k}:${v}`).join('、') + '）' : '')],
    ['カウンセリング成約数', counselingTotal2 + '件' + (counselingTotal2 ? '（' + Object.entries(counselingMap2).map(([k,v])=>`${k}:${v}`).join('、') + '）' : '')],
    ['口コミ獲得数', reviews2 + '件'],
    ['処置内訳', Object.entries(treatmentMap2).map(([k,v])=>`${k}:${v}件`).join('、') || 'なし'],
    ['行動・取り組み記録数', freePhrases2.length + '件'],
  ].map(([label, val]) => `<tr><td class="label">${esc(label)}</td><td>${esc(val)}</td></tr>`).join('');

  const freeRows = [...new Map(freePhrases2.map(p => [p.text, p])).values()].slice(0, 15)
    .map(p => `<tr><td class="label">${esc(p.date)}</td><td>${esc(p.text)}</td></tr>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>個人評価表 - ${esc(name)}</title>
<style>
@media print { .no-print { display: none; } @page { margin: 15mm; } }
body { font-family: sans-serif; background: #fff; margin: 0; padding: 30px; color: #333; max-width: 800px; }
.no-print { display:flex; gap:12px; margin-bottom:20px; }
.no-print button { padding:8px 24px; border:none; border-radius:6px; font-size:14px; cursor:pointer; }
.back-btn { background:#e5e7eb; color:#333; }
.print-btn { background:#2aab96; color:#fff; }
.header-bar { border-bottom: 3px solid #2aab96; padding-bottom: 10px; margin-bottom: 6px; display:flex; justify-content:space-between; align-items:flex-end; }
.title { font-size: 20px; font-weight:bold; }
.meta { font-size: 13px; color: #666; }
.name-big { font-size: 30px; font-weight: bold; color: #065f46; margin: 12px 0 20px; }
h2 { font-size: 14px; background: #e8f7f5; padding: 6px 12px; border-left: 4px solid #2aab96; margin: 24px 0 10px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14px; }
td { padding: 9px 12px; border: 1px solid #e5e7eb; }
td.label { background: #f9fafb; font-weight: bold; width: 38%; color: #374151; }
.comment-box { background:#f0fdf4; border:1px solid #86efac; border-radius:6px; padding:14px 18px; margin:16px 0; }
.comment-box p { font-size:14px; line-height:2; color:#166534; margin:0; }
.sign-area { margin-top: 40px; display:flex; justify-content:flex-end; gap:60px; font-size:13px; color:#555; }
.sign-line { border-top:1px solid #333; width:120px; text-align:center; padding-top:4px; margin-top:30px; }
</style>
</head>
<body>
<div class="no-print">
  <button class="back-btn" onclick="history.back()">← 戻る</button>
  <button class="print-btn" onclick="window.print()">印刷する</button>
</div>
<div class="header-bar">
  <div class="title">個人実績評価表</div>
  <div class="meta">出力日：${today}</div>
</div>
<div class="name-big">${esc(name)}</div>

<h2>実績サマリー</h2>
<table>${rows}</table>

<h2>総合コメント</h2>
<div class="comment-box"><p>${comments.map(c => esc(c)).join('<br>')}</p></div>

<h2>行動・取り組み記録</h2>
<table>
  <tr><td class="label" style="width:22%">日付</td><td>内容</td></tr>
  ${freeRows || '<tr><td colspan="2" style="color:#9ca3af;text-align:center;padding:20px">記録なし</td></tr>'}
</table>

<div class="sign-area">
  <div><div class="sign-line">確認者</div></div>
  <div><div class="sign-line">院長</div></div>
</div>
</body>
</html>`);
});

app.get('/health', (_req, res) => res.send('OK'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`スタッフ実績サーバー起動: port=${PORT}`));
