const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// ---- Data file paths ----
const DATA_DIR = path.join(__dirname, 'data');
const STAFF_FILE = path.join(DATA_DIR, 'shift-staff.json');
const ENTRIES_FILE = path.join(DATA_DIR, 'shift-entries.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'shift-settings.json');
const CLINIC_DAYS_FILE = path.join(DATA_DIR, 'shift-clinic-days.json');

// ---- Japanese National Holidays ----
const HOLIDAYS = new Set([
  // 2025
  '2025-01-01','2025-01-13','2025-02-11','2025-02-23','2025-02-24',
  '2025-03-20','2025-04-29','2025-05-03','2025-05-04','2025-05-05',
  '2025-05-06','2025-07-21','2025-08-11','2025-09-15','2025-09-23',
  '2025-10-13','2025-11-03','2025-11-23','2025-11-24',
  // 2026
  '2026-01-01','2026-01-12','2026-02-11','2026-02-23','2026-03-20',
  '2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06',
  '2026-07-20','2026-08-11','2026-09-21','2026-09-22','2026-09-23',
  '2026-10-12','2026-11-03','2026-11-23',
  // 2027
  '2027-01-01','2027-01-11','2027-02-11','2027-02-23','2027-03-21',
  '2027-04-29','2027-05-03','2027-05-04','2027-05-05','2027-07-19',
  '2027-08-11','2027-09-20','2027-09-23','2027-10-11','2027-11-03',
  '2027-11-23',
]);

// ---- Default settings ----
const DEFAULT_SETTINGS = {
  closedDays: [0, 4], // Sunday=0, Thursday=4
  points: {
    saturday: 2,
    sunday: 3,
    holiday: 3,
    paidLeaveWeekday: 1,
  },
  minStaff: [
    // { dayType: 'weekday'|'saturday'|'sunday'|'holiday', role: 'dentist'|'hygienist'|'technician'|'any', min: number }
  ],
  workHours: {
    am: { start: '09:30', end: '13:30' },
    pm: { start: '14:30', end: '18:30' },
  },
};

// ---- File I/O helpers ----
function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(file, defaultVal) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return defaultVal;
  }
}

function saveJSON(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function loadStaff() { return loadJSON(STAFF_FILE, []); }
function saveStaff(d) { saveJSON(STAFF_FILE, d); }

function loadEntries() { return loadJSON(ENTRIES_FILE, []); }
function saveEntries(d) { saveJSON(ENTRIES_FILE, d); }

function loadSettings() {
  const s = loadJSON(SETTINGS_FILE, {});
  return Object.assign({}, DEFAULT_SETTINGS, s, {
    points: Object.assign({}, DEFAULT_SETTINGS.points, s.points || {}),
    workHours: Object.assign({}, DEFAULT_SETTINGS.workHours, s.workHours || {}),
  });
}
function saveSettings(d) { saveJSON(SETTINGS_FILE, d); }

function loadClinicDays() { return loadJSON(CLINIC_DAYS_FILE, []); }
function saveClinicDays(d) { saveJSON(CLINIC_DAYS_FILE, d); }

// ---- Auth middleware ----
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    return res.status(401).json({ error: '認証が必要です' });
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const colonIdx = decoded.indexOf(':');
  const pass = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : '';
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'パスワードが違います' });
  }
  next();
}

// ---- Day type helpers ----
function getDayType(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const dow = d.getDay(); // 0=Sun
  if (HOLIDAYS.has(dateStr)) return 'holiday';
  if (dow === 0) return 'sunday';
  if (dow === 6) return 'saturday';
  return 'weekday';
}

function getPointsForEntry(entry, settings, dayType) {
  const pts = settings.points;
  if (entry.isPaidLeave) {
    // Paid leave on weekday gets bonus point; on other days no additional bonus
    if (dayType === 'weekday') return pts.paidLeaveWeekday || 1;
    return 0;
  }
  if (dayType === 'holiday') return pts.holiday || 3;
  if (dayType === 'sunday') return pts.sunday || 3;
  if (dayType === 'saturday') return pts.saturday || 2;
  return 0; // weekday shift no points
}

// ---- Staff routes ----

router.get('/staff', (req, res) => {
  res.json(loadStaff());
});

