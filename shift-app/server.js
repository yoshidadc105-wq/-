'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Data files ----
const DATA_DIR = path.join(__dirname, 'data');
const STAFF_FILE = path.join(DATA_DIR, 'staff.json');
const ENTRIES_FILE = path.join(DATA_DIR, 'entries.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CLINIC_DAYS_FILE = path.join(DATA_DIR, 'clinic-days.json');

function ensureDir() { fs.mkdirSync(DATA_DIR, { recursive: true }); }
function load(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function save(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ---- Japanese national holidays ----
const HOLIDAYS = new Set([
  '2025-01-01','2025-01-13','2025-02-11','2025-02-23','2025-02-24',
  '2025-03-20','2025-04-29','2025-05-03','2025-05-04','2025-05-05',
  '2025-05-06','2025-07-21','2025-08-11','2025-09-15','2025-09-23',
  '2025-10-13','2025-11-03','2025-11-23','2025-11-24',
  '2026-01-01','2026-01-12','2026-02-11','2026-02-23','2026-03-20',
  '2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06',
  '2026-07-20','2026-08-11','2026-09-21','2026-09-22','2026-09-23',
  '2026-10-12','2026-11-03','2026-11-23',
  '2027-01-01','2027-01-11','2027-02-11','2027-02-23','2027-03-21',
  '2027-04-29','2027-05-03','2027-05-04','2027-05-05','2027-07-19',
  '2027-08-11','2027-09-20','2027-09-23','2027-10-11','2027-11-03','2027-11-23',
]);

function getDayType(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const dow = d.getDay();
  if (HOLIDAYS.has(dateStr)) return 'holiday';
  if (dow === 0) return 'sunday';
  if (dow === 6) return 'saturday';
  return 'weekday';
}

const DEFAULT_SETTINGS = {
  closedDays: [0, 4],
  points: { saturday: 2, sunday: 3, holiday: 3, paidLeaveWeekday: 1 },
  minStaff: [],
  workHours: { am: { start: '09:30', end: '13:30' }, pm: { start: '14:30', end: '18:30' } },
};

function loadSettings() {
  const s = load(SETTINGS_FILE, {});
  return {
    ...DEFAULT_SETTINGS, ...s,
    points: { ...DEFAULT_SETTINGS.points, ...(s.points || {}) },
    workHours: {
      am: { ...DEFAULT_SETTINGS.workHours.am, ...(s.workHours?.am || {}) },
      pm: { ...DEFAULT_SETTINGS.workHours.pm, ...(s.workHours?.pm || {}) },
    },
  };
}

// ---- Admin auth middleware ----
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Basic ')) return res.status(401).json({ error: '認証が必要です' });
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const pass = decoded.slice(decoded.indexOf(':') + 1);
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'パスワードが違います' });
  next();
}

// ---- Staff ----
app.get('/api/shift/staff', (req, res) => res.json(load(STAFF_FILE, [])));

app.post('/api/shift/staff', requireAdmin, (req, res) => {
  const { name, role, contractType, color } = req.body;
  if (!name || !role) return res.status(400).json({ error: '名前と役職は必須です' });
  const staff = load(STAFF_FILE, []);
  const member = { id: crypto.randomUUID(), name, role, contractType: contractType || 'weekly2', color: color || '#2563eb', createdAt: new Date().toISOString() };
  staff.push(member);
  save(STAFF_FILE, staff);
  res.status(201).json(member);
});

app.put('/api/shift/staff/:id', requireAdmin, (req, res) => {
  const staff = load(STAFF_FILE, []);
  const idx = staff.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'スタッフが見つかりません' });
  const { name, role, contractType, color } = req.body;
  if (name !== undefined) staff[idx].name = name;
  if (role !== undefined) staff[idx].role = role;
  if (contractType !== undefined) staff[idx].contractType = contractType;
  if (color !== undefined) staff[idx].color = color;
  save(STAFF_FILE, staff);
  res.json(staff[idx]);
});

app.delete('/api/shift/staff/:id', requireAdmin, (req, res) => {
  const staff = load(STAFF_FILE, []);
  const idx = staff.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'スタッフが見つかりません' });
  staff.splice(idx, 1);
  save(STAFF_FILE, staff);
  res.json({ ok: true });
});

// ---- Entries ----
app.get('/api/shift/entries', (req, res) => {
  const { year, month } = req.query;
  let entries = load(ENTRIES_FILE, []);
  if (year && month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    entries = entries.filter(e => e.date?.startsWith(prefix));
  }
  res.json(entries);
});

app.post('/api/shift/entries', requireAdmin, (req, res) => {
  const { staffId, date, period, isPaidLeave, isLocked, note } = req.body;
  if (!staffId || !date || !period) return res.status(400).json({ error: 'staffId, date, periodは必須です' });
  const entries = load(ENTRIES_FILE, []);
  const entry = { id: crypto.randomUUID(), staffId, date, period, isPaidLeave: !!isPaidLeave, isLocked: !!isLocked, note: note || '', createdAt: new Date().toISOString() };
  entries.push(entry);
  save(ENTRIES_FILE, entries);
  res.status(201).json(entry);
});

