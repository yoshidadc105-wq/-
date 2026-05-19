const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios');
const { Resend } = require('resend');
const PDFDocument = require('pdfkit');
const path = require('path');
const { MongoClient } = require('mongodb');
const Groq = require('groq-sdk');

let _mongoDb = null;
async function getDb() {
  if (_mongoDb) return _mongoDb;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    tls: true,
    tlsAllowInvalidCertificates: false,
  });
  await client.connect();
  _mongoDb = client.db('nobinobi');
  console.log('MongoDB接続成功');
  return _mongoDb;
}

// async routeエラーでサーバーがクラッシュしないようにする
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => {
  console.error('Route error:', err.message);
  if (!res.headersSent) res.status(500).send('サーバーエラーが発生しました。管理者に連絡してください。');
});

process.on('unhandledRejection', reason => {
  console.error('UnhandledRejection:', reason);
});

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

// ---- MongoDB helpers ----

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

  const record = {
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    type: d.type || 'adult',
    name: d.name,
    kana: d.kana || '',
    tel: d.tel || '',
    q1: d.q1 || [],
    checked: false,
    data: d,
  };
  (await getDb()).collection('submissions').insertOne(record).catch(err => console.error('DB保存エラー:', err.message));

  sendFormEmail(d).catch((err) => console.error('メール送信エラー:', err.message));
  printQuestionnaire(d).catch((err) => console.error('印刷エラー:', err.message));
});

// ---- 管理画面 ----

app.get('/admin', async (req, res) => {
  if (!checkAdminAuth(req, res)) return;

  const records = await (await getDb()).collection('submissions').find({}).sort({ receivedAt: -1 }).toArray();
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

app.post('/admin/check/:id', async (req, res) => {
  if (!checkAdminAuth(req, res)) return;

  await (await getDb()).collection('submissions').updateOne({ id: req.params.id }, { $set: { checked: true } });
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
app.get('/api/quizzes', async (req, res) => {
  const all = await (await getDb()).collection('quizzes').find({}).sort({ createdAt: -1 }).toArray();
  const list = all.map(({ id, type, title, question, options, explanation, createdAt }) => ({
    id, type, title, question, options, explanation, createdAt,
  }));
  res.json(list);
});

// 管理者向け: 問題一覧（答えあり）
app.get('/api/quizzes/admin', async (req, res) => {
  if (!checkApiAuth(req, res)) return;
  const all = await (await getDb()).collection('quizzes').find({}).sort({ createdAt: -1 }).toArray();
  res.json(all);
});

// 管理者向け: 問題作成
app.post('/api/quizzes', async (req, res) => {
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
  await (await getDb()).collection('quizzes').insertOne(quiz);
  res.json(quiz);
});

// 管理者向け: 問題更新
app.put('/api/quizzes/:id', async (req, res) => {
  if (!checkApiAuth(req, res)) return;
  const db = await getDb();
  const existing = await db.collection('quizzes').findOne({ id: req.params.id });
  if (!existing) return res.status(404).json({ error: '見つかりません' });
  const { type, title, question, options, answer, explanation } = req.body;
  const updated = {
    ...existing, type,
    title: title.trim(), question: question.trim(),
    options: Array.isArray(options) ? options : [],
    answer: answer ?? '',
    explanation: (explanation || '').trim(),
    updatedAt: new Date().toISOString(),
  };
  await db.collection('quizzes').replaceOne({ id: req.params.id }, updated);
  res.json(updated);
});

// 管理者向け: 問題削除
app.delete('/api/quizzes/:id', async (req, res) => {
  if (!checkApiAuth(req, res)) return;
  await (await getDb()).collection('quizzes').deleteOne({ id: req.params.id });
  res.json({ ok: true });
});

// スタッフ向け: 回答送信
app.post('/api/quizzes/:id/submit', async (req, res) => {
  const quiz = await (await getDb()).collection('quizzes').findOne({ id: req.params.id });
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

  await (await getDb()).collection('quizSubs').insertOne(sub);

  res.json({
    isCorrect,
    explanation: quiz.explanation,
    correctAnswer: quiz.type !== 'manual' ? quiz.answer : undefined,
  });
});

// 管理者向け: 回答一覧
app.get('/api/quiz-subs', async (req, res) => {
  if (!checkApiAuth(req, res)) return;
  const subs = await (await getDb()).collection('quizSubs').find({}).sort({ submittedAt: -1 }).toArray();
  res.json(subs);
});

// 管理者向け: マニュアル問題の採点・メモ
app.patch('/api/quiz-subs/:id', async (req, res) => {
  if (!checkApiAuth(req, res)) return;
  const db = await getDb();
  const sub = await db.collection('quizSubs').findOne({ id: req.params.id });
  if (!sub) return res.status(404).json({ error: '見つかりません' });
  const update = {};
  if (req.body.isCorrect !== undefined) update.isCorrect = req.body.isCorrect;
  if (req.body.adminNote !== undefined) update.adminNote = req.body.adminNote;
  await db.collection('quizSubs').updateOne({ id: req.params.id }, { $set: update });
  res.json({ ...sub, ...update });
});

// ===== 360度評価 対象者管理 =====

// 公開: 対象者一覧（名前のみ）
app.get('/api/targets', async (req, res) => {
  const targets = await (await getDb()).collection('targets').find({}).toArray();
  res.json(targets.map(({ id, name }) => ({ id, name })));
});

// 管理者: 対象者追加
app.post('/api/targets', async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '名前が必要です' });
  const db = await getDb();
  const existing = await db.collection('targets').findOne({ name });
  if (existing) return res.status(409).json({ error: 'すでに登録されています' });
  const target = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
  await db.collection('targets').insertOne(target);
  res.json(target);
});

// 管理者: 対象者削除
app.delete('/api/targets/:id', async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  await (await getDb()).collection('targets').deleteOne({ id: req.params.id });
  res.json({ ok: true });
});

// ===== 回答者管理 =====
app.get('/api/respondents', async (req, res) => {
  const list = await (await getDb()).collection('respondents').find({}).toArray();
  res.json(list.map(({ id, name }) => ({ id, name })));
});
app.post('/api/respondents', ah(async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '名前が必要です' });
  const db = await getDb();
  if (await db.collection('respondents').findOne({ name })) return res.status(409).json({ error: 'すでに登録されています' });
  const doc = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
  await db.collection('respondents').insertOne(doc);
  res.json(doc);
}));
app.delete('/api/respondents/:id', ah(async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  await (await getDb()).collection('respondents').deleteOne({ id: req.params.id });
  res.json({ ok: true });
}));

// ===== 360度評価システム =====

const FEEDBACK_ADMIN_PASSWORD = process.env.FEEDBACK_ADMIN_PASSWORD || ADMIN_PASSWORD;

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
app.post('/feedback/submit', async (req, res) => {
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

  const db = await getDb();
  const periods = await loadPeriods();
  const activePeriod = getActivePeriod(periods);
  record.periodId = activePeriod ? activePeriod.id : null;

  if (activePeriod) {
    const dup = await db.collection('feedback').findOne({
      respondent: record.respondent,
      target: record.target,
      periodId: activePeriod.id,
    });
    if (dup) return res.status(409).json({ error: 'duplicate', message: '同じ相手への評価は今回の期間内で1回のみです。すでに提出済みです。' });
  }

  await db.collection('feedback').insertOne(record);

  console.log(`360度評価受信: target="${record.target}" respondent="${record.respondent}"`);
  res.json({ ok: true });
});

// 管理者向けAPI: 全データ取得
app.get('/api/feedback', async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  const records = await (await getDb()).collection('feedback').find({}).sort({ submittedAt: -1 }).toArray();
  res.json(records);
});

