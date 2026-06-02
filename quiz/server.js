const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const QUIZ_ADMIN_PASSWORD = process.env.QUIZ_ADMIN_PASSWORD || 'admin';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const MANUAL_API_URL = process.env.MANUAL_API_URL || '';
const MANUAL_API_KEY = process.env.MANUAL_API_KEY || '';
const MONGODB_URI = process.env.MONGODB_URI || '';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

const DATA_DIR = path.join(__dirname, 'data');
const SETS_FILE = path.join(DATA_DIR, 'quiz-sets.json');
const SUBS_FILE = path.join(DATA_DIR, 'submissions.json');

let _mongoClient = null;
async function getCollection() {
  if (!MONGODB_URI) return null;
  if (!_mongoClient) {
    const { MongoClient } = require('mongodb');
    _mongoClient = new MongoClient(MONGODB_URI);
    await _mongoClient.connect();
    console.log('MongoDB接続完了');
  }
  return _mongoClient.db('nobinobi-quiz').collection('data');
}

async function loadSets() {
  try {
    const col = await getCollection();
    if (col) {
      const doc = await col.findOne({ _id: 'sets' });
      return (doc && doc.data) ? doc.data : [];
    }
  } catch (e) { console.error('MongoDB loadSets error:', e.message); }
  try { return JSON.parse(fs.readFileSync(SETS_FILE, 'utf8')); } catch { return []; }
}

async function saveSets(data) {
  try {
    const col = await getCollection();
    if (col) {
      await col.replaceOne({ _id: 'sets' }, { _id: 'sets', data }, { upsert: true });
      return;
    }
  } catch (e) { console.error('MongoDB saveSets error:', e.message); }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETS_FILE, JSON.stringify(data, null, 2));
}

async function loadSubs() {
  try {
    const col = await getCollection();
    if (col) {
      const doc = await col.findOne({ _id: 'subs' });
      return (doc && doc.data) ? doc.data : [];
    }
  } catch (e) { console.error('MongoDB loadSubs error:', e.message); }
  try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { return []; }
}

async function saveSubs(data) {
  try {
    const col = await getCollection();
    if (col) {
      await col.replaceOne({ _id: 'subs' }, { _id: 'subs', data }, { upsert: true });
      return;
    }
  } catch (e) { console.error('MongoDB saveSubs error:', e.message); }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SUBS_FILE, JSON.stringify(data, null, 2));
}

async function loadStaff() {
  try {
    const col = await getCollection();
    if (col) {
      const doc = await col.findOne({ _id: 'staff' });
      return (doc && doc.data) ? doc.data : [];
    }
  } catch (e) { console.error('MongoDB loadStaff error:', e.message); }
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'staff.json'), 'utf8')); } catch { return []; }
}

async function saveStaff(data) {
  try {
    const col = await getCollection();
    if (col) {
      await col.replaceOne({ _id: 'staff' }, { _id: 'staff', data }, { upsert: true });
      return;
    }
  } catch (e) { console.error('MongoDB saveStaff error:', e.message); }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'staff.json'), JSON.stringify(data, null, 2));
}

function checkAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) { res.status(401).json({ error: 'unauthorized' }); return false; }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const pass = decoded.indexOf(':') >= 0 ? decoded.slice(decoded.indexOf(':') + 1) : '';
  if (pass !== QUIZ_ADMIN_PASSWORD) { res.status(401).json({ error: 'wrong password' }); return false; }
  return true;
}

function normalizeAns(s) {
  return String(s == null ? '' : s)
    .trim()
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\s　]+/g, '')
    .replace(/[、。，．・〜～ー]/g, '');
}

app.get('/api/sets', async (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json(await loadSets());
});

app.get('/api/sets/public', async (req, res) => {
  const all = await loadSets();
  const sets = all
    .filter(s => s.active !== false)
    .map(s => ({
      id: s.id,
      manualName: s.manualName,
      questionCount: s.questions.length,
      createdAt: s.createdAt,
      questions: s.questions.map(({ id, type, question, options }) => ({ id, type, question, options })),
    }));
  res.json(sets);
});

