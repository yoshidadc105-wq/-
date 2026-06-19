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
app.put('/admin/action-config/groups', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { groups } = req.body;
  if (!Array.isArray(groups)) return res.status(400).json({ error: 'groups required' });
  const config = await loadActionConfig();
  config.groups = groups;
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
  { id: 'i11', name: 'シーラント', group: '処置', category: 'treatment', needsPatient: true, needsCount: true, builtin: true, order: 10 },
  { id: 'i16', name: 'X線パック　小児', group: '処置', category: 'treatment', needsPatient: true, builtin: true, order: 11 },
  { id: 'i17', name: 'P検', group: '処置', category: 'treatment', needsPatient: true, builtin: true, order: 12 },
  { id: 'i12', name: 'X線パック　成人', group: '処置', category: 'treatment', needsPatient: true, builtin: true, order: 13 },
  { id: 'i13', name: 'フッ素塗布', group: '処置', category: 'treatment', needsPatient: true, builtin: true, defaultHidden: true, order: 14 },
  { id: 'i01', name: '物品を販売した（購入）', group: '物品', category: 'item', needsPatient: true, showItemName: true, builtin: true, order: 20 },
  { id: 'i02', name: '物品をすすめた（未購入）', group: '物品', category: 'item_recommend', needsPatient: true, showItemName: true, builtin: true, defaultHidden: true, order: 21 },
  { id: 'i09', name: 'アポ転換', group: 'アポ管理', category: 'appointment', needsPatient: true, builtin: true, defaultHidden: true, order: 30 },
  { id: 'i14', name: 'ポジティブな行動をした', group: 'チームサポート', category: 'team_support', needsFreeText: true, builtin: true, order: 40 },
  { id: 'i15', name: 'ファン患者を獲得した', group: 'ファン獲得', category: 'fan', needsPatient: true, builtin: true, order: 50 },
  { id: 'i03', name: 'インプラントジャブ打ち', group: 'カウンセリング', category: 'counseling_approach', needsPatient: true, builtin: true, defaultHidden: true, order: 90 },
  { id: 'i04', name: 'マウスピース矯正ジャブ打ち', group: 'カウンセリング', category: 'counseling_approach', needsPatient: true, builtin: true, defaultHidden: true, order: 91 },
  { id: 'i05', name: 'ホワイトニングジャブ打ち', group: 'カウンセリング', category: 'counseling_approach', needsPatient: true, builtin: true, defaultHidden: true, order: 92 },
  { id: 'i06', name: 'インプラント成約', group: 'カウンセリング', category: 'counseling', needsPatient: true, builtin: true, defaultHidden: true, order: 93 },
  { id: 'i07', name: 'マウスピース矯正成約', group: 'カウンセリング', category: 'counseling', needsPatient: true, builtin: true, defaultHidden: true, order: 94 },
  { id: 'i08', name: 'ホワイトニング成約', group: 'カウンセリング', category: 'counseling', needsPatient: true, builtin: true, defaultHidden: true, order: 95 },
  { id: 'i10', name: '口コミ獲得', group: '口コミ', category: 'review', needsPatient: true, isKuchikomi: true, builtin: true, defaultHidden: true, order: 96 },
];

async function loadActionItems() {
  // ビルトイン項目は常にデフォルト定義をマージ＆不足分を追加する
  function mergeWithDefaults(items) {
    const defMap = Object.fromEntries(DEFAULT_ACTION_ITEMS.map(d => [d.id, d]));
    const idSet = new Set(items.map(i => i.id));
    // 既存アイテムをデフォルト定義でマージ
    const merged = items.map(item => item.builtin && defMap[item.id]
      ? { ...defMap[item.id], ...item,
          name: defMap[item.id].name,
          showItemName: defMap[item.id].showItemName, needsPatient: defMap[item.id].needsPatient,
          needsCount: defMap[item.id].needsCount, typeOptions: defMap[item.id].typeOptions,
          needsFreeText: defMap[item.id].needsFreeText, category: defMap[item.id].category,
          defaultHidden: defMap[item.id].defaultHidden, order: defMap[item.id].order }
      : item);
    // DBに存在しない新しいビルトイン項目を追加
    const missing = DEFAULT_ACTION_ITEMS.filter(d => !idSet.has(d.id));
    return [...merged, ...missing].sort((a, b) => (a.order||999) - (b.order||999));
  }
  if (actionItemsCol) {
    const items = await actionItemsCol.find({}).sort({ order: 1, _id: 1 }).toArray();
    return items.length ? mergeWithDefaults(items) : DEFAULT_ACTION_ITEMS;
  }
  try {
    const items = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8'));
    return items.length ? mergeWithDefaults(items) : DEFAULT_ACTION_ITEMS;
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
  const allItems = await loadActionItems();
  const defaultDisabled = allItems.filter(i => i.defaultHidden).map(i => i.name);
  await saveStaffSetting(staffName.trim(), { disabledItems: defaultDisabled });
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

app.delete('/admin/staff-records/:name', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const name = decodeURIComponent(req.params.name);
  if (mongoCol) {
    await mongoCol.deleteMany({ staffName: name });
  } else {
    const all = await loadDB();
    const filtered = all.filter(r => r.staffName !== name);
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(filtered, null, 2));
  }
  console.log(`スタッフ記録削除: ${name}`);
  res.json({ ok: true });
});

// 管理者がスタッフとしてログイン（なりすまし）
app.get('/admin/login-as/:name', (req, res) => {
  if (!checkAuth(req, res)) return;
  const name = decodeURIComponent(req.params.name);
  const token = createStaffToken(name);
  res.setHeader('Set-Cookie', `staffSession=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`);
  res.redirect('/my-stats');
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

// 管理者セッション
function createAdminToken() {
  const payload = Buffer.from('admin').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload + '_admin').digest('hex');
  return `${payload}.${sig}`;
}
function verifyAdminToken(token) {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload + '_admin').digest('hex');
  return sig === expected;
}
function getAdminFromReq(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/adminSession=([^;]+)/);
  if (!match) return false;
  return verifyAdminToken(decodeURIComponent(match[1]));
}

function checkAuth(req, res) {
  if (getAdminFromReq(req)) return true;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Basic ')) {
    const pass = Buffer.from(auth.slice(6), 'base64').toString().slice(
      Buffer.from(auth.slice(6), 'base64').toString().indexOf(':') + 1
    );
    if (pass === ADMIN_PASSWORD) return true;
  }
  // AJAXリクエストには401、通常リクエストはログインページへ
  const isAjax = req.headers['content-type']?.includes('application/json') || req.headers['x-requested-with'] === 'XMLHttpRequest';
  if (isAjax) { res.status(401).json({ error: '認証が必要です' }); }
  else { res.redirect('/dashboard-login'); }
  return false;
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

// 評価者フラグ設定
app.post('/admin/staff-evaluator', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { staffName, isEvaluator } = req.body;
  await saveStaffSetting(staffName, { isEvaluator: !!isEvaluator });
  res.json({ ok: true });
});

