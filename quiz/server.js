const express = require('express');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const QUIZ_ADMIN_PASSWORD = process.env.QUIZ_ADMIN_PASSWORD || 'admin';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const MANUAL_API_URL = process.env.MANUAL_API_URL || '';
const MANUAL_API_KEY = process.env.MANUAL_API_KEY || '';
const MONGODB_URI = process.env.MONGODB_URI || '';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// ========== DB ==========
let _db = null;
async function getDb() {
  if (!_db) {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    _db = client.db('nobinobi-quiz');
    console.log('MongoDB接続完了');
  }
  return _db;
}

async function loadSets() {
  try {
    const db = await getDb();
    const doc = await db.collection('data').findOne({ _id: 'sets' });
    return doc ? doc.data : [];
  } catch (e) { console.error('loadSets error:', e.message); return []; }
}
async function saveSets(d) {
  const db = await getDb();
  await db.collection('data').updateOne({ _id: 'sets' }, { $set: { data: d } }, { upsert: true });
}
async function loadSubs() {
  try {
    const db = await getDb();
    const doc = await db.collection('data').findOne({ _id: 'subs' });
    return doc ? doc.data : [];
  } catch (e) { console.error('loadSubs error:', e.message); return []; }
}
async function saveSubs(d) {
  const db = await getDb();
  await db.collection('data').updateOne({ _id: 'subs' }, { $set: { data: d } }, { upsert: true });
}

function checkAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) { res.status(401).json({ error: 'unauthorized' }); return false; }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const pass = decoded.indexOf(':') >= 0 ? decoded.slice(decoded.indexOf(':') + 1) : '';
  if (pass !== QUIZ_ADMIN_PASSWORD) { res.status(401).json({ error: 'wrong password' }); return false; }
  return true;
}

function extractJsonArray(text) {
  const start = text.indexOf('[');
  if (start === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return text.substring(start, i + 1); }
  }
  return null;
}

function cleanManualText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => {
    if (!l || l.length < 8) return false;
    if (/^https?:\/\//.test(l)) return false;
    if (/^(Update|Exported|Created|Modified|Author|Date|Version)[:：]/i.test(l)) return false;
    if (/^[□■●○◆◇▶▼▲►◄→←・\-=_\*\/\\|#\s]+$/.test(l)) return false;
    if (/^[\d\s/]+$/.test(l)) return false;
    if (/^\d{4}[.\/\-]\d{2}[.\/\-]\d{2}/.test(l)) return false;
    return true;
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').substring(0, 4000);
}

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'quiz-admin.html')));
app.get('/quiz', (req, res) => res.sendFile(path.join(__dirname, 'public', 'quiz.html')));

app.get('/api/sets', async (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json(await loadSets());
});

app.get('/api/sets/public', async (req, res) => {
  const sets = (await loadSets()).map(s => ({
    id: s.id,
    manualName: s.manualName,
    questionCount: s.questions.length,
    createdAt: s.createdAt,
    questions: s.questions.map(({ id, type, question, options }) => ({ id, type, question, options })),
  }));
  res.json(sets);
});

app.post('/api/generate', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { manualText, count = 5 } = req.body;
  if (!manualText) return res.status(400).json({ error: 'manualTextが必要です' });
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEYが設定されていません' });

  const cleanedText = cleanManualText(manualText);
  if (cleanedText.length < 50) return res.status(400).json({ error: 'マニュアルの内容が少なすぎます。もっと内容のあるテキストを貼り付けてください' });

  const prompt = `Read the following manual text and create ${count} quiz questions for staff training.

Manual text:
${cleanedText}

Create a mix of these question types:
- truefalse: true/false question (answer is "true" or "false")
- choice: multiple choice with 4 options (answer is the correct option text)
- fill: fill-in-the-blank with ___ in Japanese (answer is array of words)
- sort: arrange steps in correct order (options and answer are arrays)

Write questions in Japanese. Return ONLY a JSON array, no other text:
[{"type":"...","question":"...","options":[...],"answer":"...","explanation":"..."}]`;

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: 'llama-3.3-70b-versatile', messages: [
        { role: 'system', content: 'You are a quiz generator. Always respond with valid JSON arrays only, no explanations.' },
        { role: 'user', content: prompt },
      ], temperature: 0.7 },
      { headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, timeout: 60000 }
    );
    const text = response.data.choices[0].message.content;
    const jsonStr = extractJsonArray(text);
    if (!jsonStr) throw new Error('JSON配列が見つかりませんでした');
    const parsed = JSON.parse(jsonStr);
    const raw = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : []);
    const questions = raw.map(q => {
      const questionText = q.question || q.text || q['問題'] || q['問題文'] || '';
      const explanation = q.explanation || q['解説'] || '';
      let options = q.options || q.choices || q['選択肢'] || [];
      if (!Array.isArray(options)) options = (options && typeof options === 'object') ? Object.values(options) : [];
      const answer = q.answer != null ? q.answer : q['答え'] != null ? q['答え'] : q['正解'] != null ? q['正解'] : '';
      return { type: q.type || 'truefalse', question: questionText, options, answer, explanation };
    }).filter(q => q.question && String(q.question).trim().length > 0);

    if (questions.length === 0) return res.status(500).json({ error: 'AIが問題を生成できませんでした。テキストの内容を充実させてください' });
    res.json({ questions });
  } catch (err) {
    console.error('Groq error:', err.response?.data || err.message);
    res.status(500).json({ error: 'AI生成エラー: ' + (err.response?.data?.error?.message || err.message) });
  }
});