const META_PATTERNS = [
  /\b(?:exported|updated?|created|modified|imported|revision|rev\.?|version|author|owner)\b/i,
  /\b(?:id|uuid|url|file|filename|path|sheet|row|column)\s*[:：]/i,
  /\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/,
  /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/,
  /^https?:\/\//i,
  /(?:作成者|更新者|登録者|担当者|氏名|名前|ユーザー|ログ|履歴|タイムスタンプ|エクスポート|インポート)\s*[:：]/,
  /(?:吉田|秋葉|髙橋|高橋|佐藤|鈴木|田中|伊藤|渡辺|山本|中村|小林|加藤|山田|斎藤|林|清水|山崎|森|池田|橋本|阿部|石川|山下|中島|前田|藤田|後藤|岡田|村上|長谷川|近藤|石井|齋藤|坂本|遠藤|青木|藤井|西村|福田|太田|三浦|藤原|岡本|松田|中川|中野|原田|小野|竹内|金子|和田|中山|石田|上田|森田|柴田|原|酒井|工藤|横山|宮崎|宮本|内田|高木|安藤|谷口|大野|丸山|今井|武田|藤本|村田|上野|杉山|増田|菅原|平野|大塚|千葉|久保|松井|岩崎|桜井|野口|木下|松尾|菊地|野村|新井|佐野|杉本|古川|浜田|市川|大西|小松|高田|水野|酒井|上田|東|西|南|北)[\p{Script=Han}ぁ-んァ-ヶー]{1,6}/u,
];

function normalizeManualLine(line) {
  return String(line || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[|｜]/g, ' ')
    .replace(/^[\s\-・*●■◆□◇○◎▶▷>]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsMetaInfo(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  if (META_PATTERNS.some(re => re.test(s))) return true;
  if (/^[A-Za-z0-9_ .:/-]{3,}$/.test(s) && !/[ぁ-んァ-ヶ一-龥]/.test(s)) return true;
  if (/^[\p{Script=Han}ぁ-んァ-ヶー]{2,8}$/u.test(s) && !/(患者|スタッフ|院長|歯科|衛生士|助手|受付)/.test(s)) return true;
  return false;
}

function looksLikeTrainingContent(text) {
  const s = String(text || '').trim();
  if (containsMetaInfo(s)) return false;
  if (s.length < 12 || s.length > 180) return false;
  if (!/[ぁ-んァ-ヶ一-龥]/.test(s)) return false;
  if (/^[「『]?[^。！？!?]{2,30}[」』]?$/.test(s) && !/[はをがにでへと]/.test(s)) return false;
  if (/^[「『]?[^。！？!?]{2,30}[」』]?$/.test(s) && !/(確認|説明|実施|対応|記録|入力|共有|洗浄|消毒|保管|連絡|案内|予約|準備|診療|清掃|滅菌|会計|受付|問診|同意|装着|撮影|印象|スキャン|患者|してください|します|する|行う|行います|必要|注意|禁止|徹底)/.test(s)) return false;
  return /(確認|説明|実施|対応|記録|入力|共有|洗浄|消毒|保管|連絡|案内|予約|準備|診療|検査|清掃|滅菌|会計|受付|問診|同意|装着|撮影|印象|スキャン|患者|スタッフ|院長|歯科|衛生士|助手|ください|します|する|行う|行います|必要|注意|禁止|徹底)/.test(s);
}

function cleanManualText(manualText) {
  const rawLines = String(manualText || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(normalizeManualLine)
    .filter(Boolean);

  const sentences = [];
  for (const line of rawLines) {
    if (containsMetaInfo(line)) continue;
    const pieces = line
      .split(/(?<=[。！？!?])|\n+/)
      .map(normalizeManualLine)
      .filter(Boolean);
    for (const piece of pieces) {
      if (looksLikeTrainingContent(piece)) sentences.push(piece);
    }
  }

  return [...new Set(sentences)].slice(0, 80).join('\n');
}

function buildQuizPrompt(manualText, count) {
  return `以下の【整理済みマニュアル本文】だけを根拠に、歯科クリニックのスタッフ研修に使える理解度確認クイズを${count}問作成してください。

【最重要ルール】
- 出題対象は、患者対応、検査、診療補助、受付、説明、記録、感染対策、器具管理など、スタッフが実務で判断・行動する内容だけです。
- 名前、担当者名、作成者名、更新者名、日時、日付、ID、URL、Exported、Update、Created、履歴、ログ、ファイル名、タイトルだけの行は絶対に出題・選択肢・解説に含めないでください。
- マニュアル名や項目名だけを問う問題は禁止です。例：「マニュアルでは『○○検査』とされています」は不合格です。
- 「このマニュアルに記載」「マニュアル本文」「次の内容は正しいですか」のような丸写し確認は禁止です。現場で迷う判断・行動・確認事項を問う自然な問題文にしてください。
- 本文に書かれた手順・注意点・確認事項・禁止事項・説明事項を、現場で使える問いに言い換えてください。
- マニュアル本文に書かれていない内容、一般論、IT、Python、システム管理などの架空問題は作らないでください。
- 問題・選択肢・解説はすべて自然な日本語にしてください。
- 出力はJSONオブジェクトのみです。前置き、説明文、Markdownコードブロックは禁止です。
- ${count}問ちょうど作成してください。

【問題の種類】本文に合うものだけを使ってください：
1. truefalse（マルバツ）: 実務上の判断を問う。answerは"true"または"false"。
2. choice（選択式）: 4択問題。optionsは4個、answerは正解の選択肢テキスト。
3. fill（穴埋め）: 重要語句や確認項目を問う。answerは文字列または文字列配列。
4. sort（並び替え）: 手順が明確な場合のみ使用し、answerは正しい順番の配列。

【整理済みマニュアル本文】
${manualText}

【出力形式】JSONオブジェクトのみ：
{
  "questions": [
    {"type":"truefalse","question":"実務判断を問う問題文","options":[],"answer":"true","explanation":"マニュアル本文に基づく解説"},
    {"type":"choice","question":"実務上の適切な対応を問う問題文","options":["選択肢1","選択肢2","選択肢3","選択肢4"],"answer":"選択肢1","explanation":"マニュアル本文に基づく解説"},
    {"type":"fill","question":"重要な確認事項は___です。","options":[],"answer":"答え","explanation":"マニュアル本文に基づく解説"},
    {"type":"sort","question":"次の手順を正しい順番に並べてください。","options":["手順1","手順2","手順3"],"answer":["手順1","手順2","手順3"],"explanation":"マニュアル本文に基づく解説"}
  ]
}`;
}

function extractJsonArray(responseText) {
  const text = String(responseText || '').trim();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.questions)) return parsed.questions;
  } catch (_) {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1]);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.questions)) return parsed.questions;
    } catch (_) {}
  }

  const jsonMatch = text.match(/\[[\s\S]*\]/) || text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON形式の回答が見つかりませんでした');
  const parsed = JSON.parse(jsonMatch[0]);
  return Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : []);
}

