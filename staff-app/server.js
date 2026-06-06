const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const MONGODB_URI = process.env.MONGODB_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD + '_staff_session';
const DB_FILE = path.join(__dirname, 'data', 'records.json');
const ACCOUNTS_FILE = path.join(__dirname, 'data', 'staff_accounts.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB接続
let mongoCol = null;
let staffNamesCol = null;
let staffSettingsCol = null;
let staffAccountsCol = null;
let actionItemsCol = null;
if (MONGODB_URI) {
  const client = new MongoClient(MONGODB_URI);
  client.connect()
    .then(() => {
      mongoCol = client.db('nobinobi').collection('staff_records');
      staffNamesCol = client.db('nobinobi').collection('staff_names');
      staffSettingsCol = client.db('nobinobi').collection('staff_settings');
      staffAccountsCol = client.db('nobinobi').collection('staff_accounts');
      actionItemsCol = client.db('nobinobi').collection('action_items');
      console.log('MongoDB接続成功');
    })
    .catch(err => console.error('MongoDB接続失敗（JSONファイルで継続）:', err.message));
}

// パスワードハッシュ
function hashPassword(password) {
  return crypto.pbkdf2Sync(password, 'nobinobi-dental-salt', 1000, 32, 'sha256').toString('hex');
}

// セッショントークン（スタッフ用）
function createStaffToken(staffName) {
  const payload = Buffer.from(staffName).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
function verifyStaffToken(token) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  if (sig !== expected) return null;
  try { return Buffer.from(payload, 'base64url').toString('utf8'); } catch { return null; }
}
function getStaffFromReq(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/staffSession=([^;]+)/);
  if (!match) return null;
  return verifyStaffToken(decodeURIComponent(match[1]));
}

// スタッフアカウント操作
async function loadStaffAccounts() {
  if (staffAccountsCol) return await staffAccountsCol.find({}).toArray();
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); } catch { return []; }
}
async function getStaffAccountByEmail(email) {
  if (staffAccountsCol) return await staffAccountsCol.findOne({ email });
  return (await loadStaffAccounts()).find(a => a.email === email) || null;
}
async function getStaffAccount(staffName) {
  if (staffAccountsCol) return await staffAccountsCol.findOne({ staffName });
  return (await loadStaffAccounts()).find(a => a.staffName === staffName) || null;
}
async function upsertStaffAccount(staffName, passwordHash, email) {
  const doc = { staffName, passwordHash };
  if (email !== undefined) doc.email = email;
  if (staffAccountsCol) {
    await staffAccountsCol.updateOne({ staffName }, { $set: doc }, { upsert: true });
    return;
  }
  const list = await loadStaffAccounts();
  const idx = list.findIndex(a => a.staffName === staffName);
  if (idx >= 0) Object.assign(list[idx], doc);
  else list.push(doc);
  fs.mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(list, null, 2));
}

// スタッフ認証ミドルウェア（ログイン必須ルート用）
function requireStaffAuth(req, res, next) {
  const staff = getStaffFromReq(req);
  if (!staff) return res.redirect('/staff-login');
  req.staffName = staff;
  next();
}

const NAMES_FILE = path.join(__dirname, 'data', 'staff_names.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'staff_settings.json');
const ITEMS_FILE = path.join(__dirname, 'data', 'action_items.json');
const CONFIG_FILE = path.join(__dirname, 'data', 'action_config.json');

const DEFAULT_GROUPS = ['物品', 'カウンセリング', 'アポ管理', '口コミ', '処置', 'チームサポート', 'その他'];
const DEFAULT_CATEGORIES = [
  { id: 'item', label: '物品販売' },
  { id: 'item_recommend', label: '物品すすめ' },
  { id: 'counseling', label: '成約' },
  { id: 'counseling_approach', label: 'ジャブ打ち' },
  { id: 'appointment', label: 'アポ転換' },
  { id: 'review', label: '口コミ' },
  { id: 'treatment', label: '処置・その他' },
  { id: 'team_support', label: 'チームサポート' },
];

async function loadActionConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
  return { groups: [...DEFAULT_GROUPS], categories: DEFAULT_CATEGORIES.map(c => ({...c})) };
}
async function saveActionConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

app.get('/api/action-config', async (req, res) => res.json(await loadActionConfig()));

app.post('/admin/action-config/groups', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const config = await loadActionConfig();
  if (!config.groups.includes(name.trim())) config.groups.push(name.trim());
  await saveActionConfig(config);
  res.json({ ok: true });
});
app.delete('/admin/action-config/groups/:name', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const config = await loadActionConfig();
  config.groups = config.groups.filter(g => g !== decodeURIComponent(req.params.name));
  await saveActionConfig(config);
  res.json({ ok: true });
});
app.post('/admin/action-config/categories', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'label required' });
  const config = await loadActionConfig();
  const id = 'cat_' + Date.now();
  config.categories.push({ id, label: label.trim() });
  await saveActionConfig(config);
  res.json({ ok: true, id });
});
app.delete('/admin/action-config/categories/:id', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const config = await loadActionConfig();
  config.categories = config.categories.filter(c => c.id !== req.params.id);
  await saveActionConfig(config);
  res.json({ ok: true });
});

const DEFAULT_ACTION_ITEMS = [
  { id: 'i01', name: '物品を販売した（購入）', group: '物品', category: 'item', needsPatient: true, showItemName: true, builtin: true },
  { id: 'i02', name: '物品をすすめた（未購入）', group: '物品', category: 'item_recommend', needsPatient: true, showItemName: true, builtin: true },
  { id: 'i03', name: 'インプラントジャブ打ち', group: 'カウンセリング', category: 'counseling_approach', needsPatient: true, builtin: true },
  { id: 'i04', name: 'マウスピース矯正ジャブ打ち', group: 'カウンセリング', category: 'counseling_approach', needsPatient: true, builtin: true },
  { id: 'i05', name: 'ホワイトニングジャブ打ち', group: 'カウンセリング', category: 'counseling_approach', needsPatient: true, builtin: true },
  { id: 'i06', name: 'インプラント成約', group: 'カウンセリング', category: 'counseling', needsPatient: true, builtin: true },
  { id: 'i07', name: 'マウスピース矯正成約', group: 'カウンセリング', category: 'counseling', needsPatient: true, builtin: true },
  { id: 'i08', name: 'ホワイトニング成約', group: 'カウンセリング', category: 'counseling', needsPatient: true, builtin: true },
  { id: 'i09', name: 'アポ転換', group: 'アポ管理', category: 'appointment', needsPatient: true, builtin: true },
  { id: 'i10', name: '口コミ獲得', group: '口コミ', category: 'review', needsPatient: true, isKuchikomi: true, builtin: true },
  { id: 'i11', name: 'シーラント', group: '処置', category: 'treatment', needsPatient: true, builtin: true },
  { id: 'i12', name: 'レントゲン', group: '処置', category: 'treatment', needsPatient: true, builtin: true },
  { id: 'i13', name: 'フッ素塗布', group: '処置', category: 'treatment', needsPatient: true, builtin: true },
  { id: 'i14', name: 'ポジティブ声掛け', group: 'チームサポート', category: 'team_support', needsFreeText: true, builtin: true },
];

async function loadActionItems() {
  if (actionItemsCol) {
    const items = await actionItemsCol.find({}).sort({ order: 1, _id: 1 }).toArray();
    return items.length ? items : DEFAULT_ACTION_ITEMS;
  }
  try {
    const items = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8'));
    return items.length ? items : DEFAULT_ACTION_ITEMS;
  } catch { return DEFAULT_ACTION_ITEMS; }
}
async function saveActionItem(item) {
  if (actionItemsCol) { await actionItemsCol.insertOne(item); return; }
  const list = await loadActionItems();
  list.push(item);
  fs.mkdirSync(path.dirname(ITEMS_FILE), { recursive: true });
  fs.writeFileSync(ITEMS_FILE, JSON.stringify(list, null, 2));
}
async function deleteActionItem(id) {
  if (actionItemsCol) { await actionItemsCol.deleteOne({ id }); return; }
  const list = await loadActionItems();
  fs.writeFileSync(ITEMS_FILE, JSON.stringify(list.filter(i => i.id !== id), null, 2));
}

async function loadStaffSettings() {
  if (staffSettingsCol) return await staffSettingsCol.find({}).toArray();
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return []; }
}
async function saveStaffSetting(staffName, fields) {
  if (staffSettingsCol) {
    await staffSettingsCol.updateOne({ staffName }, { $set: { staffName, ...fields } }, { upsert: true });
    return;
  }
  const list = await loadStaffSettings();
  const idx = list.findIndex(s => s.staffName === staffName);
  if (idx >= 0) Object.assign(list[idx], fields);
  else list.push({ staffName, ...fields });
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(list, null, 2));
}

// アクション項目API
app.get('/api/action-items', async (req, res) => {
  res.json(await loadActionItems());
});
app.post('/admin/action-items', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { name, group, needsPatient, needsFreeText, showItemName } = req.body;
  if (!name || !group) return res.status(400).json({ error: '必須項目が不足しています' });
  const id = 'c' + Date.now();
  const item = { id, name: name.trim(), group: group.trim(), category: 'treatment', needsPatient: !!needsPatient, needsFreeText: !!needsFreeText, showItemName: !!showItemName, builtin: false };
  await saveActionItem(item);
  res.json({ ok: true, item });
});
app.put('/admin/action-items/:id', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { name, group, needsPatient, needsFreeText, showItemName } = req.body;
  if (!name || !group) return res.status(400).json({ error: '必須項目が不足しています' });
  const items = await loadActionItems();
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  items[idx] = { ...items[idx], name: name.trim(), group: group.trim(), needsPatient: !!needsPatient, needsFreeText: !!needsFreeText, showItemName: !!showItemName };
  // 全件上書き保存（標準項目をDBに書き込む場合も対応）
  if (actionItemsCol) {
    await actionItemsCol.deleteMany({});
    if (items.length) await actionItemsCol.insertMany(items.map(i => { const d = {...i}; delete d._id; return d; }));
  } else {
    fs.mkdirSync(path.dirname(ITEMS_FILE), { recursive: true });
    fs.writeFileSync(ITEMS_FILE, JSON.stringify(items, null, 2));
  }
  res.json({ ok: true });
});

app.delete('/admin/action-items/:id', async (req, res) => {
  if (!checkAuth(req, res)) return;
  // 標準項目を削除する場合も全件上書き
  const items = await loadActionItems();
  const filtered = items.filter(i => i.id !== req.params.id);
  if (actionItemsCol) {
    await actionItemsCol.deleteMany({});
    if (filtered.length) await actionItemsCol.insertMany(filtered.map(i => { const d = {...i}; delete d._id; return d; }));
  } else {
    fs.mkdirSync(path.dirname(ITEMS_FILE), { recursive: true });
    fs.writeFileSync(ITEMS_FILE, JSON.stringify(filtered, null, 2));
  }
  res.json({ ok: true });
});

// 目標設定API（管理者用）
app.get('/api/goals', async (req, res) => {
  const settings = await loadStaffSettings();
  const goals = {};
  settings.forEach(s => { if (s.goals) goals[s.staffName] = s.goals; });
  res.json(goals);
});
// 全データ削除
// 管理者：アカウント一覧取得
app.get('/api/admin/accounts', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const accounts = await loadStaffAccounts();
  res.json(accounts.map(a => ({ staffName: a.staffName, email: a.email || '', lastLogin: a.lastLogin || null })));
});

// 管理者：スタッフ追加（名前登録＋アカウント作成を同時に）
app.post('/admin/add-staff', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { staffName, email, password } = req.body;
  if (!staffName || !email || !password) return res.status(400).json({ error: '全項目を入力してください' });
  if (password.length < 4) return res.status(400).json({ error: 'パスワードは4文字以上' });
  await addStaffName(staffName.trim());
  await upsertStaffAccount(staffName.trim(), hashPassword(password), email.trim().toLowerCase());
  res.json({ ok: true });
});

// 管理者：個別アカウント設定（メール・パスワード）
app.post('/admin/reset-password', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { staffName, password, email } = req.body;
  if (!staffName) return res.status(400).json({ error: 'invalid' });
  const existing = await getStaffAccount(staffName);
  const newHash = password ? hashPassword(password) : (existing ? existing.passwordHash : hashPassword('nobinobi'));
  await upsertStaffAccount(staffName, newHash, email !== undefined ? email.trim().toLowerCase() : undefined);
  res.json({ ok: true });
});