router.post('/staff', requireAdmin, (req, res) => {
  const { name, role, contractType, color } = req.body;
  if (!name || !role) return res.status(400).json({ error: '名前と役職は必須です' });
  const staff = loadStaff();
  const newStaff = {
    id: crypto.randomUUID(),
    name,
    role,
    contractType: contractType || 'weekly2',
    color: color || '#6b7280',
    createdAt: new Date().toISOString(),
  };
  staff.push(newStaff);
  saveStaff(staff);
  res.status(201).json(newStaff);
});

router.put('/staff/:id', requireAdmin, (req, res) => {
  const staff = loadStaff();
  const idx = staff.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'スタッフが見つかりません' });
  const { name, role, contractType, color } = req.body;
  if (name !== undefined) staff[idx].name = name;
  if (role !== undefined) staff[idx].role = role;
  if (contractType !== undefined) staff[idx].contractType = contractType;
  if (color !== undefined) staff[idx].color = color;
  saveStaff(staff);
  res.json(staff[idx]);
});

router.delete('/staff/:id', requireAdmin, (req, res) => {
  const staff = loadStaff();
  const idx = staff.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'スタッフが見つかりません' });
  staff.splice(idx, 1);
  saveStaff(staff);
  res.json({ ok: true });
});

// ---- Entries routes ----

router.get('/entries', (req, res) => {
  const { year, month } = req.query;
  let entries = loadEntries();
  if (year && month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    entries = entries.filter(e => e.date && e.date.startsWith(prefix));
  }
  res.json(entries);
});

router.post('/entries', requireAdmin, (req, res) => {
  const { staffId, date, period, isPaidLeave, isLocked, note } = req.body;
  if (!staffId || !date || !period) return res.status(400).json({ error: 'staffId, date, periodは必須です' });

  const entries = loadEntries();
  const newEntry = {
    id: crypto.randomUUID(),
    staffId,
    date,
    period,
    isPaidLeave: isPaidLeave || false,
    isLocked: isLocked || false,
    note: note || '',
    createdAt: new Date().toISOString(),
  };
  entries.push(newEntry);
  saveEntries(entries);
  res.status(201).json(newEntry);
});

router.put('/entries/:id', requireAdmin, (req, res) => {
  const entries = loadEntries();
  const idx = entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'エントリーが見つかりません' });
  const { staffId, date, period, isPaidLeave, isLocked, note } = req.body;
  if (staffId !== undefined) entries[idx].staffId = staffId;
  if (date !== undefined) entries[idx].date = date;
  if (period !== undefined) entries[idx].period = period;
  if (isPaidLeave !== undefined) entries[idx].isPaidLeave = isPaidLeave;
  if (isLocked !== undefined) entries[idx].isLocked = isLocked;
  if (note !== undefined) entries[idx].note = note;
  saveEntries(entries);
  res.json(entries[idx]);
});

router.delete('/entries/:id', requireAdmin, (req, res) => {
  const entries = loadEntries();
  const idx = entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'エントリーが見つかりません' });
  if (entries[idx].isLocked) return res.status(403).json({ error: 'ロックされたシフトは削除できません' });
  entries.splice(idx, 1);
  saveEntries(entries);
  res.json({ ok: true });
});

router.post('/entries/move', requireAdmin, (req, res) => {
  const { entryId, newDate } = req.body;
  if (!entryId || !newDate) return res.status(400).json({ error: 'entryIdとnewDateは必須です' });

  const entries = loadEntries();
  const idx = entries.findIndex(e => e.id === entryId);
  if (idx === -1) return res.status(404).json({ error: 'エントリーが見つかりません' });
  if (entries[idx].isLocked) return res.status(403).json({ error: 'ロックされたシフトは移動できません' });

  // Check if same staff already has a shift on newDate — if so, swap
  const movingEntry = entries[idx];
  const conflictIdx = entries.findIndex(
    e => e.id !== entryId && e.staffId === movingEntry.staffId && e.date === newDate
  );

  if (conflictIdx !== -1) {
    // Swap dates
    const oldDate = movingEntry.date;
    entries[idx].date = newDate;
    entries[conflictIdx].date = oldDate;
  } else {
    entries[idx].date = newDate;
  }

  saveEntries(entries);
  res.json({ ok: true, entries: [entries[idx], conflictIdx !== -1 ? entries[conflictIdx] : null].filter(Boolean) });
});