async function generateWithGemini(prompt) {
  const geminiRes = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    },
    { timeout: 60000 }
  );
  const responseText = geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return extractJsonArray(responseText);
}

async function generateWithGroq(prompt) {
  const groqRes = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: '必ず日本語のJSONオブジェクトのみを返してください。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    },
    { headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, timeout: 60000 }
  );
  const responseText = groqRes.data.choices?.[0]?.message?.content || '';
  return extractJsonArray(responseText);
}

function isGenericManualQuestion(text) {
  const s = String(text || '');
  return /このマニュアル|マニュアル本文|マニュアルに記載|記載されている内容|次の内容は.*正しいですか|該当箇所/.test(s);
}

function normalizeGeneratedQuestions(raw, count) {
  return raw.map(q => {
    const questionText = String(q.question || q.text || q['問題'] || q['問題文'] || '').trim();
    const explanation = String(q.explanation || q['解説'] || q['説明'] || '').trim();
    let options = q.options || q.choices || q['選択肢'] || [];
    if (!Array.isArray(options)) {
      options = (options && typeof options === 'object') ? Object.values(options) : [];
    }

    let type = q.type || 'truefalse';
    if (!['truefalse', 'choice', 'fill', 'sort'].includes(type)) type = 'truefalse';

    if (type === 'sort' && options.length > 0) {
      const expanded = [];
      options.forEach(o => {
        const s = String(o).trim();
        if (s.includes('、') && s.split('、').every(p => p.length < 20)) {
          s.split('、').forEach(p => { if (p.trim()) expanded.push(p.trim()); });
        } else if (s.includes(',') && s.split(',').every(p => p.trim().length < 25)) {
          s.split(',').forEach(p => { if (p.trim()) expanded.push(p.trim()); });
        } else {
          expanded.push(s);
        }
      });
      options = expanded;
    }

    options = options.map(o => String(o).trim()).filter(o => o && !containsMetaInfo(o));

    const answer = q.answer != null ? q.answer : q.correct_answer != null ? q.correct_answer : q['答え'] != null ? q['答え'] : q['正解'] != null ? q['正解'] : '';
    const finalAnswer = (type === 'sort' && !Array.isArray(answer)) ? [...options] : answer;
    return { type, question: questionText, options, answer: finalAnswer, explanation };
  }).filter(q => {
    const answerText = Array.isArray(q.answer) ? q.answer.join(' ') : String(q.answer || '');
    const combined = [q.question, q.explanation, answerText].join(' ');
    if (!q.question || containsMetaInfo(combined)) return false;
    if (isGenericManualQuestion(q.question)) return false;
    if (!looksLikeTrainingContent(q.question + ' ' + q.explanation) && q.type !== 'choice') return false;
    if (q.type === 'choice' && q.options.length < 4) return false;
    if (q.type === 'sort' && q.options.length < 2) return false;
    return true;
  }).slice(0, count);
}