// 管理者：全員を共通パスワードに設定
app.post('/admin/reset-all-passwords', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'invalid' });
  const names = await loadStaffNames();
  const accounts = await loadStaffAccounts();
  await Promise.all(names.map(n => {
    const existing = accounts.find(a => a.staffName === n);
    return upsertStaffAccount(n, hashPassword(password), existing ? existing.email : undefined);
  }));
  res.json({ ok: true, count: names.length });
});

app.delete('/admin/all-records', async (req, res) => {
  if (!checkAuth(req, res)) return;
  if (mongoCol) {
    await mongoCol.deleteMany({});
  } else {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, '[]');
  }
  console.log('全レコード削除');
  res.json({ ok: true });
});

app.post('/admin/goals', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { staffName, goals } = req.body;
  if (!staffName || !goals) return res.status(400).json({ error: 'invalid' });
  await saveStaffSetting(staffName, { goals });
  res.json({ ok: true });
});

async function loadStaffNames() {
  if (staffNamesCol) {
    const docs = await staffNamesCol.find({}).sort({ name: 1 }).toArray();
    return docs.map(d => d.name);
  }
  try { return JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8')); } catch { return []; }
}

async function addStaffName(name) {
  if (staffNamesCol) {
    await staffNamesCol.updateOne({ name }, { $set: { name } }, { upsert: true });
    return;
  }
  const names = await loadStaffNames();
  if (!names.includes(name)) {
    names.push(name);
    names.sort();
    fs.mkdirSync(path.dirname(NAMES_FILE), { recursive: true });
    fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 2));
  }
}

async function deleteStaffName(name) {
  if (staffNamesCol) {
    await staffNamesCol.deleteOne({ name });
    return;
  }
  const names = (await loadStaffNames()).filter(n => n !== name);
  fs.mkdirSync(path.dirname(NAMES_FILE), { recursive: true });
  fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 2));
}

async function loadDB() {
  if (mongoCol) {
    return await mongoCol.find({}).sort({ createdAt: -1 }).toArray();
  }
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; }
}

async function saveRecord(record) {
  if (mongoCol) {
    await mongoCol.insertOne(record);
    return;
  }
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    const records = (() => { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; } })();
    records.unshift(record);
    fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2), 'utf8');
  } catch (err) { console.error('DB保存エラー:', err.message); }
}

function checkAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    res.status(401).send('認証が必要です');
    return false;
  }
  const pass = Buffer.from(auth.slice(6), 'base64').toString().slice(
    Buffer.from(auth.slice(6), 'base64').toString().indexOf(':') + 1
  );
  if (pass !== ADMIN_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    res.status(401).send('パスワードが違います');
    return false;
  }
  return true;
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// スタッフ名一覧（プルダウン用）
// ===== スタッフログイン =====
app.get('/staff-login', (req, res) => {
  const staff = getStaffFromReq(req);
  if (staff) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/staff-login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'invalid' });
  const account = await getStaffAccountByEmail(email.trim().toLowerCase());
  if (!account) return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います。' });
  if (account.passwordHash !== hashPassword(password)) return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います。' });
  const token = createStaffToken(account.staffName);
  res.setHeader('Set-Cookie', `staffSession=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  // 最終ログイン時刻を記録
  if (staffAccountsCol) {
    staffAccountsCol.updateOne({ staffName: account.staffName }, { $set: { lastLogin: new Date().toISOString() } }).catch(()=>{});
  }
  res.json({ ok: true });
});

app.post('/staff-change-password', async (req, res) => {
  const staffName = getStaffFromReq(req);
  if (!staffName) return res.status(401).json({ error: 'ログインが必要です' });
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'invalid' });
  const account = await getStaffAccount(staffName);
  if (!account || account.passwordHash !== hashPassword(currentPassword)) return res.status(401).json({ error: '現在のパスワードが違います' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'パスワードは4文字以上にしてください' });
  await upsertStaffAccount(staffName, hashPassword(newPassword));
  res.json({ ok: true });
});

app.get('/staff-logout', (req, res) => {
  res.setHeader('Set-Cookie', 'staffSession=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.redirect('/staff-login');
});

// ログイン中スタッフ名を返す
app.get('/api/me', (req, res) => {
  const staff = getStaffFromReq(req);
  res.json({ staffName: staff || null });
});

app.get('/api/staff-names', async (req, res) => {
  res.json(await loadStaffNames());
});

// スタッフ名追加（管理画面から）
app.post('/admin/staff-names', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'invalid' });
  await addStaffName(name.trim());
  res.json({ ok: true });
});

// スタッフ名削除（管理画面から）
app.delete('/admin/staff-names/:name', async (req, res) => {
  if (!checkAuth(req, res)) return;
  await deleteStaffName(decodeURIComponent(req.params.name));
  res.json({ ok: true });
});

// 最近の入力を全員分返す（フォーム画面用）
app.get('/api/records', async (req, res) => {
  const records = await loadDB();
  res.json(records.slice(0, 50).map(r => ({
    date: r.date,
    staffName: r.staffName,
    patientNo: r.patientNo || '',
    entryType: r.entryType || 'patient',
    action: r.action || '',
    actionCategory: r.actionCategory || '',
    itemName: r.itemName || '',
    otherText: r.otherText || '',
    freeText: r.freeText || '',
  })));
});

// 患者番号の重複チェック（同一患者・同一項目・同一スタッフのみNG）
app.get('/api/check-patient/:patientNo', async (req, res) => {
  const records = await loadDB();
  const { action, staffName } = req.query;
  // action・staffName 指定あり → 完全一致チェック
  if (action && staffName) {
    const exists = records.some(r =>
      r.entryType !== 'behavior' &&
      r.patientNo === req.params.patientNo &&
      r.action === action &&
      r.staffName === staffName
    );
    return res.json({ exists });
  }
  // 指定なし（入力中リアルタイム）→ 患者番号だけで件数を返す
  const count = records.filter(r => r.entryType !== 'behavior' && r.patientNo === req.params.patientNo).length;
  res.json({ exists: false, count });
});

const ACTION_CATEGORY = {
  '物品販売': 'item',
  '物品をすすめた': 'item_recommend',
  '口コミ獲得': 'review',
  'ジャブ打ち': 'counseling_approach',
  'インプラントジャブ打ち': 'counseling_approach',
  'マウスピース矯正ジャブ打ち': 'counseling_approach',
  'ホワイトニングジャブ打ち': 'counseling_approach',
  'インプラント': 'counseling',
  'マウスピース矯正': 'counseling',
  'ホワイトニング': 'counseling',
  'アポ転換': 'appointment',
  'シーラント': 'treatment',
  'レントゲン': 'treatment',
  'フッ素塗布': 'treatment',
  'ポジティブ声掛け': 'team_support',
  'その他': 'treatment',
};

// スタッフ設定API
app.get('/api/staff-settings', async (req, res) => {
  const settings = await loadStaffSettings();
  res.json(settings);
});
app.post('/admin/staff-settings', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { staffName, showKuchikomi } = req.body;
  if (!staffName) return res.status(400).json({ error: 'staffName required' });
  await saveStaffSetting(staffName, { showKuchikomi: !!showKuchikomi });
  res.json({ ok: true });
});
// 項目ON/OFF切り替えAPI
app.post('/admin/staff-item-visible', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { staffName, itemName, visible } = req.body;
  if (!staffName || !itemName) return res.status(400).json({ error: 'required' });
  const settings = await loadStaffSettings();
  const s = settings.find(x => x.staffName === staffName) || {};
  let disabled = s.disabledItems || [];
  if (visible) {
    disabled = disabled.filter(i => i !== itemName);
  } else {
    if (!disabled.includes(itemName)) disabled.push(itemName);
  }
  await saveStaffSetting(staffName, { disabledItems: disabled });
  res.json({ ok: true });
});

app.post('/submit', async (req, res) => {
  const d = req.body;
  // セッションからスタッフ名を取得（フロントが送るstaffNameより優先）
  const sessionStaff = getStaffFromReq(req);
  if (sessionStaff) d.staffName = sessionStaff;
  if (!d || !d.staffName || !d.date) return res.status(400).json({ error: 'staffName/date missing' });

  if (d.entryType === 'behavior') {
    if (!d.freeText) return res.status(400).json({ error: 'invalid data' });
    await saveRecord({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entryType: 'behavior',
      date: d.date,
      staffName: d.staffName.trim(),
      freeText: d.freeText.trim(),
    });
    console.log(`行動記録: ${d.staffName} (${d.date})`);
    return res.status(200).json({ ok: true });
  }

  // 患者実績記録
  if (!d.action) return res.status(400).json({ error: 'invalid data' });
  const patientNo = (d.patientNo || '').trim();
  const records = await loadDB();
  if (patientNo && records.some(r =>
    r.entryType !== 'behavior' &&
    r.patientNo === patientNo &&
    r.action === d.action &&
    r.staffName === d.staffName.trim()
  )) {
    return res.status(409).json({ error: 'duplicate', message: `患者番号 ${patientNo} の「${d.action}」はあなたがすでに登録しています` });
  }

  await saveRecord({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    entryType: 'patient',
    date: d.date,
    staffName: d.staffName.trim(),
    patientNo,
    action: d.action,
    actionCategory: ACTION_CATEGORY[d.action] || 'treatment',
    itemName: d.itemName ? d.itemName.trim() : '',
    otherText: d.otherText ? d.otherText.trim() : '',
  });
  console.log(`患者実績登録: ${d.staffName} 患者${d.patientNo} ${d.action} (${d.date})`);
  res.status(200).json({ ok: true });
});

app.get('/dashboard', async (req, res) => {
  if (!checkAuth(req, res)) return;

  const allRecords = await loadDB();
  const { from, to, staff: staffFilter } = req.query;
  const records = allRecords.filter(r => {
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    if (staffFilter && r.staffName !== staffFilter) return false;
    return true;
  });
  const byStaff = {};
  for (const r of records) {
    if (!byStaff[r.staffName]) {
      byStaff[r.staffName] = { count: 0, itemsMap: {}, recommendMap: {}, counselingMap: {}, approachMap: {}, reviews: 0, treatmentMap: {}, patients: new Set(), freePhrases: [] };
    }
    const s = byStaff[r.staffName];
    s.count++;
    if (r.entryType === 'behavior') {
      if (r.freeText) s.freePhrases.push(r.freeText);
    } else {
      const cat = r.actionCategory || ACTION_CATEGORY[r.action] || 'treatment';
      const label = r.action + (r.itemName ? `（${r.itemName}）` : '') + (r.otherText ? `（${r.otherText}）` : '');
      if (cat === 'item')              s.itemsMap[label] = (s.itemsMap[label] || 0) + 1;
      if (cat === 'item_recommend')    s.recommendMap = s.recommendMap || {}; if (cat === 'item_recommend') s.recommendMap[label] = (s.recommendMap[label] || 0) + 1;
      if (cat === 'counseling')        s.counselingMap[r.action] = (s.counselingMap[r.action] || 0) + 1;
      if (cat === 'counseling_approach') s.approachMap = s.approachMap || {}; if (cat === 'counseling_approach') s.approachMap[r.action] = (s.approachMap[r.action] || 0) + 1;
      if (cat === 'review')            s.reviews++;
      if (cat === 'treatment')         s.treatmentMap[r.action] = (s.treatmentMap[r.action] || 0) + 1;
      if (r.patientNo) s.patients.add(r.patientNo);
    }
  }

  const staffList = Object.entries(byStaff).sort((a, b) => a[0].localeCompare(b[0], 'ja'));

  // 月別集計
  const byStaffMonth = {}; // { staffName: { 'YYYY-MM': { total, items, counseling, reviews } } }
  const allMonthSet = new Set();
  for (const r of records) {
    const month = r.date ? r.date.slice(0, 7) : null;
    if (!month) continue;
    allMonthSet.add(month);
    if (!byStaffMonth[r.staffName]) byStaffMonth[r.staffName] = {};
    if (!byStaffMonth[r.staffName][month]) byStaffMonth[r.staffName][month] = { total: 0, items: 0, counseling: 0, reviews: 0 };
    const sm = byStaffMonth[r.staffName][month];
    sm.total++;
    if (r.entryType !== 'behavior') {
      const cat = r.actionCategory || ACTION_CATEGORY[r.action] || 'treatment';
      if (cat === 'item') sm.items++;
      if (cat === 'counseling') sm.counseling++;
      if (cat === 'review') sm.reviews++;
    }
  }
  const monthKeys = [...allMonthSet].sort().slice(-12);
  const CHART_COLORS = ['#2aab96','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];

  // 全スタッフ折れ線 or 特定スタッフ月別カテゴリ棒
  let chartType, chartTitle, monthDatasets;
  if (staffFilter) {
    chartType = 'bar';
    chartTitle = `${staffFilter} の月別実績内訳`;
    const sm = byStaffMonth[staffFilter] || {};
    monthDatasets = [
      { label: '物品販売', data: monthKeys.map(m => (sm[m]||{}).items||0), backgroundColor: 'rgba(245,158,11,0.85)', borderRadius: 4, stack: 'a' },
      { label: 'カウンセリング', data: monthKeys.map(m => (sm[m]||{}).counseling||0), backgroundColor: 'rgba(59,130,246,0.85)', borderRadius: 4, stack: 'a' },
      { label: '口コミ', data: monthKeys.map(m => (sm[m]||{}).reviews||0), backgroundColor: 'rgba(42,171,150,0.85)', borderRadius: 4, stack: 'a' },
    ];
  } else {
    chartType = 'line';
    chartTitle = 'スタッフ別 月別書き込み件数';
    monthDatasets = staffList.map(([name], i) => ({
      label: name,
      data: monthKeys.map(m => (byStaffMonth[name]&&byStaffMonth[name][m]) ? byStaffMonth[name][m].total : 0),
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '22',
      tension: 0.3, fill: false, pointRadius: 4, pointHoverRadius: 6,
    }));
  }
  const monthData = { labels: monthKeys, datasets: monthDatasets };

  // STAFF_DATA: スタッフ別詳細（ドリルダウン用）
  const staffDataObj = {};
  for (const [name, s] of staffList) {
    staffDataObj[name] = {
      itemsMap: s.itemsMap,
      counselingMap: s.counselingMap,
      treatmentMap: s.treatmentMap,
      reviews: s.reviews,
      freePhrases: s.freePhrases,
    };
  }

  // 全スタッフ名（フィルター選択肢用）
  const allStaffNames = [...new Set(allRecords.map(r => r.staffName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
  const staffOptions = allStaffNames.map(n => `<option value="${esc(n)}"${staffFilter === n ? ' selected' : ''}>${esc(n)}</option>`).join('');

  const staffSettings = await loadStaffSettings();
  const kuchikomiEnabled = new Set(staffSettings.filter(s => s.showKuchikomi).map(s => s.staffName));

  const summaryRows = staffList.map(([name, s]) => {
    const itemsTotal = Object.values(s.itemsMap).reduce((x,y)=>x+y,0);
    const itemsDetail = Object.entries(s.itemsMap).map(([k,v])=>`${k}:${v}`).join('、') || '';
    const recommendTotal = Object.values(s.recommendMap||{}).reduce((x,y)=>x+y,0);
    const approachTotal = Object.values(s.approachMap||{}).reduce((x,y)=>x+y,0);
    const counselingTotal = Object.values(s.counselingMap).reduce((x,y)=>x+y,0);
    const counselingDetail = Object.entries(s.counselingMap).map(([k,v])=>`${k}:${v}`).join('、') || '-';
    const treatmentDetail = Object.entries(s.treatmentMap).map(([k,v])=>`${k}:${v}`).join('、') || '-';
    const initial = name.charAt(0);
    return `
      <tr class="staff-row" onclick="openModal('${esc(name).replace(/'/g, "\\'")}')">
        <td><span class="avatar">${esc(initial)}</span><strong>${esc(name)}</strong></td>
        <td class="num"><span class="badge badge-gray">${s.count}</span></td>
        <td class="num">${s.patients.size}</td>
        <td class="num"><span class="badge badge-orange">${itemsTotal}</span>${itemsDetail ? `<br><small style="color:#94a3b8;font-size:11px">${esc(itemsDetail)}</small>` : ''}<br><small style="color:#94a3b8;font-size:11px">すすめた:${recommendTotal}</small></td>
        <td class="num"><span class="badge badge-purple">${approachTotal}</span><br><small style="color:#94a3b8;font-size:11px">ジャブ打ち</small></td>
        <td class="num"><span class="badge badge-blue">${counselingTotal}</span><br><small style="color:#94a3b8;font-size:11px">${esc(counselingDetail)}</small></td>
        <td class="num"><span class="badge badge-green">${s.reviews}</span></td>
        <td style="font-size:11px;color:#64748b;max-width:160px">${esc(treatmentDetail)}</td>
        <td class="num" onclick="event.stopPropagation()" style="min-width:90px">
          ${(() => {
            const g = (staffSettings.find(s=>s.staffName===name)||{}).goals||{};
            const target = g.items || 0;
            const pct = target > 0 ? Math.min(Math.round(itemsTotal/target*100),100) : 0;
            const color = pct>=100 ? '#059669' : pct>=70 ? '#f59e0b' : '#2aab96';
            return target > 0
              ? `<div style="font-size:11px;color:#64748b">物品 ${itemsTotal}/${target}</div>
                 <div style="height:6px;background:#e2e8f0;border-radius:3px;margin-top:3px;overflow:hidden">
                   <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width .4s"></div>
                 </div>
                 <div style="font-size:11px;font-weight:700;color:${color};margin-top:2px">${pct}%${pct>=100?' ✓':''}</div>`
              : '<span style="color:#cbd5e1;font-size:11px">未設定</span>';
          })()}
        </td>
        <td onclick="event.stopPropagation()" style="white-space:nowrap">
          <a href="/certificate?name=${encodeURIComponent(name)}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}" target="_blank" class="btn-cert">賞状</a>
          <a href="/evaluation?name=${encodeURIComponent(name)}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}" target="_blank" class="btn-eval">評価表</a>
        </td>
      </tr>`;
  }).join('');

  const detailRows = records.slice().reverse().slice(0, 100).map(r => {
    const actionLabel = r.action ? `<span class="badge badge-gray">${esc(r.action)}${r.itemName ? `（${esc(r.itemName)}）` : ''}${r.otherText ? `（${esc(r.otherText)}）` : ''}</span>` : '-';
    const entryBadge = r.entryType === 'behavior' ? '<span class="badge badge-blue" style="margin-right:4px">行動</span>' : '';
    return `
      <tr>
        <td style="white-space:nowrap;color:#64748b">${esc(r.date)}</td>
        <td><span class="avatar" style="width:24px;height:24px;font-size:10px">${esc((r.staffName||'?').charAt(0))}</span><strong>${esc(r.staffName)}</strong></td>
        <td style="color:#64748b">${esc(r.patientNo) || '-'}</td>
        <td>${entryBadge}${actionLabel}</td>
        <td style="font-size:12px;color:#475569">${esc(r.freeText) || '-'}</td>
      </tr>`;
  }).join('');

  // KPIサマリー
  const totalItems = staffList.reduce((s,[,d])=>s+Object.values(d.itemsMap).reduce((a,b)=>a+b,0),0);
  const totalCounseling = staffList.reduce((s,[,d])=>s+Object.values(d.counselingMap).reduce((a,b)=>a+b,0),0);
  const totalReviews = staffList.reduce((s,[,d])=>s+d.reviews,0);
  const totalPatients = new Set(records.filter(r=>r.patientNo).map(r=>r.patientNo)).size;

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>自己申告デラックスダッシュボード | のびのび歯科</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Sans JP',sans-serif;background:#f0f4f8;color:#1e293b;font-size:14px}

/* ヘッダー */
header{background:linear-gradient(135deg,#0f766e 0%,#2aab96 60%,#34d399 100%);padding:0;box-shadow:0 2px 12px rgba(15,118,110,.3)}
.header-inner{max-width:1280px;margin:0 auto;padding:18px 28px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.header-title{display:flex;align-items:center;gap:12px}
.header-icon{width:38px;height:38px;background:rgba(255,255,255,.2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px}
header h1{font-size:18px;font-weight:700;color:#fff;letter-spacing:.03em}
header p{font-size:11px;color:rgba(255,255,255,.75);margin-top:2px}
.header-badge{background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:20px;padding:4px 14px;font-size:12px;font-weight:500}

/* コンテナ */
.container{max-width:1280px;margin:0 auto;padding:24px 20px 60px}

/* KPIカード */
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:28px}
.kpi-card{background:#fff;border-radius:14px;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04);border-left:4px solid transparent;transition:transform .15s,box-shadow .15s}
.kpi-card:hover{transform:translateY(-2px);box-shadow:0 4px 20px rgba(0,0,0,.1)}
.kpi-card.green{border-color:#2aab96}
.kpi-card.blue{border-color:#3b82f6}
.kpi-card.orange{border-color:#f59e0b}
.kpi-card.purple{border-color:#8b5cf6}
.kpi-label{font-size:11px;font-weight:500;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.kpi-value{font-size:30px;font-weight:700;line-height:1;margin-bottom:4px}
.kpi-card.green .kpi-value{color:#0f766e}
.kpi-card.blue .kpi-value{color:#2563eb}
.kpi-card.orange .kpi-value{color:#d97706}
.kpi-card.purple .kpi-value{color:#7c3aed}
.kpi-sub{font-size:11px;color:#94a3b8}

/* セクションヘッダー */
.section-header{display:flex;align-items:center;gap:10px;margin:28px 0 14px}
.section-header h2{font-size:15px;font-weight:700;color:#0f766e}
.section-header .section-line{flex:1;height:1px;background:linear-gradient(90deg,#2aab96,transparent)}

/* フィルターバー */
.filter-card{background:#fff;border-radius:14px;padding:16px 20px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.filter-card label{font-size:12px;font-weight:700;color:#0f766e;white-space:nowrap}
.filter-card input[type=date],.filter-card select{border:1.5px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;font-family:inherit;background:#f8fafc;color:#1e293b;outline:none;transition:border .2s}
.filter-card input:focus,.filter-card select:focus{border-color:#2aab96;background:#fff}
.filter-card .sep{color:#cbd5e1;font-size:18px;line-height:1}
.btn-primary{background:linear-gradient(135deg,#0f766e,#2aab96);color:#fff;border:none;border-radius:8px;padding:7px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity .2s}
.btn-primary:hover{opacity:.88}
.btn-reset{background:transparent;color:#94a3b8;border:none;font-size:12px;cursor:pointer;text-decoration:underline;font-family:inherit}
.filter-tag{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:600}

/* グラフ */
.chart-card{background:#fff;border-radius:14px;padding:20px 24px;box-shadow:0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04);margin-bottom:28px}
.chart-card h3{font-size:13px;font-weight:700;color:#475569;margin-bottom:16px}

/* テーブル共通 */
.table-card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04);margin-bottom:28px}
.table-scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
thead th{background:linear-gradient(180deg,#f0fdf4,#ecfdf5);padding:10px 14px;text-align:left;color:#065f46;font-weight:700;font-size:12px;white-space:nowrap;border-bottom:2px solid #a7f3d0}
th.num,td.num{text-align:right}
tbody tr{border-bottom:1px solid #f1f5f9;transition:background .12s}
tbody tr:last-child{border-bottom:none}
tbody tr:hover{background:#f8fffe}
td{padding:11px 14px;vertical-align:middle}
.empty{text-align:center;padding:48px;color:#94a3b8;font-size:14px}

/* スタッフ行 */
.staff-row{cursor:pointer}
.staff-row td:first-child{font-weight:700;color:#0f766e}
.avatar{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#2aab96,#0f766e);color:#fff;font-size:12px;font-weight:700;margin-right:8px;flex-shrink:0}

/* バッジ */
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.badge-green{background:#dcfce7;color:#15803d}
.badge-blue{background:#dbeafe;color:#1d4ed8}
.badge-orange{background:#fef3c7;color:#b45309}
.badge-gray{background:#f1f5f9;color:#475569}

/* 出力ボタン */
.btn-cert{background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#fff;padding:4px 12px;border-radius:6px;text-decoration:none;font-size:11px;font-weight:600;margin-right:4px;display:inline-block;transition:opacity .2s;white-space:nowrap}
.btn-cert:hover{opacity:.85}
.btn-eval{background:linear-gradient(135deg,#3b82f6,#60a5fa);color:#fff;padding:4px 12px;border-radius:6px;text-decoration:none;font-size:11px;font-weight:600;display:inline-block;transition:opacity .2s;white-space:nowrap}
.btn-eval:hover{opacity:.85}

/* 目標ゲージ */
.goal-wrap{display:flex;align-items:center;gap:6px;justify-content:flex-end;flex-wrap:wrap}
.goal-input{width:54px;border:1.5px solid #e2e8f0;border-radius:6px;padding:3px 6px;font-size:12px;text-align:right;font-family:inherit;outline:none;transition:border .2s}
.goal-input:focus{border-color:#2aab96}
.goal-gauge-wrap{width:72px;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden}
.goal-gauge-bar{height:100%;background:linear-gradient(90deg,#2aab96,#34d399);border-radius:4px;transition:width .4s}
.goal-pct{font-size:11px;color:#0f766e;font-weight:600;min-width:30px;text-align:right}

/* スタッフ管理 */
.mgmt-card{background:#fff;border-radius:14px;padding:20px 24px;box-shadow:0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04);margin-bottom:28px;max-width:420px}
.mgmt-input-row{display:flex;gap:8px;margin-bottom:12px}
.mgmt-input{flex:1;border:1.5px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:14px;font-family:inherit;outline:none;transition:border .2s}
.mgmt-input:focus{border-color:#2aab96}
.btn-add{background:linear-gradient(135deg,#0f766e,#2aab96);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap}
.mgmt-list li{display:flex;justify-content:space-between;align-items:center;padding:8px 4px;border-bottom:1px solid #f1f5f9;font-size:14px}
.mgmt-list li:last-child{border-bottom:none}
.btn-del{background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600;cursor:pointer;transition:background .2s}
.btn-del:hover{background:#fecaca}

/* モーダル */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:1000;align-items:center;justify-content:center;backdrop-filter:blur(3px)}
.modal-overlay.open{display:flex}
.modal-box{background:#fff;border-radius:16px;padding:28px 30px;max-width:540px;width:94%;max-height:85vh;overflow-y:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.2)}
.modal-close{position:absolute;top:14px;right:16px;background:#f1f5f9;border:none;width:28px;height:28px;border-radius:50%;font-size:16px;cursor:pointer;color:#64748b;display:flex;align-items:center;justify-content:center;transition:background .2s}
.modal-close:hover{background:#e2e8f0;color:#1e293b}
.modal-title{font-size:20px;font-weight:700;color:#0f766e;margin-bottom:20px;display:flex;align-items:center;gap:10px}
.modal-section{margin-bottom:16px}
.modal-section h3{font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #f1f5f9}
.modal-section ul{list-style:none;padding:0;margin:0}
.modal-section ul li{padding:5px 0;font-size:13px;color:#334155;display:flex;justify-content:space-between;border-bottom:1px solid #f8fafc}
.modal-section ul li:last-child{border-bottom:none}
.modal-cnt{font-weight:700;color:#0f766e}
.modal-empty{color:#94a3b8;font-size:13px;font-style:italic}

@media(max-width:600px){
  .header-inner{padding:14px 16px}
  header h1{font-size:15px}
  .container{padding:16px 12px 50px}
  .kpi-grid{grid-template-columns:repeat(2,1fr);gap:10px}
  .kpi-value{font-size:24px}
  td{padding:8px 10px}
}
</style>
</head>
<body>
<header>
  <div class="header-inner">
    <div class="header-title">
      <div class="header-icon">🦷</div>
      <div>
        <h1>自己申告デラックスダッシュボード</h1>
        <p>のびのび歯科・矯正歯科</p>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <div class="header-badge">管理者専用</div>
      <button onclick="deleteAllRecords()" style="background:rgba(239,68,68,.8);color:#fff;border:none;border-radius:8px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">🗑 全データ削除</button>
    </div>
  </div>
</header>

<div class="container">

  <!-- KPIカード -->
  <div class="kpi-grid">
    <div class="kpi-card green">
      <div class="kpi-label">登録患者数</div>
      <div class="kpi-value">${totalPatients}</div>
      <div class="kpi-sub">ユニーク患者番号</div>
    </div>
    <div class="kpi-card orange">
      <div class="kpi-label">物品販売</div>
      <div class="kpi-value">${totalItems}</div>
      <div class="kpi-sub">合計件数</div>
    </div>
    <div class="kpi-card blue">
      <div class="kpi-label">カウンセリング成約</div>
      <div class="kpi-value">${totalCounseling}</div>
      <div class="kpi-sub">合計件数</div>
    </div>
    <div class="kpi-card purple">
      <div class="kpi-label">口コミ獲得</div>
      <div class="kpi-value">${totalReviews}</div>
      <div class="kpi-sub">合計件数</div>
    </div>
  </div>

  <!-- フィルター -->
  <form class="filter-card" method="get" action="/dashboard">
    <label>期間</label>
    <input type="date" name="from" value="${esc(from || '')}" />
    <span class="sep">—</span>
    <input type="date" name="to" value="${esc(to || '')}" />
    <label>スタッフ</label>
    <select name="staff" id="staffFilter">
      <option value="">全員</option>
      ${staffOptions}
    </select>
    <button type="submit" class="btn-primary">絞り込む</button>
    ${from || to || staffFilter ? '<button type="button" class="btn-reset" onclick="location.href=\'/dashboard\'">リセット</button>' : ''}
    ${from || to ? `<span class="filter-tag">📅 期間指定中</span>` : ''}
    ${staffFilter ? `<span class="filter-tag">👤 ${esc(staffFilter)}</span>` : ''}
  </form>

  <!-- 月別グラフ -->
  <div class="section-header"><h2>月別推移</h2><div class="section-line"></div></div>
  <div class="chart-card">
    <h3>${esc(chartTitle)}</h3>
    <canvas id="monthChart" style="max-height:280px"></canvas>
  </div>

  <!-- スタッフ別テーブル -->
  <div class="section-header"><h2>スタッフ別 累計実績</h2><div class="section-line"></div></div>
  <div class="table-card">
    <div class="table-scroll">
    <table>
      <thead><tr>
        <th>スタッフ</th><th class="num">書き込み</th><th class="num">患者数</th><th class="num">物品販売/すすめ</th>
        <th class="num">ジャブ打ち</th><th class="num">成約</th><th class="num">口コミ</th>
        <th>処置内訳</th><th class="num">月間目標</th><th>出力</th>
      </tr></thead>
      <tbody>${summaryRows || '<tr><td colspan="9" class="empty">まだデータがありません</td></tr>'}</tbody>
    </table>
    </div>
  </div>

  <!-- 入力履歴 -->
  <div class="section-header"><h2>入力履歴（新しい順）</h2><div class="section-line"></div></div>
  <div class="table-card">
    <div class="table-scroll">
    <table>
      <thead><tr>
        <th>日付</th><th>スタッフ</th><th>患者番号</th><th>実施内容</th><th>自由記入</th>
      </tr></thead>
      <tbody>${detailRows || '<tr><td colspan="5" class="empty">まだデータがありません</td></tr>'}</tbody>
    </table>
    </div>
  </div>

  <!-- 月間目標設定 -->
  <div class="section-header"><h2>月間目標設定</h2><div class="section-line"></div></div>
  <div class="mgmt-card" style="max-width:560px">
    <p style="font-size:12px;color:#64748b;margin-bottom:14px">スタッフごとの月間目標件数を設定します。ダッシュボードの達成率ゲージに反映されます。</p>
    <div id="goalSettings" style="display:flex;flex-direction:column;gap:10px;"></div>
    <div id="goalMsg" style="font-size:12px;margin-top:10px;min-height:16px;"></div>
  </div>

  <!-- 項目表示設定 -->
  <div class="section-header"><h2>項目表示設定（スタッフ別）</h2><div class="section-line"></div></div>
  <p style="font-size:12px;color:#64748b;margin-bottom:14px">スタッフごとに入力フォームに表示する項目をON/OFFできます</p>
  <div id="itemVisibilitySettings"></div>
  <div id="itemVisibilityMsg" style="font-size:12px;margin-bottom:20px;min-height:16px;"></div>

  <!-- グループ管理 -->
  <div class="section-header"><h2>グループ管理</h2><div class="section-line"></div></div>
  <div style="margin-bottom:28px">
    <div class="mgmt-card" style="max-width:340px">
      <div style="font-size:13px;font-weight:700;color:#0f766e;margin-bottom:10px">グループ</div>
      <div id="groupList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>
      <div style="display:flex;gap:8px">
        <input type="text" id="newGroupInput" placeholder="新しいグループ名" class="mgmt-input" style="font-size:13px;flex:1" />
        <button onclick="addGroup()" class="btn-add" style="font-size:13px;white-space:nowrap">追加</button>
      </div>
      <div id="groupMsg" style="font-size:12px;margin-top:6px;min-height:16px;"></div>
    </div>
  </div>

  <!-- アクション項目管理 -->
  <div class="section-header">
    <h2>アクション項目管理</h2><div class="section-line"></div>
    <button onclick="openItemModal()" style="background:linear-gradient(135deg,#0f766e,#2aab96);color:#fff;border:none;border-radius:8px;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit">＋ 項目追加</button>
  </div>
  <div id="itemMsg" style="font-size:12px;margin-bottom:8px;min-height:16px;"></div>
  <div class="table-card" style="margin-bottom:28px">
    <div class="table-scroll">
    <table id="itemTable">
      <thead><tr>
        <th>項目名</th><th>グループ</th><th style="text-align:center">患者番号</th><th style="text-align:center">操作</th>
      </tr></thead>
      <tbody id="itemTableBody"></tbody>
    </table>
    </div>
  </div>

  <!-- スタッフ管理 -->
  <div class="section-header">
    <h2>スタッフ管理</h2><div class="section-line"></div>
    <button onclick="openStaffModal()" style="background:linear-gradient(135deg,#0f766e,#2aab96);color:#fff;border:none;border-radius:8px;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit">＋ スタッフ追加</button>
  </div>
  <div id="staffMsg" style="font-size:12px;margin-bottom:8px;min-height:16px;"></div>
  <div class="table-card" style="margin-bottom:14px">
    <div class="table-scroll">
    <table id="staffTable">
      <thead><tr>
        <th>スタッフ名</th><th>メールアドレス</th><th>最終ログイン</th><th style="text-align:center">操作</th>
      </tr></thead>
      <tbody id="staffTableBody"></tbody>
    </table>
    </div>
  </div>

</div><!-- /container -->

<!-- アクション項目追加モーダル -->
<div id="itemModalOverlay" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:1100;align-items:center;justify-content:center;backdrop-filter:blur(3px)" onclick="if(event.target===this)this.style.display='none'">
  <div style="background:#fff;border-radius:16px;padding:28px 28px 24px;max-width:420px;width:94%;box-shadow:0 20px 60px rgba(0,0,0,.2)" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <h2 id="itemModalTitle" style="font-size:17px;font-weight:700;color:#0f766e">項目を追加</h2>
      <button onclick="document.getElementById('itemModalOverlay').style.display='none'" style="background:#f1f5f9;border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px;color:#64748b">×</button>
    </div>
    <div style="margin-bottom:12px">
      <label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:5px">項目名 <span style="color:#ef4444">*</span></label>
      <input type="text" id="newItemName" placeholder="例：TCイベント" style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;font-family:inherit;outline:none" />
    </div>
    <div style="margin-bottom:12px">
      <label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:5px">グループ <span style="color:#ef4444">*</span></label>
      <input type="text" id="newItemGroup" placeholder="例：カウンセリング" style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;font-family:inherit;outline:none" list="groupSuggestions" />
      <datalist id="groupSuggestions">
        <option value="物品"><option value="カウンセリング"><option value="アポ管理"><option value="処置"><option value="チームサポート"><option value="その他">
      </datalist>
    </div>
    <div style="display:flex;gap:16px;margin-bottom:16px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#334155;cursor:pointer">
        <input type="checkbox" id="newItemNeedsPatient" checked style="width:16px;height:16px;accent-color:#0f766e" /> 患者番号が必要
      </label>
    </div>
    <div id="itemModalMsg" style="font-size:12px;min-height:16px;margin-bottom:12px;"></div>
    <div style="display:flex;gap:8px">
      <button onclick="document.getElementById('itemModalOverlay').style.display='none'" style="flex:1;padding:11px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;background:#fff;font-family:inherit">キャンセル</button>
      <button id="itemModalSaveBtn" onclick="saveNewItem()" style="flex:2;padding:11px;background:linear-gradient(135deg,#0f766e,#2aab96);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">追加する</button>
    </div>
  </div>
</div>

<!-- スタッフ追加・編集モーダル -->
<div id="staffModalOverlay" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:1100;align-items:center;justify-content:center;backdrop-filter:blur(3px)" onclick="closeStaffModal(event)">
  <div style="background:#fff;border-radius:16px;padding:28px 28px 24px;max-width:440px;width:94%;box-shadow:0 20px 60px rgba(0,0,0,.2)" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <h2 id="staffModalTitle" style="font-size:17px;font-weight:700;color:#0f766e"></h2>
      <button onclick="document.getElementById('staffModalOverlay').style.display='none'" style="background:#f1f5f9;border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px;color:#64748b">×</button>
    </div>
    <div id="staffNameField" class="form-group" style="margin-bottom:14px">
      <label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:5px">スタッフ名 <span style="color:#ef4444">*</span></label>
      <input type="text" id="modalStaffName" placeholder="例：山田 太郎" style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;font-family:inherit;outline:none" />
    </div>
    <div style="margin-bottom:14px">
      <label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:5px">メールアドレス <span style="color:#ef4444">*</span></label>
      <input type="email" id="modalEmail" placeholder="例：yamada@example.com" style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;font-family:inherit;outline:none" />
    </div>
    <div style="margin-bottom:18px">
      <label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:5px" id="pwLabel">パスワード <span style="color:#ef4444">*</span></label>
      <input type="password" id="modalPassword" placeholder="4文字以上" style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;font-family:inherit;outline:none" />
    </div>
    <div id="staffModalMsg" style="font-size:12px;min-height:16px;margin-bottom:12px;"></div>
    <div style="display:flex;gap:8px">
      <button onclick="document.getElementById('staffModalOverlay').style.display='none'" style="flex:1;padding:11px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;background:#fff;font-family:inherit">キャンセル</button>
      <button id="staffModalSaveBtn" style="flex:2;padding:11px;background:linear-gradient(135deg,#0f766e,#2aab96);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">追加する</button>
    </div>
  </div>
</div>

<!-- ドリルダウンモーダル -->
<div class="modal-overlay" id="modalOverlay" onclick="closeModalOnBg(event)">
  <div class="modal-box" id="modalBox">
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="modal-title" id="modalTitle"></div>
    <div class="modal-section">
      <h3>物品販売</h3>
      <ul id="modalItems"></ul>
    </div>
    <div class="modal-section">
      <h3>カウンセリング</h3>
      <ul id="modalCounseling"></ul>
    </div>
    <div class="modal-section">
      <h3>処置</h3>
      <ul id="modalTreatment"></ul>
    </div>
    <div class="modal-section">
      <h3>行動・取り組みの記録</h3>
      <ul id="modalPhrases"></ul>
    </div>
  </div>
</div>

<script>
const STAFF_DATA = ${JSON.stringify(staffDataObj)};
const MONTH_DATA = ${JSON.stringify(monthData)};
const ADMIN_AUTH = 'Basic ' + btoa(':' + ${JSON.stringify(ADMIN_PASSWORD)});
function adminFetch(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({'Authorization': ADMIN_AUTH}, opts.headers || {});
  return fetch(url, opts);
}

// Chart.js 月別推移グラフ
(function() {
  const ctx = document.getElementById('monthChart').getContext('2d');
  const isBar = ${JSON.stringify(!!staffFilter)};
  new Chart(ctx, {
    type: isBar ? 'bar' : 'line',
    data: MONTH_DATA,
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { stacked: isBar },
        y: { stacked: isBar, beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
})();

// ドリルダウンモーダル
function openModal(staffName) {
  const d = STAFF_DATA[staffName];
  if (!d) return;
  document.getElementById('modalTitle').textContent = staffName;
  function renderList(ulId, map) {
    const ul = document.getElementById(ulId);
    const entries = Object.entries(map || {});
    if (entries.length === 0) { ul.innerHTML = '<li class="modal-empty">なし</li>'; return; }
    ul.innerHTML = entries.map(([k, v]) => '<li>' + k + ': ' + v + '件</li>').join('');
  }
  renderList('modalItems', d.itemsMap);
  renderList('modalCounseling', d.counselingMap);
  renderList('modalTreatment', d.treatmentMap);
  const ul = document.getElementById('modalPhrases');
  if (!d.freePhrases || d.freePhrases.length === 0) { ul.innerHTML = '<li class="modal-empty">なし</li>'; }
  else { ul.innerHTML = [...new Set(d.freePhrases)].map(p => '<li>' + p + '</li>').join(''); }
  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}
function closeModalOnBg(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

// 月間目標設定UI
async function loadGoalSettings() {
  const [namesRes, goalsRes] = await Promise.all([fetch('/api/staff-names'), fetch('/api/goals')]);
  const names = await namesRes.json();
  const goals = await goalsRes.json();
  const container = document.getElementById('goalSettings');
  container.innerHTML = '';
  names.forEach(n => {
    const g = goals[n] || {};
    const row = document.createElement('div');
    row.style.cssText = 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;';
    row.innerHTML = '<div style="font-size:14px;font-weight:700;color:#0f766e;margin-bottom:8px">' + n + '</div>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
      makeGoalInput(n, 'items', '物品販売', g.items||0) +
      makeGoalInput(n, 'counseling', 'カウンセリング成約', g.counseling||0) +
      makeGoalInput(n, 'approach', 'ジャブ打ち', g.approach||0) +
      makeGoalInput(n, 'reviews', '口コミ', g.reviews||0) +
      '</div>';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '保存';
    saveBtn.style.cssText = 'margin-top:10px;background:linear-gradient(135deg,#0f766e,#2aab96);color:#fff;border:none;border-radius:6px;padding:5px 16px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit';
    saveBtn.onclick = function() { saveGoal(n, this); };
    row.appendChild(saveBtn);
    container.appendChild(row);
  });
}
function makeGoalInput(staff, key, label, val) {
  return '<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#64748b;font-weight:600">' + label +
    '<input type="number" min="0" value="' + val + '" data-key="' + key + '" style="width:64px;border:1.5px solid #e2e8f0;border-radius:6px;padding:4px 6px;font-size:14px;font-family:inherit;text-align:center" /></label>';
}
async function saveGoal(staffName, btn) {
  const row = btn.closest('div');
  const inputs = row.querySelectorAll('input[data-key]');
  const goals = {};
  inputs.forEach(i => { goals[i.dataset.key] = parseInt(i.value)||0; });
  const msg = document.getElementById('goalMsg');
  const res = await adminFetch('/admin/goals', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ staffName, goals }) });
  if (res.ok) { msg.style.color='#059669'; msg.textContent='保存しました（ページを更新すると達成率に反映されます）'; setTimeout(()=>msg.textContent='',4000); }
  else { msg.style.color='#dc2626'; msg.textContent='保存に失敗しました ('+res.status+')'; }
}
loadGoalSettings();

// 項目表示設定（スタッフ別ON/OFF）
function makeToggle(on) {
  return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:' + (on?'#0f766e':'#94a3b8') + '">' +
    (on?'ON':'OFF') +
    '<span style="position:relative;display:inline-block;width:36px;height:20px">' +
    '<span style="position:absolute;inset:0;background:' + (on?'#2aab96':'#cbd5e1') + ';border-radius:10px"></span>' +
    '<span style="position:absolute;top:3px;left:' + (on?'19px':'3px') + ';width:14px;height:14px;background:#fff;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,.2)"></span>' +
    '</span></span>';
}
async function loadItemVisibilitySettings() {
  const [namesRes, settingsRes, itemsRes] = await Promise.all([
    fetch('/api/staff-names'), fetch('/api/staff-settings'), fetch('/api/action-items')
  ]);
  const names = await namesRes.json();
  const settings = await settingsRes.json();
  const items = await itemsRes.json();
  const container = document.getElementById('itemVisibilitySettings');
  container.innerHTML = '';
  names.forEach(staffName => {
    const s = settings.find(x => x.staffName === staffName) || {};
    const disabled = s.disabledItems || [];
    const card = document.createElement('div');
    card.className = 'mgmt-card';
    card.style.cssText = 'margin-bottom:14px;max-width:640px';
    card.innerHTML = '<div style="font-size:14px;font-weight:700;color:#0f766e;margin-bottom:12px">' + staffName + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px" id="vis_' + staffName.replace(/\s/g,'_') + '"></div>';
    container.appendChild(card);
    const wrap = card.querySelector('[id^="vis_"]');
    items.forEach(item => {
      const on = !disabled.includes(item.name);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.dataset.staff = staffName;
      chip.dataset.item = item.name;
      chip.dataset.on = on ? '1' : '0';
      chip.style.cssText = 'display:flex;align-items:center;gap:6px;border:1.5px solid ' + (on?'#2aab96':'#e2e8f0') + ';border-radius:20px;padding:5px 12px;background:' + (on?'#f0fdf4':'#f8fafc') + ';cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;color:' + (on?'#065f46':'#94a3b8') + ';transition:all .15s';
      chip.innerHTML = item.name + ' ' + makeToggle(on);
      chip.onclick = function() { toggleItemVisibility(this); };
      wrap.appendChild(chip);
    });
  });
}
async function toggleItemVisibility(chip) {
  const staffName = chip.dataset.staff;
  const itemName = chip.dataset.item;
  const newOn = chip.dataset.on !== '1';
  chip.dataset.on = newOn ? '1' : '0';
  chip.style.borderColor = newOn ? '#2aab96' : '#e2e8f0';
  chip.style.background = newOn ? '#f0fdf4' : '#f8fafc';
  chip.style.color = newOn ? '#065f46' : '#94a3b8';
  chip.innerHTML = itemName + ' ' + makeToggle(newOn);
  chip.onclick = function() { toggleItemVisibility(this); };
  const msg = document.getElementById('itemVisibilityMsg');
  try {
    const res = await adminFetch('/admin/staff-item-visible', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ staffName, itemName, visible: newOn }) });
    if (res.ok) { msg.style.color='#059669'; msg.textContent=staffName+' の「'+itemName+'」を'+(newOn?'ON':'OFF')+'にしました'; setTimeout(()=>msg.textContent='',2500); }
    else { msg.style.color='#dc2626'; msg.textContent='保存に失敗しました'; chip.dataset.on=newOn?'0':'1'; }
  } catch(e) { msg.style.color='#dc2626'; msg.textContent='通信エラー'; chip.dataset.on=newOn?'0':'1'; }
}
loadItemVisibilitySettings();

// ===== スタッフ管理テーブル =====
async function loadStaffTable() {
  const [namesRes, accountsRes] = await Promise.all([fetch('/api/staff-names'), adminFetch('/api/admin/accounts')]);
  const names = await namesRes.json();
  const accounts = await accountsRes.json();
  const accountMap = {};
  accounts.forEach(a => { accountMap[a.staffName] = a; });
  const tbody = document.getElementById('staffTableBody');
  if (!names.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty">スタッフが登録されていません</td></tr>'; return; }
  tbody.innerHTML = '';
  names.forEach(n => {
    const a = accountMap[n] || {};
    const tr = document.createElement('tr');
    const loginTime = a.lastLogin ? new Date(a.lastLogin).toLocaleString('ja-JP', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '未ログイン';
    tr.innerHTML = '<td><strong>' + n + '</strong></td>' +
      '<td style="color:#475569">' + (a.email || '<span style="color:#cbd5e1">未設定</span>') + '</td>' +
      '<td style="color:#94a3b8;font-size:12px">' + loginTime + '</td>';
    const opTd = document.createElement('td');
    opTd.style.cssText = 'text-align:center;white-space:nowrap';
    const editBtn = document.createElement('button');
    editBtn.textContent = '編集';
    editBtn.style.cssText = 'background:#f1f5f9;color:#475569;border:none;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;margin-right:6px;font-family:inherit';
    editBtn.onclick = function() { openEditModal(n, a.email || ''); };
    const delBtn = document.createElement('button');
    delBtn.textContent = '削除';
    delBtn.style.cssText = 'background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit';
    delBtn.onclick = function() { deleteStaff(n, this); };
    opTd.appendChild(editBtn); opTd.appendChild(delBtn);
    tr.appendChild(opTd);
    tbody.appendChild(tr);
  });
}

let editingStaff = null;
function openStaffModal() {
  editingStaff = null;
  document.getElementById('staffModalTitle').textContent = 'スタッフ追加';
  document.getElementById('staffNameField').style.display = '';
  document.getElementById('modalStaffName').value = '';
  document.getElementById('modalEmail').value = '';
  document.getElementById('modalPassword').value = '';
  document.getElementById('pwLabel').innerHTML = 'パスワード <span style="color:#ef4444">*</span>';
  document.getElementById('staffModalMsg').textContent = '';
  const saveBtn = document.getElementById('staffModalSaveBtn');
  saveBtn.textContent = '追加する';
  saveBtn.onclick = submitAddStaff;
  document.getElementById('staffModalOverlay').style.display = 'flex';
}
function openEditModal(staffName, email) {
  editingStaff = staffName;
  document.getElementById('staffModalTitle').textContent = staffName + ' を編集';
  document.getElementById('staffNameField').style.display = 'none';
  document.getElementById('modalEmail').value = email;
  document.getElementById('modalPassword').value = '';
  document.getElementById('pwLabel').innerHTML = 'パスワード（変更する場合のみ）';
  document.getElementById('staffModalMsg').textContent = '';
  const saveBtn = document.getElementById('staffModalSaveBtn');
  saveBtn.textContent = '保存する';
  saveBtn.onclick = submitEditStaff;
  document.getElementById('staffModalOverlay').style.display = 'flex';
}
function closeStaffModal(e) {
  if (e.target === document.getElementById('staffModalOverlay')) document.getElementById('staffModalOverlay').style.display = 'none';
}
async function submitAddStaff() {
  const staffName = document.getElementById('modalStaffName').value.trim();
  const email = document.getElementById('modalEmail').value.trim();
  const password = document.getElementById('modalPassword').value;
  const msg = document.getElementById('staffModalMsg');
  if (!staffName || !email || !password) { msg.style.color='#dc2626'; msg.textContent='全項目を入力してください'; return; }
  const res = await adminFetch('/admin/add-staff', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ staffName, email, password }) });
  const data = await res.json();
  if (res.ok) { document.getElementById('staffModalOverlay').style.display='none'; loadStaffTable(); document.getElementById('staffMsg').style.color='#059669'; document.getElementById('staffMsg').textContent=staffName+'を追加しました'; setTimeout(()=>document.getElementById('staffMsg').textContent='',3000); }
  else { msg.style.color='#dc2626'; msg.textContent=data.error||'追加に失敗しました'; }
}
async function submitEditStaff() {
  const email = document.getElementById('modalEmail').value.trim();
  const password = document.getElementById('modalPassword').value;
  const msg = document.getElementById('staffModalMsg');
  if (!email) { msg.style.color='#dc2626'; msg.textContent='メールアドレスを入力してください'; return; }
  const body = { staffName: editingStaff, email };
  if (password) body.password = password;
  const res = await adminFetch('/admin/reset-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (res.ok) { document.getElementById('staffModalOverlay').style.display='none'; loadStaffTable(); document.getElementById('staffMsg').style.color='#059669'; document.getElementById('staffMsg').textContent='保存しました'; setTimeout(()=>document.getElementById('staffMsg').textContent='',3000); }
  else { msg.style.color='#dc2626'; msg.textContent='保存に失敗しました'; }
}
async function deleteStaff(name, btn) {
  if (btn.dataset.confirm !== '1') {
    btn.dataset.confirm = '1'; btn.textContent = '本当に削除？'; btn.style.background = '#ef4444'; btn.style.color = '#fff';
    setTimeout(() => { if(btn.dataset.confirm==='1'){btn.dataset.confirm='';btn.textContent='削除';btn.style.background='#fee2e2';btn.style.color='#dc2626';} }, 3000);
    return;
  }
  const msg = document.getElementById('staffMsg');
  const res = await adminFetch('/admin/staff-names/' + encodeURIComponent(name), { method:'DELETE' });
  if (res.ok) { msg.style.color='#059669'; msg.textContent=name+'を削除しました'; loadStaffTable(); setTimeout(()=>msg.textContent='',3000); }
  else { msg.style.color='#dc2626'; msg.textContent='削除に失敗しました ('+res.status+')'; }
}
async function resetAllPasswords() {
  const pw = document.getElementById('bulkPwInput').value.trim();
  const msg = document.getElementById('bulkPwMsg');
  if (!pw || pw.length < 4) { msg.style.color='#dc2626'; msg.textContent='4文字以上のパスワードを入力してください'; return; }
  const res = await adminFetch('/admin/reset-all-passwords', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: pw }) });
  const data = await res.json();
  if (res.ok) { document.getElementById('bulkPwInput').value=''; msg.style.color='#059669'; msg.textContent=data.count+'名に設定しました'; setTimeout(()=>msg.textContent='',3000); }
  else { msg.style.color='#dc2626'; msg.textContent='失敗しました'; }
}
loadStaffTable();

// アクション項目管理
async function loadItemTable() {
  const res = await fetch('/api/action-items');
  const items = await res.json();
  const tbody = document.getElementById('itemTableBody');
  tbody.innerHTML = '';
  items.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td style="padding:10px 14px;font-weight:600;color:#334155">' + item.name + '</td>' +
      '<td style="padding:10px 14px;color:#64748b">' + item.group + '</td>' +
      '<td style="padding:10px 14px;text-align:center">' + (item.needsPatient ? '✓' : '') + '</td>' +
      '<td style="padding:10px 14px;text-align:center;display:flex;gap:6px;justify-content:center"></td>';
    const editBtn = document.createElement('button');
    editBtn.textContent = '編集';
    editBtn.style.cssText = 'background:#e0f2fe;color:#0369a1;border:none;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit';
    editBtn.onclick = function() { openItemModal(item); };
    tr.cells[3].appendChild(editBtn);
    const delBtn = document.createElement('button');
    delBtn.textContent = '削除';
    delBtn.style.cssText = 'background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit';
    delBtn.onclick = function() { deleteItem(item.id, item.name, delBtn); };
    tr.cells[3].appendChild(delBtn);
    tbody.appendChild(tr);
  });
}
async function deleteItem(id, name, btn) {
  if (btn.dataset.confirm !== '1') {
    btn.dataset.confirm = '1'; btn.textContent = '本当に削除？'; btn.style.background = '#dc2626'; btn.style.color = '#fff';
    setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = '削除'; btn.style.background = '#fee2e2'; btn.style.color = '#dc2626'; }, 3000);
    return;
  }
  const res = await adminFetch('/admin/action-items/' + encodeURIComponent(id), { method: 'DELETE' });
  const msg = document.getElementById('itemMsg');
  if (res.ok) { msg.style.color='#059669'; msg.textContent=name+'を削除しました'; loadItemTable(); setTimeout(()=>msg.textContent='',3000); }
  else { msg.style.color='#dc2626'; msg.textContent='削除に失敗しました'; }
}
let editingItemId = null;
function openItemModal(item) {
  editingItemId = item ? item.id : null;
  document.getElementById('itemModalTitle').textContent = item ? '項目を編集' : '項目を追加';
  document.getElementById('itemModalSaveBtn').textContent = item ? '保存する' : '追加する';
  document.getElementById('itemModalMsg').textContent = '';
  document.getElementById('newItemName').value = item ? item.name : '';
  document.getElementById('newItemGroup').value = item ? item.group : '';
  document.getElementById('newItemNeedsPatient').checked = item ? !!item.needsPatient : true;
  document.getElementById('itemModalOverlay').style.display = 'flex';
}
async function saveNewItem() {
  const name = document.getElementById('newItemName').value.trim();
  const group = document.getElementById('newItemGroup').value.trim();
  const needsPatient = document.getElementById('newItemNeedsPatient').checked;
  const msg = document.getElementById('itemModalMsg');
  if (!name || !group) { msg.style.color='#dc2626'; msg.textContent='項目名とグループを入力してください'; return; }
  const body = JSON.stringify({ name, group, needsPatient });
  const url = editingItemId ? '/admin/action-items/' + encodeURIComponent(editingItemId) : '/admin/action-items';
  const method = editingItemId ? 'PUT' : 'POST';
  const res = await adminFetch(url, { method, headers:{'Content-Type':'application/json'}, body });
  if (res.ok) {
    document.getElementById('itemModalOverlay').style.display = 'none';
    const imsg = document.getElementById('itemMsg');
    imsg.style.color='#059669'; imsg.textContent = (editingItemId ? name+'を更新しました' : name+'を追加しました');
    loadItemTable(); setTimeout(()=>imsg.textContent='',3000);
  } else { msg.style.color='#dc2626'; msg.textContent = editingItemId ? '更新に失敗しました' : '追加に失敗しました'; }
}
loadItemTable();

// グループ・カテゴリ管理
let currentConfig = { groups: [], categories: [] };
async function loadConfig() {
  const res = await fetch('/api/action-config');
  currentConfig = await res.json();
  renderGroupList();
  const dl = document.getElementById('groupSuggestions');
  if (dl) dl.innerHTML = currentConfig.groups.map(g => '<option value="'+g+'">').join('');
}
function renderGroupList() {
  const el = document.getElementById('groupList');
  if (!el) return;
  el.innerHTML = '';
  currentConfig.groups.forEach(g => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border-radius:6px;padding:5px 10px;font-size:13px;color:#334155';
    row.textContent = g;
    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.style.cssText = 'background:none;border:none;color:#94a3b8;cursor:pointer;font-size:15px;padding:0 2px;line-height:1;margin-left:8px';
    btn.onclick = async () => {
      await adminFetch('/admin/action-config/groups/'+encodeURIComponent(g), { method:'DELETE' });
      loadConfig();
    };
    row.appendChild(btn);
    el.appendChild(row);
  });
}
async function addGroup() {
  const name = document.getElementById('newGroupInput').value.trim();
  const msg = document.getElementById('groupMsg');
  if (!name) { msg.style.color='#dc2626'; msg.textContent='グループ名を入力してください'; return; }
  await adminFetch('/admin/action-config/groups', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
  document.getElementById('newGroupInput').value = '';
  msg.style.color='#059669'; msg.textContent=name+'を追加しました';
  loadConfig(); setTimeout(()=>msg.textContent='',3000);
}
loadConfig();

async function deleteAllRecords() {
  if (!confirm('⚠️ 入力されたデータをすべて削除します。\\nこの操作は元に戻せません。\\n\\n本当に削除しますか？')) return;
  if (!confirm('最終確認：本当にすべてのデータを削除しますか？')) return;
  const res = await adminFetch('/admin/all-records', { method: 'DELETE' });
  if (res.ok) { alert('削除しました。ページを更新します。'); location.reload(); }
  else alert('削除に失敗しました。');
}
<\/script>
</body>
</html>`);
});