router.post('/entries/swap', requireAdmin, (req, res) => {
  const { entryId1, entryId2 } = req.body;
  if (!entryId1 || !entryId2) return res.status(400).json({ error: 'entryId1とentryId2は必須です' });

  const entries = loadEntries();
  const idx1 = entries.findIndex(e => e.id === entryId1);
  const idx2 = entries.findIndex(e => e.id === entryId2);
  if (idx1 === -1 || idx2 === -1) return res.status(404).json({ error: 'エントリーが見つかりません' });

  const date1 = entries[idx1].date;
  entries[idx1].date = entries[idx2].date;
  entries[idx2].date = date1;

  saveEntries(entries);
  res.json({ ok: true });
});

// ---- Clinic days routes ----

router.get('/clinic-days', (req, res) => {
  const { year, month } = req.query;
  let days = loadClinicDays();
  if (year && month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    days = days.filter(d => d.date && d.date.startsWith(prefix));
  }
  res.json(days);
});

router.post('/clinic-days', requireAdmin, (req, res) => {
  const { date, isOpen, note } = req.body;
  if (!date || isOpen === undefined) return res.status(400).json({ error: 'dateとisOpenは必須です' });

  const days = loadClinicDays();
  const existingIdx = days.findIndex(d => d.date === date);
  const record = { date, isOpen, note: note || '', updatedAt: new Date().toISOString() };

  if (existingIdx !== -1) {
    days[existingIdx] = record;
  } else {
    days.push(record);
  }
  saveClinicDays(days);
  res.json(record);
});

// ---- Settings routes ----

router.get('/settings', (req, res) => {
  res.json(loadSettings());
});

router.put('/settings', requireAdmin, (req, res) => {
  const current = loadSettings();
  const updated = Object.assign({}, current, req.body, {
    points: Object.assign({}, current.points, (req.body.points || {})),
    workHours: Object.assign({}, current.workHours, (req.body.workHours || {})),
  });
  saveSettings(updated);
  res.json(updated);
});

// ---- Points calculation ----

router.get('/points', (req, res) => {
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'yearとmonthは必須です' });

  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const entries = loadEntries().filter(e => e.date && e.date.startsWith(prefix));
  const staff = loadStaff();
  const settings = loadSettings();
  const clinicDaysOverrides = loadClinicDays().filter(d => d.date && d.date.startsWith(prefix));
  const overrideMap = {};
  clinicDaysOverrides.forEach(d => { overrideMap[d.date] = d; });

  const result = {};

  staff.forEach(s => {
    result[s.id] = {
      name: s.name,
      role: s.role,
      contractType: s.contractType,
      details: [],
      total: 0,
      weekdayCount: 0,
      saturdayCount: 0,
      sundayCount: 0,
      holidayCount: 0,
      paidLeaveBonus: 0,
    };
  });

  entries.forEach(entry => {
    const staffData = result[entry.staffId];
    if (!staffData) return;

    const dayType = getDayType(entry.date);

    // Check if clinic is open (for context, but points still accrue for staff who worked)
    let effectiveDayType = dayType;
    // Override: if it's a closed day override that made it open, treat as its natural type

    const pts = getPointsForEntry(entry, settings, effectiveDayType);

    let reason = '';
    if (entry.isPaidLeave) {
      reason = effectiveDayType === 'weekday' ? '有給休暇（平日）+1pt' : '有給休暇';
    } else {
      if (effectiveDayType === 'saturday') reason = '土曜出勤';
      else if (effectiveDayType === 'sunday') reason = '日曜出勤';
      else if (effectiveDayType === 'holiday') reason = '祝日出勤';
      else reason = '平日出勤';
    }

    staffData.details.push({
      date: entry.date,
      period: entry.period,
      dayType: effectiveDayType,
      pts,
      reason,
      isPaidLeave: entry.isPaidLeave,
    });

    staffData.total += pts;

    if (!entry.isPaidLeave) {
      if (effectiveDayType === 'weekday') staffData.weekdayCount++;
      else if (effectiveDayType === 'saturday') staffData.saturdayCount++;
      else if (effectiveDayType === 'sunday') staffData.sundayCount++;
      else if (effectiveDayType === 'holiday') staffData.holidayCount++;
    } else {
      if (effectiveDayType === 'weekday') staffData.paidLeaveBonus += pts;
    }
  });

  res.json(result);
});

// ---- Holidays endpoint ----
router.get('/holidays', (req, res) => {
  const { year } = req.query;
  const holidays = [...HOLIDAYS].filter(h => !year || h.startsWith(year));
  res.json(holidays);
});

module.exports = router;