// ピア評価フォームページ
app.get('/peer-eval', async (req, res) => {
  const fromStaff = getStaffFromReq(req);
  if (!fromStaff) return res.redirect('/staff-login');
  const settings = await loadStaffSettings();
  const mySetting = settings.find(s => s.staffName === fromStaff) || {};
  if (!mySetting.isEvaluator) return res.status(403).send('評価権限がありません');
  const allNames = await loadStaffNames();
  const evaluatorNames = settings.filter(s => s.isEvaluator).map(s => s.staffName);
  const targetNames = allNames.filter(n => !evaluatorNames.includes(n));
  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>スタッフ評価</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Sans JP',sans-serif;background:linear-gradient(160deg,#071020 0%,#0d1f35 50%,#071020 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;position:relative;overflow:hidden}
body::before{content:'';position:absolute;top:-100px;left:50%;transform:translateX(-50%);width:500px;height:500px;background:radial-gradient(circle,rgba(42,171,150,.12) 0%,transparent 70%);pointer-events:none}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:32px 28px 28px;width:100%;max-width:420px;box-shadow:0 24px 80px rgba(0,0,0,.5);backdrop-filter:blur(12px)}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
.header h1{font-size:18px;font-weight:900;color:#fff}
.from-badge{font-size:11px;color:rgba(255,255,255,.45);background:rgba(255,255,255,.07);border-radius:20px;padding:4px 12px}
label{display:block;font-size:12px;font-weight:700;color:rgba(255,255,255,.5);margin-bottom:6px;letter-spacing:.04em}
.form-group{margin-bottom:18px}
select{width:100%;border:1.5px solid rgba(255,255,255,.1);border-radius:12px;padding:13px 16px;font-size:15px;font-family:inherit;outline:none;background:rgba(255,255,255,.06);color:#e2e8f0;transition:border .2s}
select:focus{border-color:#2aab96;background:rgba(42,171,150,.08);box-shadow:0 0 0 3px rgba(42,171,150,.2)}
select option{background:#0d1f35;color:#e2e8f0}
.point-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:4px}
.point-btn{border:2px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 8px;font-family:inherit;cursor:pointer;background:rgba(255,255,255,.04);color:#e2e8f0;text-align:center;transition:all .2s}
.point-btn:hover{transform:translateY(-2px)}
.point-btn.gold{border-color:#f59e0b}
.point-btn.silver{border-color:#94a3b8}
.point-btn.bronze{border-color:#cd7c2f}
.point-btn.selected.gold{background:rgba(245,158,11,.2);border-color:#f59e0b;box-shadow:0 0 16px rgba(245,158,11,.3)}
.point-btn.selected.silver{background:rgba(148,163,184,.2);border-color:#94a3b8;box-shadow:0 0 16px rgba(148,163,184,.3)}
.point-btn.selected.bronze{background:rgba(205,124,47,.2);border-color:#cd7c2f;box-shadow:0 0 16px rgba(205,124,47,.3)}
.point-emoji{font-size:28px;margin-bottom:6px}
.point-name{font-size:13px;font-weight:700}
.point-score{font-size:11px;color:rgba(255,255,255,.45);margin-top:2px}
textarea{width:100%;border:1.5px solid rgba(255,255,255,.1);border-radius:12px;padding:13px 16px;font-size:14px;font-family:inherit;outline:none;background:rgba(255,255,255,.06);color:#e2e8f0;resize:vertical;min-height:90px;transition:border .2s}
textarea:focus{border-color:#2aab96;background:rgba(42,171,150,.08);box-shadow:0 0 0 3px rgba(42,171,150,.2)}
textarea::placeholder{color:rgba(255,255,255,.25)}
.btn{display:block;width:100%;background:linear-gradient(135deg,#0f766e,#2aab96);color:#fff;border:none;border-radius:14px;padding:15px;font-size:16px;font-weight:700;font-family:inherit;cursor:pointer;box-shadow:0 4px 20px rgba(42,171,150,.5);margin-top:8px;letter-spacing:.05em;transition:opacity .2s,transform .1s}
.btn:hover{opacity:.9}
.btn:active{transform:scale(.98)}
.btn:disabled{background:rgba(255,255,255,.1);color:rgba(255,255,255,.3);box-shadow:none;cursor:not-allowed}
.error{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#f87171;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:14px;display:none}
.success{background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.3);color:#34d399;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:14px;display:none;text-align:center}
.nav-link{display:block;text-align:center;margin-top:16px;font-size:12px;color:rgba(255,255,255,.35);text-decoration:none}
.nav-link:hover{color:rgba(255,255,255,.6)}
.star{position:fixed;border-radius:50%;background:white;pointer-events:none}
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>⭐ スタッフ評価</h1>
    <span class="from-badge">評価者：${esc(fromStaff)}</span>
  </div>
  <div class="error" id="err"></div>
  <div class="success" id="suc"></div>
  <div class="form-group">
    <label>評価するスタッフ</label>
    <select id="toStaff">
      <option value="">選択してください</option>
      ${targetNames.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
    </select>
  </div>
  <div class="form-group">
    <label>ポイント</label>
    <div class="point-grid">
      <button type="button" class="point-btn gold" onclick="selectPoint('gold',5,this)">
        <div class="point-emoji">🥇</div>
        <div class="point-name">ゴールド</div>
        <div class="point-score">5ポイント</div>
      </button>
      <button type="button" class="point-btn silver" onclick="selectPoint('silver',3,this)">
        <div class="point-emoji">🥈</div>
        <div class="point-name">シルバー</div>
        <div class="point-score">3ポイント</div>
      </button>
      <button type="button" class="point-btn bronze" onclick="selectPoint('bronze',1,this)">
        <div class="point-emoji">🥉</div>
        <div class="point-name">ブロンズ</div>
        <div class="point-score">1ポイント</div>
      </button>
    </div>
  </div>
  <div class="form-group">
    <label>評価の理由</label>
    <textarea id="reason" placeholder="どんな行動が良かったか記入してください"></textarea>
  </div>
  <button class="btn" id="submitBtn" onclick="doSubmit()">評価を送る</button>
  <a href="/my-stats" class="nav-link">← 自分の実績に戻る</a>
</div>
<script>
var selectedPoint = null, selectedScore = 0;
function selectPoint(type, score, btn) {
  document.querySelectorAll('.point-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedPoint = type; selectedScore = score;
}
for(var i=0;i<20;i++){var s=document.createElement('div');s.className='star';var sz=Math.random()*2+0.5;s.style.cssText='width:'+sz+'px;height:'+sz+'px;top:'+(Math.random()*100)+'%;left:'+(Math.random()*100)+'%;opacity:'+(Math.random()*0.5+0.1);document.body.appendChild(s);}
async function doSubmit() {
  var toStaff = document.getElementById('toStaff').value;
  var reason = document.getElementById('reason').value.trim();
  var err = document.getElementById('err');
  var suc = document.getElementById('suc');
  err.style.display = 'none'; suc.style.display = 'none';
  if (!toStaff) { err.textContent='評価するスタッフを選択してください'; err.style.display='block'; return; }
  if (!selectedPoint) { err.textContent='ポイントを選択してください'; err.style.display='block'; return; }
  if (!reason) { err.textContent='評価の理由を入力してください'; err.style.display='block'; return; }
  var btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = '送信中...';
  try {
    var res = await fetch('/peer-eval', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ toStaff, pointType: selectedPoint, points: selectedScore, reason }) });
    if (res.ok) {
      suc.textContent = toStaff + 'さんに' + (selectedPoint==='gold'?'🥇ゴールド':selectedPoint==='silver'?'🥈シルバー':'🥉ブロンズ') + 'ポイントを送りました！';
      suc.style.display = 'block';
      document.getElementById('toStaff').value = '';
      document.getElementById('reason').value = '';
      document.querySelectorAll('.point-btn').forEach(b => b.classList.remove('selected'));
      selectedPoint = null; selectedScore = 0;
    } else {
      var d = await res.json();
      err.textContent = d.error || '送信に失敗しました'; err.style.display = 'block';
    }
  } catch(e) { err.textContent = '通信エラーが発生しました'; err.style.display = 'block'; }
  btn.disabled = false; btn.textContent = '評価を送る';
}
</script>
</body>
</html>`);
});

app.post('/peer-eval', async (req, res) => {
  const fromStaff = getStaffFromReq(req);
  if (!fromStaff) return res.status(401).json({ error: '未ログイン' });
  const settings = await loadStaffSettings();
  const mySetting = settings.find(s => s.staffName === fromStaff) || {};
  if (!mySetting.isEvaluator) return res.status(403).json({ error: '評価権限がありません' });
  const { toStaff, pointType, points, reason } = req.body;
  if (!toStaff || !pointType || !points || !reason) return res.status(400).json({ error: '入力が不足しています' });
  const POINT_MAP = { gold: 5, silver: 3, bronze: 1 };
  if (POINT_MAP[pointType] !== points) return res.status(400).json({ error: '不正なポイント値' });
  await saveRecord({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    entryType: 'peer_eval',
    date: new Date(Date.now() + 9*60*60*1000).toISOString().slice(0,10),
    staffName: toStaff,
    fromStaff,
    pointType,
    points,
    reason,
    action: 'その他',
    actionCategory: 'other',
  });
  console.log(`ピア評価: ${fromStaff} → ${toStaff} ${pointType}(${points}pt)`);
  res.json({ ok: true });
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
  '物品を販売した（購入）': 'item',
  '物品をすすめた（未購入）': 'item_recommend',
  '口コミ獲得': 'review',
  'インプラントジャブ打ち': 'counseling_approach',
  'マウスピース矯正ジャブ打ち': 'counseling_approach',
  'ホワイトニングジャブ打ち': 'counseling_approach',
  'インプラント成約': 'counseling',
  'マウスピース矯正成約': 'counseling',
  'ホワイトニング成約': 'counseling',
  'アポ転換': 'appointment',
  'シーラント': 'treatment',
  'レントゲン': 'treatment',
  'レントゲン（CT・パノラマ／臼歯デンタル）': 'treatment',
  'X線パック　成人': 'treatment',
  'X線パック　小児': 'treatment',
  'P検': 'treatment',
  'フッ素塗布': 'treatment',
  'ポジティブ声掛け': 'team_support',
  'ポジティブな行動をした': 'team_support',
  'ファン患者を獲得した': 'fan',
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
  // 時間制限チェック（JST 13:30〜14:25 / 18:45〜翌9:00のみ受付）
  const jstMs = Date.now() + 9 * 60 * 60 * 1000;
  const jstH = new Date(jstMs).getUTCHours();
  const jstMin = new Date(jstMs).getUTCMinutes();
  const totalMin = jstH * 60 + jstMin;
  const isOpen = (totalMin >= 13 * 60 + 30 && totalMin <= 14 * 60 + 25)
              || totalMin >= 18 * 60 + 45
              || totalMin <= 9 * 60;
  if (!isOpen) return res.status(403).json({ error: 'time_restricted', message: '入力可能時間外です（13:30〜14:25 / 18:45〜翌9:00）' });
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
    return res.status(409).json({ error: 'duplicate', message: `患者番号 ${patientNo} の「${d.action}」はすでに登録しています` });
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
    countValue: d.countValue ? (parseInt(d.countValue) || null) : null,
    otherText: d.otherText ? d.otherText.trim() : '',
  });
  console.log(`患者実績登録: ${d.staffName} 患者${d.patientNo} ${d.action} (${d.date})`);
  res.status(200).json({ ok: true });
});

app.get('/dashboard-login', (req, res) => {
  if (getAdminFromReq(req)) return res.redirect('/dashboard');
  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ダッシュボード ログイン</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Noto Sans JP',sans-serif;background:linear-gradient(160deg,#071020 0%,#0d1f35 50%,#071020 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:40px 32px 36px;width:100%;max-width:380px;box-shadow:0 24px 80px rgba(0,0,0,.5);backdrop-filter:blur(12px)}
    .logo{text-align:center;margin-bottom:32px}
    .logo-icon{width:72px;height:72px;background:linear-gradient(135deg,#0f766e,#2aab96);border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:34px;margin:0 auto 14px;box-shadow:0 0 30px rgba(42,171,150,.5)}
    .logo h1{font-size:18px;font-weight:900;color:#fff}
    .logo p{font-size:12px;color:rgba(255,255,255,.4);margin-top:4px}
    label{display:block;font-size:12px;font-weight:700;color:rgba(255,255,255,.5);margin-bottom:6px;letter-spacing:.04em}
    input[type=password]{width:100%;border:1.5px solid rgba(255,255,255,.1);border-radius:12px;padding:13px 16px;font-size:15px;font-family:inherit;outline:none;background:rgba(255,255,255,.06);color:#e2e8f0;transition:border .2s,box-shadow .2s}
    input::placeholder{color:rgba(255,255,255,.25)}
    input:focus{border-color:#2aab96;background:rgba(42,171,150,.08);box-shadow:0 0 0 3px rgba(42,171,150,.2)}
    .btn{display:block;width:100%;background:linear-gradient(135deg,#0f766e,#2aab96);color:#fff;border:none;border-radius:14px;padding:15px;font-size:16px;font-weight:700;font-family:inherit;cursor:pointer;margin-top:20px;letter-spacing:.05em;box-shadow:0 4px 20px rgba(42,171,150,.5)}
    .btn:active{transform:scale(.98)}
    .error{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#f87171;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:16px;display:none}
  </style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="logo-icon">📊</div>
    <h1>実績ダッシュボード</h1>
    <p>のびのび歯科・矯正歯科</p>
  </div>
  <div class="error" id="err"></div>
  <label>パスワード</label>
  <input type="password" id="pw" placeholder="パスワードを入力" autocomplete="current-password"/>
  <button class="btn" onclick="doLogin()">ログイン</button>
</div>
<script>
  document.getElementById('pw').addEventListener('keydown',function(e){if(e.key==='Enter')doLogin()});
  async function doLogin(){
    var pw=document.getElementById('pw').value;
    var err=document.getElementById('err');
    err.style.display='none';
    if(!pw){err.textContent='パスワードを入力してください';err.style.display='block';return;}
    var res=await fetch('/dashboard-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
    if(res.ok){location.href='/dashboard';}
    else{var d=await res.json();err.textContent=d.error||'ログインに失敗しました';err.style.display='block';}
  }
</script>
</body>
</html>`);
});

app.post('/dashboard-login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'パスワードが違います' });
  }
  const token = createAdminToken();
  res.setHeader('Set-Cookie', `adminSession=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  res.json({ ok: true });
});

app.get('/dashboard-logout', (req, res) => {
  res.setHeader('Set-Cookie', 'adminSession=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.redirect('/dashboard-login');
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
      byStaff[r.staffName] = { count: 0, actionMap: {}, patients: new Set(), freePhrases: [], itemsMap: {}, counselingMap: {}, treatmentMap: {}, reviews: 0 };
    }
    const s = byStaff[r.staffName];
    s.count++;
    if (r.entryType === 'behavior') {
      if (r.freeText) s.freePhrases.push(r.freeText);
    } else {
      s.actionMap[r.action] = (s.actionMap[r.action] || 0) + 1;
      const cat = ACTION_CATEGORY[r.action] || r.actionCategory || 'treatment';
      const label = r.action + (r.itemName ? `（${r.itemName}）` : '') + (r.otherText ? `（${r.otherText}）` : '');
      if (cat === 'item')    s.itemsMap[label] = (s.itemsMap[label] || 0) + 1;
      if (cat === 'counseling') s.counselingMap[r.action] = (s.counselingMap[r.action] || 0) + 1;
      if (cat === 'treatment')  s.treatmentMap[r.action] = (s.treatmentMap[r.action] || 0) + 1;
      if (cat === 'review')     s.reviews++;
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
      const cat = ACTION_CATEGORY[r.action] || r.actionCategory || 'treatment';
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

  // ONになっているアイテムをグループ別にまとめてカラム定義を作る
  const dashItems = await loadActionItems();
  const enabledItems = dashItems.filter(i => !i.defaultHidden);
  const groupOrder = [];
  const groupItemsMap = {};
  for (const item of enabledItems) {
    if (!groupItemsMap[item.group]) { groupItemsMap[item.group] = []; groupOrder.push(item.group); }
    groupItemsMap[item.group].push(item.name);
  }

  const thCols = groupOrder.map(g => `<th class="num">${esc(g)}</th>`).join('');

  const summaryRows = staffList.map(([name, s]) => {
    const initial = name.charAt(0);
    const groupCells = groupOrder.map(g => {
      const names = groupItemsMap[g];
      const total = names.reduce((sum, n) => sum + (s.actionMap[n] || 0), 0);
      const detail = names.map(n => s.actionMap[n] ? `${n}:${s.actionMap[n]}` : null).filter(Boolean).join('、');
      const badge = total > 0 ? `<span class="badge badge-gray">${total}</span>` : `<span style="color:#cbd5e1">0</span>`;
      return `<td class="num">${badge}${detail ? `<br><small style="color:#94a3b8;font-size:10px">${esc(detail)}</small>` : ''}</td>`;
    }).join('');

    const stSetting = staffSettings.find(x => x.staffName === name) || {};
    const g = stSetting.goals || {};
    const goalParts = enabledItems.map(item => {
      const cur = s.actionMap[item.name] || 0;
      const target = g[item.name] || 0;
      if (!target) return null;
      const pct = Math.min(Math.round(cur / target * 100), 100);
      const color = pct >= 100 ? '#059669' : pct >= 70 ? '#f59e0b' : '#2aab96';
      return `<div style="font-size:11px;color:#64748b">${esc(item.name)} ${cur}/${target}</div>
        <div style="height:5px;background:#e2e8f0;border-radius:3px;margin:2px 0 4px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
        </div>`;
    }).filter(Boolean).join('');

    return `
      <tr class="staff-row" onclick="openModal('${esc(name).replace(/'/g, "\\'")}')">
        <td><span class="avatar">${esc(initial)}</span><strong>${esc(name)}</strong></td>
        <td class="num"><span class="badge badge-gray">${s.count}</span></td>
        <td class="num">${s.patients.size}</td>
        ${groupCells}
        <td onclick="event.stopPropagation()" style="min-width:100px">
          ${goalParts || '<span style="color:#cbd5e1;font-size:11px">未設定</span>'}
        </td>
        <td onclick="event.stopPropagation()" style="white-space:nowrap">
          <a href="/admin/login-as/${encodeURIComponent(name)}" class="btn-eval" style="background:linear-gradient(135deg,#6366f1,#818cf8)">👤 本人画面</a>
          <a href="/certificate?name=${encodeURIComponent(name)}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}" target="_blank" class="btn-cert">賞状</a>
          <a href="/evaluation?name=${encodeURIComponent(name)}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}" target="_blank" class="btn-eval">評価表</a>
          <button onclick="deleteStaffRecords('${esc(name)}')" style="background:rgba(239,68,68,.1);color:#dc2626;border:1px solid rgba(239,68,68,.3);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">🗑 記録削除</button>
        </td>
      </tr>`;
  }).join('');

  const detailRows = records.slice().reverse().slice(0, 100).map(r => {
    const countPart = r.countValue ? `　${r.countValue}${r.action === 'シーラント' ? '本' : '件'}` : '';
    const actionLabel = r.action ? `<span class="badge badge-gray">${esc(r.action)}${countPart}${r.itemName ? `（${esc(r.itemName)}）` : ''}${r.otherText ? `（${esc(r.otherText)}）` : ''}</span>` : '-';
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

  // KPIサマリー（アクション名別集計）
  const actionTotals = {};
  const actionCountTotals = {}; // countValueの合計（シーラント本数など）
  for (const r of records) {
    if (r.entryType === 'behavior' || !r.action) continue;
    actionTotals[r.action] = (actionTotals[r.action] || 0) + 1;
    if (r.countValue) actionCountTotals[r.action] = (actionCountTotals[r.action] || 0) + r.countValue;
  }
  const totalPatients = new Set(records.filter(r=>r.patientNo).map(r=>r.patientNo)).size;
  // ONになっているデフォルト項目（defaultHidden=falseのもの）のKPIカード
  const actionItems4kpi = await loadActionItems();
  const kpiItems = actionItems4kpi.filter(i => !i.defaultHidden);
  const kpiColors = ['green','blue','orange','purple','teal','pink'];
  const kpiCards = kpiItems.map((item, idx) => {
    const cnt = actionTotals[item.name] || 0;
    const color = kpiColors[idx % kpiColors.length];
    const totalCount = actionCountTotals[item.name];
    const countLine = totalCount ? `<div class="kpi-sub" style="margin-top:2px">合計 ${totalCount}本</div>` : '';
    return `<div class="kpi-card ${color}">
      <div class="kpi-label">${esc(item.name)}</div>
      <div class="kpi-value">${cnt}</div>
      <div class="kpi-sub">合計件数</div>
      ${countLine}
    </div>`;
  }).join('') + `<div class="kpi-card green">
    <div class="kpi-label">登録患者数</div>
    <div class="kpi-value">${totalPatients}</div>
    <div class="kpi-sub">ユニーク患者番号</div>
  </div>`;

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
.kpi-card.teal{border-color:#14b8a6}
.kpi-card.pink{border-color:#ec4899}
.kpi-card.teal .kpi-value{color:#0d9488}
.kpi-card.pink .kpi-value{color:#db2777}
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
      <a href="/dashboard-logout" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:5px 12px;font-size:12px;font-weight:600;text-decoration:none">ログアウト</a>
    </div>
  </div>
</header>

<div class="container">

  <!-- KPIカード -->
  <div class="kpi-grid">
    ${kpiCards}
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
        <th>スタッフ</th><th class="num">書き込み</th><th class="num">患者数</th>
        ${thCols}
        <th>目標進捗</th><th>出力</th>
      </tr></thead>
      <tbody>${summaryRows || `<tr><td colspan="${4 + groupOrder.length}" class="empty">まだデータがありません</td></tr>`}</tbody>
    </table>
    </div>
  </div>

  <!-- 入力履歴 -->
  <div class="section-header"><h2>入力履歴（新しい順）</h2><div class="section-line"></div></div>
  <div class="filter-card" style="margin-bottom:12px">
    <label>スタッフ</label>
    <select id="hStaff" style="border:1.5px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;font-family:inherit;background:#f8fafc">
      <option value="">全員</option>
      ${allStaffNames.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}
    </select>
    <label>日付</label>
    <input type="date" id="hFrom" style="border:1.5px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;font-family:inherit;background:#f8fafc">
    <span style="color:#cbd5e1">—</span>
    <input type="date" id="hTo" style="border:1.5px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;font-family:inherit;background:#f8fafc">
    <button onclick="filterHistory()" class="btn-primary">絞り込む</button>
    <button onclick="clearHistory()" class="btn-reset">クリア</button>
    <span id="hCount" style="font-size:12px;color:#64748b"></span>
  </div>
  <div class="table-card">
    <div class="table-scroll">
    <table id="historyTable">
      <thead><tr>
        <th>日付</th><th>スタッフ</th><th>患者番号</th><th>実施内容</th><th>自由記入</th>
      </tr></thead>
      <tbody id="historyBody">${detailRows || '<tr><td colspan="5" class="empty">まだデータがありません</td></tr>'}</tbody>
    </table>
    </div>
  </div>
  <script>
  function filterHistory() {
    var staff = document.getElementById('hStaff').value;
    var from = document.getElementById('hFrom').value;
    var to = document.getElementById('hTo').value;
    var rows = document.querySelectorAll('#historyBody tr');
    var shown = 0;
    rows.forEach(function(tr) {
      var tds = tr.querySelectorAll('td');
      if (tds.length < 2) { tr.style.display=''; return; }
      var date = tds[0].textContent.trim();
      var s = tds[1].querySelector('strong');
      var sName = s ? s.textContent.trim() : tds[1].textContent.trim();
      var ok = (!staff || sName === staff) && (!from || date >= from) && (!to || date <= to);
      tr.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    document.getElementById('hCount').textContent = shown + '件表示中';
  }
  function clearHistory() {
    document.getElementById('hStaff').value = '';
    document.getElementById('hFrom').value = '';
    document.getElementById('hTo').value = '';
    document.querySelectorAll('#historyBody tr').forEach(function(tr){ tr.style.display=''; });
    document.getElementById('hCount').textContent = '';
  }
  <\/script>

  <!-- スタッフ設定（週間目標 + 項目表示） -->
  <div class="section-header"><h2>スタッフ設定</h2><div class="section-line"></div></div>
  <div class="mgmt-card" style="max-width:760px">
    <div style="margin-bottom:14px;padding:10px 14px;background:#fefce8;border:1px solid #fde047;border-radius:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:11px;color:#713f12;font-weight:600">⚠️ 一括操作</span>
      <button onclick="fixCategories()" style="background:#d97706;color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">一括修正を実行</button>
      <button onclick="fixItemOrder()" style="background:#0f766e;color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">項目順番を更新</button>
      <button onclick="applyDefaultVisibility()" style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">全スタッフに表示設定を適用</button>
      <button onclick="debugActions()" style="background:#0f766e;color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">📋 アクション確認</button>
      <span id="fixCatMsg" style="font-size:11px"></span>
    </div>
    <div id="debugActionsResult" style="display:none;font-size:11px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;margin-bottom:10px;white-space:pre-wrap;word-break:break-all"></div>
    <!-- スタッフタブ -->
    <div id="staffTabBar" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px"></div>
    <div id="staffTabContent"></div>
    <div id="itemVisibilityMsg" style="font-size:12px;min-height:16px;"></div>
    <div style="margin-top:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <button onclick="saveAllGoals()" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:none;border-radius:8px;padding:7px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">全スタッフ一括保存</button>
      <div id="goalMsg" style="font-size:12px;min-height:16px;"></div>
    </div>
  </div>

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
        <th>スタッフ名</th><th>メールアドレス</th><th>最終ログイン</th><th style="text-align:center">評価者</th><th style="text-align:center">操作</th>
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
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#334155;cursor:pointer">
        <input type="checkbox" id="newItemNeedsFreeText" style="width:16px;height:16px;accent-color:#0f766e" /> 自由記述が必要
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

async function debugActions() {
  const el = document.getElementById('debugActionsResult');
  el.style.display = 'block'; el.textContent = '取得中...';
  const res = await adminFetch('/admin/debug-actions');
  if (res.ok) {
    const d = await res.json();
    let lines = ['合計 ' + d.total + ' 件', ''];
    Object.entries(d.counts).sort((a,b) => b[1]-a[1]).forEach(function(e){ lines.push(e[1] + '件　' + e[0]); });
    el.textContent = lines.join('\\n');
  } else { el.textContent = '失敗'; }
}

async function applyDefaultVisibility() {
  const msg = document.getElementById('fixCatMsg');
  msg.style.color = '#7c3aed'; msg.textContent = '適用中...';
  const res = await adminFetch('/admin/apply-default-visibility', { method: 'POST' });
  if (res.ok) {
    const d = await res.json();
    msg.style.color = '#065f46';
    msg.textContent = '完了：' + d.count + '名のスタッフに適用しました。ページを再読み込みしてください。';
    setTimeout(function(){ location.reload(); }, 2000);
  } else { msg.style.color = '#dc2626'; msg.textContent = '失敗しました'; }
}

async function fixItemOrder() {
  const msg = document.getElementById('fixCatMsg');
  msg.style.color = '#0f766e'; msg.textContent = '更新中...';
  const res = await adminFetch('/admin/fix-item-order', { method: 'POST' });
  if (res.ok) {
    const d = await res.json();
    msg.style.color = '#065f46';
    msg.textContent = '完了：' + d.updated + '件の項目を更新しました。ページを再読み込みしてください。';
  } else { msg.style.color = '#dc2626'; msg.textContent = '失敗しました'; }
}

async function fixCategories() {
  const msg = document.getElementById('fixCatMsg');
  msg.style.color = '#92400e'; msg.textContent = '処理中...';
  const res = await adminFetch('/admin/fix-categories', { method: 'POST' });
  if (res.ok) {
    const d = await res.json();
    msg.style.color = '#065f46';
    msg.textContent = '完了：' + d.fixed + '件を修正しました（合計' + d.total + '件）';
  } else {
    msg.style.color = '#dc2626'; msg.textContent = '失敗しました';
  }
}

// ===== スタッフ設定タブ（週間目標 + 項目表示） =====
function makeGoalInput(staff, key, label, val) {
  var shortLabel = label.length > 12 ? label.slice(0,12) + '…' : label;
  return '<label title="' + label + '" style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#64748b;font-weight:600;max-width:90px">' + shortLabel +
    '<input type="number" min="0" value="' + val + '" data-key="' + key + '" style="width:60px;border:1.5px solid #e2e8f0;border-radius:6px;padding:4px 6px;font-size:14px;font-family:inherit;text-align:center" /></label>';
}
function makeGoalGroup(groupLabel, inputs) {
  return '<div style="margin-bottom:8px"><div style="font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px;padding-left:2px">' + groupLabel + '</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;padding:8px 10px;background:#f1f5f9;border-radius:8px">' + inputs.join('') + '</div></div>';
}
function makeToggle(on) {
  return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:' + (on?'#0f766e':'#94a3b8') + '">' +
    (on?'ON':'OFF') +
    '<span style="position:relative;display:inline-block;width:36px;height:20px">' +
    '<span style="position:absolute;inset:0;background:' + (on?'#2aab96':'#cbd5e1') + ';border-radius:10px"></span>' +
    '<span style="position:absolute;top:3px;left:' + (on?'19px':'3px') + ';width:14px;height:14px;background:#fff;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,.2)"></span>' +
    '</span></span>';
}
var _staffTabData = null;
async function loadStaffTabs() {
  const [namesRes, goalsRes, itemsRes, settingsRes] = await Promise.all([
    fetch('/api/staff-names'), fetch('/api/goals'), fetch('/api/action-items'), fetch('/api/staff-settings')
  ]);
  _staffTabData = {
    names: await namesRes.json(),
    goals: await goalsRes.json(),
    allItems: await itemsRes.json(),
    settings: await settingsRes.json()
  };
  // 評価者はスタッフ設定タブから除外
  const evaluatorNames = new Set(_staffTabData.settings.filter(s => s.isEvaluator).map(s => s.staffName));
  _staffTabData.names = _staffTabData.names.filter(n => !evaluatorNames.has(n));
  const tabBar = document.getElementById('staffTabBar');
  const content = document.getElementById('staffTabContent');
  tabBar.innerHTML = '';
  content.innerHTML = '';
  if (!_staffTabData.names.length) { content.innerHTML = '<p style="font-size:13px;color:#94a3b8">スタッフが登録されていません</p>'; return; }
  _staffTabData.names.forEach(function(n, idx) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = n; btn.dataset.tab = n;
    btn.style.cssText = 'border:1.5px solid #e2e8f0;border-radius:20px;padding:5px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;background:#f8fafc;color:#475569;transition:all .15s';
    btn.onclick = function(){ switchTab(n); };
    tabBar.appendChild(btn);
    var panel = document.createElement('div');
    panel.id = 'sp_' + idx; panel.dataset.tabPanel = n; panel.style.display = 'none';
    buildPanel(panel, n);
    content.appendChild(panel);
  });
  switchTab(_staffTabData.names[0]);
}
function switchTab(name) {
  document.querySelectorAll('#staffTabBar button').forEach(function(b) {
    var active = b.dataset.tab === name;
    b.style.background = active ? 'linear-gradient(135deg,#0f766e,#2aab96)' : '#f8fafc';
    b.style.color = active ? '#fff' : '#475569';
    b.style.borderColor = active ? '#0f766e' : '#e2e8f0';
  });
  document.querySelectorAll('#staffTabContent > div').forEach(function(p) {
    p.style.display = p.dataset.tabPanel === name ? '' : 'none';
  });
}
function buildPanel(panel, n) {
  var d = _staffTabData;
  var s = d.settings.find(function(x){ return x.staffName === n; }) || {};
  var disabled = s.disabledItems || [];
  var g = d.goals[n] || {};
  // 項目表示設定
  var visDiv = document.createElement('div');
  visDiv.style.cssText = 'margin-bottom:14px';
  visDiv.innerHTML = '<div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">項目表示設定</div><div style="display:flex;flex-wrap:wrap;gap:6px"></div>';
  var wrap = visDiv.querySelector('div:last-child');
  d.allItems.forEach(function(item) {
    var on = !disabled.includes(item.name);
    var chip = document.createElement('button');
    chip.type = 'button'; chip.dataset.staff = n; chip.dataset.item = item.name; chip.dataset.on = on ? '1' : '0';
    chip.style.cssText = 'display:flex;align-items:center;gap:5px;border:1.5px solid ' + (on?'#2aab96':'#e2e8f0') + ';border-radius:20px;padding:4px 10px;background:' + (on?'#f0fdf4':'#f8fafc') + ';cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;color:' + (on?'#065f46':'#94a3b8');
    chip.innerHTML = item.name + ' ' + makeToggle(on);
    chip.onclick = function(){ toggleItemVisibility(this); };
    wrap.appendChild(chip);
  });
  panel.appendChild(visDiv);
  // 週間目標設定
  var goalDiv = document.createElement('div');
  goalDiv.style.cssText = 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px';
  goalDiv.dataset.staffRow = n;
  goalDiv.innerHTML = '<div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">週間目標設定</div>';
  var visibleItems = d.allItems.filter(function(i){ return !disabled.includes(i.name); });
  var groups = {};
  visibleItems.forEach(function(item){ if (!groups[item.group]) groups[item.group] = []; groups[item.group].push(item); });
  Object.entries(groups).forEach(function(e) {
    goalDiv.innerHTML += makeGoalGroup(e[0], e[1].map(function(item){ return makeGoalInput(n, item.name, item.name, g[item.name]||10); }));
  });
  var saveBtn = document.createElement('button');
  saveBtn.textContent = '保存'; saveBtn.style.cssText = 'margin-top:8px;background:linear-gradient(135deg,#0f766e,#2aab96);color:#fff;border:none;border-radius:6px;padding:5px 16px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit';
  saveBtn.onclick = function(){ saveGoal(n, this); };
  goalDiv.appendChild(saveBtn);
  panel.appendChild(goalDiv);
}
async function saveGoal(staffName, btn) {
  const row = btn.closest('[data-staff-row]');
  const inputs = row ? row.querySelectorAll('input[data-key]') : [];
  const goals = {};
  inputs.forEach(function(i) { goals[i.dataset.key] = parseInt(i.value)||0; });
  const msg = document.getElementById('goalMsg');
  try {
    const res = await adminFetch('/admin/goals', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ staffName: staffName, goals: goals }) });
    if (res.ok) { msg.style.color='#059669'; msg.textContent='保存しました（' + staffName + '）'; setTimeout(function(){msg.textContent='';},4000); }
    else { msg.style.color='#dc2626'; msg.textContent=staffName + ' の保存に失敗しました ('+res.status+')'; }
  } catch(e) { msg.style.color='#dc2626'; msg.textContent=staffName + ' エラー: ' + e.message; }
}
async function saveAllGoals() {
  const msg = document.getElementById('goalMsg');
  const rows = document.querySelectorAll('[data-staff-row]');
  let ok = 0, fail = 0;
  for (const row of rows) {
    const staffName = row.dataset.staffRow;
    const inputs = row.querySelectorAll('input[data-key]');
    const goals = {};
    inputs.forEach(function(i) { goals[i.dataset.key] = parseInt(i.value)||0; });
    try {
      const res = await adminFetch('/admin/goals', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ staffName: staffName, goals: goals }) });
      if (res.ok) ok++; else fail++;
    } catch(e) { fail++; }
  }
  msg.style.color = fail > 0 ? '#dc2626' : '#059669';
  msg.textContent = '全員保存完了：' + ok + '名成功' + (fail > 0 ? '、' + fail + '名失敗' : '');
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
loadStaffTabs();

// ===== スタッフ管理テーブル =====
async function loadStaffTable() {
  const [namesRes, accountsRes, settingsRes] = await Promise.all([fetch('/api/staff-names'), adminFetch('/api/admin/accounts'), fetch('/api/staff-settings')]);
  const names = await namesRes.json();
  const accounts = await accountsRes.json();
  const settings = await settingsRes.json();
  const accountMap = {};
  accounts.forEach(a => { accountMap[a.staffName] = a; });
  const settingsMap = {};
  settings.forEach(s => { settingsMap[s.staffName] = s; });
  const tbody = document.getElementById('staffTableBody');
  if (!names.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty">スタッフが登録されていません</td></tr>'; return; }
  tbody.innerHTML = '';
  names.forEach(n => {
    const a = accountMap[n] || {};
    const s = settingsMap[n] || {};
    const tr = document.createElement('tr');
    const loginTime = a.lastLogin ? new Date(a.lastLogin).toLocaleString('ja-JP', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '未ログイン';
    tr.innerHTML = '<td><strong>' + n + '</strong></td>' +
      '<td style="color:#475569">' + (a.email || '<span style="color:#cbd5e1">未設定</span>') + '</td>' +
      '<td style="color:#94a3b8;font-size:12px">' + loginTime + '</td>';
    // 評価者トグル
    const evalTd = document.createElement('td');
    evalTd.style.cssText = 'text-align:center';
    const evalBtn = document.createElement('button');
    evalBtn.textContent = s.isEvaluator ? '⭐ ON' : 'OFF';
    evalBtn.style.cssText = 'border:none;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;' + (s.isEvaluator ? 'background:#fef3c7;color:#d97706' : 'background:#f1f5f9;color:#94a3b8');
    evalBtn.onclick = async function() {
      const newVal = !s.isEvaluator;
      await adminFetch('/admin/staff-evaluator', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ staffName: n, isEvaluator: newVal }) });
      loadStaffTable();
    };
    evalTd.appendChild(evalBtn);
    tr.appendChild(evalTd);
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
  document.getElementById('newItemNeedsFreeText').checked = item ? !!item.needsFreeText : false;
  document.getElementById('itemModalOverlay').style.display = 'flex';
}
async function saveNewItem() {
  const name = document.getElementById('newItemName').value.trim();
  const group = document.getElementById('newItemGroup').value.trim();
  const needsPatient = document.getElementById('newItemNeedsPatient').checked;
  const needsFreeText = document.getElementById('newItemNeedsFreeText').checked;
  const msg = document.getElementById('itemModalMsg');
  if (!name || !group) { msg.style.color='#dc2626'; msg.textContent='項目名とグループを入力してください'; return; }
  const body = JSON.stringify({ name, group, needsPatient, needsFreeText });
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
  let dragSrc = null;
  currentConfig.groups.forEach(g => {
    const row = document.createElement('div');
    row.dataset.group = g;
    row.draggable = true;
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border-radius:6px;padding:5px 10px;font-size:13px;color:#334155;cursor:grab;user-select:none';
    const handle = document.createElement('span');
    handle.textContent = '⠿ ' + g;
    handle.style.cssText = 'flex:1;color:#334155';
    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.style.cssText = 'background:none;border:none;color:#94a3b8;cursor:pointer;font-size:15px;padding:0 2px;line-height:1;margin-left:8px';
    btn.onclick = async () => {
      await adminFetch('/admin/action-config/groups/'+encodeURIComponent(g), { method:'DELETE' });
      loadConfig();
    };
    row.addEventListener('dragstart', e => { dragSrc = row; row.style.opacity = '0.4'; });
    row.addEventListener('dragend', e => {
      row.style.opacity = '';
      el.querySelectorAll('[data-group]').forEach(r => r.style.background = '#f8fafc');
    });
    row.addEventListener('dragover', e => { e.preventDefault(); row.style.background = '#e0f2fe'; });
    row.addEventListener('dragleave', e => { row.style.background = '#f8fafc'; });
    row.addEventListener('drop', async e => {
      e.preventDefault();
      row.style.background = '#f8fafc';
      if (!dragSrc || dragSrc === row) return;
      const rows = [...el.querySelectorAll('[data-group]')];
      const fromIdx = rows.indexOf(dragSrc);
      const toIdx = rows.indexOf(row);
      el.insertBefore(dragSrc, toIdx < fromIdx ? row : row.nextSibling);
      const newOrder = [...el.querySelectorAll('[data-group]')].map(r => r.dataset.group);
      currentConfig.groups = newOrder;
      await adminFetch('/admin/action-config/groups', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ groups: newOrder }) });
      loadConfig();
    });
    row.appendChild(handle);
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
async function deleteStaffRecords(name) {
  if (!confirm('⚠️ ' + name + ' の入力データをすべて削除します。\\nこの操作は元に戻せません。\\n\\n本当に削除しますか？')) return;
  const res = await adminFetch('/admin/staff-records/' + encodeURIComponent(name), { method: 'DELETE' });
  if (res.ok) { alert(name + ' のデータを削除しました。ページを更新します。'); location.reload(); }
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
    const cat = ACTION_CATEGORY[r.action] || r.actionCategory || 'treatment';
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
    const cat = ACTION_CATEGORY[r.action] || r.actionCategory || 'treatment';
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
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  const name = getStaffFromReq(req);
  if (!name) return res.redirect('/staff-login');
  const allRecords = await loadDB();
  // 受け取った評価履歴
  const peerEvals = allRecords
    .filter(r => r.entryType === 'peer_eval' && r.staffName === name)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const totalPoints = peerEvals.reduce((s, r) => s + (r.points || 0), 0);
  const POINT_MEDAL = { gold: '🥇', silver: '🥈', bronze: '🥉' };
  const POINT_LABEL = { gold: 'ゴールド', silver: 'シルバー', bronze: 'ブロンズ' };
  const evalHtml = peerEvals.length === 0 ? '<p style="color:rgba(255,255,255,.35);font-size:13px;text-align:center;padding:16px 0">まだ評価はありません</p>' :
    peerEvals.map(r => `<div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:20px">${POINT_MEDAL[r.pointType]||'⭐'}</span>
        <span style="font-size:13px;font-weight:700;color:#fbbf24">${POINT_LABEL[r.pointType]||''} +${r.points}pt</span>
        <span style="font-size:11px;color:rgba(255,255,255,.35);margin-left:auto">${r.date} ${esc(r.fromStaff)}</span>
      </div>
      <div style="font-size:13px;color:rgba(255,255,255,.7);line-height:1.5">${esc(r.reason)}</div>
    </div>`).join('');
  const staffNames = await loadStaffNames();
  const settings = await loadStaffSettings();
  const rawGoals = ((settings.find(s => s.staffName === name) || {}).goals) || {};
  // 旧名→新名マイグレーション（項目リネーム時に目標値を引き継ぐ）
  const GOAL_NAME_MIGRATION = {
    'レントゲン（CT・パノラマ／臼歯デンタル）': 'X線パック　成人',
    'レントゲン': 'X線パック　成人',
  };
  const goals = {};
  for (const [k, v] of Object.entries(rawGoals)) {
    goals[GOAL_NAME_MIGRATION[k] || k] = v;
  }
  const staffSetting = settings.find(s => s.staffName === name) || {};
  const disabledItems = staffSetting.disabledItems || [];
  const actionItems = await loadActionItems();
  const itemCatMap = Object.fromEntries(actionItems.map(i => [i.name, i.category]));
  // ONになっているカテゴリのセット
  const visibleCats = new Set(
    actionItems.filter(i => !disabledItems.includes(i.name))
      .map(i => ACTION_CATEGORY[i.name] || i.category || 'treatment')
  );

  // 月別集計
  const byMonth = {};
  for (const r of allRecords) {
    if (r.staffName !== name) continue;
    const month = r.date ? r.date.slice(0, 7) : null;
    if (!month) continue;
    if (!byMonth[month]) byMonth[month] = { count: 0, items: 0, recommend: 0, counseling: 0, approach: 0, reviews: 0, treatment: 0, appointment: 0, team_support: 0, fan: 0 };
    const m = byMonth[month];
    m.count++;
    if (r.entryType !== 'behavior') {
      const cat = ACTION_CATEGORY[r.action] || itemCatMap[r.action] || r.actionCategory || 'treatment';
      if (cat === 'item') m.items++;
      if (cat === 'item_recommend') m.recommend++;
      if (cat === 'counseling') m.counseling++;
      if (cat === 'counseling_approach') m.approach++;
      if (cat === 'review') m.reviews++;
      if (cat === 'treatment') m.treatment++;
      if (cat === 'appointment') m.appointment++;
      if (cat === 'team_support') m.team_support++;
      if (cat === 'fan') m.fan++;
    }
  }
  const months = Object.keys(byMonth).sort().slice(-6); // 直近6ヶ月
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
  const thisM = byMonth[thisMonth] || {};
  const lastM = byMonth[lastMonth] || {};

  // 今週（月〜日、JST）の集計 ── アクション名ごとに個別カウント
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jstNow = new Date(jstMs);
  const dow = jstNow.getUTCDay(); // 0=日
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const weekStartMs = jstMs - daysFromMon * 86400 * 1000;
  const weekEndMs = weekStartMs + 6 * 86400 * 1000;
  const weekStart = new Date(weekStartMs).toISOString().slice(0, 10);
  const weekEnd = new Date(weekEndMs).toISOString().slice(0, 10);
  const lastWeekStartMs = weekStartMs - 7 * 86400 * 1000;
  const lastWeekEnd = new Date(weekStartMs - 86400 * 1000).toISOString().slice(0, 10);
  const lastWeekStart = new Date(lastWeekStartMs).toISOString().slice(0, 10);
  const thisW = {}; // { actionName: count }
  const lastW = {};
  const thisWCountSum = {}; // countValueの合計（本数など）
  let thisWTotal = 0, lastWTotal = 0;
  for (const r of allRecords) {
    if (r.staffName !== name || !r.date || r.entryType === 'behavior') continue;
    if (r.date >= weekStart && r.date <= weekEnd) {
      thisW[r.action] = (thisW[r.action] || 0) + 1;
      if (r.countValue) thisWCountSum[r.action] = (thisWCountSum[r.action] || 0) + r.countValue;
      thisWTotal++;
    } else if (r.date >= lastWeekStart && r.date <= lastWeekEnd) {
      lastW[r.action] = (lastW[r.action] || 0) + 1;
      lastWTotal++;
    }
  }

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

  // 月間サマリー：カテゴリ別
  const rows = `
    ${goalRow('処置', 'treatment', thisM.treatment, lastM.treatment, 0)}
    ${goalRow('物品販売', 'items', thisM.items, lastM.items, 0)}
    ${goalRow('アポ転換', 'appointment', thisM.appointment, lastM.appointment, 0)}
    ${goalRow('ポジティブ行動', 'team_support', thisM.team_support, lastM.team_support, 0)}
    ${goalRow('ファン患者', 'fan', thisM.fan, lastM.fan, 0)}
    ${goalRow('月間合計', 'count', thisM.count, lastM.count, 0)}
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
      freeText: r.freeText || '',
      countValue: r.countValue || null
    });
  }

  // 週間目標自動+1: 先週すべての目標を達成していたら各項目の目標を+1
  const bumpWeekKey = weekStart; // 'YYYY-MM-DD'（今週月曜）
  const lastBumpedWeek = staffSetting.goalBumpedWeek || '';
  if (lastBumpedWeek !== bumpWeekKey) {
    const visibleForBump = actionItems.filter(i => !disabledItems.includes(i.name)).map(i => i.name);
    const goalsToBump = visibleForBump.filter(n => {
      const g = goals[n] || 0;
      return g > 0 && (lastW[n] || 0) >= g;
    });
    if (goalsToBump.length > 0) {
      goalsToBump.forEach(n => { goals[n] = (lastW[n] || 0) + 1; });
      if (staffSettingsCol) await staffSettingsCol.updateOne(
        { staffName: name },
        { $set: { goals, goalBumpedWeek: bumpWeekKey } },
        { upsert: true }
      );
    } else {
      // 達成なくても bump 週だけ更新してループ防止
      if (staffSettingsCol) await staffSettingsCol.updateOne(
        { staffName: name },
        { $set: { goalBumpedWeek: bumpWeekKey } },
        { upsert: true }
      );
    }
  }

  // 週間目標達成カウント（山登りの進捗）── アイテム個別
  // 入力フォームと同じグループ順で並び替え
  const actionConfig = await loadActionConfig();
  const groupOrderList = actionConfig.groups && actionConfig.groups.length
    ? actionConfig.groups
    : ['処置', '物品', 'アポ管理', 'チームサポート', 'ファン獲得', 'カウンセリング', '口コミ', '行動', 'その他'];
  const visibleItems2 = actionItems.filter(i => !disabledItems.includes(i.name));
  visibleItems2.sort((a, b) => {
    const gi = g => { const idx = groupOrderList.indexOf(g); return idx >= 0 ? idx : 999; };
    const gd = gi(a.group) - gi(b.group);
    return gd !== 0 ? gd : (a.order||999) - (b.order||999);
  });
  const visibleItemNames = visibleItems2.map(i => i.name);
  const goalItems = visibleItemNames
    .map(n => ({ label: n, cur: thisW[n]||0, goal: goals[n]||0 }))
    .filter(g => g.goal > 0);
  const achievedCount = goalItems.filter(g => g.cur >= g.goal).length;
  const totalGoals = goalItems.length;
  const allAchieved = totalGoals > 0 && achievedCount === totalGoals;
  const avgPct = totalGoals > 0
    ? Math.min(Math.round(goalItems.reduce((s,g) => s + Math.min(g.cur/g.goal*100, 100), 0) / totalGoals), 100)
    : 0;

  function ringCard(label, cur, prev, goal, countSum) {
    const pct = goal > 0 ? Math.min(Math.round(cur/goal*100), 100) : null;
    const over = goal > 0 ? Math.round(cur/goal*100) : 0;
    const achieved = pct !== null && pct >= 100;
    const r = 36, circ = Math.round(2 * Math.PI * r);
    const dash = pct !== null ? Math.round(circ * Math.min(pct,100) / 100) : 0;
    const ringColor = achieved ? '#34d399' : pct >= 70 ? '#f59e0b' : '#2aab96';
    const glowColor = achieved ? 'rgba(52,211,153,0.5)' : 'none';
    const diff = cur - (prev||0);
    const diffHtml = diff > 0 ? `<span style="color:#34d399;font-size:11px;font-weight:700">▲${diff}</span>`
                   : diff < 0 ? `<span style="color:#f87171;font-size:11px;font-weight:700">▼${Math.abs(diff)}</span>`
                   : `<span style="color:#64748b;font-size:11px">→</span>`;
    const countSumHtml = countSum ? `<div style="font-size:11px;color:rgba(255,255,255,.45);margin-top:2px">合計 ${countSum}本</div>` : '';
    return `<div class="ring-card${achieved?' ring-achieved':''}">
      <div class="ring-wrap">
        <svg width="88" height="88" viewBox="0 0 88 88">
          <circle cx="44" cy="44" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="8"/>
          ${pct !== null ? `<circle cx="44" cy="44" r="${r}" fill="none" stroke="${ringColor}" stroke-width="8"
            stroke-dasharray="${dash} ${circ}" stroke-dashoffset="0"
            stroke-linecap="round" transform="rotate(-90 44 44)"
            style="filter:${achieved?`drop-shadow(0 0 6px ${glowColor})`:'none'};transition:stroke-dasharray 1s ease"/>` : ''}
          <text x="44" y="40" text-anchor="middle" fill="white" font-size="18" font-weight="700" font-family="'Noto Sans JP',sans-serif">${cur}</text>
          ${goal > 0 ? `<text x="44" y="54" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-size="10" font-family="'Noto Sans JP',sans-serif">/${goal}</text>` : ''}
        </svg>
        ${achieved ? '<div class="ring-badge">達成</div>' : ''}
      </div>
      <div class="ring-label">${label}</div>
      <div class="ring-diff">${diffHtml} 先週比</div>
      ${countSumHtml}
      ${pct !== null && over > 100 ? `<div class="ring-over">${over}% 達成！</div>` : ''}
    </div>`;
  }

  const allGoalItems = [
    ...visibleItemNames.map(n => ({ label: n, cur: thisW[n]||0, prev: lastW[n]||0, goal: goals[n]||0, countSum: thisWCountSum[n]||0 })),
    { label: '今週合計', cur: thisWTotal, prev: lastWTotal, goal: 0, countSum: 0 },
  ];
  const ringCards = allGoalItems.map(g => ringCard(g.label, g.cur, g.prev, g.goal, g.countSum)).join('');

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>自分の実績 | 自己申告デラックス</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Sans JP',sans-serif;background:#071020;color:#e2e8f0;font-size:14px;min-height:100vh}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;max-width:640px;margin:0 auto}
.hero-name{font-size:12px;color:rgba(255,255,255,0.5)}
.hero-name strong{color:#fff;font-size:15px;display:block;margin-top:1px}
.logout-btn{background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);border:1px solid rgba(255,255,255,.2);border-radius:20px;padding:6px 14px;font-size:12px;font-weight:600;text-decoration:none;white-space:nowrap}
.mountain-wrap{position:relative;max-width:640px;margin:0 auto}
.mtn-overlay{position:absolute;top:10px;left:0;right:0;text-align:center;pointer-events:none;z-index:2}
.mtn-pct{font-size:38px;font-weight:900;color:#fff;line-height:1;text-shadow:0 2px 20px rgba(0,0,0,.7)}
.mtn-sub{font-size:11px;color:rgba(255,255,255,.6);margin-top:3px;font-weight:600;letter-spacing:.05em}
.mtn-status{margin-top:5px;font-size:13px;font-weight:700}
.mtn-status.all{color:#34d399;text-shadow:0 0 12px rgba(52,211,153,.8)}
.mtn-status.part{color:#f59e0b}
.mtn-status.none{color:rgba(255,255,255,.35)}
.mountain-svg{display:block;width:100%;height:auto}
.rings-section{max-width:640px;margin:0 auto;padding:12px 16px 4px}
.rings-title{font-size:11px;font-weight:700;color:rgba(255,255,255,.35);letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px}
.rings-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
@media(max-width:400px){.rings-grid{grid-template-columns:repeat(3,1fr)}}
.ring-card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px 8px 10px;text-align:center;position:relative}
.ring-card.ring-achieved{background:rgba(52,211,153,.08);border-color:rgba(52,211,153,.3);box-shadow:0 0 16px rgba(52,211,153,.15)}
.ring-wrap{position:relative;display:inline-block;margin-bottom:4px}
.ring-badge{position:absolute;top:-4px;right:-8px;background:#34d399;color:#022c22;font-size:9px;font-weight:900;padding:2px 6px;border-radius:10px}
@keyframes badge-pop{0%{transform:scale(0)}100%{transform:scale(1)}}
.ring-label{font-size:11px;font-weight:700;color:rgba(255,255,255,.8);margin-bottom:2px}
.ring-diff{font-size:10px;color:rgba(255,255,255,.35)}
.ring-over{font-size:10px;font-weight:700;color:#34d399;margin-top:2px}
.month-label{font-size:11px;color:rgba(255,255,255,.35);text-align:center;padding:8px 0 14px}
.month-label strong{color:#2aab96}
.container{max-width:640px;margin:0 auto;padding:16px 16px 60px}
.back-link{display:inline-flex;align-items:center;gap:6px;color:#2aab96;font-size:13px;font-weight:600;text-decoration:none;margin-bottom:16px;background:rgba(255,255,255,.05);padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.08)}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:16px;margin-bottom:18px;overflow:hidden}
.card-header{background:rgba(255,255,255,.04);padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px;font-weight:700;color:rgba(255,255,255,.7);display:flex;align-items:center;gap:6px}
.cal-nav{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.06)}
.cal-nav button{background:rgba(255,255,255,.08);border:none;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700;color:#2aab96;cursor:pointer;font-family:inherit}
.cal-nav button:hover{background:rgba(42,171,150,.2)}
.cal-nav .cal-title{font-size:15px;font-weight:700;color:#fff}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);padding:10px 8px 14px}
.cal-dow{text-align:center;font-size:10px;font-weight:700;color:rgba(255,255,255,.3);padding:4px 0 6px}
.cal-dow.sun{color:rgba(239,68,68,.7)}.cal-dow.sat{color:rgba(96,165,250,.7)}
.cal-day{min-height:52px;border-radius:8px;padding:4px;margin:2px;transition:background .15s}
.cal-day.has-record{cursor:pointer}
.cal-day.has-record:hover{background:rgba(42,171,150,.15)}
.cal-day.today{background:rgba(42,171,150,.15);outline:2px solid #2aab96}
.cal-day.other-month{opacity:.2;pointer-events:none}
.cal-day-num{font-size:11px;font-weight:700;color:rgba(255,255,255,.7);margin-bottom:2px}
.cal-day-num.sun{color:rgba(239,68,68,.8)}.cal-day-num.sat{color:rgba(96,165,250,.8)}
.cal-dot{width:6px;height:6px;background:#2aab96;border-radius:50%;display:inline-block;margin:1px}
.cal-count{font-size:9px;color:#2aab96;font-weight:700}
.cal-detail{background:rgba(42,171,150,.06);border:1px solid rgba(42,171,150,.2);border-radius:10px;padding:14px 16px;margin:0 8px 14px;font-size:13px}
.cal-detail-date{font-weight:700;color:#34d399;margin-bottom:8px;font-size:14px}
.cal-detail-item{display:flex;align-items:flex-start;gap:6px;padding:6px 0;border-bottom:1px solid rgba(42,171,150,.15);color:rgba(255,255,255,.8)}
.cal-detail-item:last-child{border-bottom:none}
.cal-detail-item::before{content:'•';color:#2aab96;font-weight:700;flex-shrink:0}
@keyframes glow-pulse{0%,100%{opacity:.8}50%{opacity:1}}
</style>
</head>
<body style="background:linear-gradient(180deg,#071020 0%,#0d1f35 100%)">

<div class="topbar">
  <div class="hero-name"><span>自分の実績</span><strong>${esc(name)}</strong></div>
  <div style="display:flex;gap:8px;align-items:center">
    ${staffSetting.isEvaluator ? `<a href="/peer-eval" style="background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#fff;border-radius:20px;padding:6px 14px;font-size:12px;font-weight:700;text-decoration:none">⭐ 評価する</a>` : ''}
    <a href="/staff-logout" class="logout-btn">ログアウト</a>
  </div>
</div>

<div class="mountain-wrap">
  <div class="mtn-overlay">
    <div class="mtn-pct" id="mtnPct">0%</div>
    <div class="mtn-sub">今週の総合達成率</div>
    <div class="mtn-status ${allAchieved ? 'all' : totalGoals > 0 ? 'part' : 'none'}">
      ${allAchieved ? '🏆 全目標達成！' : totalGoals > 0 ? achievedCount + '/' + totalGoals + ' 項目達成中' : '目標を設定しよう'}
    </div>
  </div>
  <svg class="mountain-svg" viewBox="0 0 360 200" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#071020"/>
        <stop offset="100%" stop-color="#122b3a"/>
      </linearGradient>
      <linearGradient id="mtnG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a3a50"/>
        <stop offset="100%" stop-color="#0d2233"/>
      </linearGradient>
      <linearGradient id="mtnG2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0f2535"/>
        <stop offset="100%" stop-color="#081828"/>
      </linearGradient>
      <linearGradient id="pathG" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#0f766e"/>
        <stop offset="100%" stop-color="#34d399"/>
      </linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="360" height="200" fill="url(#skyG)"/>
    <circle cx="30" cy="22" r="1.2" fill="white" opacity=".7"/>
    <circle cx="88" cy="12" r="1" fill="white" opacity=".6"/>
    <circle cx="155" cy="9" r=".8" fill="white" opacity=".5"/>
    <circle cx="210" cy="18" r="1.2" fill="white" opacity=".7"/>
    <circle cx="275" cy="11" r="1" fill="white" opacity=".6"/>
    <circle cx="325" cy="24" r=".8" fill="white" opacity=".5"/>
    <circle cx="60" cy="35" r=".7" fill="white" opacity=".4"/>
    <circle cx="305" cy="38" r=".7" fill="white" opacity=".4"/>
    <polygon points="55,180 145,62 235,180" fill="url(#mtnG2)" opacity=".55"/>
    <polygon points="175,180 268,58 360,180" fill="url(#mtnG2)" opacity=".45"/>
    <polygon points="145,62 157,86 133,86" fill="rgba(255,255,255,.1)"/>
    <polygon points="268,58 280,82 256,82" fill="rgba(255,255,255,.08)"/>
    <polygon points="0,200 180,18 360,200" fill="url(#mtnG)"/>
    <polygon points="180,18 360,200 295,200" fill="rgba(0,0,0,.18)"/>
    <polygon points="180,18 196,50 164,50" fill="rgba(255,255,255,.15)"/>
    <path id="guidePath" d="M 48,194 C 60,178 74,163 90,150 C 106,137 115,127 122,116 C 130,104 134,94 140,82 C 147,70 154,58 163,44 C 170,33 175,26 180,18" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="2.5" stroke-dasharray="4,5" stroke-linecap="round"/>
    <path id="climbPath" d="M 48,194 C 60,178 74,163 90,150 C 106,137 115,127 122,116 C 130,104 134,94 140,82 C 147,70 154,58 163,44 C 170,33 175,26 180,18" fill="none" stroke="url(#pathG)" stroke-width="3.5" stroke-linecap="round" filter="url(#glow)"/>
    ${allAchieved ? '<line x1="180" y1="18" x2="180" y2="4" stroke="#34d399" stroke-width="1.5" filter="url(#glow)"/><polygon points="180,4 192,10 180,16" fill="#34d399" filter="url(#glow)"/>' : ''}
    <circle id="climberDot" cx="48" cy="194" r="5.5" fill="#34d399" filter="url(#glow)"/>
    <circle id="climberCore" cx="48" cy="194" r="2.5" fill="#fff"/>
    <rect x="0" y="196" width="360" height="4" fill="#071020"/>
  </svg>
</div>

<div class="rings-section">
  <div class="rings-title">今週の実績 — ${weekStart} 〜 ${weekEnd}</div>
  <div class="rings-grid">${ringCards}</div>
</div>

<div class="container">
  <a href="/" class="back-link">← 入力フォームへ戻る</a>

  <!-- 評価履歴 -->
  <div class="card" style="margin-bottom:16px">
    <div class="card-header" style="display:flex;align-items:center;justify-content:space-between">
      <span>⭐ 受け取った評価</span>
      <span style="font-size:13px;font-weight:700;color:#fbbf24">合計 ${totalPoints}pt</span>
    </div>
    <div style="padding:4px 0">${evalHtml}</div>
  </div>

  <div class="card" id="calCard">
    <div class="card-header">📅 記録カレンダー</div>
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
// 山アニメーション
(function(){
  var pct = ${avgPct};
  document.getElementById('mtnPct').textContent = pct + '%';
  var path = document.getElementById('climbPath');
  var dot = document.getElementById('climberDot');
  var core = document.getElementById('climberCore');
  var total = path.getTotalLength();
  path.style.strokeDasharray = '0 ' + total;
  path.style.transition = 'stroke-dasharray 2s cubic-bezier(.4,0,.2,1)';
  setTimeout(function(){
    var traveled = total * pct / 100;
    path.style.strokeDasharray = traveled + ' ' + total;
    var pt = path.getPointAtLength(traveled);
    dot.style.transition = 'cx 2s cubic-bezier(.4,0,.2,1), cy 2s cubic-bezier(.4,0,.2,1)';
    core.style.transition = 'cx 2s cubic-bezier(.4,0,.2,1), cy 2s cubic-bezier(.4,0,.2,1)';
    dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
    core.setAttribute('cx', pt.x); core.setAttribute('cy', pt.y);
    // カウントアップ
    var start = 0, end = pct, dur = 1800, startTime = null;
    function step(ts){ if(!startTime) startTime=ts; var p=Math.min((ts-startTime)/dur,1); document.getElementById('mtnPct').textContent = Math.round(p*end)+'%'; if(p<1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }, 200);
})();

const BY_DATE = ${JSON.stringify(byDate)};
const WEEKDAYS = ['日','月','火','水','木','金','土'];
let calYear, calMonth;

const _jst = new Date(Date.now() + 9*60*60*1000);
const TODAY = _jst.getUTCFullYear() + '-' + String(_jst.getUTCMonth()+1).padStart(2,'0') + '-' + String(_jst.getUTCDate()).padStart(2,'0');
calYear = _jst.getUTCFullYear();
calMonth = _jst.getUTCMonth();

function moveMonth(d) {
  calMonth += d;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCal();
  document.getElementById('calDetail').innerHTML = '';
}

function renderCal() {
  document.getElementById('calTitle').textContent = calYear + '年' + (calMonth+1) + '月';
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  ['日','月','火','水','木','金','土'].forEach((w,i) => {
    const d = document.createElement('div');
    d.className = 'cal-dow' + (i===0?' sun':i===6?' sat':'');
    d.textContent = w;
    grid.appendChild(d);
  });
  const first = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
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
    if (records.length) {
      if (records.length > 0) {
        const cnt = document.createElement('div');
        cnt.className = 'cal-count';
        cnt.textContent = String(records.length) + '件';
        cell.appendChild(cnt);
      }
      cell.onclick = () => showDetail(dateStr, records);
    }
    grid.appendChild(cell);
  }
}

function showDetail(dateStr, records) {
  const det = document.getElementById('calDetail');
  const [y,m,d] = dateStr.split('-');
  const dow = WEEKDAYS[new Date(+y,+m-1,+d).getDay()];
  let html = '<div class="cal-detail"><div class="cal-detail-date">📅 ' + y+'年'+parseInt(m)+'月'+parseInt(d)+'日（'+dow+'）— ' + records.length + '件</div>';
  records.forEach(r => {
    let txt = r.action;
    if (r.countValue) txt += '　' + r.countValue + (r.action === 'シーラント' ? '本' : '件');
    if (r.patientNo) txt += '　患者番号：' + r.patientNo;
    if (r.itemName) txt += '　' + r.itemName;
    html += '<div class="cal-detail-item">' + txt.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div>';
  });
  html += '</div>';
  det.innerHTML = html;
}

renderCal();
<\/script>
</body>
</html>`);
});

// 過去レコードのactionCategory一括修正
app.post('/admin/fix-categories', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const records = await loadDB();
  const actionItems = await loadActionItems();
  const itemCatMap = Object.fromEntries(actionItems.map(i => [i.name, i.category]));
  let fixed = 0;
  const updated = records.map(r => {
    if (r.entryType === 'behavior' || !r.action) return r;
    const correct = ACTION_CATEGORY[r.action] || itemCatMap[r.action] || 'treatment';
    if (r.actionCategory !== correct) {
      fixed++;
      return { ...r, actionCategory: correct };
    }
    return r;
  });
  if (fixed > 0) {
    if (mongoCol) {
      await Promise.all(updated.map(r => mongoCol.replaceOne({ id: r.id }, r, { upsert: true })));
    } else {
      fs.writeFileSync(DB_FILE, JSON.stringify(updated, null, 2));
    }
  }
  res.json({ ok: true, fixed, total: records.length });
});

// デバッグ：アクション別件数確認
app.get('/admin/debug-items', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const items = await loadActionItems();
  res.json(items.map(i => ({ id: i.id, name: i.name, group: i.group, builtin: i.builtin, defaultHidden: i.defaultHidden, order: i.order })));
});

app.get('/admin/debug-actions', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const records = await loadDB();
  const actionItems = await loadActionItems();
  const itemCatMap = Object.fromEntries(actionItems.map(i => [i.name, i.category]));
  const counts = {};
  for (const r of records) {
    if (r.entryType === 'behavior') { counts['[behavior]'] = (counts['[behavior]'] || 0) + 1; continue; }
    const cat = ACTION_CATEGORY[r.action] || itemCatMap[r.action] || r.actionCategory || '?';
    const key = (r.action || '[no-action]') + ' → ' + cat;
    counts[key] = (counts[key] || 0) + 1;
  }
  res.json({ total: records.length, counts });
});

// 全スタッフにデフォルト表示設定を適用
app.post('/admin/apply-default-visibility', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const items = await loadActionItems();
  const hiddenNames = items.filter(i => i.defaultHidden).map(i => i.name);
  const staffNames = await loadStaffNames();
  const allSettings = await loadStaffSettings();
  for (const name of staffNames) {
    const s = allSettings.find(x => x.staffName === name) || {};
    await saveStaffSetting(name, { ...s, disabledItems: hiddenNames });
  }
  res.json({ ok: true, count: staffNames.length });
});

// カスタム項目を復元
app.get('/admin/restore-custom-items', async (req, res) => {
  if (!checkAuth(req, res)) return;
  if (!actionItemsCol) return res.json({ ok: false, msg: 'MongoDB未接続' });
  const customItems = [
    { id: 'custom-apo-01', name: '土曜、平日夕方患者を平日の午前や日中でアポをとった。', group: 'アポ管理', category: 'appointment', needsPatient: false, builtin: false, defaultHidden: false, order: 31 },
  ];
  let added = 0;
  for (const item of customItems) {
    const exists = await actionItemsCol.findOne({ id: item.id });
    if (!exists) { await actionItemsCol.insertOne(item); added++; }
  }
  res.send('完了：' + added + '件追加しました。管理画面に戻ってください。');
});

app.post('/admin/restore-custom-items', async (req, res) => {
  if (!checkAuth(req, res)) return;
  if (!actionItemsCol) return res.json({ ok: false, msg: 'MongoDB未接続' });
  const customItems = [
    { id: 'custom-apo-01', name: '土曜、平日夕方患者を平日の午前や日中でアポをとった。', group: 'アポ管理', category: 'appointment', needsPatient: false, builtin: false, defaultHidden: false, order: 31 },
  ];
  let added = 0;
  for (const item of customItems) {
    const exists = await actionItemsCol.findOne({ id: item.id });
    if (!exists) {
      await actionItemsCol.insertOne(item);
      added++;
    }
  }
  res.json({ ok: true, added });
});

// ビルトイン項目の順番・プロパティをDBに強制反映
app.post('/admin/fix-item-order', async (req, res) => {
  if (!checkAuth(req, res)) return;
  if (!actionItemsCol) return res.json({ ok: false, msg: 'MongoDB未接続' });
  let updated = 0;
  for (const def of DEFAULT_ACTION_ITEMS) {
    const r = await actionItemsCol.updateOne(
      { id: def.id },
      { $set: { order: def.order, name: def.name, category: def.category, needsPatient: !!def.needsPatient,
                needsCount: !!def.needsCount, needsFreeText: !!def.needsFreeText, defaultHidden: !!def.defaultHidden,
                typeOptions: def.typeOptions || null, showItemName: !!def.showItemName, group: def.group } },
      { upsert: true }
    );
    if (r.modifiedCount || r.upsertedCount) updated++;
  }
  // defaultHidden項目を全スタッフのdisabledItemsに追加
  const hiddenNames = DEFAULT_ACTION_ITEMS.filter(d => d.defaultHidden).map(d => d.name);
  const allSettings = await loadStaffSettings();
  const staffNames = await loadStaffNames();
  for (const name of staffNames) {
    const s = allSettings.find(x => x.staffName === name) || {};
    const disabled = s.disabledItems || [];
    const newDisabled = [...new Set([...disabled, ...hiddenNames.filter(h => !disabled.includes(h))])];
    if (newDisabled.length !== disabled.length) {
      await saveStaffSetting(name, { disabledItems: newDisabled });
    }
  }
  res.json({ ok: true, updated });
});

app.get('/health', (_req, res) => res.send('OK'));

// アプリアイコン（ホーム画面追加用）
function makeIconSvg(size) {
  const r = Math.round(size * 0.195);
  const fs = Math.round(size * 0.52);
  const cy = Math.round(size * 0.67);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f766e"/>
      <stop offset="100%" stop-color="#2aab96"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>
  <text x="${size/2}" y="${cy}" text-anchor="middle" font-size="${fs}" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">🦷</text>
</svg>`;
}
app.get('/icon-192.png', (_req, res) => { res.set('Content-Type','image/svg+xml'); res.send(makeIconSvg(192)); });
app.get('/icon-512.png', (_req, res) => { res.set('Content-Type','image/svg+xml'); res.send(makeIconSvg(512)); });
app.get('/apple-touch-icon.png', (_req, res) => { res.set('Content-Type','image/svg+xml'); res.send(makeIconSvg(180)); });

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`スタッフ実績サーバー起動: port=${PORT}`));