app.put('/api/shift/entries/:id', requireAdmin, (req, res) => {
  const entries = load(ENTRIES_FILE, []);
  const idx = entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'エントリーが見つかりません' });
  const fields = ['staffId', 'date', 'period', 'isPaidLeave', 'isLocked', 'note'];
  fields.forEach(f => { if (req.body[f] !== undefined) entries[idx][f] = req.body[f]; });
  save(ENTRIES_FILE, entries);
  res.json(entries[idx]);
});

app.delete('/api/shift/entries/:id', requireAdmin, (req, res) => {
  const entries = load(ENTRIES_FILE, []);
  const idx = entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'エントリーが見つかりません' });
  if (entries[idx].isLocked) return res.status(403).json({ error: 'ロックされたシフトは削除できません' });
  entries.splice(idx, 1);
  save(ENTRIES_FILE, entries);
  res.json({ ok: true });
});

app.post('/api/shift/entries/move', requireAdmin, (req, res) => {
  const { entryId, newDate } = req.body;
  if (!entryId || !newDate) return res.status(400).json({ error: 'entryIdとnewDateは必須です' });
  const entries = load(ENTRIES_FILE, []);
  const idx = entries.findIndex(e => e.id === entryId);
  if (idx === -1) return res.status(404).json({ error: 'エントリーが見つかりません' });
  if (entries[idx].isLocked) return res.status(403).json({ error: 'ロックされたシフトは移動できません' });

  const moving = entries[idx];
  const conflictIdx = entries.findIndex(e => e.id !== entryId && e.staffId === moving.staffId && e.date === newDate);
  const oldDate = moving.date;
  entries[idx].date = newDate;
  if (conflictIdx !== -1) entries[conflictIdx].date = oldDate;

  save(ENTRIES_FILE, entries);
  const result = [entries[idx]];
  if (conflictIdx !== -1) result.push(entries[conflictIdx]);
  res.json({ ok: true, entries: result });
});

// ---- Clinic days ----
app.get('/api/shift/clinic-days', (req, res) => {
  const { year, month } = req.query;
  let days = load(CLINIC_DAYS_FILE, []);
  if (year && month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    days = days.filter(d => d.date?.startsWith(prefix));
  }
  res.json(days);
});

app.post('/api/shift/clinic-days', requireAdmin, (req, res) => {
  const { date, isOpen, note } = req.body;
  if (!date || isOpen === undefined) return res.status(400).json({ error: 'dateとisOpenは必須です' });
  const days = load(CLINIC_DAYS_FILE, []);
  const idx = days.findIndex(d => d.date === date);
  const record = { date, isOpen: !!isOpen, note: note || '', updatedAt: new Date().toISOString() };
  if (idx !== -1) days[idx] = record; else days.push(record);
  save(CLINIC_DAYS_FILE, days);
  res.json(record);
});

// ---- Settings ----
app.get('/api/shift/settings', (req, res) => res.json(loadSettings()));

app.put('/api/shift/settings', requireAdmin, (req, res) => {
  const current = loadSettings();
  const updated = {
    ...current, ...req.body,
    points: { ...current.points, ...(req.body.points || {}) },
    workHours: {
      am: { ...current.workHours.am, ...(req.body.workHours?.am || {}) },
      pm: { ...current.workHours.pm, ...(req.body.workHours?.pm || {}) },
    },
  };
  save(SETTINGS_FILE, updated);
  res.json(updated);
});

// ---- Holidays ----
app.get('/api/shift/holidays', (req, res) => {
  const { year } = req.query;
  const list = [...HOLIDAYS].filter(h => !year || h.startsWith(year));
  res.json(list);
});

// ---- Points ----
app.get('/api/shift/points', (req, res) => {
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'yearとmonthは必須です' });

  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const entries = load(ENTRIES_FILE, []).filter(e => e.date?.startsWith(prefix));
  const staff = load(STAFF_FILE, []);
  const settings = loadSettings();
  const pts = settings.points;

  const result = {};
  staff.forEach(s => {
    result[s.id] = { name: s.name, role: s.role, contractType: s.contractType, details: [], total: 0, weekdayCount: 0, saturdayCount: 0, sundayCount: 0, holidayCount: 0, paidLeaveBonus: 0 };
  });

  entries.forEach(entry => {
    const row = result[entry.staffId];
    if (!row) return;
    const dt = getDayType(entry.date);
    let p = 0, reason = '';

    if (entry.isPaidLeave) {
      if (dt === 'weekday') { p = pts.paidLeaveWeekday || 1; reason = '平日有給 +1pt'; }
      else reason = '有給休暇';
    } else {
      if (dt === 'saturday') { p = pts.saturday || 2; reason = '土曜出勤'; row.saturdayCount++; }
      else if (dt === 'sunday') { p = pts.sunday || 3; reason = '日曜出勤'; row.sundayCount++; }
      else if (dt === 'holiday') { p = pts.holiday || 3; reason = '祝日出勤'; row.holidayCount++; }
      else { reason = '平日出勤'; row.weekdayCount++; }
    }

    row.details.push({ date: entry.date, period: entry.period, dayType: dt, pts: p, reason, isPaidLeave: entry.isPaidLeave });
    row.total += p;
    if (entry.isPaidLeave && dt === 'weekday') row.paidLeaveBonus += p;
  });

  res.json(result);
});

// ---- Health check ----
app.get('/health', (_req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log(`シフト管理サーバー起動: http://localhost:${PORT}`);
  console.log(`管理画面: http://localhost:${PORT}/`);
});
