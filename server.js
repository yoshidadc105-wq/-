const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios');
const { Resend } = require('resend');
const PDFDocument = require('pdfkit');
const path = require('path');

const app = express();

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const STRANSA_WEBHOOK_URL = process.env.STRANSA_WEBHOOK_URL;
const QUESTIONNAIRE_URL = process.env.QUESTIONNAIRE_URL;
const TEST_MODE = process.env.TEST_MODE === 'true';
const MAIL_TO = process.env.MAIL_TO;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const PRINTNODE_API_KEY = process.env.PRINTNODE_API_KEY;
const PRINTNODE_PRINTER_ID = process.env.PRINTNODE_PRINTER_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const QUIZ_ADMIN_PASSWORD = process.env.QUIZ_ADMIN_PASSWORD || 'quiz-admin';

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
      .post(STRANSA_WEBHOOK_URL, req.rawBody, {
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
  const resend = new Resend(RESEND_API_KEY);

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

  await resend.emails.send({
    from: 'のびのび歯科 問診表 <onboarding@resend.dev>',
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

// ===== クイズシステム =====

const QUIZ_FILE = path.join(__dirname, 'data', 'quizzes.json');
const QUIZ_SUBS_FILE = path.join(__dirname, 'data', 'quiz-subs.json');

function loadQuizzes() {
  try { return JSON.parse(fs.readFileSync(QUIZ_FILE, 'utf8')); } catch { return []; }
}
function saveQuizzes(d) {
  fs.mkdirSync(path.dirname(QUIZ_FILE), { recursive: true });
  fs.writeFileSync(QUIZ_FILE, JSON.stringify(d, null, 2));
}
function loadQuizSubs() {
  try { return JSON.parse(fs.readFileSync(QUIZ_SUBS_FILE, 'utf8')); } catch { return []; }
}
function saveQuizSubs(d) {
  fs.mkdirSync(path.dirname(QUIZ_SUBS_FILE), { recursive: true });
  fs.writeFileSync(QUIZ_SUBS_FILE, JSON.stringify(d, null, 2));
}

function checkApiAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const colonIdx = decoded.indexOf(':');
  const pass = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : '';
  if (pass !== QUIZ_ADMIN_PASSWORD) {
    res.status(401).json({ error: 'wrong password' });
    return false;
  }
  return true;
}

// スタッフ向け: 問題一覧（答えなし）
app.get('/api/quizzes', (req, res) => {
  const list = loadQuizzes().map(({ id, type, title, question, options, explanation, createdAt }) => ({
    id, type, title, question, options, explanation, createdAt,
  }));
  res.json(list);
});

// 管理者向け: 問題一覧（答えあり）
app.get('/api/quizzes/admin', (req, res) => {
  if (!checkApiAuth(req, res)) return;
  res.json(loadQuizzes());
});

// 管理者向け: 問題作成
app.post('/api/quizzes', (req, res) => {
  if (!checkApiAuth(req, res)) return;
  const { type, title, question, options, answer, explanation } = req.body;
  if (!type || !title || !question) return res.status(400).json({ error: '必須項目が不足しています' });
  const quiz = {
    id: crypto.randomUUID(),
    type,
    title: title.trim(),
    question: question.trim(),
    options: Array.isArray(options) ? options : [],
    answer: answer ?? '',
    explanation: (explanation || '').trim(),
    createdAt: new Date().toISOString(),
  };
  const all = loadQuizzes();
  all.unshift(quiz);
  saveQuizzes(all);
  res.json(quiz);
});

// 管理者向け: 問題更新
app.put('/api/quizzes/:id', (req, res) => {
  if (!checkApiAuth(req, res)) return;
  const all = loadQuizzes();
  const i = all.findIndex(q => q.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '見つかりません' });
  const { type, title, question, options, answer, explanation } = req.body;
  all[i] = {
    ...all[i], type,
    title: title.trim(), question: question.trim(),
    options: Array.isArray(options) ? options : [],
    answer: answer ?? '',
    explanation: (explanation || '').trim(),
    updatedAt: new Date().toISOString(),
  };
  saveQuizzes(all);
  res.json(all[i]);
});

// 管理者向け: 問題削除
app.delete('/api/quizzes/:id', (req, res) => {
  if (!checkApiAuth(req, res)) return;
  saveQuizzes(loadQuizzes().filter(q => q.id !== req.params.id));
  res.json({ ok: true });
});

// スタッフ向け: 回答送信
app.post('/api/quizzes/:id/submit', (req, res) => {
  const quiz = loadQuizzes().find(q => q.id === req.params.id);
  if (!quiz) return res.status(404).json({ error: '問題が見つかりません' });

  const { staffName, userAnswer } = req.body;
  if (!staffName) return res.status(400).json({ error: 'スタッフ名が必要です' });

  let isCorrect = null;

  if (quiz.type === 'fill') {
    const correct = Array.isArray(quiz.answer) ? quiz.answer : [quiz.answer];
    const user = Array.isArray(userAnswer) ? userAnswer : [userAnswer];
    isCorrect = correct.length === user.length &&
      correct.every((a, i) => a.trim().toLowerCase() === (user[i] || '').trim().toLowerCase());
  } else if (quiz.type === 'sort') {
    const correct = Array.isArray(quiz.options) ? quiz.options : [];
    const user = Array.isArray(userAnswer) ? userAnswer : [];
    isCorrect = correct.length === user.length && correct.every((a, i) => a === user[i]);
  } else if (quiz.type === 'choice') {
    isCorrect = String(quiz.answer).trim() === String(userAnswer).trim();
  } else if (quiz.type === 'truefalse') {
    isCorrect = String(quiz.answer) === String(userAnswer);
  } else if (quiz.type === 'manual') {
    isCorrect = null;
  }

  const sub = {
    id: crypto.randomUUID(),
    quizId: quiz.id,
    quizTitle: quiz.title,
    quizType: quiz.type,
    question: quiz.question,
    staffName: staffName.trim(),
    userAnswer,
    correctAnswer: quiz.type !== 'manual' ? quiz.answer : undefined,
    isCorrect,
    explanation: quiz.explanation,
    adminNote: '',
    submittedAt: new Date().toISOString(),
  };

  const subs = loadQuizSubs();
  subs.unshift(sub);
  saveQuizSubs(subs);

  res.json({
    isCorrect,
    explanation: quiz.explanation,
    correctAnswer: quiz.type !== 'manual' ? quiz.answer : undefined,
  });
});

// 管理者向け: 回答一覧
app.get('/api/quiz-subs', (req, res) => {
  if (!checkApiAuth(req, res)) return;
  res.json(loadQuizSubs());
});

// 管理者向け: マニュアル問題の採点・メモ
app.patch('/api/quiz-subs/:id', (req, res) => {
  if (!checkApiAuth(req, res)) return;
  const subs = loadQuizSubs();
  const sub = subs.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ error: '見つかりません' });
  if (req.body.isCorrect !== undefined) sub.isCorrect = req.body.isCorrect;
  if (req.body.adminNote !== undefined) sub.adminNote = req.body.adminNote;
  saveQuizSubs(subs);
  res.json(sub);
});

