'use strict';
const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Database ----
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function dbLoad(key, defaultVal) {
  try {
    const r = await pool.query('SELECT value FROM app_data WHERE key=$1', [key]);
    return r.rows.length > 0 ? r.rows[0].value : defaultVal;
  } catch (e) {
    console.error('DB load error:', e.message);
    return defaultVal;
  }
}

async function dbSave(key, data) {
  await pool.query(
    `INSERT INTO app_data(key,value,updated_at) VALUES($1,$2::jsonb,NOW())
     ON CONFLICT(key) DO UPDATE SET value=$2::jsonb, updated_at=NOW()`,
    [key, JSON.stringify(data)]
  );
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

async function loadSettings() {
  const s = await dbLoad('settings', {});
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
app.get('/api/shift/staff', async (req, res) => {
  res.json(await dbLoad('staff', []));
});

app.post('/api/shift/staff', requireAdmin, async (req, res) => {
  const { name, role, contractType, color } = req.body;
  if (!name || !role) return res.status(400).json({ error: '名前と役職は必須です' });
  const staff = await dbLoad('staff', []);
  const member = { id: crypto.randomUUID(), name, role, contractType: contractType || 'weekly2', color: color || '#2563eb', createdAt: new Date().toISOString() };
  staff.push(member);
  await dbSave('staff', staff);
  res.status(201).json(member);
});

app.put('/api/shift/staff/:id', requireAdmin, async (req, res) => {
  const staff = await dbLoad('staff', []);
  const idx = staff.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'スタッフが見つかりません' });
  const { name, role, contractType, color } = req.body;
  if (name !== undefined) staff[idx].name = name;
  if (role !== undefined) staff[idx].role = role;
  if (contractType !== undefined) staff[idx].contractType = contractType;
  if (color !== undefined) staff[idx].color = color;
  await dbSave('staff', staff);
  res.json(staff[idx]);
});

app.delete('/api/shift/staff/:id', requireAdmin, async (req, res) => {
  const staff = await dbLoad('staff', []);
  const idx = staff.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'スタッフが見つかりません' });
  staff.splice(idx, 1);
  await dbSave('staff', staff);
  res.json({ ok: true });
});

// ---- Entries ----
app.get('/api/shift/entries', async (req, res) => {
  const { year, month } = req.query;
  let entries = await dbLoad('entries', []);
  if (year && month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    entries = entries.filter(e => e.date?.startsWith(prefix));
  }
  res.json(entries);
});

app.post('/api/shift/entries', requireAdmin, async (req, res) => {
  const { staffId, date, period, isPaidLeave, isLocked, note } = req.body;
  if (!staffId || !date || !period) return res.status(400).json({ error: 'staffId, date, periodは必須です' });
  const entries = await dbLoad('entries', []);
  const entry = { id: crypto.randomUUID(), staffId, date, period, isPaidLeave: !!isPaidLeave, isLocked: !!isLocked, note: note || '', createdAt: new Date().toISOString() };
  entries.push(entry);
  await dbSave('entries', entries);
  res.status(201).json(entry);
});

app.put('/api/shift/entries/:id', requireAdmin, async (req, res) => {
  const entries = await dbLoad('entries', []);
  const idx = entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'エントリーが見つかりません' });
  ['staffId','date','period','isPaidLeave','isLocked','note'].forEach(f => {
    if (req.body[f] !== undefined) entries[idx][f] = req.body[f];
  });
  await dbSave('entries', entries);
  res.json(entries[idx]);
});

app.delete('/api/shift/entries/:id', requireAdmin, async (req, res) => {
  const entries = await dbLoad('entries', []);
  const idx = entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'エントリーが見つかりません' });
  if (entries[idx].isLocked) return res.status(403).json({ error: 'ロックされたシフトは削除できません' });
  entries.splice(idx, 1);
  await dbSave('entries', entries);
  res.json({ ok: true });
});

