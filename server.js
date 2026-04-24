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

  console.log(`問診表受信: ${d.name}`);
  res.status(200).json({ ok: true });

  // DBに保存
  const records = loadDB();
  records.unshift({
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    name: d.name,
    kana: d.kana || '',
    tel: d.tel || d.mobile || '',
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
      const badge = r.checked
        ? '<span class="badge-done">確認済</span>'
        : `<form method="post" action="/admin/check/${r.id}"><button class="btn-check" type="submit">確認済にする</button></form>`;
      return `
      <tr class="${rowClass}">
        <td>${escHtml(dt)}</td>
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
.container { padding: 20px; max-width: 1100px; margin: 0 auto; }
.summary { margin-bottom: 12px; font-size: 14px; color: #6b7280; }
table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
th { background: #eff6ff; padding: 10px 14px; text-align: left; font-size: 13px; color: #1e40af; white-space: nowrap; }
td { padding: 10px 14px; border-top: 1px solid #e5e7eb; font-size: 14px; vertical-align: top; }
tr.new td { background: #fefce8; }
tr.new td:first-child { border-left: 4px solid #f59e0b; }
.badge-done { background: #d1fae5; color: #065f46; padding: 3px 10px; border-radius: 999px; font-size: 12px; display: inline-block; }
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
        <th>お名前</th>
        <th>電話番号</th>
        <th>主訴</th>
        <th>状態</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="5" class="empty">まだ受信した問診表はありません</td></tr>'}
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

async function sendFormEmail(d) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  const text = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  のびのび歯科・矯正歯科　問診表
  受信日時: ${now}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【基本情報】
お名前　　: ${d.name}（${d.kana}）
生年月日　: ${d.dob}
性別　　　: ${d.gender || '未記入'}
ご住所　　: ${d.address || '未記入'}
電話番号　: ${d.tel || '未記入'}
携帯　　　: ${d.mobile || '未記入'}
勤務先　　: ${d.workplace || '未記入'}
ご職業　　: ${d.job || '未記入'}

━━ 来院・治療について ━━━━━━━━━━━━━

Q1. 本日の主訴
  ${formatChecks(d.q1)}
  その他: ${d.q1_other || 'なし'}

Q2. 来院のきっかけ
  ${formatChecks(d.q2)}
  紹介者: ${d.q2_ref_name || 'なし'} / 紹介元: ${d.q2_hospital || 'なし'}

Q3. 気になる部位: ${d.q3 || '未記入'}

Q4. 最後の受診: ${d.q4 || '未記入'}
  詳細: ${d.q4_detail || 'なし'}

Q5. 以前の受診の感想: ${formatChecks(d.q5)}
Q6. 治療で重視すること: ${formatChecks(d.q6)}
Q7. 興味のある治療: ${formatChecks(d.q7)}

━━ 健康状態について ━━━━━━━━━━━━━━

Q8. 既往歴: ${formatChecks(d.q8)}
  詳細: ${d.q8_detail || 'なし'}

Q9. 現在の健康状態: ${formatChecks(d.q9)}
  通院病院: ${d.q9_hospital || 'なし'} / 薬剤: ${d.q9_medicine || 'なし'}

Q10. アレルギー: ${formatChecks(d.q10)} ${d.q10_other || ''}
Q11. 薬での体調不良: ${d.q11 || '未記入'} ${d.q11_detail || ''}
Q12. 麻酔経験: ${d.q12 || '未記入'} ${d.q12_detail || ''}
Q13. 喫煙: ${d.q13 || '未記入'} ${d.q13_count || ''}
Q14. 妊娠中: ${d.q14_pregnant || '未回答'} ${d.q14_week ? d.q14_week + '週目' : ''} / 授乳中: ${d.q14_breastfeed || '未回答'}
Q15. 診療へのご要望: ${formatChecks(d.q15)}

━━ ご要望・通院希望 ━━━━━━━━━━━━━━

【当院へのご要望】
${d.requests || 'なし'}

【通院希望曜日】
　　　月　火　水　木　金　土　日　祝
午前　${d.sch_am_mon||'-'}　${d.sch_am_tue||'-'}　${d.sch_am_wed||'-'}　${d.sch_am_thu||'-'}　${d.sch_am_fri||'-'}　${d.sch_am_sat||'-'}　${d.sch_am_sun||'-'}　${d.sch_am_hol||'-'}
午後　${d.sch_pm_mon||'-'}　${d.sch_pm_tue||'-'}　${d.sch_pm_wed||'-'}　${d.sch_pm_thu||'-'}　${d.sch_pm_fri||'-'}　${d.sch_pm_sat||'-'}　${d.sch_pm_sun||'-'}　${d.sch_pm_hol||'-'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

  await transporter.sendMail({
    from: `"のびのび歯科 問診表" <${GMAIL_USER}>`,
    to: MAIL_TO,
    subject: `【問診表】${d.name} 様（${now}）`,
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

    doc.fontSize(16).text('のびのび歯科・矯正歯科 問診表', { align: 'center' });
    doc.fontSize(9).text(`受信: ${now}`, { align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(11).text('■ 基本情報');
    doc.fontSize(10)
      .text(`お名前: ${d.name}（${d.kana}）`)
      .text(`生年月日: ${d.dob}　性別: ${d.gender || '未記入'}`)
      .text(`電話: ${d.tel || ''}　携帯: ${d.mobile || ''}`)
      .text(`ご住所: ${d.address || ''}`);
    doc.moveDown(0.5);

    doc.fontSize(11).text('■ 来院・治療について');
    doc.fontSize(10)
      .text(`Q1 主訴: ${formatChecks(d.q1)}${d.q1_other ? ' / ' + d.q1_other : ''}`)
      .text(`Q2 来院のきっかけ: ${formatChecks(d.q2)}`)
      .text(`Q3 気になる部位: ${d.q3 || '未記入'}`)
      .text(`Q4 最後の受診: ${d.q4 || '未記入'}${d.q4_detail ? ' / ' + d.q4_detail : ''}`)
      .text(`Q5 以前の感想: ${formatChecks(d.q5)}`)
      .text(`Q6 治療で重視: ${formatChecks(d.q6)}`)
      .text(`Q7 興味ある治療: ${formatChecks(d.q7)}`);
    doc.moveDown(0.5);

    doc.fontSize(11).text('■ 健康状態');
    doc.fontSize(10)
      .text(`Q8 既往歴: ${formatChecks(d.q8)}${d.q8_detail ? ' / ' + d.q8_detail : ''}`)
      .text(`Q9 現在の健康: ${formatChecks(d.q9)}`)
      .text(`　通院: ${d.q9_hospital || 'なし'}　薬剤: ${d.q9_medicine || 'なし'}`)
      .text(`Q10 アレルギー: ${formatChecks(d.q10)}${d.q10_other ? ' / ' + d.q10_other : ''}`)
      .text(`Q11 薬での体調不良: ${d.q11 || '未記入'}${d.q11_detail ? ' / ' + d.q11_detail : ''}`)
      .text(`Q12 麻酔経験: ${d.q12 || '未記入'}${d.q12_detail ? ' / ' + d.q12_detail : ''}`)
      .text(`Q13 喫煙: ${d.q13 || '未記入'}${d.q13_count ? ' ' + d.q13_count : ''}`)
      .text(`Q14 妊娠中: ${d.q14_pregnant || '未回答'}${d.q14_week ? ' ' + d.q14_week + '週目' : ''}　授乳中: ${d.q14_breastfeed || '未回答'}`)
      .text(`Q15 診療希望: ${formatChecks(d.q15)}`);
    doc.moveDown(0.5);

    doc.fontSize(11).text('■ ご要望');
    doc.fontSize(10).text(d.requests || 'なし');
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
    await axios.post(
      'https://api.printnode.com/printjobs',
      {
        printerId: parseInt(PRINTNODE_PRINTER_ID),
        title: `問診表 ${d.name}`,
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