// ===== 360度評価システム =====

const FEEDBACK_FILE = path.join(__dirname, 'data', 'feedback.json');
const FEEDBACK_ADMIN_PASSWORD = process.env.FEEDBACK_ADMIN_PASSWORD || ADMIN_PASSWORD;

function loadFeedback() {
  try { return JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8')); } catch { return []; }
}
function saveFeedback(records) {
  fs.mkdirSync(path.dirname(FEEDBACK_FILE), { recursive: true });
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(records, null, 2));
}

function checkFeedbackAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="FeedbackAdmin"');
    res.status(401).send('認証が必要です');
    return false;
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const colonIdx = decoded.indexOf(':');
  const pass = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : '';
  if (pass !== FEEDBACK_ADMIN_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="FeedbackAdmin"');
    res.status(401).send('パスワードが違います');
    return false;
  }
  return true;
}

// フィードバック受信
app.post('/feedback/submit', (req, res) => {
  const d = req.body;
  if (!d || !d.respondent || !d.s1 || !d.s2 || !d.s3 || !d.s4) {
    return res.status(400).json({ error: 'invalid data' });
  }

  const record = {
    id: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
    target: (d.target || '').trim(),
    respondent: d.respondent.trim(),
    managerComment: '',
    commentAt: null,
    s1: {
      q1: parseInt(d.s1.q1) || 0,
      q2: parseInt(d.s1.q2) || 0,
      q3: parseInt(d.s1.q3) || 0,
      good: (d.s1.good || '').trim(),
      improve: (d.s1.improve || '').trim(),
    },
    s2: {
      q1: parseInt(d.s2.q1) || 0,
      q2: parseInt(d.s2.q2) || 0,
      q3: parseInt(d.s2.q3) || 0,
      good: (d.s2.good || '').trim(),
      improve: (d.s2.improve || '').trim(),
    },
    s3: {
      q1: parseInt(d.s3.q1) || 0,
      q2: parseInt(d.s3.q2) || 0,
      q3: parseInt(d.s3.q3) || 0,
      good: (d.s3.good || '').trim(),
      improve: (d.s3.improve || '').trim(),
    },
    s4: {
      q1: parseInt(d.s4.q1) || 0,
      q2: parseInt(d.s4.q2) || 0,
      good: (d.s4.good || '').trim(),
      improve: (d.s4.improve || '').trim(),
    },
  };

  const records = loadFeedback();
  records.unshift(record);
  saveFeedback(records);

  console.log(`360度評価受信: target="${record.target}" respondent="${record.respondent}"`);
  res.json({ ok: true });
});