app.post('/api/shift/entries/move', requireAdmin, async (req, res) => {
  const { entryId, newDate } = req.body;
  if (!entryId || !newDate) return res.status(400).json({ error: 'entryIdとnewDateは必須です' });
  const entries = await dbLoad('entries', []);
  const idx = entries.findIndex(e => e.id === entryId);
  if (idx === -1) return res.status(404).json({ error: 'エントリーが見つかりません' });
  if (entries[idx].isLocked) return res.status(403).json({ error: 'ロックされたシフトは移動できません' });
  const moving = entries[idx];
  const conflictIdx = entries.findIndex(e => e.id !== entryId && e.staffId === moving.staffId && e.date === newDate);
  const oldDate = moving.date;
  entries[idx].date = newDate;
  if (conflictIdx !== -1) entries[conflictIdx].date = oldDate;
  await dbSave('entries', entries);
  const result = [entries[idx]];
  if (conflictIdx !== -1) result.push(entries[conflictIdx]);
  res.json({ ok: true, entries: result });
});

// ---- Clinic days ----
app.get('/api/shift/clinic-days', async (req, res) => {
  const { year, month } = req.query;
  let days = await dbLoad('clinic_days', []);
  if (year && month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    days = days.filter(d => d.date?.startsWith(prefix));
  }
  res.json(days);
});

app.post('/api/shift/clinic-days', requireAdmin, async (req, res) => {
  const { date, isOpen, note } = req.body;
  if (!date || isOpen === undefined) return res.status(400).json({ error: 'dateとisOpenは必須です' });
  const days = await dbLoad('clinic_days', []);
  const idx = days.findIndex(d => d.date === date);
  const record = { date, isOpen: !!isOpen, note: note || '', updatedAt: new Date().toISOString() };
  if (idx !== -1) days[idx] = record; else days.push(record);
  await dbSave('clinic_days', days);
  res.json(record);
});

// ---- Settings ----
app.get('/api/shift/settings', async (req, res) => {
  res.json(await loadSettings());
});

app.put('/api/shift/settings', requireAdmin, async (req, res) => {
  const current = await loadSettings();
  const updated = {
    ...current, ...req.body,
    points: { ...current.points, ...(req.body.points || {}) },
    workHours: {
      am: { ...current.workHours.am, ...(req.body.workHours?.am || {}) },
      pm: { ...current.workHours.pm, ...(req.body.workHours?.pm || {}) },
    },
  };
  await dbSave('settings', updated);
  res.json(updated);
});

// ---- Holidays ----
app.get('/api/shift/holidays', (req, res) => {
  const { year } = req.query;
  res.json([...HOLIDAYS].filter(h => !year || h.startsWith(year)));
});

// ---- Points ----
app.get('/api/shift/points', async (req, res) => {
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'yearとmonthは必須です' });
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const [allEntries, staff, settings] = await Promise.all([
    dbLoad('entries', []),
    dbLoad('staff', []),
    loadSettings(),
  ]);
  const entries = allEntries.filter(e => e.date?.startsWith(prefix));
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