// 管理者向け: HTML結果ページ
app.get('/feedback/admin', async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;

  const db = await getDb();
  const all = await db.collection('feedback').find({}).sort({ submittedAt: -1 }).toArray();

  // ターゲット別に集計
  const byTarget = {};
  for (const r of all) {
    const key = r.target || '（未指定）';
    if (!byTarget[key]) byTarget[key] = [];
    byTarget[key].push(r);
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
.target-mgmt-card { background:#fff; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,.1); margin-bottom:24px; overflow:hidden; }
.target-mgmt-header { background:#4a148c; color:#fff; padding:12px 20px; font-size:15px; font-weight:bold; }
.target-mgmt-body { padding:16px 20px; }
.target-list { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; min-height:30px; }
.target-item { display:flex; align-items:center; gap:8px; background:#f3e5f5; border-radius:20px; padding:5px 14px; font-size:14px; }
.target-del-btn { background:none; border:none; color:#9c27b0; cursor:pointer; font-size:12px; padding:0; }
.target-del-btn:hover { color:#6a0080; text-decoration:underline; }
.target-add-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.target-input { border:1px solid #ce93d8; border-radius:6px; padding:7px 12px; font-size:14px; font-family:inherit; outline:none; width:200px; }
.target-input:focus { border-color:#673ab7; }
.target-add-btn { background:#673ab7; color:#fff; border:none; border-radius:6px; padding:7px 18px; font-size:14px; cursor:pointer; }
.target-add-btn:hover { background:#512da8; }
.target-msg { font-size:12px; }
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

  // 対象者管理パネル
  const targets = await db.collection('targets').find({}).toArray();
  html += `
<div class="target-mgmt-card">
  <div class="target-mgmt-header">対象者管理</div>
  <div class="target-mgmt-body">
    <div class="target-list" id="target-list">
      ${targets.length === 0
        ? '<p style="color:#9e9e9e;font-size:13px">まだ登録されていません</p>'
        : targets.map(t => `
          <div class="target-item" id="ti-${t.id}">
            <span>${escHtml(t.name)}</span>
            <button type="button" class="target-del-btn" onclick="deletTarget('${t.id}')">削除</button>
          </div>`).join('')}
    </div>
    <div class="target-add-row">
      <input type="text" id="new-target-name" placeholder="名前を入力（例：原田）" class="target-input" />
      <button type="button" class="target-add-btn" onclick="addTarget()">追加</button>
      <span class="target-msg" id="target-msg"></span>
    </div>
  </div>
</div>`;

  html += all.length === 0 ? `<p class="empty" style="background:#fff;border-radius:8px;padding:40px;text-align:center;color:#9e9e9e">まだ回答はありません</p>` : '';

  if (all.length > 0) {
    for (const [targetName, records] of Object.entries(byTarget)) {
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

  html += `</div>
<script>
async function addTarget() {
  const inp = document.getElementById('new-target-name');
  const msg = document.getElementById('target-msg');
  const name = inp.value.trim();
  if (!name) { msg.style.color='#c62828'; msg.textContent='名前を入力してください'; return; }
  try {
    const res = await fetch('/api/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.status === 409) { msg.style.color='#c62828'; msg.textContent='すでに登録されています'; return; }
    if (!res.ok) throw new Error();
    msg.style.color = '#2e7d32';
    msg.textContent = '✅ 追加しました';
    inp.value = '';
    setTimeout(() => location.reload(), 800);
  } catch {
    msg.style.color = '#c62828';
    msg.textContent = '❌ 追加に失敗しました';
  }
}
async function deletTarget(id) {
  if (!confirm('この対象者を削除しますか？')) return;
  try {
    const res = await fetch('/api/targets/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    location.reload();
  } catch {
    alert('削除に失敗しました');
  }
}
<\/script>
</body></html>`;
  res.send(html);
});

// ===== 行動基準評価システム =====

// 行動基準評価 受信
app.post('/self-assessment/submit', async (req, res) => {
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

  const db = await getDb();
  const periods = await loadPeriods();
  const activePeriod = getActivePeriod(periods);
  record.periodId = activePeriod ? activePeriod.id : null;

  if (activePeriod) {
    const dup = await db.collection('selfAssessments').findOne({
      respondent: record.respondent,
      periodId: activePeriod.id,
    });
    if (dup) return res.status(409).json({ error: 'duplicate', message: '既に提出済みです。行動基準評価は今回の期間内で1回のみです。' });
  }

  await db.collection('selfAssessments').insertOne(record);

  console.log(`行動基準評価受信: respondent="${record.respondent}"`);
  res.json({ ok: true });
});

// 管理者向けAPI: 全データ取得
app.get('/api/self-assessments', async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  const records = await (await getDb()).collection('selfAssessments').find({}).sort({ submittedAt: -1 }).toArray();
  res.json(records);
});

// 管理者向け: マネージャーフィードバック保存（行動基準評価）
app.patch('/api/self-assessments/:id/feedback', async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  const db = await getDb();
  const record = await db.collection('selfAssessments').findOne({ id: req.params.id });
  if (!record) return res.status(404).json({ error: '見つかりません' });
  await db.collection('selfAssessments').updateOne(
    { id: req.params.id },
    { $set: { managerFeedback: (req.body.feedback || '').trim(), feedbackAt: new Date().toISOString() } }
  );
  res.json({ ok: true });
});

// 管理者向け: マネージャーフィードバック保存（360度評価）
app.patch('/api/feedback/:id/comment', async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  const db = await getDb();
  const record = await db.collection('feedback').findOne({ id: req.params.id });
  if (!record) return res.status(404).json({ error: '見つかりません' });
  await db.collection('feedback').updateOne(
    { id: req.params.id },
    { $set: { managerComment: (req.body.comment || '').trim(), commentAt: new Date().toISOString() } }
  );
  res.json({ ok: true });
});

// 管理者向け: 行動基準評価 HTMLページ
app.get('/self-assessment/admin', async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;

  const records = await (await getDb()).collection('selfAssessments').find({}).sort({ submittedAt: -1 }).toArray();

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

// ===== 総合フィードバック用データ =====

app.patch('/api/comprehensive-feedback/:name', async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  const name = decodeURIComponent(req.params.name);
  const doc = { name, feedback: (req.body.feedback || '').trim(), updatedAt: new Date().toISOString() };
  await (await getDb()).collection('compFeedback').replaceOne({ name }, doc, { upsert: true });
  res.json({ ok: true });
});

// ===== 評価期間管理 =====

async function loadPeriods() {
  const doc = await (await getDb()).collection('settings').findOne({ _id: 'periods' });
  if (!doc || !Array.isArray(doc.list)) return [];
  return doc.list;
}

function getActivePeriod(periods) {
  const now = new Date();
  return periods.find(p => new Date(p.start) <= now && new Date(p.end) >= now) || null;
}

// kept for frontend banner compat (feedback.html / self-assessment.html fetch /api/deadline)
async function loadDeadline() {
  const periods = await loadPeriods();
  const active = getActivePeriod(periods);
  return active ? { start: active.start, end: active.end } : null;
}

app.get('/api/deadline', ah(async (req, res) => {
  const deadline = await loadDeadline();
  res.json(deadline);
}));

app.get('/api/periods', ah(async (req, res) => {
  res.json(await loadPeriods());
}));

app.put('/api/periods', ah(async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  let { list } = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'list required' });
  // assign IDs to new periods
  list = list.map(p => ({ ...p, id: p.id || ('p' + Date.now().toString(36) + Math.random().toString(36).slice(2,5)) }));
  await (await getDb()).collection('settings').replaceOne(
    { _id: 'periods' },
    { _id: 'periods', list },
    { upsert: true }
  );
  res.json({ ok: true, list });
}));

// ===== 質問管理 =====

const DEFAULT_QUESTIONS = {
  feedback360: {
    sections: [
      { id: 's1', title: 'セクション①姿勢', questions: [
        { id: 'q1', text: '自分を明るくする存在である' },
        { id: 'q2', text: '自分に対して前向きな言葉や態度で接してくれる' },
        { id: 'q3', text: '体調管理を含め、安定した状態で仕事に取り組んでいるようにみえる' }
      ]},
      { id: 's2', title: 'セクション②患者さんへの姿勢', questions: [
        { id: 'q1', text: '患者さんの将来を考えた提案をしているようにみえる' },
        { id: 'q2', text: '不安を和らげる分かりやすい説明をしているようにみえる' },
        { id: 'q3', text: '「また来たい」と思ってもらえる関わりをしているようにみえる' }
      ]},
      { id: 's3', title: 'セクション③成長', questions: [
        { id: 'q1', text: '分からないことを明確にするためによく質問をしているようにみえる' },
        { id: 'q2', text: '新しいことにチャレンジするための環境を自分で作れているようにみえる' },
        { id: 'q3', text: '事前報告や、すぐ報告し、チームを守っているようにみえる' }
      ]},
      { id: 's4', title: 'セクション④チーム力', questions: [
        { id: 'q1', text: '自分のエネルギーはチームに影響すると理解しているようにみえる' },
        { id: 'q2', text: 'どうすれば良くなるかを、個人的に上司に伝えられているようにみえる' }
      ]}
    ]
  },
  selfAssessment: {
    sections: [
      { id: 's1', title: 'セクション①自分の姿勢', questions: [
        { id: 'q1', text: '私は院内を明るくする存在である' },
        { id: 'q2', text: '前向きな言葉を選んでいる' },
        { id: 'q3', text: '体調管理も仕事の一部だと思っている' }
      ]},
      { id: 's2', title: 'セクション②患者さんへの姿勢', questions: [
        { id: 'q1', text: '患者さんの未来を考えた提案をしている' },
        { id: 'q2', text: '不安を安心に変える説明をしている' },
        { id: 'q3', text: '「また来たい」と思ってもらえる関わりをしている' }
      ]},
      { id: 's3', title: 'セクション③成長', questions: [
        { id: 'q1', text: '分からないことはその日のうちに確認している' },
        { id: 'q2', text: '新しいことにチャレンジするための環境を自分で作れている' },
        { id: 'q3', text: '事前報告や、すぐ報告し、チームを守っている' }
      ]},
      { id: 's4', title: 'セクション④チーム力', questions: [
        { id: 'q1', text: '自分のエネルギーはチームに影響すると理解している' },
        { id: 'q2', text: 'どうすれば良くなるかを、個人的に上司に伝えられている' },
        { id: 'q3', text: '医院の未来を一緒に創っていると感じている' }
      ]}
    ]
  }
};
async function loadQuestions() {
  const doc = await (await getDb()).collection('settings').findOne({ _id: 'questions' });
  if (!doc) return DEFAULT_QUESTIONS;
  const { _id, ...rest } = doc;
  return rest;
}

app.get('/api/questions', async (req, res) => {
  const questions = await loadQuestions();
  res.json(questions);
});
app.put('/api/questions', async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  const data = { ...req.body, _id: 'questions' };
  await (await getDb()).collection('settings').replaceOne({ _id: 'questions' }, data, { upsert: true });
  res.json({ ok: true });
});

// ===== AI フィードバック生成 =====

app.post('/api/ai-feedback/:name', async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'GROQ_API_KEYが設定されていません' });

  const name = decodeURIComponent(req.params.name);
  const db = await getDb();
  const [feedbacks, selfRecs, questions] = await Promise.all([
    db.collection('feedback').find({ target: name }).sort({ submittedAt: -1 }).toArray(),
    db.collection('selfAssessments').find({ respondent: name }).sort({ submittedAt: -1 }).toArray(),
    loadQuestions(),
  ]);

  function qLabel(type, secId, qId) {
    const form = type === 'sa' ? questions.selfAssessment : questions.feedback360;
    const sec = form.sections.find(s => s.id === secId);
    const q = sec && sec.questions.find(qi => qi.id === qId);
    return q ? q.text : '';
  }

  // プロンプト構築
  let prompt = `あなたは歯科クリニックの院長として、スタッフ「${name}」さんへの総合フィードバックを書いてください。\n\n`;
  prompt += `以下の評価データをもとに、温かく具体的なフィードバックを日本語で作成してください。\n`;
  prompt += `フォーマット：【総合コメント】【特に良かった点】【成長してほしい点】【具体的なアドバイス】【次の目標（来期に向けて）】\n\n`;

  if (feedbacks.length > 0) {
    prompt += `=== 360度評価（${feedbacks.length}件の平均スコア、1〜5点） ===\n`;
    const avg = (key) => {
      const vals = feedbacks.map(r => key(r)).filter(v => v > 0);
      return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : 'データなし';
    };
    prompt += `${qLabel('fb','s1','q1')}: ${avg(r=>r.s1.q1)}\n`;
    prompt += `${qLabel('fb','s1','q2')}: ${avg(r=>r.s1.q2)}\n`;
    prompt += `${qLabel('fb','s1','q3')}: ${avg(r=>r.s1.q3)}\n`;
    prompt += `${qLabel('fb','s2','q1')}: ${avg(r=>r.s2.q1)}\n`;
    prompt += `${qLabel('fb','s2','q2')}: ${avg(r=>r.s2.q2)}\n`;
    prompt += `${qLabel('fb','s2','q3')}: ${avg(r=>r.s2.q3)}\n`;
    prompt += `${qLabel('fb','s3','q1')}: ${avg(r=>r.s3.q1)}\n`;
    prompt += `${qLabel('fb','s3','q2')}: ${avg(r=>r.s3.q2)}\n`;
    prompt += `${qLabel('fb','s3','q3')}: ${avg(r=>r.s3.q3)}\n`;
    prompt += `${qLabel('fb','s4','q1')}: ${avg(r=>r.s4.q1)}\n`;
    prompt += `${qLabel('fb','s4','q2')}: ${avg(r=>r.s4.q2)}\n`;
    const goods = feedbacks.map(r=>[r.s1.good,r.s2.good,r.s3.good,r.s4.good]).flat().filter(Boolean);
    const improves = feedbacks.map(r=>[r.s1.improve,r.s2.improve,r.s3.improve,r.s4.improve]).flat().filter(Boolean);
    if (goods.length) prompt += `\nできている点（コメント）:\n${goods.join('\n')}\n`;
    if (improves.length) prompt += `\n改善点（コメント）:\n${improves.join('\n')}\n`;
  }

  if (selfRecs.length > 0) {
    const r = selfRecs[0];
    prompt += `\n=== 行動基準評価（自己評価、最新回答） ===\n`;
    const secs = [['s1','s2','s3','s4'],['q1','q2','q3']];
    for (const sid of ['s1','s2','s3','s4']) {
      for (const qid of ['q1','q2','q3']) {
        if (r[sid] && r[sid][qid]) {
          prompt += `${qLabel('sa',sid,qid)}: ${r[sid][qid]}\n`;
        }
      }
    }
  }

  try {
    const groq = new Groq({ apiKey });
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1200,
    });
    const text = completion.choices[0]?.message?.content || '';
    res.json({ feedback: text });
  } catch (e) {
    console.error('Groq error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== 統合管理画面 =====

app.get('/staff-admin', async (req, res) => {
  if (!checkFeedbackAuth(req, res)) return;

  const db = await getDb();
  const periods = await loadPeriods();
  const selectedPeriodId = req.query.period || null; // null = all periods

  const selectedPeriod = selectedPeriodId ? periods.find(p => p.id === selectedPeriodId) : null;
  const dateQuery = selectedPeriod
    ? { submittedAt: { $gte: selectedPeriod.start, $lte: selectedPeriod.end } }
    : {};

  const [feedbacks, selfRecs, targets, compFBArr] = await Promise.all([
    db.collection('feedback').find(dateQuery).sort({ submittedAt: -1 }).toArray(),
    db.collection('selfAssessments').find(dateQuery).sort({ submittedAt: -1 }).toArray(),
    db.collection('targets').find({}).toArray(),
    db.collection('compFeedback').find({}).toArray(),
  ]);
  // Convert compFeedback array to object keyed by name
  const compFB = {};
  for (const doc of compFBArr) {
    compFB[doc.name] = { feedback: doc.feedback, updatedAt: doc.updatedAt };
  }

  const questions = await loadQuestions();

  // 質問文取得ヘルパー
  function qText(type, secId, qId) {
    const form = type === 'sa' ? questions.selfAssessment : questions.feedback360;
    const sec = form.sections.find(s => s.id === secId);
    const q = sec && sec.questions.find(qi => qi.id === qId);
    return q ? escHtml(q.text) : '—';
  }
  function secTitle(type, secId) {
    const form = type === 'sa' ? questions.selfAssessment : questions.feedback360;
    const sec = form.sections.find(s => s.id === secId);
    return sec ? escHtml(sec.title) : '—';
  }

  const byTarget = {};
  for (const r of feedbacks) {
    const key = r.target || '（未指定）';
    if (!byTarget[key]) byTarget[key] = [];
    byTarget[key].push(r);
  }
  const bySelf = {};
  for (const r of selfRecs) {
    if (!bySelf[r.respondent]) bySelf[r.respondent] = [];
    bySelf[r.respondent].push(r);
  }

  function avg(arr) {
    if (!arr.length) return 0;
    return (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2);
  }
  function bar(score) {
    const pct = (parseFloat(score) / 5) * 100;
    return `<div style="display:inline-flex;align-items:center;gap:8px">
      <div style="width:100px;height:8px;background:#e8e0f5;border-radius:4px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:#673ab7;border-radius:4px"></div>
      </div>
      <span style="font-size:12px;font-weight:bold;color:#673ab7">${score}</span>
    </div>`;
  }
  function badge(val) {
    const map = {
      'Yes': 'background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7',
      'どちらでもない': 'background:#fff8e1;color:#f57f17;border:1px solid #ffe082',
      'まだできていない': 'background:#fce4ec;color:#c62828;border:1px solid #ef9a9a',
    };
    const style = map[val] || 'background:#f5f5f5;color:#666';
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:bold;${style}">${escHtml(val || '—')}</span>`;
  }

  // ===== 360度評価タブ =====
  let sec360 = `<div class="mgmt-card">
    <div class="mgmt-hd" style="background:#4a148c">対象者管理</div>
    <div class="mgmt-bd">
      <div class="target-list">
        ${targets.length === 0 ? '<p style="color:#9e9e9e;font-size:13px">未登録</p>' : targets.map(t => `<div class="target-item"><span>${escHtml(t.name)}</span><button class="del-btn" onclick="delTarget('${t.id}')">✕</button></div>`).join('')}
      </div>
      <div class="add-row">
        <input type="text" id="nt" class="add-input" placeholder="名前を入力" />
        <button class="add-btn" onclick="addTarget()">＋ 追加</button>
        <span id="tmsg" style="font-size:12px"></span>
      </div>
    </div>
  </div>`;

  if (feedbacks.length === 0) {
    sec360 += '<div class="empty">まだ回答はありません</div>';
  } else {
    for (const [tName, recs] of Object.entries(byTarget)) {
      sec360 += `<div class="target-block">
        <div class="target-hd">${escHtml(tName)} さん <span class="badge">${recs.length}件</span></div>
        <div class="target-bd">
          <div class="sec-title">スコア集計（全${recs.length}件の平均）</div>
          <div class="avg-sec-block">
            <div class="avg-sec-hd">${secTitle('fb','s1')}</div>
            <div class="sc-grid">
              <div class="sc"><div class="sc-lbl">${qText('fb','s1','q1')}</div>${bar(avg(recs.map(r=>r.s1.q1)))}</div>
              <div class="sc"><div class="sc-lbl">${qText('fb','s1','q2')}</div>${bar(avg(recs.map(r=>r.s1.q2)))}</div>
              <div class="sc"><div class="sc-lbl">${qText('fb','s1','q3')}</div>${bar(avg(recs.map(r=>r.s1.q3)))}</div>
            </div>
          </div>
          <div class="avg-sec-block">
            <div class="avg-sec-hd">${secTitle('fb','s2')}</div>
            <div class="sc-grid">
              <div class="sc"><div class="sc-lbl">${qText('fb','s2','q1')}</div>${bar(avg(recs.map(r=>r.s2.q1)))}</div>
              <div class="sc"><div class="sc-lbl">${qText('fb','s2','q2')}</div>${bar(avg(recs.map(r=>r.s2.q2)))}</div>
              <div class="sc"><div class="sc-lbl">${qText('fb','s2','q3')}</div>${bar(avg(recs.map(r=>r.s2.q3)))}</div>
            </div>
          </div>
          <div class="avg-sec-block">
            <div class="avg-sec-hd">${secTitle('fb','s3')}</div>
            <div class="sc-grid">
              <div class="sc"><div class="sc-lbl">${qText('fb','s3','q1')}</div>${bar(avg(recs.map(r=>r.s3.q1)))}</div>
              <div class="sc"><div class="sc-lbl">${qText('fb','s3','q2')}</div>${bar(avg(recs.map(r=>r.s3.q2)))}</div>
              <div class="sc"><div class="sc-lbl">${qText('fb','s3','q3')}</div>${bar(avg(recs.map(r=>r.s3.q3)))}</div>
            </div>
          </div>
          <div class="avg-sec-block">
            <div class="avg-sec-hd">${secTitle('fb','s4')}</div>
            <div class="sc-grid">
              <div class="sc"><div class="sc-lbl">${qText('fb','s4','q1')}</div>${bar(avg(recs.map(r=>r.s4.q1)))}</div>
              <div class="sc"><div class="sc-lbl">${qText('fb','s4','q2')}</div>${bar(avg(recs.map(r=>r.s4.q2)))}</div>
            </div>
          </div>
          <div class="sec-title">個別回答（${recs.length}件）</div>
          ${recs.map(r => {
            const dt = new Date(r.submittedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
            return `<div class="rec-card">
              <div class="rec-mini-hd">
                <span><strong>${escHtml(r.respondent)}</strong> <span class="dt-sm">${escHtml(dt)}</span></span>
                <span class="${r.managerComment?'fbdone':'fbpend'}">${r.managerComment?'コメント済':'未コメント'}</span>
              </div>
              <div class="tg-grid">
                <div class="tg-sec"><div class="tg-title">${secTitle('fb','s1')}</div>
                  <div class="tg-row scores-row"><span class="tl">スコア</span><div class="tv score-chips"><span class="schip">${qText('fb','s1','q1')}: <strong>${r.s1.q1}</strong></span><span class="schip">${qText('fb','s1','q2')}: <strong>${r.s1.q2}</strong></span><span class="schip">${qText('fb','s1','q3')}: <strong>${r.s1.q3}</strong></span></div></div>
                  <div class="tg-row"><span class="tl">できている点</span><div class="tv">${escHtml(r.s1.good)||'—'}</div></div>
                  <div class="tg-row"><span class="tl">改善点</span><div class="tv">${escHtml(r.s1.improve)||'—'}</div></div>
                </div>
                <div class="tg-sec"><div class="tg-title">${secTitle('fb','s2')}</div>
                  <div class="tg-row scores-row"><span class="tl">スコア</span><div class="tv score-chips"><span class="schip">${qText('fb','s2','q1')}: <strong>${r.s2.q1}</strong></span><span class="schip">${qText('fb','s2','q2')}: <strong>${r.s2.q2}</strong></span><span class="schip">${qText('fb','s2','q3')}: <strong>${r.s2.q3}</strong></span></div></div>
                  <div class="tg-row"><span class="tl">できている点</span><div class="tv">${escHtml(r.s2.good)||'—'}</div></div>
                  <div class="tg-row"><span class="tl">改善点</span><div class="tv">${escHtml(r.s2.improve)||'—'}</div></div>
                </div>
                <div class="tg-sec"><div class="tg-title">${secTitle('fb','s3')}</div>
                  <div class="tg-row scores-row"><span class="tl">スコア</span><div class="tv score-chips"><span class="schip">${qText('fb','s3','q1')}: <strong>${r.s3.q1}</strong></span><span class="schip">${qText('fb','s3','q2')}: <strong>${r.s3.q2}</strong></span><span class="schip">${qText('fb','s3','q3')}: <strong>${r.s3.q3}</strong></span></div></div>
                  <div class="tg-row"><span class="tl">できている点</span><div class="tv">${escHtml(r.s3.good)||'—'}</div></div>
                  <div class="tg-row"><span class="tl">改善点</span><div class="tv">${escHtml(r.s3.improve)||'—'}</div></div>
                </div>
                <div class="tg-sec"><div class="tg-title">${secTitle('fb','s4')}</div>
                  <div class="tg-row scores-row"><span class="tl">スコア</span><div class="tv score-chips"><span class="schip">${qText('fb','s4','q1')}: <strong>${r.s4.q1}</strong></span><span class="schip">${qText('fb','s4','q2')}: <strong>${r.s4.q2}</strong></span></div></div>
                  <div class="tg-row"><span class="tl">できている点</span><div class="tv">${escHtml(r.s4.good)||'—'}</div></div>
                  <div class="tg-row"><span class="tl">改善点</span><div class="tv">${escHtml(r.s4.improve)||'—'}</div></div>
                </div>
              </div>
              <div class="fb-area">
                <div class="fb-lbl">この回答へのコメント</div>
                <textarea class="fb-ta" id="cmttxt-${r.id}">${escHtml(r.managerComment||'')}</textarea>
                <button class="save-btn" onclick="saveFB('${r.id}','feedback')">保存</button>
                <span class="fb-msg" id="fbmsg-${r.id}"></span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }
  }

  // ===== 行動基準評価タブ（人ごとにグループ化） =====
  let selfSection = '';
  if (selfRecs.length === 0) {
    selfSection = '<div class="empty">まだ回答はありません</div>';
  } else {
    const selfNames = [...new Set(selfRecs.map(r => r.respondent))].sort();
    for (const name of selfNames) {
      const recs = selfRecs.filter(r => r.respondent === name);
      const hasFB = recs.some(r => r.managerFeedback);
      selfSection += `<div class="target-block">
        <div class="target-hd">${escHtml(name)} さん <span class="badge">${recs.length}件</span>
          <span class="${hasFB?'fbdone':'fbpend'}" style="margin-left:8px">${hasFB?'FB済':'未FB'}</span>
        </div>
        <div class="target-bd">
          ${recs.map(r => {
            const dt = new Date(r.submittedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
            return `<div class="rec-card">
              <div class="rec-mini-hd">
                <span class="dt-sm">${escHtml(dt)}</span>
              </div>
              <div class="self-sections">
                <div class="self-sec"><div class="self-sec-title">${secTitle('sa','s1')}</div>
                  <div class="qrow"><span class="ql">${qText('sa','s1','q1')}</span>${badge(r.s1.q1)}</div>
                  <div class="qrow"><span class="ql">${qText('sa','s1','q2')}</span>${badge(r.s1.q2)}</div>
                  <div class="qrow"><span class="ql">${qText('sa','s1','q3')}</span>${badge(r.s1.q3)}</div>
                  <div class="text-pair"><div><span class="tl">できている点</span><div class="tv">${escHtml(r.s1.good)||'—'}</div></div><div><span class="tl">改善点</span><div class="tv">${escHtml(r.s1.improve)||'—'}</div></div></div>
                </div>
                <div class="self-sec"><div class="self-sec-title">${secTitle('sa','s2')}</div>
                  <div class="qrow"><span class="ql">${qText('sa','s2','q1')}</span>${badge(r.s2.q1)}</div>
                  <div class="qrow"><span class="ql">${qText('sa','s2','q2')}</span>${badge(r.s2.q2)}</div>
                  <div class="qrow"><span class="ql">${qText('sa','s2','q3')}</span>${badge(r.s2.q3)}</div>
                  <div class="text-pair"><div><span class="tl">できている点</span><div class="tv">${escHtml(r.s2.good)||'—'}</div></div><div><span class="tl">改善点</span><div class="tv">${escHtml(r.s2.improve)||'—'}</div></div></div>
                </div>
                <div class="self-sec"><div class="self-sec-title">${secTitle('sa','s3')}</div>
                  <div class="qrow"><span class="ql">${qText('sa','s3','q1')}</span>${badge(r.s3.q1)}</div>
                  <div class="qrow"><span class="ql">${qText('sa','s3','q2')}</span>${badge(r.s3.q2)}</div>
                  <div class="qrow"><span class="ql">${qText('sa','s3','q3')}</span>${badge(r.s3.q3)}</div>
                  <div class="text-pair"><div><span class="tl">できている点</span><div class="tv">${escHtml(r.s3.good)||'—'}</div></div><div><span class="tl">改善点</span><div class="tv">${escHtml(r.s3.improve)||'—'}</div></div></div>
                </div>
                <div class="self-sec"><div class="self-sec-title">${secTitle('sa','s4')}</div>
                  <div class="qrow"><span class="ql">${qText('sa','s4','q1')}</span>${badge(r.s4.q1)}</div>
                  <div class="qrow"><span class="ql">${qText('sa','s4','q2')}</span>${badge(r.s4.q2)}</div>
                  <div class="qrow"><span class="ql">${qText('sa','s4','q3')}</span>${badge(r.s4.q3)}</div>
                  <div class="text-pair"><div><span class="tl">できている点</span><div class="tv">${escHtml(r.s4.good)||'—'}</div></div><div><span class="tl">改善点</span><div class="tv">${escHtml(r.s4.improve)||'—'}</div></div></div>
                </div>
              </div>
              <div class="fb-area" style="margin-top:12px">
                <div class="fb-lbl">フィードバック</div>
                <textarea class="fb-ta" id="fbtxt-${r.id}">${escHtml(r.managerFeedback||'')}</textarea>
                <button class="save-btn" onclick="saveFB('${r.id}','self')">保存</button>
                <span class="fb-msg" id="fbmsg-${r.id}"></span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }
  }

  // ===== 総合フィードバックタブ =====
  const allNames = [...new Set([...Object.keys(byTarget), ...Object.keys(bySelf)])].sort();
  const fbTemplate = `【総合コメント】\n\n\n【特に良かった点】\n\n\n【成長してほしい点】\n\n\n【具体的なアドバイス】\n\n\n【次の目標（来期に向けて）】\n`;
  const compRows = allNames.map(name => {
    const fb = compFB[name] || {};
    const recs360 = byTarget[name] || [];
    const recsSelf = bySelf[name] || [];
    const latestSelf = recsSelf[0];
    const hasFb = !!fb.feedback;
    const fbDt = fb.updatedAt ? new Date(fb.updatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}) : '';

    let summary360 = '';
    if (recs360.length > 0) {
      summary360 = `<div class="comp-sub-title">360度評価 スコア平均（${recs360.length}件）</div>
        <div class="comp-sec-block">
          <div class="comp-sec-hd">${secTitle('fb','s1')}</div>
          <div class="sc-row"><span class="ql">${qText('fb','s1','q1')}</span>${bar(avg(recs360.map(r=>r.s1.q1)))}</div>
          <div class="sc-row"><span class="ql">${qText('fb','s1','q2')}</span>${bar(avg(recs360.map(r=>r.s1.q2)))}</div>
          <div class="sc-row"><span class="ql">${qText('fb','s1','q3')}</span>${bar(avg(recs360.map(r=>r.s1.q3)))}</div>
        </div>
        <div class="comp-sec-block">
          <div class="comp-sec-hd">${secTitle('fb','s2')}</div>
          <div class="sc-row"><span class="ql">${qText('fb','s2','q1')}</span>${bar(avg(recs360.map(r=>r.s2.q1)))}</div>
          <div class="sc-row"><span class="ql">${qText('fb','s2','q2')}</span>${bar(avg(recs360.map(r=>r.s2.q2)))}</div>
          <div class="sc-row"><span class="ql">${qText('fb','s2','q3')}</span>${bar(avg(recs360.map(r=>r.s2.q3)))}</div>
        </div>
        <div class="comp-sec-block">
          <div class="comp-sec-hd">${secTitle('fb','s3')}</div>
          <div class="sc-row"><span class="ql">${qText('fb','s3','q1')}</span>${bar(avg(recs360.map(r=>r.s3.q1)))}</div>
          <div class="sc-row"><span class="ql">${qText('fb','s3','q2')}</span>${bar(avg(recs360.map(r=>r.s3.q2)))}</div>
          <div class="sc-row"><span class="ql">${qText('fb','s3','q3')}</span>${bar(avg(recs360.map(r=>r.s3.q3)))}</div>
        </div>
        <div class="comp-sec-block">
          <div class="comp-sec-hd">${secTitle('fb','s4')}</div>
          <div class="sc-row"><span class="ql">${qText('fb','s4','q1')}</span>${bar(avg(recs360.map(r=>r.s4.q1)))}</div>
          <div class="sc-row"><span class="ql">${qText('fb','s4','q2')}</span>${bar(avg(recs360.map(r=>r.s4.q2)))}</div>
        </div>`;
    } else {
      summary360 = `<p style="color:#9e9e9e;font-size:12px;margin-bottom:8px">360度評価のデータなし</p>`;
    }

    let summarySelf = '';
    if (latestSelf) {
      const dt = new Date(latestSelf.submittedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
      summarySelf = `<div class="comp-sub-title">行動基準評価 最新回答（${escHtml(dt)}）</div>
        <div class="comp-sec-block">
          <div class="comp-sec-hd">${secTitle('sa','s1')}</div>
          <div class="sc-row"><span class="ql">${qText('sa','s1','q1')}</span>${badge(latestSelf.s1.q1)}</div>
          <div class="sc-row"><span class="ql">${qText('sa','s1','q2')}</span>${badge(latestSelf.s1.q2)}</div>
          <div class="sc-row"><span class="ql">${qText('sa','s1','q3')}</span>${badge(latestSelf.s1.q3)}</div>
        </div>
        <div class="comp-sec-block">
          <div class="comp-sec-hd">${secTitle('sa','s2')}</div>
          <div class="sc-row"><span class="ql">${qText('sa','s2','q1')}</span>${badge(latestSelf.s2.q1)}</div>
          <div class="sc-row"><span class="ql">${qText('sa','s2','q2')}</span>${badge(latestSelf.s2.q2)}</div>
          <div class="sc-row"><span class="ql">${qText('sa','s2','q3')}</span>${badge(latestSelf.s2.q3)}</div>
        </div>
        <div class="comp-sec-block">
          <div class="comp-sec-hd">${secTitle('sa','s3')}</div>
          <div class="sc-row"><span class="ql">${qText('sa','s3','q1')}</span>${badge(latestSelf.s3.q1)}</div>
          <div class="sc-row"><span class="ql">${qText('sa','s3','q2')}</span>${badge(latestSelf.s3.q2)}</div>
          <div class="sc-row"><span class="ql">${qText('sa','s3','q3')}</span>${badge(latestSelf.s3.q3)}</div>
        </div>
        <div class="comp-sec-block">
          <div class="comp-sec-hd">${secTitle('sa','s4')}</div>
          <div class="sc-row"><span class="ql">${qText('sa','s4','q1')}</span>${badge(latestSelf.s4.q1)}</div>
          <div class="sc-row"><span class="ql">${qText('sa','s4','q2')}</span>${badge(latestSelf.s4.q2)}</div>
          <div class="sc-row"><span class="ql">${qText('sa','s4','q3')}</span>${badge(latestSelf.s4.q3)}</div>
        </div>`;
    } else {
      summarySelf = `<p style="color:#9e9e9e;font-size:12px;margin-bottom:8px">行動基準評価のデータなし</p>`;
    }

    return `<div class="comp-card">
      <div class="comp-hd">
        <span>${escHtml(name)} さん</span>
        <span class="${hasFb?'fbdone':'fbpend'}">${hasFb?'FB済':'未FB'}</span>
      </div>
      <div class="comp-bd">
        <div class="comp-data">
          ${summary360}
          ${summarySelf}
        </div>
        <div class="fb-area" style="margin-top:16px">
          <div class="fb-lbl">総合フィードバック${hasFb?` <span style="font-size:11px;color:#888">（最終更新: ${escHtml(fbDt)}）</span>`:''}</div>
          <div style="font-size:12px;color:#888;margin-bottom:6px">360度評価・行動基準評価の両方を踏まえて記入してください</div>
          <textarea class="fb-ta" id="cfbtxt-${encodeURIComponent(name)}" style="min-height:200px">${escHtml(fb.feedback || fbTemplate)}</textarea>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
            <button class="save-btn" onclick="saveCompFB('${encodeURIComponent(name)}')">保存</button>
            ${process.env.GROQ_API_KEY ? `<button class="ai-btn" onclick="genAI('${encodeURIComponent(name)}')">✨ AIで生成</button>` : '<span style="font-size:12px;color:#888">（GROQ_API_KEYを設定するとAI生成が使えます）</span>'}
            <span class="fb-msg" id="cfbmsg-${encodeURIComponent(name)}"></span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  function fmtDL(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // 質問編集UI生成
  function qEditSection(type, label) {
    const secs = type === 'feedback360' ? questions.feedback360.sections : questions.selfAssessment.sections;
    const key = type;
    return secs.map(sec => `
      <div style="margin-bottom:16px">
        <div style="font-size:12px;font-weight:bold;color:#512da8;border-left:4px solid #673ab7;padding-left:8px;margin-bottom:8px">
          セクションタイトル
          <input data-q-type="${key}" data-q-sec="${sec.id}" data-q-field="title" type="text" value="${escHtml(sec.title)}" style="width:100%;border:1px solid #ce93d8;border-radius:4px;padding:5px 8px;font-size:13px;margin-top:4px;font-family:inherit;outline:none;box-sizing:border-box" />
        </div>
        ${sec.questions.map(q => `
          <div style="margin-bottom:8px">
            <div style="font-size:11px;color:#888;margin-bottom:3px">質問${q.id.toUpperCase()}</div>
            <input data-q-type="${key}" data-q-sec="${sec.id}" data-q-id="${q.id}" type="text" value="${escHtml(q.text)}" style="width:100%;border:1px solid #ce93d8;border-radius:4px;padding:5px 8px;font-size:13px;font-family:inherit;outline:none;box-sizing:border-box" />
          </div>`).join('')}
      </div>`).join('');
  }

  res.send(`<!DOCTYPE html><html lang="ja"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>スタッフ評価 管理</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:sans-serif;background:#ede7f6;color:#333;font-size:14px}
.topbar{height:8px;background:#673ab7}
header{background:#673ab7;color:#fff;padding:14px 20px}
header h1{font-size:17px;font-weight:bold}
.tabs{display:flex;background:#512da8;max-width:1100px;margin:0 auto;flex-wrap:wrap}
.tab-btn{flex:1;min-width:80px;padding:12px 8px;background:none;border:none;color:#e1bee7;font-size:13px;cursor:pointer;font-weight:bold;transition:background .2s;white-space:nowrap}
.tab-btn.active{background:#fff;color:#673ab7}
.tab-btn:hover:not(.active){background:#4527a0;color:#fff}
.wrap{max-width:1100px;margin:16px auto;padding:0 16px 60px}
.tab-panel{display:none}.tab-panel.active{display:block}
.mgmt-card,.target-block,.comp-card,.set-card{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.1);margin-bottom:20px;overflow:hidden}
.mgmt-hd,.target-hd,.comp-hd,.set-hd{color:#fff;padding:12px 18px;font-size:15px;font-weight:bold;background:#512da8;display:flex;justify-content:space-between;align-items:center}
.comp-hd{font-size:16px}
.mgmt-bd,.target-bd,.comp-bd,.set-bd{padding:16px}
.target-list{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;min-height:28px}
.target-item{display:flex;align-items:center;gap:6px;background:#f3e5f5;border-radius:20px;padding:4px 12px;font-size:13px}
.del-btn{background:none;border:none;color:#9c27b0;cursor:pointer;font-size:11px}
.add-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.add-input{border:1px solid #ce93d8;border-radius:6px;padding:6px 10px;font-size:13px;font-family:inherit;outline:none;width:180px}
.add-input:focus{border-color:#673ab7}
.add-btn{background:#673ab7;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer}
.badge{background:#ce93d8;color:#fff;border-radius:999px;padding:2px 8px;font-size:12px;margin-left:6px}
.sec-title{font-size:13px;font-weight:bold;color:#512da8;border-left:4px solid #673ab7;padding-left:8px;margin:16px 0 10px}
.comp-sub-title{font-size:12px;font-weight:bold;color:#512da8;border-left:3px solid #ce93d8;padding-left:6px;margin:12px 0 8px}
.comp-sec-block{margin-bottom:12px}
.comp-sec-hd{font-size:11px;font-weight:bold;color:#512da8;background:#ede7f6;border-radius:4px;padding:3px 8px;margin-bottom:4px}
.sc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:16px}
.sc{background:#f3e5f5;border-radius:8px;padding:10px 12px}
.sc-lbl{font-size:11px;color:#7b1fa2;margin-bottom:6px}
.rec-card{background:#faf5ff;border-radius:8px;padding:14px 16px;margin-bottom:12px;border:1px solid #e8d5f5}
.rec-mini-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px}
.dt-sm{font-size:12px;color:#888;margin-left:8px}
.score-row{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:#555;background:#f3e5f5;border-radius:6px;padding:8px 12px;margin-bottom:10px}
.avg-sec-block{margin-bottom:16px}
.avg-sec-hd{font-size:12px;font-weight:bold;color:#512da8;background:#ede7f6;border-radius:4px;padding:4px 10px;margin-bottom:8px}
.tg-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
@media(max-width:700px){.tg-grid{grid-template-columns:1fr}}
.tg-sec{border-left:3px solid #ce93d8;padding-left:8px;margin-bottom:4px}
.tg-title{font-size:12px;font-weight:bold;color:#673ab7;background:#f3e5f5;border-radius:4px;padding:3px 8px;margin-bottom:6px}
.tg-row{margin-bottom:6px}
.score-chips{display:flex;flex-wrap:wrap;gap:6px}
.schip{font-size:11px;background:#fff;border:1px solid #ce93d8;border-radius:4px;padding:2px 7px;color:#444}
.fb-area{margin-top:10px}
.fb-lbl{font-size:13px;font-weight:bold;color:#512da8;margin-bottom:6px}
.fb-ta{width:100%;min-height:80px;border:1px solid #ce93d8;border-radius:6px;padding:8px 10px;font-size:13px;font-family:inherit;resize:vertical;outline:none}
.fb-ta:focus{border-color:#673ab7}
.save-btn{margin-top:6px;background:#673ab7;color:#fff;border:none;border-radius:4px;padding:7px 18px;font-size:13px;cursor:pointer}
.save-btn:hover{background:#512da8}
.ai-btn{margin-top:6px;background:#f57c00;color:#fff;border:none;border-radius:4px;padding:7px 18px;font-size:13px;cursor:pointer}
.ai-btn:hover{background:#e65100}
.ai-btn:disabled{background:#bdbdbd;cursor:not-allowed}
.del-dl-btn{margin-top:6px;background:#c62828;color:#fff;border:none;border-radius:4px;padding:7px 18px;font-size:13px;cursor:pointer;margin-left:8px}
.fb-msg{font-size:12px;margin-left:8px}
.fbdone{background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;font-size:12px;font-weight:bold;padding:2px 10px;border-radius:999px;white-space:nowrap}
.fbpend{background:#fff8e1;color:#f57f17;border:1px solid #ffe082;font-size:12px;font-weight:bold;padding:2px 10px;border-radius:999px;white-space:nowrap}
.self-sections{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0}
@media(max-width:600px){.self-sections{grid-template-columns:1fr}}
.self-sec{border-left:3px solid #ce93d8;padding-left:10px}
.self-sec-title{font-size:12px;font-weight:bold;color:#673ab7;margin-bottom:8px}
.qrow,.sc-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #f3e5f5;flex-wrap:wrap}
.ql{font-size:12px;color:#444;flex:1}
.text-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
@media(max-width:500px){.text-pair{grid-template-columns:1fr}}
.tl{font-size:11px;color:#7b1fa2;font-weight:bold;display:block;margin-bottom:2px}
.tv{font-size:12px;color:#444;background:#f9f5ff;border-radius:4px;padding:6px 8px;white-space:pre-wrap;line-height:1.5;min-height:30px}
.self-compact{border:1px solid #f3e5f5;border-radius:6px;padding:8px;margin-bottom:8px}
.comp-data{background:#faf5ff;border-radius:8px;padding:14px;border:1px solid #e8d5f5}
.empty{color:#9e9e9e;text-align:center;padding:40px;background:#fff;border-radius:10px}
.dl-row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px}
.dl-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#512da8;font-weight:bold}
.dl-input{border:1px solid #ce93d8;border-radius:6px;padding:7px 10px;font-size:13px;font-family:inherit;outline:none}
.dl-input:focus{border-color:#673ab7}
.dl-current{background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:12px}
.q-form-block{margin-bottom:24px;background:#faf5ff;border-radius:8px;padding:14px;border:1px solid #e8d5f5}
.q-form-title{font-size:14px;font-weight:bold;color:#512da8;margin-bottom:12px}
input[data-q-type]{display:block}
</style>
<script>
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
}
async function addRespondent() {
  const inp = document.getElementById('nr'); const msg = document.getElementById('rmsg');
  const name = inp.value.trim();
  if (!name) { msg.style.color='#c62828'; msg.textContent='名前を入力'; return; }
  const r = await fetch('/api/respondents', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
  if (r.status===409) { msg.style.color='#c62828'; msg.textContent='すでに登録済み'; return; }
  if (!r.ok) { msg.style.color='#c62828'; msg.textContent='エラー'; return; }
  msg.style.color='#2e7d32'; msg.textContent='追加しました'; inp.value='';
  setTimeout(() => location.reload(), 800);
}
async function delRespondent(id) {
  if (!confirm('削除しますか？')) return;
  await fetch('/api/respondents/' + id, {method:'DELETE'}); location.reload();
}
async function addTarget() {
  const inp = document.getElementById('nt'); const msg = document.getElementById('tmsg');
  const name = inp.value.trim();
  if (!name) { msg.style.color='#c62828'; msg.textContent='名前を入力'; return; }
  const r = await fetch('/api/targets', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
  if (r.status===409) { msg.style.color='#c62828'; msg.textContent='すでに登録済み'; return; }
  if (!r.ok) { msg.style.color='#c62828'; msg.textContent='エラー'; return; }
  msg.style.color='#2e7d32'; msg.textContent='追加しました'; inp.value='';
  setTimeout(() => location.reload(), 800);
}
async function delTarget(id) {
  if (!confirm('削除しますか？')) return;
  await fetch('/api/targets/' + id, {method:'DELETE'}); location.reload();
}
async function saveFB(id, type) {
  const txtEl = document.getElementById((type==='self'?'fbtxt-':'cmttxt-') + id);
  const msg = document.getElementById('fbmsg-' + id);
  const url = type === 'self' ? '/api/self-assessments/' + id + '/feedback' : '/api/feedback/' + id + '/comment';
  const body = type === 'self' ? {feedback: txtEl.value.trim()} : {comment: txtEl.value.trim()};
  const r = await fetch(url, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if (r.ok) { msg.style.color='#2e7d32'; msg.textContent='保存しました'; setTimeout(()=>{msg.textContent='';location.reload();},1000); }
  else { msg.style.color='#c62828'; msg.textContent='エラー'; }
}
async function saveCompFB(encodedName) {
  const txtEl = document.getElementById('cfbtxt-' + encodedName);
  const msg = document.getElementById('cfbmsg-' + encodedName);
  const r = await fetch('/api/comprehensive-feedback/' + encodedName, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({feedback: txtEl.value.trim()})});
  if (r.ok) { msg.style.color='#2e7d32'; msg.textContent='保存しました'; setTimeout(()=>{msg.textContent='';location.reload();},1000); }
  else { msg.style.color='#c62828'; msg.textContent='エラー'; }
}
function addPeriodRow() {
  const tbody = document.getElementById('periods-body');
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid #f3e5f5';
  const td1 = '<td style="padding:8px"><input type="text" placeholder="例: 2026年4月期" data-field="label" style="width:100%;border:1px solid #ce93d8;border-radius:4px;padding:4px 6px;font-size:12px" /></td>';
  const td2 = '<td style="padding:8px"><input type="datetime-local" data-field="start" style="border:1px solid #ce93d8;border-radius:4px;padding:4px 6px;font-size:12px" /></td>';
  const td3 = '<td style="padding:8px"><input type="datetime-local" data-field="end" style="border:1px solid #ce93d8;border-radius:4px;padding:4px 6px;font-size:12px" /></td>';
  const td4 = '<td style="padding:8px"><button onclick="deletePeriodRow(this)" style="background:#c62828;color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer">削除</button></td>';
  tr.innerHTML = td1 + td2 + td3 + td4;
  tbody.appendChild(tr);
}
function deletePeriodRow(btn) {
  btn.closest('tr').remove();
}
async function savePeriods() {
  const msg = document.getElementById('periods-msg');
  const rows = document.querySelectorAll('#periods-body tr');
  const list = [];
  for (const row of rows) {
    const label = row.querySelector('[data-field="label"]').value.trim();
    const start = row.querySelector('[data-field="start"]').value;
    const end = row.querySelector('[data-field="end"]').value;
    const pid = row.querySelector('[data-field="label"]').dataset.pid || '';
    if (!label || !start || !end) { msg.style.color='#c62828'; msg.textContent='全ての行を入力してください'; return; }
    if (new Date(start) >= new Date(end)) { msg.style.color='#c62828'; msg.textContent='「' + label + '」の終了は開始より後にしてください'; return; }
    list.push({ id: pid, label, start: new Date(start).toISOString(), end: new Date(end).toISOString() });
  }
  const r = await fetch('/api/periods', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({list})});
  if (r.ok) { msg.style.color='#2e7d32'; msg.textContent='保存しました'; setTimeout(()=>location.reload(),800); }
  else { msg.style.color='#c62828'; msg.textContent='エラー'; }
}
async function genAI(encodedName) {
  const btn = event.target;
  const msg = document.getElementById('cfbmsg-' + encodedName);
  btn.disabled = true; btn.textContent = '生成中...';
  try {
    const r = await fetch('/api/ai-feedback/' + encodedName, {method:'POST'});
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'エラー'); }
    const { feedback } = await r.json();
    document.getElementById('cfbtxt-' + encodedName).value = feedback;
    msg.style.color='#2e7d32'; msg.textContent='生成しました。内容を確認して「保存」を押してください。';
  } catch(e) {
    msg.style.color='#c62828'; msg.textContent='生成失敗: ' + e.message;
  }
  btn.disabled = false; btn.textContent = '✨ AIで生成';
}
async function saveQuestions() {
  const msg = document.getElementById('q-msg');
  const inputs = document.querySelectorAll('[data-q-type]');
  const data = {feedback360:{sections:[]},selfAssessment:{sections:[]}};
  const map = {};
  inputs.forEach(el => {
    const type = el.dataset.qType;
    const sec = el.dataset.qSec;
    const field = el.dataset.qField;
    const qid = el.dataset.qId;
    if (!map[type]) map[type] = {};
    if (!map[type][sec]) map[type][sec] = {id:sec,title:'',questions:[]};
    if (field === 'title') { map[type][sec].title = el.value.trim(); }
    else if (qid) { map[type][sec].questions.push({id:qid,text:el.value.trim()}); }
  });
  for (const type of ['feedback360','selfAssessment']) {
    data[type].sections = Object.values(map[type] || {});
  }
  const r = await fetch('/api/questions', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  if (r.ok) { msg.style.color='#2e7d32'; msg.textContent='保存しました（次回フォームアクセス時から反映）'; }
  else { msg.style.color='#c62828'; msg.textContent='エラー'; }
}
<\/script>
</head><body>
<div class="topbar"></div>
<header><h1>スタッフ評価 管理画面</h1></header>
<div style="background:#4a148c;padding:8px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
  <span style="color:#e1bee7;font-size:13px;font-weight:bold">表示期間:</span>
  <select id="period-sel" style="border:none;border-radius:4px;padding:6px 10px;font-size:13px;background:#fff;color:#333;cursor:pointer" onchange="location.href='/staff-admin?period='+this.value+(location.hash||'')">
    <option value="" ${!selectedPeriodId?'selected':''}>全期間（合算）</option>
    ${periods.sort((a,b)=>new Date(b.start)-new Date(a.start)).map(p=>`<option value="${escHtml(p.id)}" ${selectedPeriodId===p.id?'selected':''}>${escHtml(p.label)} （${fmtDL(p.start)}〜${fmtDL(p.end)}）</option>`).join('')}
  </select>
  ${getActivePeriod(periods) ? `<span style="font-size:12px;background:#7b1fa2;color:#fff;border-radius:10px;padding:2px 10px">現在募集中: ${escHtml(getActivePeriod(periods).label)}</span>` : '<span style="font-size:12px;color:#ce93d8">（現在募集中の期なし）</span>'}
</div>
<div class="tabs">
  <button class="tab-btn active" id="tab-self" onclick="switchTab('self')">行動基準評価（${selfRecs.length}件）</button>
  <button class="tab-btn" id="tab-360" onclick="switchTab('360')">360度評価（${feedbacks.length}件）</button>
  <button class="tab-btn" id="tab-comp" onclick="switchTab('comp')">総合フィードバック（${allNames.length}名）</button>
  <button class="tab-btn" id="tab-settings" onclick="switchTab('settings')">設定</button>
</div>
<div class="wrap">
  <div class="tab-panel active" id="panel-self">
    ${selfSection}
  </div>
  <div class="tab-panel" id="panel-360">${sec360}</div>
  <div class="tab-panel" id="panel-comp">
    ${allNames.length === 0 ? '<div class="empty">まだデータはありません</div>' : compRows}
  </div>
  <div class="tab-panel" id="panel-settings">
    <div class="set-card">
      <div class="set-hd">回答者管理（フォームに回答するスタッフ）</div>
      <div class="set-bd">
        <p style="font-size:12px;color:#555;margin-bottom:12px">行動基準評価・360度評価フォームの「回答者（あなたの名前）」プルダウンに表示される名前リストです。</p>
        <div class="target-list" id="resp-list">
          ${(await (await getDb()).collection('respondents').find({}).toArray()).map(t => `<div class="target-item"><span>${escHtml(t.name)}</span><button class="del-btn" onclick="delRespondent('${t.id}')">✕</button></div>`).join('') || '<p style="color:#9e9e9e;font-size:13px">未登録</p>'}
        </div>
        <div class="add-row">
          <input type="text" id="nr" class="add-input" placeholder="名前を入力" />
          <button class="add-btn" onclick="addRespondent()">＋ 追加</button>
          <span id="rmsg" style="font-size:12px"></span>
        </div>
      </div>
    </div>
    <div class="set-card">
      <div class="set-hd">評価期間の管理</div>
      <div class="set-bd">
        <p style="font-size:12px;color:#555;margin-bottom:12px">期を事前に複数登録できます。開始〜終了期間中に回答した場合、その期のデータとして蓄積されます。同じ期内の重複回答は防止されます。</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px" id="periods-table">
          <thead><tr style="background:#ede7f6"><th style="padding:8px;text-align:left">期名</th><th style="padding:8px;text-align:left">開始</th><th style="padding:8px;text-align:left">終了</th><th style="padding:8px"></th></tr></thead>
          <tbody id="periods-body">
            ${periods.sort((a,b)=>new Date(a.start)-new Date(b.start)).map((p,i)=>`<tr data-idx="${i}" style="border-bottom:1px solid #f3e5f5">
              <td style="padding:8px"><input type="text" value="${escHtml(p.label)}" data-field="label" data-pid="${escHtml(p.id)}" style="width:100%;border:1px solid #ce93d8;border-radius:4px;padding:4px 6px;font-size:12px" /></td>
              <td style="padding:8px"><input type="datetime-local" value="${p.start.slice(0,16)}" data-field="start" data-pid="${escHtml(p.id)}" style="border:1px solid #ce93d8;border-radius:4px;padding:4px 6px;font-size:12px" /></td>
              <td style="padding:8px"><input type="datetime-local" value="${p.end.slice(0,16)}" data-field="end" data-pid="${escHtml(p.id)}" style="border:1px solid #ce93d8;border-radius:4px;padding:4px 6px;font-size:12px" /></td>
              <td style="padding:8px"><button onclick="deletePeriodRow(this)" style="background:#c62828;color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer">削除</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="save-btn" onclick="addPeriodRow()">＋ 期を追加</button>
          <button class="save-btn" onclick="savePeriods()">保存</button>
          <span id="periods-msg" style="font-size:12px"></span>
        </div>
      </div>
    </div>
    <div class="set-card">
      <div class="set-hd">質問文の編集</div>
      <div class="set-bd">
        <div class="q-form-block">
          <div class="q-form-title">360度評価 質問文</div>
          ${qEditSection('feedback360', '360度評価')}
        </div>
        <div class="q-form-block">
          <div class="q-form-title">行動基準評価（自己評価）質問文</div>
          ${qEditSection('selfAssessment', '行動基準評価')}
        </div>
        <button class="save-btn" onclick="saveQuestions()">質問文を保存</button>
        <span id="q-msg" style="font-size:12px;margin-left:8px"></span>
      </div>
    </div>
  </div>
</div>
</body></html>`);
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