function splitManualSentences(manualText) {
  return cleanManualText(manualText)
    .split('\n')
    .map(s => s.replace(/^[\s\-・*●■◆□0-9０-９.)）(（]+/, '').trim())
    .filter(looksLikeTrainingContent);
}

function pickBlankTarget(sentence) {
  const parts = String(sentence || '')
    .split(/[、,\s　「」『』（）()\[\]【】]|(?:について)|[はをがにでへともの]/)
    .map(s => s.replace(/します$|してください$|する$|です$|ます$/g, '').trim())
    .filter(s => s.length >= 2 && s.length <= 8);
  const candidates = parts.length ? parts : (sentence.match(/[一-龥ぁ-んァ-ヶA-Za-z0-9ー]{2,8}/g) || []);
  const stopwords = new Set(['してください', 'します', 'あります', 'できます', 'について', '場合', 'ため', 'こと', 'もの', 'ように', 'スタッフ', 'マニュアル']);
  return candidates.find(w => !stopwords.has(w) && !/^[0-9０-９]+$/.test(w)) || candidates[0] || '';
}

function makeLocalQuizQuestions(manualText, count) {
  const sentences = splitManualSentences(manualText);
  const source = sentences.length ? sentences : [String(manualText || '').trim()].filter(Boolean);
  const questions = [];

  for (let i = 0; questions.length < count && i < Math.max(source.length, count * 2); i++) {
    const sentence = source[i % source.length];
    const mode = questions.length % 3;

    if (mode === 0) {
      questions.push({
        type: 'truefalse',
        question: `スタッフが現場で行う対応として、次の行動は適切ですか。「${sentence}」`,
        options: [],
        answer: 'true',
        explanation: `この対応は、研修本文で求められている手順・確認事項に沿っています。`,
      });
      continue;
    }

    if (mode === 1) {
      const target = pickBlankTarget(sentence);
      if (target && sentence.includes(target)) {
        questions.push({
          type: 'fill',
          question: sentence.replace(target, '___'),
          options: [],
          answer: target,
          explanation: `研修本文では、この確認・対応が必要であることが示されています。`,
        });
        continue;
      }
    }

    const options = [
      sentence,
      '確認せずに自己判断で進める',
      '必要な記録や共有を省略する',
      '患者さんへの説明や配慮を行わない',
    ];
    questions.push({
      type: 'choice',
      question: '現場対応として最も適切なものはどれですか。',
      options,
      answer: sentence,
      explanation: `正解は、研修本文で求められている具体的な対応に沿った選択肢です。`,
    });
  }

  return questions.slice(0, count);
}