// 賞状ページ
app.get('/certificate', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const name = req.query.name || '';
  if (!name) return res.status(400).send('スタッフ名が必要です');
  const from = req.query.from || '';
  const to = req.query.to || '';
  const allRecords = await loadDB();
  const staffRecords = allRecords.filter(r => {
    if (r.staffName !== name) return false;
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    return true;
  });
  let itemsTotal = 0, counselingTotal = 0, reviewsTotal = 0, treatmentTotal = 0, patientCount = 0;
  const counselingTypes = new Set();
  const itemNames = new Set();
  const behaviors = [];
  const patients = new Set();
  for (const r of staffRecords) {
    if (r.entryType === 'behavior') { if (r.freeText) behaviors.push(r.freeText); continue; }
    const cat = r.actionCategory || ACTION_CATEGORY[r.action] || 'treatment';
    if (cat === 'item') { itemsTotal++; if (r.itemName) itemNames.add(r.itemName); }
    if (cat === 'counseling') { counselingTotal++; counselingTypes.add(r.action); }
    if (cat === 'review') reviewsTotal++;
    if (cat === 'treatment') treatmentTotal++;
    if (r.patientNo) patients.add(r.patientNo);
  }
  patientCount = patients.size;
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const uniqueBehaviors = [...new Set(behaviors)].slice(0, 4);

  // 実績に応じた文章を生成
  const highlights = [];
  if (patientCount > 0) highlights.push(`${patientCount}名の患者様を丁寧に担当`);
  if (counselingTotal > 0) highlights.push(`${[...counselingTypes].join('・')}など${counselingTotal}件のカウンセリングを成約に導く`);
  if (itemsTotal > 0) highlights.push(`${itemsTotal}件の物品販売を通じて患者様の口腔ケアをサポート`);
  if (reviewsTotal > 0) highlights.push(`${reviewsTotal}件の口コミ獲得により医院の信頼向上に貢献`);
  if (treatmentTotal > 0) highlights.push(`${treatmentTotal}件の処置において正確・迅速な補助を実践`);
  if (uniqueBehaviors.length > 0) highlights.push(...uniqueBehaviors.slice(0,2));

  const highlightHtml = highlights.map(h => `<div class="hl">・${esc(h)}</div>`).join('');

  // 実績に応じた本文を自動生成
  const bodyParts = [];
  // 1文目：患者対応の基本姿勢
  bodyParts.push('あなたは日々の診療業務において、患者様お一人おひとりに対して真心のこもった対応を実践し、チームの一員として常に高い意識と誠実な姿勢で職務に励んでまいりました。');

  // 2文目：特に目立つ実績を具体的に
  const achievements = [];
  if (patientCount > 0) achievements.push(`${patientCount}名の患者様を担当`);
  if (counselingTotal > 0) achievements.push(`${[...counselingTypes].join('・')}のカウンセリングで${counselingTotal}件の成約`);
  if (itemsTotal > 0) {
    const itemList = [...itemNames].slice(0, 2).join('・');
    achievements.push(`${itemList ? itemList + 'など' : ''}物品販売${itemsTotal}件`);
  }
  if (reviewsTotal > 0) achievements.push(`口コミ${reviewsTotal}件獲得`);

  if (achievements.length > 0) {
    bodyParts.push(`特に${achievements.join('、')}など、具体的な成果を通じて医院の発展に大きく貢献されました。`);
  }

  // 3文目：行動・取り組みがあれば
  if (uniqueBehaviors.length > 0) {
    bodyParts.push(`また、${uniqueBehaviors[0]}など、日常の一つひとつの行動においても模範となる姿勢を示し続けてくださいました。`);
  }

  // 締め
  bodyParts.push('その献身的な取り組みと積み重ねた実績はここに特筆すべきものであり、表彰いたします。');

  const autoBody = bodyParts.join('\n\n');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>賞状 - ${esc(name)}</title>
<style>
@media print { .no-print { display: none; } @page { margin: 15mm; } }
body { font-family: "游明朝", "Yu Mincho", "Hiragino Mincho Pro", serif; background: #fffdf5; display: flex; flex-direction:column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
.no-print { display:flex; gap:12px; margin-bottom:20px; }
.no-print button { padding:8px 24px; border:none; border-radius:6px; font-size:14px; cursor:pointer; }
.back-btn { background:#e5e7eb; color:#333; }
.print-btn { background:#2aab96; color:#fff; }
.cert { border: 8px double #b8860b; padding: 56px 64px; max-width: 720px; width: 100%; text-align: center; background: #fffdf5; position: relative; }
.cert::before { content:''; position:absolute; inset:10px; border:2px solid #d4a017; pointer-events:none; }
.cert::after { content:'✦'; position:absolute; top:20px; left:50%; transform:translateX(-50%); font-size:20px; color:#d4a017; }
h1 { font-size: 44px; letter-spacing: 0.4em; color: #8b6914; margin: 20px 0 36px; }
.name { font-size: 38px; font-weight: bold; border-bottom: 2px solid #333; display: inline-block; padding-bottom: 6px; margin: 16px 0 28px; letter-spacing:0.15em; }
.body { font-size: 16px; line-height: 2.4; color: #333; margin: 20px 0; text-align:left; padding: 0 10px; }
.highlights { background: #fefce8; border: 1px solid #d4a017; border-radius: 6px; padding: 16px 20px; margin: 20px 0; text-align:left; }
.hl { font-size: 14px; color: #555; line-height: 2; }
.footer { margin-top: 36px; }
.date { font-size: 14px; color: #666; }
.clinic { font-size: 20px; font-weight: bold; margin-top: 8px; letter-spacing:0.1em; }
.seal { font-size: 36px; margin-top: 4px; }
</style>
</head>
<body>
<div class="no-print" style="flex-direction:column;align-items:center;gap:10px;max-width:720px;width:100%;">
  <div style="display:flex;gap:12px;">
    <button class="back-btn" onclick="window.close(); location.href='/dashboard'">← 戻る</button>
    <button class="print-btn" onclick="window.print()">印刷する</button>
  </div>
  <div style="width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px;">
    <div style="font-size:12px;color:#666;margin-bottom:6px;">📝 実績をもとに自動生成しました。自由に編集できます（印刷に反映されます）</div>
    <textarea id="certBody" rows="8" style="width:100%;border:1px solid #ccc;border-radius:6px;padding:8px;font-size:13px;font-family:inherit;resize:vertical;" oninput="updateBody()">${esc(autoBody)}</textarea>
  </div>
</div>
<div class="cert">
  <h1>表　彰　状</h1>
  <div class="name">${esc(name)}　殿</div>
  <div class="body" id="certBodyDisplay"></div>
  ${highlights.length ? `<div class="highlights">${highlightHtml}</div>` : ''}
  <div class="footer">
    <div class="date">${today}</div>
    <div class="clinic">のびのび歯科・矯正歯科</div>
  </div>
</div>
<script>
function updateBody() {
  const text = document.getElementById('certBody').value;
  document.getElementById('certBodyDisplay').innerHTML = text.split('\\n').map(l => l ? l : '<br>').join('<br>');
}
updateBody();
</script>
</body>
</html>`);
});

// 個人評価表ページ
app.get('/evaluation', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const name = req.query.name || '';
  if (!name) return res.status(400).send('スタッフ名が必要です');
  const from = req.query.from || '';
  const to = req.query.to || '';
  const allRecords = await loadDB();
  const staffRecords = allRecords.filter(r => {
    if (r.staffName !== name) return false;
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    return true;
  });

  const itemsMap2 = {}, counselingMap2 = {}, treatmentMap2 = {};
  let reviews2 = 0;
  const freePhrases2 = [];
  const patients = new Set();

  for (const r of staffRecords) {
    if (r.entryType === 'behavior') {
      if (r.freeText) freePhrases2.push({ date: r.date, text: r.freeText });
      continue;
    }
    const cat = r.actionCategory || ACTION_CATEGORY[r.action] || 'treatment';
    const label = r.action + (r.itemName ? `（${r.itemName}）` : '') + (r.otherText ? `（${r.otherText}）` : '');
    if (cat === 'item')       itemsMap2[label] = (itemsMap2[label] || 0) + 1;
    if (cat === 'counseling') counselingMap2[r.action] = (counselingMap2[r.action] || 0) + 1;
    if (cat === 'review')     reviews2++;
    if (cat === 'treatment')  treatmentMap2[r.action] = (treatmentMap2[r.action] || 0) + 1;
    if (r.patientNo) patients.add(r.patientNo);
  }
  const itemsTotal2 = Object.values(itemsMap2).reduce((a,b)=>a+b,0);
  const counselingTotal2 = Object.values(counselingMap2).reduce((a,b)=>a+b,0);
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

  // 評価コメント自動生成
  const comments = [];
  if (patients.size >= 10) comments.push('多くの患者様を担当し、豊富な臨床経験を積んでいます。');
  else if (patients.size > 0) comments.push('患者様一人ひとりに丁寧に向き合う姿勢が見られます。');
  if (counselingTotal2 >= 5) comments.push('カウンセリング成約数が高く、患者様への説明力・提案力が優れています。');
  else if (counselingTotal2 > 0) comments.push('カウンセリングへの積極的な関与が実績に表れています。');
  if (itemsTotal2 > 0) comments.push('物品提案を通じて患者様のセルフケアをサポートできています。');
  if (reviews2 > 0) comments.push('口コミ獲得により医院の認知向上に貢献しています。');
  if (freePhrases2.length >= 3) comments.push('日常業務での積極的な取り組みが多く記録されており、チームへの貢献度が高いです。');
  if (comments.length === 0) comments.push('引き続き日々の業務に取り組み、実績を積み上げていきましょう。');

  const rows = [
    ['担当患者数', patients.size + '名'],
    ['物品販売数', itemsTotal2 + '件' + (itemsTotal2 ? '（' + Object.entries(itemsMap2).map(([k,v])=>`${k}:${v}`).join('、') + '）' : '')],
    ['カウンセリング成約数', counselingTotal2 + '件' + (counselingTotal2 ? '（' + Object.entries(counselingMap2).map(([k,v])=>`${k}:${v}`).join('、') + '）' : '')],
    ['口コミ獲得数', reviews2 + '件'],
    ['処置内訳', Object.entries(treatmentMap2).map(([k,v])=>`${k}:${v}件`).join('、') || 'なし'],
    ['行動・取り組み記録数', freePhrases2.length + '件'],
  ].map(([label, val]) => `<tr><td class="label">${esc(label)}</td><td>${esc(val)}</td></tr>`).join('');

  const freeRows = [...new Map(freePhrases2.map(p => [p.text, p])).values()].slice(0, 15)
    .map(p => `<tr><td class="label">${esc(p.date)}</td><td>${esc(p.text)}</td></tr>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>個人評価表 - ${esc(name)}</title>
<style>
@media print { .no-print { display: none; } @page { margin: 15mm; } }
body { font-family: sans-serif; background: #fff; margin: 0; padding: 30px; color: #333; max-width: 800px; }
.no-print { display:flex; gap:12px; margin-bottom:20px; }
.no-print button { padding:8px 24px; border:none; border-radius:6px; font-size:14px; cursor:pointer; }
.back-btn { background:#e5e7eb; color:#333; }
.print-btn { background:#2aab96; color:#fff; }
.header-bar { border-bottom: 3px solid #2aab96; padding-bottom: 10px; margin-bottom: 6px; display:flex; justify-content:space-between; align-items:flex-end; }
.title { font-size: 20px; font-weight:bold; }
.meta { font-size: 13px; color: #666; }
.name-big { font-size: 30px; font-weight: bold; color: #065f46; margin: 12px 0 20px; }
h2 { font-size: 14px; background: #e8f7f5; padding: 6px 12px; border-left: 4px solid #2aab96; margin: 24px 0 10px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14px; }
td { padding: 9px 12px; border: 1px solid #e5e7eb; }
td.label { background: #f9fafb; font-weight: bold; width: 38%; color: #374151; }
.comment-box { background:#f0fdf4; border:1px solid #86efac; border-radius:6px; padding:14px 18px; margin:16px 0; }
.comment-box p { font-size:14px; line-height:2; color:#166534; margin:0; }
.sign-area { margin-top: 40px; display:flex; justify-content:flex-end; gap:60px; font-size:13px; color:#555; }
.sign-line { border-top:1px solid #333; width:120px; text-align:center; padding-top:4px; margin-top:30px; }
</style>
</head>
<body>
<div class="no-print">
  <button class="back-btn" onclick="window.close(); location.href='/dashboard'">← 戻る</button>
  <button class="print-btn" onclick="window.print()">印刷する</button>
</div>
<div class="header-bar">
  <div class="title">個人実績評価表</div>
  <div class="meta">出力日：${today}</div>
</div>
<div class="name-big">${esc(name)}</div>

<h2>実績サマリー</h2>
<table>${rows}</table>

<h2>総合コメント</h2>
<div class="comment-box"><p>${comments.map(c => esc(c)).join('<br>')}</p></div>

<h2>行動・取り組み記録</h2>
<table>
  <tr><td class="label" style="width:22%">日付</td><td>内容</td></tr>
  ${freeRows || '<tr><td colspan="2" style="color:#9ca3af;text-align:center;padding:20px">記録なし</td></tr>'}
</table>

<div class="sign-area">
  <div><div class="sign-line">確認者</div></div>
  <div><div class="sign-line">院長</div></div>
</div>
</body>
</html>`);
});

// スタッフ個人実績ページ
app.get('/my-stats', async (req, res) => {
  const name = getStaffFromReq(req);
  if (!name) return res.redirect('/staff-login');
  const allRecords = await loadDB();
  const staffNames = await loadStaffNames();
  const settings = await loadStaffSettings();
  const goals = ((settings.find(s => s.staffName === name) || {}).goals) || {};

  // 月別集計
  const byMonth = {};
  for (const r of allRecords) {
    if (r.staffName !== name) continue;
    const month = r.date ? r.date.slice(0, 7) : null;
    if (!month) continue;
    if (!byMonth[month]) byMonth[month] = { count: 0, items: 0, recommend: 0, counseling: 0, approach: 0, reviews: 0, treatment: 0 };
    const m = byMonth[month];
    m.count++;
    if (r.entryType !== 'behavior') {
      const cat = r.actionCategory || ACTION_CATEGORY[r.action] || 'treatment';
      if (cat === 'item') m.items++;
      if (cat === 'item_recommend') m.recommend++;
      if (cat === 'counseling') m.counseling++;
      if (cat === 'counseling_approach') m.approach++;
      if (cat === 'review') m.reviews++;
      if (cat === 'treatment') m.treatment++;
    }
  }
  const months = Object.keys(byMonth).sort().slice(-6); // 直近6ヶ月
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
  const thisM = byMonth[thisMonth] || {};
  const lastM = byMonth[lastMonth] || {};

  function diffBadge(cur, prev) {
    if (!prev && !cur) return '';
    const d = (cur||0) - (prev||0);
    if (d > 0) return `<span style="color:#059669;font-size:11px;font-weight:700">▲${d}</span>`;
    if (d < 0) return `<span style="color:#ef4444;font-size:11px;font-weight:700">▼${Math.abs(d)}</span>`;
    return `<span style="color:#94a3b8;font-size:11px">→同じ</span>`;
  }
  function goalRow(label, key, cur, prev, goal) {
    const pct = goal > 0 ? Math.min(Math.round((cur||0)/goal*100),100) : null;
    const barColor = pct >= 100 ? '#059669' : pct >= 70 ? '#f59e0b' : '#2aab96';
    return `<tr>
      <td style="padding:10px 14px;font-weight:600;color:#334155;width:140px">${esc(label)}</td>
      <td style="padding:10px 14px;text-align:center;font-size:18px;font-weight:700;color:#0f766e">${cur||0}</td>
      <td style="padding:10px 14px;text-align:center;color:#64748b">${prev||0} ${diffBadge(cur,prev)}</td>
      <td style="padding:10px 14px">
        ${goal > 0 ? `
          <div style="font-size:11px;color:#64748b;margin-bottom:3px">目標${goal}件　${pct}%${pct>=100?' 🎉達成':''}</div>
          <div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:4px"></div>
          </div>
        ` : '<span style="color:#cbd5e1;font-size:12px">目標未設定</span>'}
      </td>
    </tr>`;
  }

  const rows = `
    ${goalRow('物品販売（購入）', 'items', thisM.items, lastM.items, goals.items)}
    ${goalRow('物品をすすめた', 'recommend', thisM.recommend, lastM.recommend, 0)}
    ${goalRow('ジャブ打ち', 'approach', thisM.approach, lastM.approach, goals.approach)}
    ${goalRow('カウンセリング成約', 'counseling', thisM.counseling, lastM.counseling, goals.counseling)}
    ${goalRow('口コミ獲得', 'reviews', thisM.reviews, lastM.reviews, goals.reviews)}
    ${goalRow('処置', 'treatment', thisM.treatment, lastM.treatment, 0)}
    ${goalRow('書き込み合計', 'count', thisM.count, lastM.count, 0)}
  `;

  // 日付別記録（カレンダー用）
  const byDate = {};
  for (const r of allRecords) {
    if (r.staffName !== name || !r.date) continue;
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push({
      action: r.action,
      patientNo: r.patientNo || '',
      itemName: r.itemName || '',
      freeText: r.freeText || ''
    });
  }

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>自分の実績 | 自己申告デラックス</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Sans JP',sans-serif;background:#f0f4f8;color:#1e293b;font-size:14px}
header{background:linear-gradient(135deg,#0f766e 0%,#2aab96 60%,#34d399 100%);padding:0;box-shadow:0 2px 12px rgba(15,118,110,.3)}
.header-inner{max-width:640px;margin:0 auto;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.header-left{display:flex;align-items:center;gap:12px}
.header-icon{width:38px;height:38px;background:rgba(255,255,255,.2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
header h1{font-size:16px;font-weight:700;color:#fff}
header p{font-size:11px;color:rgba(255,255,255,.8);margin-top:2px}
.header-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.logout-btn{background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:5px 11px;font-size:12px;font-weight:600;text-decoration:none;white-space:nowrap}
.container{max-width:640px;margin:0 auto;padding:20px 16px 60px}
.card{background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04);margin-bottom:18px;overflow:hidden}
.card-header{background:linear-gradient(135deg,#f0fdf4,#ecfdf5);padding:12px 16px;border-bottom:1px solid #a7f3d0;font-size:13px;font-weight:700;color:#065f46;display:flex;align-items:center;gap:6px}
.select-wrap{padding:16px}
select{width:100%;border:1.5px solid #e2e8f0;border-radius:10px;padding:10px 14px;font-size:15px;font-family:inherit;outline:none;background:#f8fafc}
select:focus{border-color:#2aab96}
table{width:100%;border-collapse:collapse}
thead th{background:#f8fafc;padding:8px 14px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #e2e8f0;text-align:left}
thead th:not(:first-child){text-align:center}
tbody tr{border-bottom:1px solid #f1f5f9;transition:background .1s}
tbody tr:hover{background:#f8fffe}
tbody tr:last-child{border-bottom:none}
.month-tag{display:inline-block;background:#ecfdf5;color:#065f46;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700}
.back-link{display:inline-flex;align-items:center;gap:6px;color:#0f766e;font-size:13px;font-weight:600;text-decoration:none;margin-bottom:16px;background:#fff;padding:8px 14px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.cal-nav{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e2e8f0}
.cal-nav button{background:#f1f5f9;border:none;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700;color:#0f766e;cursor:pointer;font-family:inherit}
.cal-nav button:hover{background:#e0f2f1}
.cal-nav .cal-title{font-size:15px;font-weight:700;color:#0f766e}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);padding:10px 8px 14px}
.cal-dow{text-align:center;font-size:10px;font-weight:700;color:#94a3b8;padding:4px 0 6px;letter-spacing:.04em}
.cal-dow.sun{color:#ef4444}.cal-dow.sat{color:#3b82f6}
.cal-day{min-height:56px;border-radius:8px;padding:4px;margin:2px;cursor:pointer;transition:background .15s;position:relative}
.cal-day:hover{background:#f0fdf4}
.cal-day.today{background:#ecfdf5;outline:2px solid #2aab96}
.cal-day.has-record{cursor:pointer}
.cal-day.other-month{opacity:.3;pointer-events:none}
.cal-day-num{font-size:11px;font-weight:700;color:#334155;margin-bottom:2px}
.cal-day-num.sun{color:#ef4444}.cal-day-num.sat{color:#3b82f6}
.cal-dot{font-size:10px;line-height:1.4;color:#0f766e;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cal-detail{background:#f0fdf4;border:1px solid #a7f3d0;border-radius:10px;padding:14px 16px;margin:0 8px 14px;font-size:13px}
.cal-detail-date{font-weight:700;color:#065f46;margin-bottom:8px;font-size:14px}
.cal-detail-item{display:flex;align-items:flex-start;gap:6px;padding:5px 0;border-bottom:1px solid #d1fae5;color:#334155}
.cal-detail-item:last-child{border-bottom:none}
.cal-detail-item::before{content:'•';color:#2aab96;font-weight:700;flex-shrink:0}
</style>
</head>
<body>
<header>
  <div class="header-inner">
    <div class="header-left">
      <div class="header-icon">📊</div>
      <div><h1>自分の実績</h1><p>${esc(name)} さん</p></div>
    </div>
    <div class="header-right">
      <a href="/staff-logout" class="logout-btn">ログアウト</a>
    </div>
  </div>
</header>
<div class="container">
  <a href="/" class="back-link">← 入力フォームへ戻る</a>

  <div class="card">
    <div class="card-header">📅 今月の実績 vs 先月 <span class="month-tag">${thisMonth}</span></div>
    <div style="overflow-x:auto">
    <table>
      <thead><tr><th>項目</th><th>今月</th><th>先月</th><th>目標・達成率</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
  </div>

  <div class="card" id="calCard">
    <div class="cal-nav">
      <button onclick="moveMonth(-1)">&#8592; 前月</button>
      <span class="cal-title" id="calTitle"></span>
      <button onclick="moveMonth(1)">次月 &#8594;</button>
    </div>
    <div class="cal-grid" id="calGrid"></div>
    <div id="calDetail"></div>
  </div>
</div>
<script>
const BY_DATE = ${JSON.stringify(byDate)};
const WEEKDAYS = ['日','月','火','水','木','金','土'];
let calYear, calMonth;

// JST今日
const _jst = new Date(Date.now() + 9*60*60*1000);
const TODAY = _jst.getUTCFullYear() + '-' + String(_jst.getUTCMonth()+1).padStart(2,'0') + '-' + String(_jst.getUTCDate()).padStart(2,'0');
calYear = _jst.getUTCFullYear();
calMonth = _jst.getUTCMonth(); // 0-indexed

function moveMonth(d) {
  calMonth += d;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCal();
  document.getElementById('calDetail').innerHTML = '';
}

function renderCal() {
  const title = calYear + '年' + (calMonth+1) + '月';
  document.getElementById('calTitle').textContent = title;
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  ['日','月','火','水','木','金','土'].forEach((w,i) => {
    const d = document.createElement('div');
    d.className = 'cal-dow' + (i===0?' sun':i===6?' sat':'');
    d.textContent = w;
    grid.appendChild(d);
  });
  const first = new Date(calYear, calMonth, 1).getDay(); // day of week of 1st
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  // blank cells before 1st
  for (let i=0; i<first; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day other-month';
    grid.appendChild(cell);
  }
  for (let day=1; day<=daysInMonth; day++) {
    const dateStr = calYear + '-' + String(calMonth+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
    const dow = (first + day - 1) % 7;
    const records = BY_DATE[dateStr] || [];
    const cell = document.createElement('div');
    cell.className = 'cal-day' + (dateStr===TODAY?' today':'') + (records.length?' has-record':'');
    const numEl = document.createElement('div');
    numEl.className = 'cal-day-num' + (dow===0?' sun':dow===6?' sat':'');
    numEl.textContent = day;
    cell.appendChild(numEl);
    records.slice(0,3).forEach(r => {
      const dot = document.createElement('div');
      dot.className = 'cal-dot';
      dot.textContent = r.action;
      cell.appendChild(dot);
    });
    if (records.length > 3) {
      const more = document.createElement('div');
      more.style.cssText = 'font-size:10px;color:#94a3b8';
      more.textContent = '+' + (records.length-3) + '件';
      cell.appendChild(more);
    }
    if (records.length) {
      cell.onclick = () => showDetail(dateStr, records);
    }
    grid.appendChild(cell);
  }
}

function showDetail(dateStr, records) {
  const det = document.getElementById('calDetail');
  const [y,m,d] = dateStr.split('-');
  const dow = WEEKDAYS[new Date(+y,+m-1,+d).getDay()];
  let html = '<div class="cal-detail"><div class="cal-detail-date">📅 ' + y+'年'+parseInt(m)+'月'+parseInt(d)+'日（'+dow+'）' + ' — ' + records.length + '件</div>';
  records.forEach(r => {
    let txt = r.action;
    if (r.patientNo) txt += '　患者番号：' + r.patientNo;
    if (r.itemName) txt += '　' + r.itemName;
    if (r.freeText) txt += '　' + r.freeText;
    html += '<div class="cal-detail-item">' + txt.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div>';
  });
  html += '</div>';
  det.innerHTML = html;
  det.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

renderCal();
<\/script>
</body>
</html>`);
});

app.get('/health', (_req, res) => res.send('OK'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`スタッフ実績サーバー起動: port=${PORT}`));
