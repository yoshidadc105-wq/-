const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const path = require('path');
const phone = require('./phone');

const app = express();

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const STRANSA_WEBHOOK_URL = process.env.STRANSA_WEBHOOK_URL;
const QUESTIONNAIRE_URL = process.env.QUESTIONNAIRE_URL;
const TEST_MODE = process.env.TEST_MODE === 'true';
const MAIL_TO = process.env.MAIL_TO;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const PRINTNODE_API_KEY = process.env.PRINTNODE_API_KEY;
const PRINTNODE_PRINTER_ID = process.env.PRINTNODE_PRINTER_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// ---- 簡易DB（JSONファイル）----

const DB_FILE = path.join(__dirname, 'data', 'submissions.json');

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveDB(records) {
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2), 'utf8');
  } catch (err) {
    console.error('DB保存エラー:', err.message);
  }
}

// ---- 管理者認証 ----

function checkAdminAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    res.status(401).send('認証が必要です');
    return false;
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const colonIdx = decoded.indexOf(':');
  const pass = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : '';
  if (pass !== ADMIN_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    res.status(401).send('パスワードが違います');
    return false;
  }
  return true;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 静的ファイル配信
app.use(express.static(path.join(__dirname, 'public')));

// rawBodyをLINEシグネチャ検証のために保持
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ---- 日本語フォント（起動時にダウンロード・キャッシュ）----

let jaFont = null;

function loadJapaneseFont() {
  const candidates = [
    path.join(__dirname, 'node_modules', '@expo-google-fonts', 'noto-sans-jp', '400Regular', 'NotoSansJP_400Regular.ttf'),
  ];
  for (const p of candidates) {
    try {
      jaFont = fs.readFileSync(p);
      console.log('フォント読み込み完了');
      return;
    } catch (_) {}
  }
  console.error('フォントを読み込めませんでした（印刷は日本語なしで続行）');
}

loadJapaneseFont();

// ---- LINE Webhook ----

function verifyLineSignature(rawBody, signature) {
  const hash = crypto
    .createHmac('SHA256', CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');
  return hash === signature;
}

app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];

  if (!verifyLineSignature(req.rawBody, signature)) {
    console.warn('Invalid signature - rejected');
    return res.status(401).send('Invalid signature');
  }

  res.status(200).send('OK');

  if (!TEST_MODE && STRANSA_WEBHOOK_URL) {
    axios
      .post(STRANSA_WEBHOOK_URL, req.body, {
        headers: {
          'Content-Type': 'application/json',
          'x-line-signature': signature,
        },
        timeout: 5000,
      })
      .catch((err) => console.error('Stransa転送エラー:', err.message));
  } else if (TEST_MODE) {
    console.log('[TEST MODE] Stransa転送スキップ');
  }

  const events = req.body.events || [];
  for (const event of events) {
    console.log('=== イベント受信 ===');
    console.log(JSON.stringify(event, null, 2));

    if (event.type === 'follow') {
      await sendFollowMessage(event.source.userId);
    }

    if (event.type === 'message' && event.message.type === 'text') {
      const text = event.message.text.trim();
      if (text === '問診表') {
        await sendQuestionnaire(event.source.userId);
      }
    }
  }
});

async function sendFollowMessage(userId) {
  const message = [
    'のびのび歯科・矯正歯科へようこそ！',
    '友だち追加ありがとうございます😊',
    '',
    'このアカウントでは予約の確認や最新情報をお届けします。',
  ].join('\n');

  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: userId, messages: [{ type: 'text', text: message }] },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        },
        timeout: 5000,
      }
    );
  } catch (err) {
    console.error('ウェルカムメッセージ送信エラー:', err.response?.data || err.message);
  }
}

async function sendQuestionnaire(userId) {
  const message = [
    '📋 問診表をお送りします。',
    '',
    '下記のURLをタップしてご記入ください。',
    'ご来院前にご提出いただくと受付がスムーズになります。',
    '',
    QUESTIONNAIRE_URL,
  ].join('\n');

  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: userId, messages: [{ type: 'text', text: message }] },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        },
        timeout: 5000,
      }
    );
    console.log(`問診表送信完了: userId=${userId}`);
  } catch (err) {
    console.error(`問診表送信エラー: userId=${userId}`, err.response?.data || err.message);
  }
}

// ---- 問診表フォーム受信 ----

app.post('/submit', async (req, res) => {
  const d = req.body;
  if (!d || !d.name) return res.status(400).json({ error: 'invalid data' });

  const typeLabel = d.type === 'child' ? '小児用' : '成人用';
  console.log(`問診表受信(${typeLabel}): ${d.name}`);
  res.status(200).json({ ok: true });

  const records = loadDB();
  records.unshift({
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    type: d.type || 'adult',
    name: d.name,
    kana: d.kana || '',
    tel: d.tel || '',
    q1: d.q1 || [],
    checked: false,
    data: d,
  });
  saveDB(records);

  sendFormEmail(d).catch((err) => console.error('メール送信エラー:', err.message));
  printQuestionnaire(d).catch((err) => console.error('印刷エラー:', err.message));
});

// ---- 管理画面 ----