app.post('/api/generate', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { manualText, count = 5 } = req.body;
  const safeCount = Math.min(Math.max(parseInt(count, 10) || 5, 1), 20);
  if (!manualText) return res.status(400).json({ error: 'manualTextが必要です' });
  const cleanedManualText = cleanManualText(manualText);
  if (!cleanedManualText) return res.status(400).json({ error: '出題できる実務本文が見つかりませんでした。名前・日時・履歴ではなく、手順や注意点を含む本文を入力してください。' });

  const prompt = buildQuizPrompt(cleanedManualText, safeCount);
  const attempts = [];

  if (GEMINI_API_KEY) attempts.push(['Gemini 2.0 Flash', () => generateWithGemini(prompt)]);
  if (GROQ_API_KEY) attempts.push(['Groq llama-3.3', () => generateWithGroq(prompt)]);

  const errors = [];
  for (const [providerName, fn] of attempts) {
    try {
      const raw = await fn();
      let questions = normalizeGeneratedQuestions(raw, safeCount);
      if (questions.length < safeCount) {
        const local = makeLocalQuizQuestions(cleanedManualText, safeCount - questions.length);
        questions = questions.concat(local).slice(0, safeCount);
      }
      console.log(`AI provider success: ${providerName}, questions: ${questions.length}`);
      if (!questions.length) throw new Error('有効な問題が生成されませんでした');
      return res.json({ questions, provider: providerName });
    } catch (err) {
      const detail = err.response?.data?.error?.message || err.response?.data?.error || err.message;
      console.error(`AI provider failed: ${providerName}`, err.response?.data || err.message);
      errors.push(`${providerName}: ${detail}`);
    }
  }

  const questions = makeLocalQuizQuestions(cleanedManualText, safeCount);
  if (!questions.length) return res.status(500).json({ error: '有効な問題が生成されませんでした。マニュアル本文を長めに入力してください。' });
  console.log('AI provider fallback: Local rule-based generator', errors.join(' / '));
  return res.json({ questions, provider: 'Local rule-based generator', warning: errors.length ? errors.join(' / ') : undefined });
});

app.post('/api/sets', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { manualName, questions } = req.body;
  if (!manualName || !questions?.length) return res.status(400).json({ error: 'データが不足しています' });
  const set = {
    id: crypto.randomUUID(),
    manualName: manualName.trim(),
    questions: questions.map(q => ({ ...q, id: crypto.randomUUID() })),
    active: true,
    createdAt: new Date().toISOString(),
  };
  const all = await loadSets();
  all.unshift(set);
  await saveSets(all);
  res.json(set);
});

app.put('/api/sets/:id', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const all = await loadSets();
  const i = all.findIndex(s => s.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '見つかりません' });
  all[i] = { ...all[i], manualName: req.body.manualName, questions: req.body.questions };
  await saveSets(all);
  res.json(all[i]);
});

app.patch('/api/sets/:id/active', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const all = await loadSets();
  const i = all.findIndex(s => s.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '見つかりません' });
  all[i] = { ...all[i], active: req.body.active };
  await saveSets(all);
  res.json(all[i]);
});

app.delete('/api/sets/:id', async (req, res) => {
  if (!checkAuth(req, res)) return;
  await saveSets((await loadSets()).filter(s => s.id !== req.params.id));
  res.json({ ok: true });
});

app.post('/api/sets/:id/submit', async (req, res) => {
  const all = await loadSets();
  const set = all.find(s => s.id === req.params.id);
  if (!set) return res.status(404).json({ error: '見つかりません' });
  const { staffName, answers } = req.body;
  if (!staffName || !answers) return res.status(400).json({ error: 'データが不足しています' });

  const results = set.questions.map(q => {
    const userAnswer = answers[q.id];
    let isCorrect = false;
    if (q.type === 'truefalse') {
      isCorrect = String(q.answer) === String(userAnswer);
    } else if (q.type === 'choice') {
      isCorrect = String(q.answer).trim() === String(userAnswer || '').trim();
    } else if (q.type === 'fill') {
      const correct = Array.isArray(q.answer) ? q.answer : [q.answer];
      const user = Array.isArray(userAnswer) ? userAnswer : [userAnswer || ''];
      isCorrect = correct.length === user.length &&
        correct.every((a, i) => normalizeAns(a) === normalizeAns(user[i] || ''));
    } else if (q.type === 'sort') {
      const correct = Array.isArray(q.options) ? q.options : [];
      const user = Array.isArray(userAnswer) ? userAnswer : [];
      isCorrect = JSON.stringify(correct) === JSON.stringify(user);
    }
    return {
      questionId: q.id, type: q.type, question: q.question,
      userAnswer, correctAnswer: q.answer, isCorrect, explanation: q.explanation,
    };
  });

  const score = results.filter(r => r.isCorrect).length;
  const sub = {
    id: crypto.randomUUID(),
    setId: set.id,
    manualName: set.manualName,
    staffName: staffName.trim(),
    results, score,
    total: set.questions.length,
    submittedAt: new Date().toISOString(),
  };
  const subs = await loadSubs();
  subs.unshift(sub);
  await saveSubs(subs);
  res.json(sub);
});

