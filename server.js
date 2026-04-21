const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const STRANSA_WEBHOOK_URL = process.env.STRANSA_WEBHOOK_URL;
const QUESTIONNAIRE_URL = process.env.QUESTIONNAIRE_URL;
const TEST_MODE = process.env.TEST_MODE === 'true';

// rawBodyをシグネチャ検証のために保持
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

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

  // LINEには200を即返す（タイムアウト防止）
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

  // イベント処理
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
    'のびのび歯科・矯正歯科へようこそ！😊',
    '',
    '初めてご来院の方は、下記の問診表にご記入をお願いいたします。',
    '事前にご記入いただくと、受付がスムーズになります。',
    '',
    `📋 問診表はこちら`,
    QUESTIONNAIRE_URL,
  ].join('\n');

  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      {
        to: userId,
        messages: [{ type: 'text', text: message }],
      },
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

// 死活確認用
app.get('/health', (_req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動: port=${PORT}`);
  console.log(`テストモード: ${TEST_MODE}`);
  console.log(`Stransa転送先: ${STRANSA_WEBHOOK_URL || '未設定'}`);
});