app.post('/api/sets', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { manualName, questions } = req.body;
  if (!manualName || !questions?.length) return res.status(400).json({ error: 'データが不足しています' });
  const set = {
    id: crypto.randomUUID(),
    manualName: manualName.trim(),
    questions: questions.map(q => ({ ...q, id: crypto.randomUUID() })),
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

app.delete('/api/sets/:id', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const all = await loadSets();
  await saveSets(all.filter(s => s.id !== req.params.id));
  res.json({ ok: true });
});

app.post('/api/sets/:id/submit', async (req, res) => {
  const sets = await loadSets();
  const set = sets.find(s => s.id === req.params.id);
  if (!set) return res.status(404).json({ error: '見つかりません' });
  const { staffName, answers } = req.body;
  if (!staffName || !answers) return res.status(400).json({ error: 'データが不足しています' });

  const results = set.questions.map(q => {
    const userAnswer = answers[q.id];
    let isCorrect = false;
    if (q.type === 'truefalse') isCorrect = String(q.answer) === String(userAnswer);
    else if (q.type === 'choice') isCorrect = String(q.answer).trim() === String(userAnswer || '').trim();
    else if (q.type === 'fill') {
      const correct = Array.isArray(q.answer) ? q.answer : [q.answer];
      const user = Array.isArray(userAnswer) ? userAnswer : [userAnswer || ''];
      isCorrect = correct.length === user.length && correct.every((a, i) => a.trim().toLowerCase() === (user[i] || '').trim().toLowerCase());
    } else if (q.type === 'sort') {
      isCorrect = JSON.stringify(Array.isArray(q.options) ? q.options : []) === JSON.stringify(Array.isArray(userAnswer) ? userAnswer : []);
    }
    return { questionId: q.id, type: q.type, question: q.question, userAnswer, correctAnswer: q.answer, isCorrect, explanation: q.explanation };
  });

  const score = results.filter(r => r.isCorrect).length;
  const sub = { id: crypto.randomUUID(), setId: set.id, manualName: set.manualName, staffName: staffName.trim(), results, score, total: set.questions.length, submittedAt: new Date().toISOString() };
  const subs = await loadSubs();
  subs.unshift(sub);
  await saveSubs(subs);
  res.json(sub);
});

app.get('/api/submissions', async (req, res) => {
  if (!checkAuth(req, res)) return;
  res.json(await loadSubs());
});

app.get('/api/manual-list', async (req, res) => {
  if (!checkAuth(req, res)) return;
  if (!MANUAL_API_URL || !MANUAL_API_KEY) return res.status(503).json({ error: 'マニュアル連携が設定されていません' });
  try {
    const r = await axios.get(`${MANUAL_API_URL}/api/quiz/manuals`, { headers: { 'x-quiz-api-key': MANUAL_API_KEY }, timeout: 10000 });
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: 'マニュアル取得エラー: ' + (err.response?.data?.error || err.message) }); }
});

app.get('/api/manual-text/:id', async (req, res) => {
  if (!checkAuth(req, res)) return;
  if (!MANUAL_API_URL || !MANUAL_API_KEY) return res.status(503).json({ error: 'マニュアル連携が設定されていません' });
  try {
    const r = await axios.get(`${MANUAL_API_URL}/api/quiz/manuals/${req.params.id}/text`, { headers: { 'x-quiz-api-key': MANUAL_API_KEY }, timeout: 30000 });
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: 'テキスト取得エラー: ' + (err.response?.data?.error || err.message) }); }
});

app.get('/health', (_, res) => res.send('OK'));

app.listen(PORT, () => console.log(`クイズサーバー起動: port=${PORT}`));