// ---- Auto-generate shifts ----
app.post('/api/shift/auto-generate', requireAdmin, async (req, res) => {
  const { year, month } = req.body;
  if (!year || !month) return res.status(400).json({ error: 'yearとmonthは必須です' });
  const yr = parseInt(year);
  const mo = parseInt(month);
  const prefix = `${yr}-${String(mo).padStart(2, '0')}`;

  const [staff, settings, allEntries, clinicDaysOverrides] = await Promise.all([
    dbLoad('staff', []),
    loadSettings(),
    dbLoad('entries', []),
    dbLoad('clinic_days', []),
  ]);

  // ロック済み以外の今月分を削除
  let entries = allEntries.filter(e => !e.date?.startsWith(prefix) || e.isLocked);
  const lockedKeys = new Set(
    entries.filter(e => e.date?.startsWith(prefix) && e.isLocked).map(e => `${e.staffId}:${e.date}`)
  );

  // 全日付を取得（開院・休診両方）
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const allDays = [];
  const firstDow = new Date(yr, mo - 1, 1).getDay();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(yr, mo - 1, d).getDay();
    const override = clinicDaysOverrides.find(cd => cd.date === dateStr);
    const isOpen = override !== undefined ? override.isOpen : !settings.closedDays.includes(dow);
    const weekNum = Math.floor((d - 1 + ((firstDow + 6) % 7)) / 7);
    allDays.push({ dateStr, dow, weekNum, isOpen });
  }

  // 週ごとにグループ化（全日付）
  const weekGroups = {};
  allDays.forEach(day => {
    if (!weekGroups[day.weekNum]) weekGroups[day.weekNum] = [];
    weekGroups[day.weekNum].push(day);
  });
  const weeks = Object.keys(weekGroups).map(Number).sort();

  const staffMap = {};
  staff.forEach(s => { staffMap[s.id] = s; });

  // 開院日ごとの出勤者リスト（最低人数チェック用）
  const dayAssignments = {};
  allDays.filter(d => d.isOpen).forEach(d => {
    dayAssignments[d.dateStr] = staff.map(s => s.id).filter(id => !lockedKeys.has(`${id}:${d.dateStr}`));
  });

  // スタッフごとの休み日を決定
  const daysOffMap = {};
  staff.forEach((s, staffIdx) => {
    daysOffMap[s.id] = new Set();

    weeks.forEach((w, wi) => {
      const weekDays = weekGroups[w];
      const closedCount = weekDays.filter(d => !d.isOpen).length;
      const openDaysInWeek = weekDays.filter(d => d.isOpen);

      // 契約に基づく必要休日数
      let contractDaysOff;
      if (s.contractType === 'weekly2') {
        contractDaysOff = 2;
      } else {
        // 隔週休3日：スタッフごとにずらして交互に2日・3日
        contractDaysOff = wi % 2 === staffIdx % 2 ? 3 : 2;
      }

      // 休診日が既に満たしている分を差し引く
      const extraDaysOff = Math.max(0, contractDaysOff - closedCount);
      if (extraDaysOff === 0) return;

      // 候補：土曜以外を優先、(staffIdx×3 + wi×2)でローテーション
      const candidates = [...openDaysInWeek]
        .filter(day => !lockedKeys.has(`${s.id}:${day.dateStr}`))
        .sort((a, b) => (a.dow === 6 ? 1 : 0) - (b.dow === 6 ? 1 : 0));

      if (candidates.length === 0) return;
      const offset = (staffIdx * 3 + wi * 2) % candidates.length;
      const rotated = [...candidates.slice(offset), ...candidates.slice(0, offset)];

      let assigned = 0;
      for (const day of rotated) {
        if (assigned >= extraDaysOff) break;
        // 最低人数チェック
        const dt = getDayType(day.dateStr);
        let canRemove = true;
        for (const rule of (settings.minStaff || [])) {
          if (rule.dayType !== dt && rule.dayType !== 'any') continue;
          const currentCount = (dayAssignments[day.dateStr] || []).filter(sid => {
            const sm = staffMap[sid];
            return sm && (rule.role === 'any' || sm.role === rule.role);
          }).length;
          const willReduce = rule.role === 'any' || staffMap[s.id]?.role === rule.role;
          if (willReduce && currentCount - 1 < rule.min) { canRemove = false; break; }
        }
        if (canRemove) {
          daysOffMap[s.id].add(day.dateStr);
          dayAssignments[day.dateStr] = (dayAssignments[day.dateStr] || []).filter(id => id !== s.id);
          assigned++;
        }
      }
    });
  });

  // エントリーを生成
  const newEntries = [];
  staff.forEach(s => {
    allDays.filter(d => d.isOpen).forEach(day => {
      if (daysOffMap[s.id]?.has(day.dateStr)) return;
      if (lockedKeys.has(`${s.id}:${day.dateStr}`)) return;
      newEntries.push({
        id: crypto.randomUUID(),
        staffId: s.id,
        date: day.dateStr,
        period: 'full',
        isPaidLeave: false,
        isLocked: false,
        note: '自動生成',
        createdAt: new Date().toISOString(),
      });
    });
  });

  // 最低人数の警告
  const warnings = [];
  allDays.filter(d => d.isOpen).forEach(day => {
    const dt = getDayType(day.dateStr);
    const assigned = dayAssignments[day.dateStr] || [];
    (settings.minStaff || []).forEach(rule => {
      if (rule.dayType !== dt && rule.dayType !== 'any') return;
      const count = assigned.filter(sid => {
        const sm = staffMap[sid];
        return sm && (rule.role === 'any' || sm.role === rule.role);
      }).length;
      if (count < rule.min) warnings.push(`${day.dateStr}：${rule.role} が ${rule.min}名必要ですが${count}名です`);
    });
  });

  entries = [...entries, ...newEntries];
  await dbSave('entries', entries);
  res.json({ ok: true, generated: newEntries.length, warnings });
});

// ---- Health check ----
app.get('/health', (_req, res) => res.send('OK'));

// ---- Start ----
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`シフト管理サーバー起動: http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('DB初期化エラー:', err.message);
    process.exit(1);
  });
