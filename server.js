const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const path = require('path');

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

Q1. 本日の主訴
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

Q1. 本日の主訴
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
        .text(`Q1 主訴: ${formatChecks(d.q1)}${d.q1_other ? ' / ' + d.q1_other : ''}`)
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
        .text(`Q1 主訴: ${formatChecks(d.q1)}${d.q1_other ? ' / ' + d.q1_other : ''}`)
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動: port=${PORT}`);
  console.log(`テストモード: ${TEST_MODE}`);
  console.log(`メール送信先: ${MAIL_TO || '未設定'}`);
  console.log(`印刷先プリンターID: ${PRINTNODE_PRINTER_ID || '未設定'}`);
  console.log(`PrintNode APIキー: ${PRINTNODE_API_KEY ? PRINTNODE_API_KEY.slice(0,6) + '...' : '未設定'}`);
});