app.get('/admin', (req, res) => {
  if (!checkAdminAuth(req, res)) return;

  const records = loadDB();
  const unchecked = records.filter((r) => !r.checked).length;

  const rows = records
    .map((r) => {
      const dt = new Date(r.receivedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
      const q1Text = Array.isArray(r.q1) ? r.q1.join('、') : r.q1 || '';
      const rowClass = r.checked ? '' : 'new';
      const typeLabel = r.type === 'child' ? '<span class="badge-child">小児</span>' : '<span class="badge-adult">成人</span>';
      const badge = r.checked
        ? '<span class="badge-done">確認済</span>'
        : `<form method="post" action="/admin/check/${r.id}"><button class="btn-check" type="submit">確認済にする</button></form>`;
      return `
      <tr class="${rowClass}">
        <td>${escHtml(dt)}</td>
        <td>${typeLabel}</td>
        <td><strong>${escHtml(r.name)}</strong><br><small>${escHtml(r.kana)}</small></td>
        <td>${escHtml(r.tel)}</td>
        <td>${escHtml(q1Text)}</td>
        <td>${badge}</td>
      </tr>`;
    })
    .join('');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>問診表 管理画面 | のびのび歯科</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: sans-serif; background: #f3f4f6; color: #333; }
header { background: #1d4ed8; color: #fff; padding: 14px 24px; display: flex; align-items: center; gap: 14px; }
header h1 { font-size: 17px; font-weight: bold; }
.badge-new { background: #ef4444; color: #fff; border-radius: 999px; padding: 2px 12px; font-size: 13px; font-weight: bold; }
.container { padding: 20px; max-width: 1200px; margin: 0 auto; }
.summary { margin-bottom: 12px; font-size: 14px; color: #6b7280; }
table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
th { background: #eff6ff; padding: 10px 14px; text-align: left; font-size: 13px; color: #1e40af; white-space: nowrap; }
td { padding: 10px 14px; border-top: 1px solid #e5e7eb; font-size: 14px; vertical-align: top; }
tr.new td { background: #fefce8; }
tr.new td:first-child { border-left: 4px solid #f59e0b; }
.badge-done { background: #d1fae5; color: #065f46; padding: 3px 10px; border-radius: 999px; font-size: 12px; display: inline-block; }
.badge-adult { background: #dbeafe; color: #1d4ed8; padding: 2px 10px; border-radius: 999px; font-size: 12px; display: inline-block; font-weight: bold; }
.badge-child { background: #fce7f3; color: #9d174d; padding: 2px 10px; border-radius: 999px; font-size: 12px; display: inline-block; font-weight: bold; }
.btn-check { background: #1d4ed8; color: #fff; border: none; padding: 5px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.btn-check:hover { background: #1e40af; }
.empty { text-align: center; padding: 48px; color: #9ca3af; font-size: 15px; }
</style>
</head>
<body>
<header>
  <h1>のびのび歯科 問診表管理</h1>
  ${unchecked > 0 ? `<span class="badge-new">未確認 ${unchecked}件</span>` : '<span style="font-size:13px;opacity:.8">未確認なし</span>'}
</header>
<div class="container">
  <p class="summary">合計 ${records.length}件 ／ 未確認 ${unchecked}件</p>
  <table>
    <thead>
      <tr>
        <th>受信日時</th>
        <th>種別</th>
        <th>お名前</th>
        <th>電話番号</th>
        <th>主訴</th>
        <th>状態</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="6" class="empty">まだ受信した問診表はありません</td></tr>'}
    </tbody>
  </table>
</div>
</body>
</html>`);
});

app.post('/admin/check/:id', (req, res) => {
  if (!checkAdminAuth(req, res)) return;

  const records = loadDB();
  const record = records.find((r) => r.id === req.params.id);
  if (record) {
    record.checked = true;
    saveDB(records);
  }
  res.redirect('/admin');
});

// ---- メール送信 ----

function formatChecks(arr) {
  if (!arr || arr.length === 0) return '（なし）';
  return Array.isArray(arr) ? arr.join('、') : arr;
}

function scheduleText(d) {
  return [
    `　　　月　火　水　木　金　土　日　祝`,
    `午前　${d.sch_am_mon||'-'}　${d.sch_am_tue||'-'}　${d.sch_am_wed||'-'}　${d.sch_am_thu||'-'}　${d.sch_am_fri||'-'}　${d.sch_am_sat||'-'}　${d.sch_am_sun||'-'}　${d.sch_am_hol||'-'}`,
    `午後　${d.sch_pm_mon||'-'}　${d.sch_pm_tue||'-'}　${d.sch_pm_wed||'-'}　${d.sch_pm_thu||'-'}　${d.sch_pm_fri||'-'}　${d.sch_pm_sat||'-'}　${d.sch_pm_sun||'-'}　${d.sch_pm_hol||'-'}`,
  ].join('\n');
}

async function sendFormEmail(d) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const isChild = d.type === 'child';
  const typeLabel = isChild ? '小児用' : '成人用';

  let text;
  if (isChild) {
    text = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  のびのび歯科・矯正歯科　問診表（小児用）
  受信日時: ${now}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【基本情報】
お子様の名前: ${d.name}（${d.kana || ''}）
生年月日　　: ${d.dob}
性別　　　　: ${d.gender || '未記入'}
学校・保育園: ${d.school || '未記入'}
保護者名　　: ${d.guardian || '未記入'}
電話番号　　: ${d.tel || '未記入'}

━━ 問診 ━━━━━━━━━━━━━━━━━━━━━━━━

Q1. 来院理由
  ${formatChecks(d.q1)}${d.q1_other ? ' / ' + d.q1_other : ''}

Q2. 過去の受診経験: ${d.q2 || '未記入'}

Q3. 既往歴・アレルギー
  ${formatChecks(d.q3)}${d.q3_other ? ' / ' + d.q3_other : ''}

Q4. 現在の服薬: ${d.q4 || '未記入'}
  薬剤名: ${d.q4_medicine || 'なし'}

Q5. 口腔習癖
  ${formatChecks(d.q5)}

Q6. 食事・飲み物の習慣
  ${formatChecks(d.q6)}

Q7. 当院を知ったきっかけ
  ${formatChecks(d.q7)}${d.q7_other ? ' / ' + d.q7_other : ''}

Q8. ご不安・気になること
  ${d.q8 || 'なし'}

━━ 通院希望曜日 ━━━━━━━━━━━━━━━━━━━━
${scheduleText(d)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━`.trim();
  } else {
    text = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  のびのび歯科・矯正歯科　問診表（成人用）
  受信日時: ${now}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【基本情報】
お名前　: ${d.name}（${d.kana || ''}）
生年月日: ${d.dob}
性別　　: ${d.gender || '未記入'}
電話番号: ${d.tel || '未記入'}

━━ 問診 ━━━━━━━━━━━━━━━━━━━━━━━━

Q1. 来院理由
  ${formatChecks(d.q1)}${d.q1_other ? ' / ' + d.q1_other : ''}

Q2. 最後の受診: ${d.q2 || '未記入'}

Q3. 既往歴
  ${formatChecks(d.q3)}${d.q3_other ? ' / ' + d.q3_other : ''}

Q4. 現在の服薬: ${d.q4 || '未記入'}
  薬剤名: ${d.q4_medicine || 'なし'}

Q5. アレルギー
  ${formatChecks(d.q5)}${d.q5_other ? ' / ' + d.q5_other : ''}

Q6. 当院を知ったきっかけ
  ${formatChecks(d.q6)}${d.q6_other ? ' / ' + d.q6_other : ''}

Q7. 治療の希望
  ${formatChecks(d.q7)}${d.q7_other ? ' / ' + d.q7_other : ''}

Q8. ご不安・気になること
  ${d.q8 || 'なし'}

━━ 通院希望曜日 ━━━━━━━━━━━━━━━━━━━━
${scheduleText(d)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━`.trim();
  }

  await transporter.sendMail({
    from: `"のびのび歯科 問診表" <${GMAIL_USER}>`,
    to: MAIL_TO,
    subject: `【問診表・${typeLabel}】${d.name} 様（${now}）`,
    text,
  });
}

// ---- PDF生成 ----

function buildPDF(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (jaFont) {
      doc.registerFont('JP', jaFont);
      doc.font('JP');
    }

    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const isChild = d.type === 'child';
    const typeLabel = isChild ? '小児用' : '成人用';

    doc.fontSize(16).text(`のびのび歯科・矯正歯科 問診表（${typeLabel}）`, { align: 'center' });
    doc.fontSize(9).text(`受信: ${now}`, { align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(11).text('■ 基本情報');
    if (isChild) {
      doc.fontSize(10)
        .text(`お子様の名前: ${d.name}（${d.kana || ''}）`)
        .text(`生年月日: ${d.dob}　性別: ${d.gender || '未記入'}`)
        .text(`学校・保育園: ${d.school || '未記入'}`)
        .text(`保護者名: ${d.guardian || '未記入'}　電話: ${d.tel || '未記入'}`);
    } else {
      doc.fontSize(10)
        .text(`お名前: ${d.name}（${d.kana || ''}）`)
        .text(`生年月日: ${d.dob}　性別: ${d.gender || '未記入'}`)
        .text(`電話: ${d.tel || '未記入'}`);
    }
    doc.moveDown(0.5);

    doc.fontSize(11).text('■ 問診');
    if (isChild) {
      doc.fontSize(10)
        .text(`Q1 来院理由:${formatChecks(d.q1)}${d.q1_other ? ' / ' + d.q1_other : ''}`)
        .text(`Q2 過去の受診経験: ${d.q2 || '未記入'}`)
        .text(`Q3 既往歴・アレルギー: ${formatChecks(d.q3)}${d.q3_other ? ' / ' + d.q3_other : ''}`)
        .text(`Q4 服薬: ${d.q4 || '未記入'}${d.q4_medicine ? ' / ' + d.q4_medicine : ''}`)
        .text(`Q5 口腔習癖: ${formatChecks(d.q5)}`)
        .text(`Q6 食事の習慣: ${formatChecks(d.q6)}`)
        .text(`Q7 きっかけ: ${formatChecks(d.q7)}${d.q7_other ? ' / ' + d.q7_other : ''}`)
        .text(`Q8 ご不安・気になること:`);
      doc.fontSize(10).text(d.q8 || 'なし', { indent: 12 });
    } else {
      doc.fontSize(10)
        .text(`Q1 来院理由:${formatChecks(d.q1)}${d.q1_other ? ' / ' + d.q1_other : ''}`)
        .text(`Q2 最後の受診: ${d.q2 || '未記入'}`)
        .text(`Q3 既往歴: ${formatChecks(d.q3)}${d.q3_other ? ' / ' + d.q3_other : ''}`)
        .text(`Q4 服薬: ${d.q4 || '未記入'}${d.q4_medicine ? ' / ' + d.q4_medicine : ''}`)
        .text(`Q5 アレルギー: ${formatChecks(d.q5)}${d.q5_other ? ' / ' + d.q5_other : ''}`)
        .text(`Q6 きっかけ: ${formatChecks(d.q6)}${d.q6_other ? ' / ' + d.q6_other : ''}`)
        .text(`Q7 治療の希望: ${formatChecks(d.q7)}${d.q7_other ? ' / ' + d.q7_other : ''}`)
        .text(`Q8 ご不安・気になること:`);
      doc.fontSize(10).text(d.q8 || 'なし', { indent: 12 });
    }
    doc.moveDown(0.5);

    doc.fontSize(11).text('■ 通院希望曜日');
    doc.fontSize(10)
      .text(`午前(9:30〜13:30): 月${d.sch_am_mon||'-'} 火${d.sch_am_tue||'-'} 水${d.sch_am_wed||'-'} 木${d.sch_am_thu||'-'} 金${d.sch_am_fri||'-'} 土${d.sch_am_sat||'-'} 日${d.sch_am_sun||'-'} 祝${d.sch_am_hol||'-'}`)
      .text(`午後(14:30〜18:30): 月${d.sch_pm_mon||'-'} 火${d.sch_pm_tue||'-'} 水${d.sch_pm_wed||'-'} 木${d.sch_pm_thu||'-'} 金${d.sch_pm_fri||'-'} 土${d.sch_pm_sat||'-'} 日${d.sch_pm_sun||'-'} 祝${d.sch_pm_hol||'-'}`);

    doc.end();
  });
}

// ---- PrintNode自動印刷 ----

async function printQuestionnaire(d) {
  if (!PRINTNODE_API_KEY || !PRINTNODE_PRINTER_ID) {
    console.log('PrintNode未設定のためスキップ');
    return;
  }
  try {
    const pdfBuf = await buildPDF(d);
    const typeLabel = d.type === 'child' ? '小児' : '成人';
    await axios.post(
      'https://api.printnode.com/printjobs',
      {
        printerId: parseInt(PRINTNODE_PRINTER_ID),
        title: `問診表(${typeLabel}) ${d.name}`,
        contentType: 'pdf_base64',
        content: pdfBuf.toString('base64'),
        source: 'nobinobi-questionnaire',
      },
      { auth: { username: PRINTNODE_API_KEY, password: '' } }
    );
    console.log(`印刷完了: ${d.name}`);
  } catch (err) {
    console.error('印刷エラー:', err.response?.data || err.message);
  }
}

// 死活確認用
app.get('/health', (_req, res) => res.send('OK'));

// ============================================================
// 電話システム
// ============================================================

// ---- 設定画面 (/phone-admin) ----

app.get('/phone-admin', (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  res.send(phoneAdminHtml());
});

// ---- API ----

app.get('/api/phone-schedule', (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  res.json(phone.loadSchedule());
});

app.post('/api/phone-schedule', (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  try {
    phone.saveSchedule(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/phone-override', (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  const { override } = req.body; // 'open' | 'closed' | null
  const schedule = phone.loadSchedule();
  schedule.manualOverride = override || null;
  phone.saveSchedule(schedule);
  res.json({ ok: true });
});

app.get('/api/call-log', (req, res) => {
  if (!checkAdminAuth(req, res)) return;
  const logs = phone.loadCallLog();
  res.json(logs.slice(0, 200));
});

// ---- Twilio Webhook ----

// 着信時に呼ばれる（全着信をここでログ記録）
app.post('/twilio/voice', (req, res) => {
  const { status, reason } = phone.getCurrentStatus();
  const schedule = phone.loadSchedule();

  phone.addCallLog({
    type: 'incoming',
    from: req.body.From || '',
    to: req.body.To || '',
    callSid: req.body.CallSid || '',
    mode: status,
    reason,
  });

  res.set('Content-Type', 'text/xml');

  const hasStaffPhones = schedule.staffPhones && schedule.staffPhones.filter(Boolean).length > 0;

  if (status === 'open' && hasStaffPhones) {
    const numbers = schedule.staffPhones
      .filter(Boolean)
      .map(p => `<Number>${escHtml(p)}</Number>`)
      .join('');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="20" action="/twilio/no-answer" record="record-from-answer">
    ${numbers}
  </Dial>
</Response>`);
  } else {
    const msg = status === 'lunch'
      ? escHtml(schedule.messages.lunch)
      : escHtml(schedule.messages.closed);
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="ja-JP" voice="Polly.Mizuki">${msg}</Say>
  <Record maxLength="120" action="/twilio/recording" playBeep="true" transcribe="false"/>
</Response>`);
  }
});

// スタッフが応答しなかった場合
app.post('/twilio/no-answer', (req, res) => {
  const schedule = phone.loadSchedule();
  phone.addCallLog({
    type: 'no-answer',
    callSid: req.body.CallSid || '',
    dialCallStatus: req.body.DialCallStatus || '',
  });
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="ja-JP" voice="Polly.Mizuki">${escHtml(schedule.messages.voicemail)}</Say>
  <Record maxLength="120" action="/twilio/recording" playBeep="true" transcribe="false"/>
</Response>`);
});

// 録音完了後
app.post('/twilio/recording', (req, res) => {
  phone.addCallLog({
    type: 'recording',
    callSid: req.body.CallSid || '',
    recordingUrl: req.body.RecordingUrl || '',
    recordingDuration: req.body.RecordingDuration || '',
    from: req.body.From || '',
  });
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="ja-JP" voice="Polly.Mizuki">メッセージを受け付けました。ありがとうございました。</Say>
  <Hangup/>
</Response>`);
});

// 全通話ステータス更新（4コール以内で切れた着信もここに来る）
app.post('/twilio/status', (req, res) => {
  const status = req.body.CallStatus || '';
  // completed以外の短時間切断をログ
  if (['no-answer', 'canceled', 'busy', 'failed'].includes(status)) {
    phone.addCallLog({
      type: 'dropped',
      callSid: req.body.CallSid || '',
      from: req.body.From || '',
      callStatus: status,
      callDuration: req.body.CallDuration || '0',
    });
  }
  res.sendStatus(200);
});

// ---- 設定画面HTML ----

function phoneAdminHtml() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>電話設定 | のびのび歯科</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;background:#f3f4f6;color:#1f2937;font-size:15px}
header{background:#1d4ed8;color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
header h1{font-size:16px;font-weight:700}
.status-badge{padding:4px 12px;border-radius:999px;font-size:13px;font-weight:700}
.status-open{background:#22c55e;color:#fff}
.status-closed{background:#ef4444;color:#fff}
.status-lunch{background:#f59e0b;color:#fff}
.tabs{display:flex;background:#fff;border-bottom:1px solid #e5e7eb;overflow-x:auto;white-space:nowrap}
.tab{padding:12px 18px;font-size:14px;font-weight:600;color:#6b7280;cursor:pointer;border-bottom:3px solid transparent;flex-shrink:0}
.tab.active{color:#1d4ed8;border-bottom-color:#1d4ed8}
.pane{display:none;padding:16px;max-width:640px;margin:0 auto}
.pane.active{display:block}
.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.card h2{font-size:14px;font-weight:700;color:#374151;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #f3f4f6}
.row{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.row label{font-size:13px;color:#6b7280;width:80px;flex-shrink:0}
.row input[type=time]{border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:14px;width:100px}
.row input[type=text]{border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:14px;flex:1;min-width:0}
.row textarea{border:1px solid #d1d5db;border-radius:6px;padding:8px;font-size:13px;flex:1;min-width:0;resize:vertical;min-height:72px}
.day-row{display:grid;grid-template-columns:48px 1fr;gap:8px;align-items:start;padding:10px 0;border-bottom:1px solid #f3f4f6}
.day-row:last-child{border-bottom:none}
.day-label{font-size:14px;font-weight:700;color:#374151;padding-top:4px}
.day-fields{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.toggle{position:relative;display:inline-flex;align-items:center;gap:8px;cursor:pointer}
.toggle input{opacity:0;width:0;height:0;position:absolute}
.slider{width:42px;height:24px;background:#d1d5db;border-radius:999px;transition:.2s;flex-shrink:0;position:relative}
.slider::after{content:'';position:absolute;left:3px;top:3px;width:18px;height:18px;background:#fff;border-radius:50%;transition:.2s}
.toggle input:checked+.slider{background:#1d4ed8}
.toggle input:checked+.slider::after{left:21px}
.time-group{display:flex;align-items:center;gap:4px;font-size:13px;color:#6b7280}
.time-group input[type=time]{width:90px}
.time-sep{color:#9ca3af}
.disabled-fields{opacity:.4;pointer-events:none}
.btn{padding:8px 20px;border-radius:8px;font-size:14px;font-weight:600;border:none;cursor:pointer;transition:.15s}
.btn-primary{background:#1d4ed8;color:#fff}
.btn-primary:hover{background:#1e40af}
.btn-primary:disabled{background:#93c5fd;cursor:not-allowed}
.btn-secondary{background:#f3f4f6;color:#374151}
.btn-secondary:hover{background:#e5e7eb}
.btn-danger{background:#fee2e2;color:#dc2626}
.btn-danger:hover{background:#fecaca}
.btn-sm{padding:4px 12px;font-size:13px}
.override-btns{display:flex;gap:8px;flex-wrap:wrap}
.override-btn{padding:10px 20px;border-radius:10px;font-size:14px;font-weight:700;border:2px solid transparent;cursor:pointer;transition:.15s}
.override-btn.ob-auto{border-color:#1d4ed8;color:#1d4ed8;background:#eff6ff}
.override-btn.ob-open{border-color:#22c55e;color:#22c55e;background:#f0fdf4}
.override-btn.ob-closed{border-color:#ef4444;color:#ef4444;background:#fef2f2}
.override-btn.active{opacity:1;filter:none}
.override-btn:not(.active){opacity:.5}
.exception-list{margin-bottom:12px}
.exc-item{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px}
.exc-item:last-child{border-bottom:none}
.exc-type-open{color:#16a34a;font-weight:600}
.exc-type-closed{color:#dc2626;font-weight:600}
.phone-item{display:flex;gap:8px;margin-bottom:8px}
.phone-item input{flex:1}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1f2937;color:#fff;padding:10px 22px;border-radius:10px;font-size:14px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:1000}
.toast.show{opacity:1}
.log-item{padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:12px}
.log-item:last-child{border-bottom:none}
.log-type{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;margin-bottom:2px}
.lt-incoming{background:#dbeafe;color:#1d4ed8}
.lt-dropped{background:#fee2e2;color:#dc2626}
.lt-recording{background:#d1fae5;color:#065f46}
.lt-no-answer{background:#fef3c7;color:#92400e}
.log-from{color:#374151;font-weight:600}
.log-time{color:#9ca3af}
.save-bar{position:sticky;bottom:0;background:#fff;border-top:1px solid #e5e7eb;padding:12px 16px;display:flex;justify-content:flex-end;gap:8px}
</style>
</head>
<body>
<header>
  <h1>電話設定</h1>
  <span id="statusBadge" class="status-badge">読込中</span>
</header>

<div class="tabs">
  <div class="tab active" onclick="switchTab('status')">現在の状態</div>
  <div class="tab" onclick="switchTab('schedule')">営業スケジュール</div>
  <div class="tab" onclick="switchTab('exceptions')">例外日</div>
  <div class="tab" onclick="switchTab('settings')">設定</div>
  <div class="tab" onclick="switchTab('log')">着信履歴</div>
</div>

<!-- 現在の状態タブ -->
<div id="pane-status" class="pane active">
  <div class="card">
    <h2>手動上書き</h2>
    <p style="font-size:13px;color:#6b7280;margin-bottom:12px">スケジュールに関わらず強制的にモードを切り替えます</p>
    <div class="override-btns">
      <button class="override-btn ob-auto active" id="ob-auto" onclick="setOverride(null)">自動（スケジュール通り）</button>
      <button class="override-btn ob-open" id="ob-open" onclick="setOverride('open')">強制 診療中</button>
      <button class="override-btn ob-closed" id="ob-closed" onclick="setOverride('closed')">強制 休診</button>
    </div>
  </div>
  <div class="card">
    <h2>今日のスケジュール</h2>
    <div id="todaySummary" style="font-size:14px;color:#374151;line-height:1.8"></div>
  </div>
</div>

<!-- 営業スケジュールタブ -->
<div id="pane-schedule" class="pane">
  <div class="card">
    <h2>曜日別スケジュール</h2>
    <div id="weeklyEditor"></div>
  </div>
  <div class="save-bar">
    <button class="btn btn-primary" onclick="saveSchedule()">保存する</button>
  </div>
</div>

<!-- 例外日タブ -->
<div id="pane-exceptions" class="pane">
  <div class="card">
    <h2>例外日一覧</h2>
    <div id="exceptionList" class="exception-list"></div>
  </div>
  <div class="card">
    <h2>例外日を追加</h2>
    <div class="row">
      <label>日付</label>
      <input type="date" id="excDate" style="border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:14px">
    </div>
    <div class="row">
      <label>種別</label>
      <select id="excType" style="border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:14px" onchange="toggleExcFields()">
        <option value="closed">休診</option>
        <option value="open">臨時診療</option>
      </select>
    </div>
    <div id="excOpenFields">
      <div class="row">
        <label>開始</label>
        <input type="time" id="excStart" value="09:00">
      </div>
      <div class="row">
        <label>終了</label>
        <input type="time" id="excEnd" value="13:00">
      </div>
      <div class="row">
        <label>昼休み開始</label>
        <input type="time" id="excLunchStart" placeholder="なし" style="border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:14px;width:100px">
      </div>
      <div class="row">
        <label>昼休み終了</label>
        <input type="time" id="excLunchEnd" placeholder="なし" style="border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:14px;width:100px">
      </div>
    </div>
    <button class="btn btn-primary" onclick="addException()">追加する</button>
  </div>
</div>

<!-- 設定タブ -->
<div id="pane-settings" class="pane">
  <div class="card">
    <h2>転送先電話番号</h2>
    <p style="font-size:12px;color:#6b7280;margin-bottom:12px">国際番号形式で入力（例：+819012345678）<br>空欄の場合は転送なし（AIのみ応答）</p>
    <div id="phoneList"></div>
    <button class="btn btn-secondary btn-sm" onclick="addPhoneField()">＋ 番号を追加</button>
  </div>
  <div class="card">
    <h2>音声メッセージ</h2>
    <div class="row" style="align-items:flex-start">
      <label style="padding-top:6px">休診時</label>
      <textarea id="msgClosed"></textarea>
    </div>
    <div class="row" style="align-items:flex-start">
      <label style="padding-top:6px">昼休み</label>
      <textarea id="msgLunch"></textarea>
    </div>
    <div class="row" style="align-items:flex-start">
      <label style="padding-top:6px">留守電</label>
      <textarea id="msgVoicemail"></textarea>
    </div>
  </div>
  <div class="save-bar">
    <button class="btn btn-primary" onclick="saveSchedule()">保存する</button>
  </div>
</div>

<!-- 着信履歴タブ -->
<div id="pane-log" class="pane">
  <div class="card">
    <h2>着信履歴（直近200件）</h2>
    <div id="callLogList"></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
let scheduleData = null;

const DAY_LABELS = {sun:'日',mon:'月',tue:'火',wed:'水',thu:'木',fri:'金',sat:'土'};
const DAY_ORDER = ['mon','tue','wed','thu','fri','sat','sun'];

async function loadData() {
  try {
    const r = await fetch('/api/phone-schedule', { headers: authHeader() });
    if (!r.ok) { location.href = location.href; return; }
    scheduleData = await r.json();
    renderAll();
  } catch(e) {
    showToast('読み込みエラー');
  }
}

function authHeader() {
  const stored = sessionStorage.getItem('adminPass') || prompt('パスワードを入力してください');
  if (!stored) return {};
  sessionStorage.setItem('adminPass', stored);
  return { Authorization: 'Basic ' + btoa(':' + stored) };
}

function renderAll() {
  renderStatusBadge();
  renderWeeklyEditor();
  renderExceptionList();
  renderPhoneList();
  renderMessages();
  renderTodaySummary();
  renderOverrideBtns();
}

function renderStatusBadge() {
  const badge = document.getElementById('statusBadge');
  const override = scheduleData.manualOverride;
  // クライアント側で簡易判定（正確な判定はサーバー側）
  if (override === 'open') { badge.textContent = '強制 診療中'; badge.className = 'status-badge status-open'; return; }
  if (override === 'closed') { badge.textContent = '強制 休診'; badge.className = 'status-badge status-closed'; return; }
  badge.textContent = '自動判定';
  badge.className = 'status-badge status-badge';
  badge.style.background = '#6b7280';
}

function renderOverrideBtns() {
  const v = scheduleData.manualOverride;
  document.getElementById('ob-auto').classList.toggle('active', !v);
  document.getElementById('ob-open').classList.toggle('active', v === 'open');
  document.getElementById('ob-closed').classList.toggle('active', v === 'closed');
}

function renderTodaySummary() {
  const el = document.getElementById('todaySummary');
  const now = new Date();
  const jst = new Date(now.toLocaleString('en-US',{timeZone:'Asia/Tokyo'}));
  const dayKey = ['sun','mon','tue','wed','thu','fri','sat'][jst.getDay()];
  const yyyy = jst.getFullYear(), mm=String(jst.getMonth()+1).padStart(2,'0'), dd=String(jst.getDate()).padStart(2,'0');
  const dateStr = yyyy+'-'+mm+'-'+dd;

  const exc = (scheduleData.exceptions||[]).find(e=>e.date===dateStr);
  if (exc) {
    el.innerHTML = exc.type==='closed'
      ? '<span style="color:#dc2626">本日は例外休診日です</span>'
      : '<span style="color:#16a34a">本日は臨時診療日です（'+exc.start+'〜'+exc.end+'）</span>';
    return;
  }
  const day = (scheduleData.weeklySchedule||{})[dayKey];
  if (!day||!day.open) { el.innerHTML='<span style="color:#dc2626">本日（'+DAY_LABELS[dayKey]+'曜日）は定休日です</span>'; return; }
  let html = '<span style="color:#16a34a">診療時間：'+day.start+'〜'+day.end+'</span>';
  if (day.lunchStart && day.lunchEnd) html += '<br><span style="color:#d97706">昼休み：'+day.lunchStart+'〜'+day.lunchEnd+'</span>';
  el.innerHTML = html;
}

function renderWeeklyEditor() {
  const ws = scheduleData.weeklySchedule || {};
  const el = document.getElementById('weeklyEditor');
  el.innerHTML = DAY_ORDER.map(key => {
    const d = ws[key] || { open: false };
    const fields = d.open
      ? \`<div class="day-fields">
          <div class="time-group"><span>開始</span><input type="time" value="\${d.start||'09:00'}" data-day="\${key}" data-field="start"></div>
          <div class="time-group"><span>終了</span><input type="time" value="\${d.end||'18:00'}" data-day="\${key}" data-field="end"></div>
          <div class="time-group"><span>昼休</span><input type="time" value="\${d.lunchStart||''}" data-day="\${key}" data-field="lunchStart"><span class="time-sep">〜</span><input type="time" value="\${d.lunchEnd||''}" data-day="\${key}" data-field="lunchEnd"></div>
        </div>\`
      : '<span style="font-size:13px;color:#9ca3af">休診</span>';
    return \`<div class="day-row">
      <div class="day-label">\${DAY_LABELS[key]}</div>
      <div>
        <label class="toggle" style="margin-bottom:8px">
          <input type="checkbox" \${d.open?'checked':''} data-day="\${key}" onchange="toggleDay(this)">
          <span class="slider"></span>
          <span style="font-size:13px">\${d.open?'診療あり':'休診'}</span>
        </label>
        <div id="dayFields-\${key}" class="\${d.open?'':'disabled-fields'}">\${fields}</div>
      </div>
    </div>\`;
  }).join('');
}

function toggleDay(cb) {
  const key = cb.dataset.day;
  const ws = scheduleData.weeklySchedule;
  ws[key] = ws[key] || {};
  ws[key].open = cb.checked;
  if (cb.checked && !ws[key].start) {
    ws[key].start = '09:00'; ws[key].end = '18:00';
    ws[key].lunchStart = '13:00'; ws[key].lunchEnd = '14:00';
  }
  renderWeeklyEditor();
}

function collectWeeklySchedule() {
  const ws = {};
  DAY_ORDER.forEach(key => {
    const cb = document.querySelector(\`input[data-day="\${key}"][type=checkbox]\`);
    if (!cb) return;
    if (!cb.checked) { ws[key] = { open: false }; return; }
    ws[key] = {
      open: true,
      start: getField(key,'start'),
      end: getField(key,'end'),
      lunchStart: getField(key,'lunchStart') || null,
      lunchEnd: getField(key,'lunchEnd') || null,
    };
  });
  return ws;
}

function getField(day, field) {
  const el = document.querySelector(\`input[data-day="\${day}"][data-field="\${field}"]\`);
  return el ? el.value : '';
}

function renderExceptionList() {
  const list = scheduleData.exceptions || [];
  const el = document.getElementById('exceptionList');
  if (!list.length) { el.innerHTML = '<p style="font-size:13px;color:#9ca3af">例外日はありません</p>'; return; }
  const sorted = [...list].sort((a,b)=>a.date.localeCompare(b.date));
  el.innerHTML = sorted.map((e,i) => {
    const label = e.type==='closed'
      ? '<span class="exc-type-closed">休診</span>'
      : \`<span class="exc-type-open">臨時診療 \${e.start}〜\${e.end}</span>\`;
    return \`<div class="exc-item">
      <span>\${e.date}（\${DAY_LABELS[dayOfDate(e.date)]}）\${label}</span>
      <button class="btn btn-danger btn-sm" onclick="removeException('\${e.date}')">削除</button>
    </div>\`;
  }).join('');
}

function dayOfDate(dateStr) {
  const d = new Date(dateStr+'T00:00:00+09:00');
  return ['sun','mon','tue','wed','thu','fri','sat'][d.getDay()];
}

function toggleExcFields() {
  const type = document.getElementById('excType').value;
  document.getElementById('excOpenFields').style.display = type==='open' ? '' : 'none';
}
toggleExcFields();

function addException() {
  const date = document.getElementById('excDate').value;
  if (!date) { showToast('日付を選択してください'); return; }
  const type = document.getElementById('excType').value;
  const exc = scheduleData.exceptions || [];
  exc.push(type==='closed'
    ? { date, type: 'closed' }
    : { date, type: 'open',
        start: document.getElementById('excStart').value,
        end: document.getElementById('excEnd').value,
        lunchStart: document.getElementById('excLunchStart').value || null,
        lunchEnd: document.getElementById('excLunchEnd').value || null,
      });
  scheduleData.exceptions = exc;
  saveDirect().then(() => { renderExceptionList(); showToast('追加しました'); });
}

function removeException(date) {
  scheduleData.exceptions = (scheduleData.exceptions||[]).filter(e=>e.date!==date);
  saveDirect().then(() => { renderExceptionList(); showToast('削除しました'); });
}

function renderPhoneList() {
  const phones = scheduleData.staffPhones || [];
  const el = document.getElementById('phoneList');
  el.innerHTML = (phones.length ? phones : ['']).map((p,i) => \`
    <div class="phone-item">
      <input type="tel" class="staff-phone" value="\${p}" placeholder="+819012345678"
        style="border:1px solid #d1d5db;border-radius:6px;padding:8px;font-size:14px">
      <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">削除</button>
    </div>\`).join('');
}

function addPhoneField() {
  const div = document.createElement('div');
  div.className = 'phone-item';
  div.innerHTML = \`<input type="tel" class="staff-phone" placeholder="+819012345678"
    style="border:1px solid #d1d5db;border-radius:6px;padding:8px;font-size:14px">
    <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">削除</button>\`;
  document.getElementById('phoneList').appendChild(div);
}

function renderMessages() {
  const m = scheduleData.messages || {};
  document.getElementById('msgClosed').value = m.closed || '';
  document.getElementById('msgLunch').value = m.lunch || '';
  document.getElementById('msgVoicemail').value = m.voicemail || '';
}

async function saveSchedule() {
  scheduleData.weeklySchedule = collectWeeklySchedule();
  scheduleData.staffPhones = [...document.querySelectorAll('.staff-phone')]
    .map(el=>el.value.trim()).filter(Boolean);
  scheduleData.messages = {
    closed: document.getElementById('msgClosed').value,
    lunch: document.getElementById('msgLunch').value,
    voicemail: document.getElementById('msgVoicemail').value,
  };
  await saveDirect();
  showToast('保存しました');
  renderAll();
}

async function saveDirect() {
  const r = await fetch('/api/phone-schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(scheduleData),
  });
  if (!r.ok) showToast('保存失敗');
}

async function setOverride(val) {
  const r = await fetch('/api/phone-override', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ override: val }),
  });
  if (r.ok) {
    scheduleData.manualOverride = val || null;
    renderOverrideBtns();
    renderStatusBadge();
    showToast(val ? (val==='open'?'強制診療中に切替':'強制休診に切替') : '自動に戻しました');
  }
}

async function loadCallLog() {
  try {
    const r = await fetch('/api/call-log', { headers: authHeader() });
    const logs = await r.json();
    const el = document.getElementById('callLogList');
    if (!logs.length) { el.innerHTML='<p style="font-size:13px;color:#9ca3af">着信履歴はありません</p>'; return; }
    el.innerHTML = logs.map(l => {
      const typeMap = {incoming:'lt-incoming',dropped:'lt-dropped',recording:'lt-recording','no-answer':'lt-no-answer'};
      const labelMap = {incoming:'着信',dropped:'途中切断',recording:'留守電',  'no-answer':'不在'};
      const cls = typeMap[l.type]||'lt-incoming';
      const label = labelMap[l.type]||l.type;
      const dt = new Date(l.createdAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
      const from = l.from ? \`<span class="log-from">\${l.from}</span> \` : '';
      return \`<div class="log-item">
        <span class="log-type \${cls}">\${label}</span>
        \${from}<span class="log-time">\${dt}</span>
        \${l.recordingUrl?'<br><a href="'+l.recordingUrl+'" target="_blank" style="font-size:12px;color:#1d4ed8">録音を聞く</a>':''}
      </div>\`;
    }).join('');
  } catch(e) {
    document.getElementById('callLogList').innerHTML='<p style="color:#dc2626">読み込みエラー</p>';
  }
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t,i)=>{
    const names=['status','schedule','exceptions','settings','log'];
    t.classList.toggle('active', names[i]===name);
  });
  document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));
  document.getElementById('pane-'+name).classList.add('active');
  if (name==='log') loadCallLog();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2500);
}

loadData();
</script>
</body>
</html>`;
}


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動: port=${PORT}`);
  console.log(`テストモード: ${TEST_MODE}`);
  console.log(`メール送信先: ${MAIL_TO || '未設定'}`);
  console.log(`印刷先プリンターID: ${PRINTNODE_PRINTER_ID || '未設定'}`);
  console.log(`PrintNode APIキー: ${PRINTNODE_API_KEY ? PRINTNODE_API_KEY.slice(0,6) + '...' : '未設定'}`);
});
