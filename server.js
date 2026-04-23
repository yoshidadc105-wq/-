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

// ---- 日本語フォント（起動時にダウンロード・キャッシュ） ----

let jaFont = null;

function loadJapaneseFont() {
  const candidates = [
    path.join(__dirname, 'node_modules', '@expo-google-fonts', 'noto-sans-jp', 'NotoSansJP_400Regular.ttf'),
    path.join(__dirname, 'node_modules', '@expo-google-fonts', 'noto-sans-jp', 'NotoSansJP-Regular.ttf'),
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

  // Stransa へ転送（テストモード時はスキップ）
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

    // 友達追加時
    if (event.type === 'follow') {
      await sendFollowMessage(event.source.userId);
    }

    // 「問診表」キーワード受信時 → 問診表URLを送信
    if (event.type === 'message' && event.message.type === 'text') {
      const text = event.message.text.trim();
      if (text === '問診表') {
        await sendQuestionnaire(event.source.userId);
      }
    }
  }
});

// 友達追加時のウェルカムメッセージ
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

// 問診表URLを送信
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

  // メール送信
  sendFormEmail(d).catch((err) => console.error('メール送信エラー:', err.message));

  // 自動印刷
  printQuestionnaire(d).catch((err) => console.error('印刷エラー:', err.message));
});

function formatChecks(arr) {
  if (!arr || arr.length === 0) return '（なし）';
  return Array.isArray(arr) ? arr.join('、') : arr;
}

// ---- メール送信 ----

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

    // ヘッダー
    doc.fontSize(16).text('のびのび歯科・矯正歯科 問診表', { align: 'center' });
    doc.fontSize(9).text(`受信: ${now}`, { align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.5);

    // 基本情報
    doc.fontSize(11).text('■ 基本情報');
    doc.fontSize(10)
      .text(`お名前: ${d.name}（${d.kana}）`)
      .text(`生年月日: ${d.dob}　性別: ${d.gender || '未記入'}`)
      .text(`電話: ${d.tel || ''}　携帯: ${d.mobile || ''}`)
      .text(`ご住所: ${d.address || ''}`);
    doc.moveDown(0.5);

    // 来院・治療
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

    // 健康状態
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

    // ご要望
    doc.fontSize(11).text('■ ご要望');
    doc.fontSize(10).text(d.requests || 'なし');
    doc.moveDown(0.5);

    // 通院希望
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
});
