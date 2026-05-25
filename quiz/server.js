const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const QUIZ_ADMIN_PASSWORD = process.env.QUIZ_ADMIN_PASSWORD || 'admin';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MANUAL_API_URL = process.env.MANUAL_API_URL || '';
const MANUAL_API_KEY = process.env.MANUAL_API_KEY || '';
const MONGODB_URI = process.env.MONGODB_URI || '';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// ========== Storage (MongoDB with file fallback) ==========
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

// ========== Helpers ==========
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
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return text.substring(start, i + 1);
    }
  }
  return null;
}

// ========== Routes ==========
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

function extractKeyTerms(text) {
  const terms = new Set();
  (text.match(/[ァ-ヶー]{2,}/g) || []).forEach(t => terms.add(t));
  (text.match(/[一-鿿][一-鿿぀-ゟ]{1,}/g) || []).forEach(t => terms.add(t));
  return [...terms].slice(0, 25).join('、');
}

function cleanManualText(text) {
  return text
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return false;
      if (/^https?:\/\//i.test(t)) return false;
      if (/^View online/i.test(t)) return false;
      if (/^Update\s*[:：]/i.test(t)) return false;
      if (/^Exported\s*[:：]/i.test(t)) return false;
      if (/^Created\s*[:：]/i.test(t)) return false;
      if (/^Author\s*[:：]/i.test(t)) return false;
      if (/^\d{4}\.\d{2}\.\d{2}/.test(t)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

app.post('/api/generate', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { manualText, count = 5 } = req.body;
  if (!manualText) return res.status(400).json({ error: 'manualTextが必要です' });
  if (!OPENROUTER_API_KEY && !GEMINI_API_KEY && !GROQ_API_KEY) return res.status(500).json({ error: 'API_KEYが設定されていません（OPENROUTER_API_KEYを設定してください）' });

  const cleanedText = cleanManualText(manualText);
  if (!cleanedText) return res.status(400).json({ error: 'マニュアルテキストに有効な内容がありません' });

  const keyTerms = extractKeyTerms(cleanedText);

  const prompt = `以下のマニュアルテキストの内容だけを根拠にして、クイズを${count}問作成してください。マニュアルに書かれていない情報は使わないでください。\n\nマニュアルテキスト:\n${cleanedText}\n\n重要キーワード（問題文か選択肢に必ず含めること）: ${keyTerms}\n\n問題タイプを混ぜて作成してください:\n- truefalse: ○×問題。answerは"true"または"false"\n- choice: 4択問題。optionsは4つの選択肢配列、answerは正解テキスト\n- fill: 穴埋め問題。問題文に___を使う、answerは答えの配列\n- sort: 手順並び替え。questionは「〇〇の手順を正しい順番に並べてください」形式、optionsは3〜5ステップの配列、answerはoptionsと同じ順の配列\n\n{"questions": [{"type":"...","question":"...","options":[...],"answer":"...","explanation":"..."}]}`;

  try {
    let raw = [];

    if (OPENROUTER_API_KEY) {
      const orRes = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'deepseek/deepseek-chat-v3-0324:free',
          messages: [
            { role: 'system', content: 'あなたはクイズ作成AIです。与えられたマニュアルテキストの内容だけを根拠に問題を作成してください。{"questions":[...]}形式のJSONのみ返してください。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        },
        {
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://nobinobi-quiz.onrender.com',
            'X-Title': 'Nobinobi Quiz',
          },
          timeout: 60000,
        }
      );
      const rawContent = orRes.data.choices[0].message.content;
      console.log('OpenRouter raw response:', rawContent.substring(0, 500));
      const parsed = JSON.parse(rawContent);
      raw = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : []);
    } else if (GEMINI_API_KEY) {
      const gRes = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
        },
        { timeout: 60000 }
      );
      const rawContent = gRes.data.candidates[0].content.parts[0].text;
      console.log('Gemini raw response:', rawContent.substring(0, 500));
      const parsed = JSON.parse(rawContent);
      raw = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : []);
    } else {
      const gqRes = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'あなたはクイズ作成AIです。マニュアルテキストの内容だけを根拠に問題を作成してください。{"questions":[...]}形式のJSONのみ返してください。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
        },
        { headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, timeout: 60000 }
      );
      const rawContent = gqRes.data.choices[0].message.content;
      console.log('Groq raw response:', rawContent.substring(0, 500));
      const jsonStr = extractJsonArray(rawContent);
      if (!jsonStr) throw new Error('JSON配列が見つかりませんでした');
      const parsed = JSON.parse(jsonStr);
      raw = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : []);
    }

    const questions = raw.map(q => {
      const questionText =
        q.question || q.text || q.content || q.question_text ||
        q['問題'] || q['問題文'] || q['質問'] || '';
      const explanation =
        q.explanation || q.reason || q.description ||
        q['解説'] || q['説明'] || '';
      let options = q.options || q.choices || q.selections || q['選択肢'] || [];
      if (!Array.isArray(options)) {
        options = (options && typeof options === 'object') ? Object.values(options) : [];
      }
      const type = q.type || q['タイプ'] || q['種類'] || 'truefalse';
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
      const answer =
        q.answer != null ? q.answer :
        q.correct_answer != null ? q.correct_answer :
        q.correct != null ? q.correct :
        q['答え'] != null ? q['答え'] :
        q['正解'] != null ? q['正解'] : '';
      const finalAnswer = (type === 'sort' && !Array.isArray(answer)) ? [...options] : answer;
      return { type, question: questionText, options, answer: finalAnswer, explanation };
    }).filter(q => q.question && String(q.question).trim().length > 0);

    if (!questions.length) return res.status(500).json({ error: '有効な問題が生成されませんでした。もう一度お試しください。' });
    res.json({ questions });
  } catch (err) {
    console.error('AI generate error:', err.response?.data || err.message);
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