// 管理者向けAPI: 全データ取得
app.get('/api/feedback', (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  res.json(loadFeedback());
});

// 管理者向け: HTML結果ページ
app.get('/feedback/admin', (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;

  const all = loadFeedback();

  // ターゲット別に集計
  const targets = {};
  for (const r of all) {
    const key = r.target || '（未指定）';
    if (!targets[key]) targets[key] = [];
    targets[key].push(r);
  }

  function avg(arr) {
    if (!arr.length) return 0;
    return (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2);
  }

  function starBar(score) {
    const pct = (parseFloat(score) / 5) * 100;
    return `<div style="display:inline-flex;align-items:center;gap:8px">
      <div style="width:120px;height:10px;background:#e8e0f5;border-radius:5px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:#673ab7;border-radius:5px"></div>
      </div>
      <span style="font-size:13px;font-weight:bold;color:#673ab7">${score}</span>
    </div>`;
  }

  let html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>360度評価 管理画面</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: sans-serif; background: #ede7f6; color: #333; font-size: 14px; }
.top-bar { height: 8px; background: #673ab7; }
header { background: #673ab7; color: #fff; padding: 16px 24px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
header h1 { font-size: 18px; font-weight: bold; }
header p { font-size: 12px; opacity: .8; margin-top: 2px; }
header nav a { color:#e1bee7; font-size:13px; text-decoration:none; margin-left:16px; }
header nav a:hover { color:#fff; }
.container { max-width: 960px; margin: 24px auto; padding: 0 16px 60px; }
.target-block { background: #fff; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.1); margin-bottom: 32px; overflow: hidden; }
.target-header { background: #512da8; color: #fff; padding: 14px 20px; font-size: 16px; font-weight: bold; }
.target-body { padding: 20px; }
.summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; }
.summary-card { background: #f3e5f5; border-radius: 8px; padding: 14px 16px; }
.summary-card .sc-label { font-size: 12px; color: #7b1fa2; margin-bottom: 6px; }
.summary-card .sc-title { font-size: 13px; color: #333; margin-bottom: 8px; font-weight: 500; }
.section-title { font-size: 14px; font-weight: bold; color: #512da8; border-left: 4px solid #673ab7; padding-left: 10px; margin: 20px 0 12px; }
.responses-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px; }
.responses-table th { background: #ede7f6; padding: 8px 12px; text-align: left; color: #512da8; border-bottom: 2px solid #ce93d8; }
.responses-table td { padding: 8px 12px; border-bottom: 1px solid #f3e5f5; vertical-align: top; }
.responses-table tr:hover td { background: #faf5ff; }
.text-block { margin-bottom: 16px; }
.text-block .tb-label { font-size: 12px; color: #7b1fa2; font-weight: bold; margin-bottom: 6px; }
.text-entry { background: #faf5ff; border-left: 3px solid #ce93d8; padding: 8px 12px; margin-bottom: 6px; border-radius: 0 4px 4px 0; font-size: 13px; color: #444; }
.text-entry .te-who { font-size: 11px; color: #9e9e9e; margin-top: 4px; }
.empty { color: #9e9e9e; text-align: center; padding: 40px; }
.count-badge { background: #ce93d8; color: #fff; border-radius: 999px; padding: 2px 10px; font-size: 12px; margin-left: 8px; }
.fb-section { margin-top:20px; border-top:2px dashed #ce93d8; padding-top:16px; }
.fb-section-title { font-size:13px; font-weight:bold; color:#512da8; margin-bottom:8px; }
.fb-textarea { width:100%; min-height:80px; border:1px solid #ce93d8; border-radius:6px; padding:10px 12px; font-size:13px; font-family:inherit; resize:vertical; outline:none; margin-bottom:8px; }
.fb-textarea:focus { border-color:#673ab7; }
.fb-save-btn { background:#673ab7; color:#fff; border:none; border-radius:4px; padding:7px 18px; font-size:13px; cursor:pointer; }
.fb-save-btn:hover { background:#512da8; }
.fb-saved-msg { font-size:12px; color:#2e7d32; margin-left:10px; }
</style>
<script>
async function saveComment(id) {
  const txt = document.getElementById('cmttxt-' + id).value.trim();
  const msgEl = document.getElementById('cmtmsg-' + id);
  try {
    const res = await fetch('/api/feedback/' + id + '/comment', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: txt }),
    });
    if (!res.ok) throw new Error();
    msgEl.style.color = '#2e7d32';
    msgEl.textContent = '✅ 保存しました';
    setTimeout(() => { msgEl.textContent = ''; location.reload(); }, 1200);
  } catch {
    msgEl.style.color = '#c62828';
    msgEl.textContent = '❌ 保存に失敗しました';
  }
}
<\/script>
</head>
<body>
<div class="top-bar"></div>
<header>
  <div>
    <h1>360度評価 管理画面</h1>
    <p>合計 ${all.length} 件の回答</p>
  </div>
  <nav>
    <a href="/self-assessment/admin">行動基準評価へ</a>
  </nav>
</header>
<div class="container">`;

  if (all.length === 0) {
    html += `<p class="empty">まだ回答はありません</p>`;
  } else {
    for (const [targetName, records] of Object.entries(targets)) {
      const n = records.length;
      const s1q1avg = avg(records.map(r => r.s1.q1));
      const s1q2avg = avg(records.map(r => r.s1.q2));
      const s1q3avg = avg(records.map(r => r.s1.q3));
      const s2q1avg = avg(records.map(r => r.s2.q1));
      const s2q2avg = avg(records.map(r => r.s2.q2));
      const s2q3avg = avg(records.map(r => r.s2.q3));
      const s3q1avg = avg(records.map(r => r.s3.q1));
      const s3q2avg = avg(records.map(r => r.s3.q2));
      const s3q3avg = avg(records.map(r => r.s3.q3));
      const s4q1avg = avg(records.map(r => r.s4.q1));
      const s4q2avg = avg(records.map(r => r.s4.q2));

      html += `
<div class="target-block">
  <div class="target-header">${escHtml(targetName)}さん <span class="count-badge">${n}件</span></div>
  <div class="target-body">
    <div class="section-title">スコア集計</div>
    <div class="summary-grid">
      <div class="summary-card">
        <div class="sc-label">①姿勢 / 明るい存在</div>
        <div class="sc-title">自分を明るくする存在である</div>
        ${starBar(s1q1avg)}
      </div>
      <div class="summary-card">
        <div class="sc-label">①姿勢 / 前向きな言葉</div>
        <div class="sc-title">前向きな言葉や態度で接してくれる</div>
        ${starBar(s1q2avg)}
      </div>
      <div class="summary-card">
        <div class="sc-label">①姿勢 / 安定した状態</div>
        <div class="sc-title">安定した状態で仕事に取り組んでいる</div>
        ${starBar(s1q3avg)}
      </div>
      <div class="summary-card">
        <div class="sc-label">②患者さんへの姿勢 / 提案</div>
        <div class="sc-title">患者さんの将来を考えた提案をしている</div>
        ${starBar(s2q1avg)}
      </div>
      <div class="summary-card">
        <div class="sc-label">②患者さんへの姿勢 / 説明</div>
        <div class="sc-title">分かりやすい説明をしている</div>
        ${starBar(s2q2avg)}
      </div>
      <div class="summary-card">
        <div class="sc-label">②患者さんへの姿勢 / また来たい</div>
        <div class="sc-title">「また来たい」と思われる関わり</div>
        ${starBar(s2q3avg)}
      </div>
      <div class="summary-card">
        <div class="sc-label">③成長 / 質問</div>
        <div class="sc-title">分からないことをよく質問している</div>
        ${starBar(s3q1avg)}
      </div>
      <div class="summary-card">
        <div class="sc-label">③成長 / 挑戦</div>
        <div class="sc-title">新しいことに前向きに挑戦している</div>
        ${starBar(s3q2avg)}
      </div>
      <div class="summary-card">
        <div class="sc-label">③成長 / 報告</div>
        <div class="sc-title">報告をすぐに行っている</div>
        ${starBar(s3q3avg)}
      </div>
      <div class="summary-card">
        <div class="sc-label">④チーム力 / 言動の影響</div>
        <div class="sc-title">言動がチームに与える影響を理解している</div>
        ${starBar(s4q1avg)}
      </div>
      <div class="summary-card">
        <div class="sc-label">④チーム力 / 未来づくり</div>
        <div class="sc-title">医院の未来づくりに主体的に関わっている</div>
        ${starBar(s4q2avg)}
      </div>
    </div>

    <div class="section-title">個別スコア一覧 ＆ フィードバック</div>
    <table class="responses-table">
      <thead>
        <tr>
          <th>回答者</th><th>受信日時</th>
          <th>①-1</th><th>①-2</th><th>①-3</th>
          <th>②-1</th><th>②-2</th><th>②-3</th>
          <th>③-1</th><th>③-2</th><th>③-3</th>
          <th>④-1</th><th>④-2</th>
          <th>FB</th>
        </tr>
      </thead>
      <tbody>
        ${records.map(r => {
          const dt = new Date(r.submittedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
          const hasCmt = r.managerComment;
          return `<tr>
            <td><strong>${escHtml(r.respondent)}</strong></td>
            <td>${escHtml(dt)}</td>
            <td>${r.s1.q1}</td><td>${r.s1.q2}</td><td>${r.s1.q3}</td>
            <td>${r.s2.q1}</td><td>${r.s2.q2}</td><td>${r.s2.q3}</td>
            <td>${r.s3.q1}</td><td>${r.s3.q2}</td><td>${r.s3.q3}</td>
            <td>${r.s4.q1}</td><td>${r.s4.q2}</td>
            <td><span style="font-size:12px;color:${hasCmt ? '#2e7d32' : '#f57f17'}">${hasCmt ? '✅' : '未'}</span></td>
          </tr>
          <tr>
            <td colspan="14" style="padding:0 12px 12px">
              <div class="fb-section">
                <div class="fb-section-title">マネージャーフィードバック（${escHtml(r.respondent)}）</div>
                <textarea class="fb-textarea" id="cmttxt-${r.id}">${escHtml(r.managerComment || '')}</textarea>
                <button type="button" class="fb-save-btn" onclick="saveComment('${r.id}')">保存する</button>
                <span class="fb-saved-msg" id="cmtmsg-${r.id}"></span>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>

    <div class="section-title">コメント: ①姿勢</div>
    <div class="text-block">
      <div class="tb-label">できている点</div>
      ${records.filter(r => r.s1.good).map(r => `<div class="text-entry">${escHtml(r.s1.good)}<div class="te-who">${escHtml(r.respondent)}</div></div>`).join('') || '<div class="text-entry" style="color:#9e9e9e">（なし）</div>'}
    </div>
    <div class="text-block">
      <div class="tb-label">改善点</div>
      ${records.filter(r => r.s1.improve).map(r => `<div class="text-entry">${escHtml(r.s1.improve)}<div class="te-who">${escHtml(r.respondent)}</div></div>`).join('') || '<div class="text-entry" style="color:#9e9e9e">（なし）</div>'}
    </div>

    <div class="section-title">コメント: ②患者さんへの姿勢</div>
    <div class="text-block">
      <div class="tb-label">できている点</div>
      ${records.filter(r => r.s2.good).map(r => `<div class="text-entry">${escHtml(r.s2.good)}<div class="te-who">${escHtml(r.respondent)}</div></div>`).join('') || '<div class="text-entry" style="color:#9e9e9e">（なし）</div>'}
    </div>
    <div class="text-block">
      <div class="tb-label">改善点</div>
      ${records.filter(r => r.s2.improve).map(r => `<div class="text-entry">${escHtml(r.s2.improve)}<div class="te-who">${escHtml(r.respondent)}</div></div>`).join('') || '<div class="text-entry" style="color:#9e9e9e">（なし）</div>'}
    </div>

    <div class="section-title">コメント: ③成長</div>
    <div class="text-block">
      <div class="tb-label">できている点</div>
      ${records.filter(r => r.s3.good).map(r => `<div class="text-entry">${escHtml(r.s3.good)}<div class="te-who">${escHtml(r.respondent)}</div></div>`).join('') || '<div class="text-entry" style="color:#9e9e9e">（なし）</div>'}
    </div>
    <div class="text-block">
      <div class="tb-label">改善点</div>
      ${records.filter(r => r.s3.improve).map(r => `<div class="text-entry">${escHtml(r.s3.improve)}<div class="te-who">${escHtml(r.respondent)}</div></div>`).join('') || '<div class="text-entry" style="color:#9e9e9e">（なし）</div>'}
    </div>

    <div class="section-title">コメント: ④チーム力</div>
    <div class="text-block">
      <div class="tb-label">できている点</div>
      ${records.filter(r => r.s4.good).map(r => `<div class="text-entry">${escHtml(r.s4.good)}<div class="te-who">${escHtml(r.respondent)}</div></div>`).join('') || '<div class="text-entry" style="color:#9e9e9e">（なし）</div>'}
    </div>
    <div class="text-block">
      <div class="tb-label">改善点</div>
      ${records.filter(r => r.s4.improve).map(r => `<div class="text-entry">${escHtml(r.s4.improve)}<div class="te-who">${escHtml(r.respondent)}</div></div>`).join('') || '<div class="text-entry" style="color:#9e9e9e">（なし）</div>'}
    </div>
  </div>
</div>`;
    }
  }

  html += `</div></body></html>`;
  res.send(html);
});

// ===== 行動基準評価システム =====

const SELF_ASSESSMENT_FILE = path.join(__dirname, 'data', 'self-assessment.json');

function loadSelfAssessments() {
  try { return JSON.parse(fs.readFileSync(SELF_ASSESSMENT_FILE, 'utf8')); } catch { return []; }
}
function saveSelfAssessments(records) {
  fs.mkdirSync(path.dirname(SELF_ASSESSMENT_FILE), { recursive: true });
  fs.writeFileSync(SELF_ASSESSMENT_FILE, JSON.stringify(records, null, 2));
}

// 行動基準評価 受信
app.post('/self-assessment/submit', (req, res) => {
  const d = req.body;
  if (!d || !d.respondent || !d.s1 || !d.s2 || !d.s3 || !d.s4) {
    return res.status(400).json({ error: 'invalid data' });
  }

  const record = {
    id: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
    respondent: d.respondent.trim(),
    managerFeedback: '',
    feedbackAt: null,
    s1: {
      q1: d.s1.q1 || '',
      q2: d.s1.q2 || '',
      q3: d.s1.q3 || '',
      good: (d.s1.good || '').trim(),
      improve: (d.s1.improve || '').trim(),
    },
    s2: {
      q1: d.s2.q1 || '',
      q2: d.s2.q2 || '',
      q3: d.s2.q3 || '',
      good: (d.s2.good || '').trim(),
      improve: (d.s2.improve || '').trim(),
    },
    s3: {
      q1: d.s3.q1 || '',
      q2: d.s3.q2 || '',
      q3: d.s3.q3 || '',
      good: (d.s3.good || '').trim(),
      improve: (d.s3.improve || '').trim(),
    },
    s4: {
      q1: d.s4.q1 || '',
      q2: d.s4.q2 || '',
      q3: d.s4.q3 || '',
      good: (d.s4.good || '').trim(),
      improve: (d.s4.improve || '').trim(),
    },
  };

  const records = loadSelfAssessments();
  records.unshift(record);
  saveSelfAssessments(records);

  console.log(`行動基準評価受信: respondent="${record.respondent}"`);
  res.json({ ok: true });
});

// 管理者向けAPI: 全データ取得
app.get('/api/self-assessments', (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  res.json(loadSelfAssessments());
});

// 管理者向け: マネージャーフィードバック保存（行動基準評価）
app.patch('/api/self-assessments/:id/feedback', (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  const records = loadSelfAssessments();
  const record = records.find(r => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: '見つかりません' });
  record.managerFeedback = (req.body.feedback || '').trim();
  record.feedbackAt = new Date().toISOString();
  saveSelfAssessments(records);
  res.json({ ok: true });
});

// 管理者向け: マネージャーフィードバック保存（360度評価）
app.patch('/api/feedback/:id/comment', (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  const records = loadFeedback();
  const record = records.find(r => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: '見つかりません' });
  record.managerComment = (req.body.comment || '').trim();
  record.commentAt = new Date().toISOString();
  saveFeedback(records);
  res.json({ ok: true });
});

// 管理者向け: 行動基準評価 HTMLページ
app.get('/self-assessment/admin', (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;

  const records = loadSelfAssessments();

  const CHOICES = { 'Yes': '✅ Yes', 'どちらでもない': '🔶 どちらでもない', 'まだできていない': '🔴 まだできていない', '': '—' };

  function choiceBadge(val) {
    const map = {
      'Yes': 'background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7',
      'どちらでもない': 'background:#fff8e1;color:#f57f17;border:1px solid #ffe082',
      'まだできていない': 'background:#fce4ec;color:#c62828;border:1px solid #ef9a9a',
    };
    const style = map[val] || 'background:#f5f5f5;color:#666';
    const label = CHOICES[val] || val || '—';
    return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:bold;${style}">${escHtml(label)}</span>`;
  }

  const rows = records.map(r => {
    const dt = new Date(r.submittedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const hasFb = r.managerFeedback;
    const fbDt = r.feedbackAt ? new Date(r.feedbackAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '';
    return `
<div class="record-card" id="rec-${r.id}">
  <div class="record-header">
    <div>
      <strong>${escHtml(r.respondent)}</strong>
      <span class="dt">${escHtml(dt)}</span>
    </div>
    <span class="fb-badge ${hasFb ? 'fb-done' : 'fb-pending'}">${hasFb ? 'FB済' : '未フィードバック'}</span>
  </div>
  <div class="record-body">
    <div class="section-block">
      <div class="sb-title">①自分の姿勢</div>
      <div class="q-row"><span class="q-label">院内を明るくする存在である</span>${choiceBadge(r.s1.q1)}</div>
      <div class="q-row"><span class="q-label">前向きな言葉を選んでいる</span>${choiceBadge(r.s1.q2)}</div>
      <div class="q-row"><span class="q-label">体調管理も仕事の一部だと思っている</span>${choiceBadge(r.s1.q3)}</div>
      <div class="text-pair">
        <div><span class="text-label">できている点</span><div class="text-val">${escHtml(r.s1.good) || '<em style="color:#9e9e9e">なし</em>'}</div></div>
        <div><span class="text-label">改善点</span><div class="text-val">${escHtml(r.s1.improve) || '<em style="color:#9e9e9e">なし</em>'}</div></div>
      </div>
    </div>
    <div class="section-block">
      <div class="sb-title">②患者さんへの姿勢</div>
      <div class="q-row"><span class="q-label">患者さんの未来を考えた提案をしている</span>${choiceBadge(r.s2.q1)}</div>
      <div class="q-row"><span class="q-label">不安を安心に変える説明をしている</span>${choiceBadge(r.s2.q2)}</div>
      <div class="q-row"><span class="q-label">「また来たい」と思ってもらえる関わり</span>${choiceBadge(r.s2.q3)}</div>
      <div class="text-pair">
        <div><span class="text-label">できている点</span><div class="text-val">${escHtml(r.s2.good) || '<em style="color:#9e9e9e">なし</em>'}</div></div>
        <div><span class="text-label">改善点</span><div class="text-val">${escHtml(r.s2.improve) || '<em style="color:#9e9e9e">なし</em>'}</div></div>
      </div>
    </div>
    <div class="section-block">
      <div class="sb-title">③成長</div>
      <div class="q-row"><span class="q-label">分からないことはその日のうちに確認している</span>${choiceBadge(r.s3.q1)}</div>
      <div class="q-row"><span class="q-label">新しいことにチャレンジする環境を自分で作れている</span>${choiceBadge(r.s3.q2)}</div>
      <div class="q-row"><span class="q-label">事前報告や、すぐ報告し、チームを守っている</span>${choiceBadge(r.s3.q3)}</div>
      <div class="text-pair">
        <div><span class="text-label">できている点</span><div class="text-val">${escHtml(r.s3.good) || '<em style="color:#9e9e9e">なし</em>'}</div></div>
        <div><span class="text-label">改善点</span><div class="text-val">${escHtml(r.s3.improve) || '<em style="color:#9e9e9e">なし</em>'}</div></div>
      </div>
    </div>
    <div class="section-block">
      <div class="sb-title">④チーム力</div>
      <div class="q-row"><span class="q-label">自分のエネルギーはチームに影響すると理解している</span>${choiceBadge(r.s4.q1)}</div>
      <div class="q-row"><span class="q-label">どうすれば良くなるかを上司に伝えられている</span>${choiceBadge(r.s4.q2)}</div>
      <div class="q-row"><span class="q-label">医院の未来を一緒に創っていると感じている</span>${choiceBadge(r.s4.q3)}</div>
      <div class="text-pair">
        <div><span class="text-label">できている点</span><div class="text-val">${escHtml(r.s4.good) || '<em style="color:#9e9e9e">なし</em>'}</div></div>
        <div><span class="text-label">改善点</span><div class="text-val">${escHtml(r.s4.improve) || '<em style="color:#9e9e9e">なし</em>'}</div></div>
      </div>
    </div>

    <!-- Manager feedback section -->
    <div class="feedback-section">
      <div class="fb-title">マネージャーフィードバック</div>
      ${hasFb ? `<div class="fb-existing">${escHtml(r.managerFeedback)}<div class="fb-date">${escHtml(fbDt)} 記入</div></div>` : ''}
      <textarea class="fb-textarea" id="fbtxt-${r.id}" placeholder="フィードバックを入力してください...">${escHtml(r.managerFeedback)}</textarea>
      <button type="button" class="fb-save-btn" onclick="saveFeedback('${r.id}', 'self')">保存する</button>
      <span class="fb-saved-msg" id="fbmsg-${r.id}"></span>
    </div>
  </div>
</div>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>行動基準評価 管理画面</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: sans-serif; background: #ede7f6; color: #333; font-size: 14px; }
.top-bar { height: 8px; background: #673ab7; }
header { background: #673ab7; color: #fff; padding: 16px 24px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
header h1 { font-size: 18px; font-weight: bold; }
header p { font-size: 12px; opacity: .8; }
header nav a { color:#e1bee7; font-size:13px; text-decoration:none; margin-left:16px; }
header nav a:hover { color:#fff; }
.container { max-width: 860px; margin: 24px auto; padding: 0 16px 60px; }
.record-card { background:#fff; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,.1); margin-bottom:20px; overflow:hidden; }
.record-header { background:#f3e5f5; padding:12px 20px; display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
.record-header strong { font-size:16px; color:#512da8; }
.dt { font-size:12px; color:#888; margin-left:10px; }
.fb-badge { font-size:12px; font-weight:bold; padding:3px 12px; border-radius:999px; }
.fb-done { background:#e8f5e9; color:#2e7d32; border:1px solid #a5d6a7; }
.fb-pending { background:#fff8e1; color:#f57f17; border:1px solid #ffe082; }
.record-body { padding:20px; }
.section-block { margin-bottom:20px; border-left:4px solid #ce93d8; padding-left:12px; }
.sb-title { font-size:13px; font-weight:bold; color:#673ab7; margin-bottom:10px; }
.q-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:5px 0; border-bottom:1px solid #f3e5f5; flex-wrap:wrap; }
.q-label { font-size:13px; color:#444; flex:1; }
.text-pair { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:10px; }
@media(max-width:600px) { .text-pair { grid-template-columns:1fr; } }
.text-label { font-size:11px; color:#7b1fa2; font-weight:bold; display:block; margin-bottom:4px; }
.text-val { font-size:13px; color:#444; background:#faf5ff; border-radius:4px; padding:8px 10px; line-height:1.6; white-space:pre-wrap; }
.feedback-section { margin-top:20px; border-top:2px dashed #ce93d8; padding-top:16px; }
.fb-title { font-size:13px; font-weight:bold; color:#673ab7; margin-bottom:8px; }
.fb-existing { background:#f3e5f5; border-radius:6px; padding:10px 12px; margin-bottom:10px; font-size:13px; white-space:pre-wrap; }
.fb-date { font-size:11px; color:#9e9e9e; margin-top:4px; }
.fb-textarea { width:100%; min-height:100px; border:1px solid #ce93d8; border-radius:6px; padding:10px 12px; font-size:13px; font-family:inherit; resize:vertical; outline:none; }
.fb-textarea:focus { border-color:#673ab7; }
.fb-save-btn { margin-top:8px; background:#673ab7; color:#fff; border:none; border-radius:4px; padding:8px 20px; font-size:13px; cursor:pointer; }
.fb-save-btn:hover { background:#512da8; }
.fb-saved-msg { font-size:12px; color:#2e7d32; margin-left:10px; }
.empty { color:#9e9e9e; text-align:center; padding:60px; background:#fff; border-radius:10px; }
.count-badge { background:#ce93d8; color:#fff; border-radius:999px; padding:2px 10px; font-size:12px; margin-left:8px; }
</style>
</head>
<body>
<div class="top-bar"></div>
<header>
  <div>
    <h1>行動基準評価 管理画面</h1>
    <p>合計 ${records.length} 件 ／ フィードバック済 ${records.filter(r => r.managerFeedback).length} 件</p>
  </div>
  <nav>
    <a href="/feedback/admin">360度評価へ</a>
  </nav>
</header>
<div class="container">
  ${records.length === 0
    ? '<div class="empty">まだ回答はありません</div>'
    : rows}
</div>
<script>
async function saveFeedback(id, type) {
  const txt = document.getElementById('fbtxt-' + id).value.trim();
  const msgEl = document.getElementById('fbmsg-' + id);
  const url = type === 'self' ? '/api/self-assessments/' + id + '/feedback' : '/api/feedback/' + id + '/comment';
  const body = type === 'self' ? { feedback: txt } : { comment: txt };
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    msgEl.textContent = '✅ 保存しました';
    setTimeout(() => { msgEl.textContent = ''; location.reload(); }, 1200);
  } catch {
    msgEl.style.color = '#c62828';
    msgEl.textContent = '❌ 保存に失敗しました';
  }
}
<\/script>
</body>
</html>`);
});

// 死活確認用
app.get('/health', (_req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動: port=${PORT}`);
  console.log(`テストモード: ${TEST_MODE}`);
  console.log(`メール送信先: ${MAIL_TO || '未設定'}`);
  console.log(`Resend APIキー: ${RESEND_API_KEY ? '設定済み' : '未設定'}`);
  console.log(`印刷先プリンターID: ${PRINTNODE_PRINTER_ID || '未設定'}`);
  console.log(`PrintNode APIキー: ${PRINTNODE_API_KEY ? PRINTNODE_API_KEY.slice(0,6) + '...' : '未設定'}`);
});
