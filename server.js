const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const nodemailer = require('nodemailer');
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

// 静的ファイル（問診表HTML）を public/ から配信
app.use(express.static(path.join(__dirname, 'public')));

// rawBodyをLINEシグネチャ検証のために保持
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

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
    console.log(`イベント受信: type=${event.type}, userId=${event.source?.userId}`);
    if (event.type === 'follow') {
      await sendQuestionnaire(event.source.userId);
    }
  }
});

async function sendQuestionnaire(userId) {
  const message = [
    'はじめまして！のびのび歯科・矯正歯科です。',
    '友だち追加ありがとうございます😊',
    '',
    'このアカウントでは最新情報を定期的に配信していきます。',
    'どうぞお楽しみに🎁✨',
    '',
    '---',
    '',
    '初めてご来院の方は、下記の問診表にご記入をお願いいたします。',
    '事前にご記入いただくと、受付がスムーズになります。',
    '',
    '📋 問診表はこちら',
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

  try {
    await sendFormEmail(d);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('メール送信エラー:', err.message);
    res.status(500).json({ error: 'mail failed' });
  }
});

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

Q3. 気になる部位
  ${d.q3 || '未記入'}

Q4. 最後の受診
  ${d.q4 || '未記入'}
  詳細: ${d.q4_detail || 'なし'}

Q5. 以前の受診の感想
  ${formatChecks(d.q5)}
  その他: ${d.q5_other || 'なし'}

Q6. 治療で重視すること
  ${formatChecks(d.q6)}

Q7. 興味のある治療
  ${formatChecks(d.q7)}

━━ 健康状態について ━━━━━━━━━━━━━━

Q8. 既往歴
  ${formatChecks(d.q8)}
  詳細: ${d.q8_detail || 'なし'}

Q9. 現在の健康状態
  ${formatChecks(d.q9)}
  通院病院: ${d.q9_hospital || 'なし'} / 薬剤: ${d.q9_medicine || 'なし'}

Q10. アレルギー
  ${formatChecks(d.q10)}
  その他: ${d.q10_other || 'なし'}

Q11. 薬での体調不良
  ${d.q11 || '未記入'} / ${d.q11_detail || 'なし'}

Q12. 麻酔経験
  ${d.q12 || '未記入'} / ${d.q12_detail || 'なし'}

Q13. 喫煙
  ${d.q13 || '未記入'} ${d.q13_count || ''}

Q14. 妊娠・授乳（女性）
  妊娠中: ${d.q14_pregnant || '未回答'} ${d.q14_week ? d.q14_week + '週目' : ''}
  授乳中: ${d.q14_breastfeed || '未回答'}

Q15. 診療へのご要望
  ${formatChecks(d.q15)}

━━ ご要望・通院希望 ━━━━━━━━━━━━━━

【当院へのご要望】
${d.requests || 'なし'}

【通いやすい曜日・時間帯】
　　　　月　火　水　木　金　土　日　祝
午前　　${d.sch_am_mon||'-'}　${d.sch_am_tue||'-'}　${d.sch_am_wed||'-'}　${d.sch_am_thu||'-'}　${d.sch_am_fri||'-'}　${d.sch_am_sat||'-'}　${d.sch_am_sun||'-'}　${d.sch_am_hol||'-'}
午後　　${d.sch_pm_mon||'-'}　${d.sch_pm_tue||'-'}　${d.sch_pm_wed||'-'}　${d.sch_pm_thu||'-'}　${d.sch_pm_fri||'-'}　${d.sch_pm_sat||'-'}　${d.sch_pm_sun||'-'}　${d.sch_pm_hol||'-'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

  await transporter.sendMail({
    from: `"のびのび歯科 問診表" <${GMAIL_USER}>`,
    to: MAIL_TO,
    subject: `【問診表】${d.name} 様（${now}）`,
    text,
  });
}

// 死活確認用
app.get('/health', (_req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動: port=${PORT}`);
  console.log(`テストモード: ${TEST_MODE}`);
  console.log(`メール送信先: ${MAIL_TO || '未設定'}`);
});