app.get('/api/submissions', async (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json(await loadSubs());
});

app.patch('/api/submissions/:id', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const subs = await loadSubs();
  const i = subs.findIndex(s => s.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '見つかりません' });
  const { results } = req.body;
  if (!Array.isArray(results)) return res.status(400).json({ error: 'resultsが必要です' });
  subs[i] = { ...subs[i], results, score: results.filter(r => r.isCorrect).length };
  await saveSubs(subs);
  res.json(subs[i]);
});

app.delete('/api/submissions/:id', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const subs = await loadSubs();
  const filtered = subs.filter(s => s.id !== req.params.id);
  if (filtered.length === subs.length) return res.status(404).json({ error: '見つかりません' });
  await saveSubs(filtered);
  res.json({ ok: true });
});

app.get('/api/staff/public', async (req, res) => {
  const staff = await loadStaff();
  res.json(staff.map(s => ({ id: s.id, name: s.name })));
});

app.get('/api/staff', async (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json(await loadStaff());
});

app.post('/api/staff', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '名前が必要です' });
  const staff = await loadStaff();
  if (staff.some(s => s.name === name.trim())) return res.status(400).json({ error: '同じ名前が既に登録されています' });
  const member = { id: crypto.randomUUID(), name: name.trim() };
  staff.push(member);
  await saveStaff(staff);
  res.json(member);
});

app.delete('/api/staff/:id', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const staff = await loadStaff();
  const filtered = staff.filter(s => s.id !== req.params.id);
  if (filtered.length === staff.length) return res.status(404).json({ error: '見つかりません' });
  await saveStaff(filtered);
  res.json({ ok: true });
});

app.put('/api/staff', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { staff } = req.body;
  if (!Array.isArray(staff)) return res.status(400).json({ error: 'staffが必要です' });
  await saveStaff(staff);
  res.json({ ok: true });
});

app.get('/api/manual-list', async (req, res) => {
  if (!checkAuth(req, res)) return;
  if (!MANUAL_API_URL || !MANUAL_API_KEY) return res.status(503).json({ error: 'マニュアル連携が設定されていません' });
  try {
    const r = await axios.get(`${MANUAL_API_URL}/api/quiz/manuals`, {
      headers: { 'x-quiz-api-key': MANUAL_API_KEY },
      timeout: 10000,
    });
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error: 'マニュアル取得エラー: ' + (err.response?.data?.error || err.message) });
  }
});

app.get('/api/manual-text/:id', async (req, res) => {
  if (!checkAuth(req, res)) return;
  if (!MANUAL_API_URL || !MANUAL_API_KEY) return res.status(503).json({ error: 'マニュアル連携が設定されていません' });
  try {
    const r = await axios.get(`${MANUAL_API_URL}/api/quiz/manuals/${req.params.id}/text`, {
      headers: { 'x-quiz-api-key': MANUAL_API_KEY },
      timeout: 30000,
    });
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error: 'テキスト取得エラー: ' + (err.response?.data?.error || err.message) });
  }
});

app.get('/admin', (_, res) => res.redirect('/quiz-admin.html'));
app.get('/quiz', (_, res) => res.redirect('/quiz.html'));
app.get('/health', (_, res) => res.send('OK'));

app.listen(PORT, () => console.log(`クイズサーバー起動: port=${PORT}`));
