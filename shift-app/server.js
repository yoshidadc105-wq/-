'use strict';
// Render free tierはIPv6非対応のためIPv4を優先する
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

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
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Pool error:', err.message);
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

// GET用: DB障害時はデフォルト値を返す（表示が空になるだけで安全）
async function dbLoadSafe(key, defaultVal) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await pool.query('SELECT value FROM app_data WHERE key=$1', [key]);
      if (attempt > 1) console.log(`DB load OK on attempt ${attempt} (${key})`);
      return r.rows.length > 0 ? r.rows[0].value : defaultVal;
    } catch (e) {
      console.error(`DB load error attempt ${attempt} (${key}):`, e.message);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  console.error(`DB load failed after 3 attempts (${key}), returning default`);
  return defaultVal;
}

// 書き込み用: DB障害時は例外をスロー（空データで上書きするのを防ぐ）
async function dbLoad(key, defaultVal) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await pool.query('SELECT value FROM app_data WHERE key=$1', [key]);
      if (attempt > 1) console.log(`DB load OK on attempt ${attempt} (${key})`);
      return r.rows.length > 0 ? r.rows[0].value : defaultVal;
    } catch (e) {
      console.error(`DB load error attempt ${attempt} (${key}):`, e.message);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      } else {
        throw new Error(`DBに接続できません。しばらく待ってから再試行してください。(${e.message})`);
      }
    }
  }
}

async function dbSave(key, data) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await pool.query(
        `INSERT INTO app_data(key,value,updated_at) VALUES($1,$2::jsonb,NOW())
         ON CONFLICT(key) DO UPDATE SET value=$2::jsonb, updated_at=NOW()`,
        [key, JSON.stringify(data)]
      );
      if (attempt > 1) console.log(`DB save OK on attempt ${attempt} (${key})`);
      return;
    } catch (e) {
      console.error(`DB save error attempt ${attempt} (${key}):`, e.message);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
      else throw new Error(`DB save failed (${key}): ${e.message}`);
    }
  }
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

async function loadSettings(safe = false) {
  const loader = safe ? dbLoadSafe : dbLoad;
  const s = await loader('settings', {});
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
  const staff = await dbLoadSafe('staff', []);
  console.log(`GET /api/shift/staff → ${staff.length}件`);
  res.json(staff);
});

app.post('/api/shift/staff', requireAdmin, async (req, res) => {
  try {
    const { name, role, contractType, color } = req.body;
    if (!name || !role) return res.status(400).json({ error: '名前と役職は必須です' });
    const staff = await dbLoad('staff', []);
    const member = { id: crypto.randomUUID(), name, role, contractType: contractType || 'weekly2', color: color || '#2563eb', createdAt: new Date().toISOString() };
    staff.push(member);
    await dbSave('staff', staff);
    console.log(`スタッフ追加: ${name} (合計${staff.length}件)`);
    res.status(201).json(member);
  } catch (e) {
    console.error('POST staff error:', e.message);
    res.status(500).json({ error: 'スタッフ保存に失敗しました: ' + e.message });
  }
});

app.put('/api/shift/staff/:id', requireAdmin, async (req, res) => {
  try {
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
  } catch (e) {
    console.error('PUT staff error:', e.message);
    res.status(500).json({ error: 'スタッフ更新に失敗しました: ' + e.message });
  }
});

app.delete('/api/shift/staff/:id', requireAdmin, async (req, res) => {
  try {
    const staff = await dbLoad('staff', []);
    const idx = staff.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'スタッフが見つかりません' });
    staff.splice(idx, 1);
    await dbSave('staff', staff);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE staff error:', e.message);
    res.status(500).json({ error: 'スタッフ削除に失敗しました: ' + e.message });
  }
});

// ---- Entries ----
app.get('/api/shift/entries', async (req, res) => {
  const { year, month } = req.query;
  let entries = await dbLoadSafe('entries', []);
  if (year && month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    entries = entries.filter(e => e.date?.startsWith(prefix));
  }
  res.json(entries);
});

app.post('/api/shift/entries', requireAdmin, async (req, res) => {
  try {
    const { staffId, date, period, isPaidLeave, isLocked, note } = req.body;
    if (!staffId || !date || !period) return res.status(400).json({ error: 'staffId, date, periodは必須です' });
    const entries = await dbLoad('entries', []);
    const entry = { id: crypto.randomUUID(), staffId, date, period, isPaidLeave: !!isPaidLeave, isLocked: !!isLocked, note: note || '', createdAt: new Date().toISOString() };
    entries.push(entry);
    await dbSave('entries', entries);
    res.status(201).json(entry);
  } catch (e) {
    console.error('POST entries error:', e.message);
    res.status(500).json({ error: 'シフト保存に失敗しました: ' + e.message });
  }
});

app.put('/api/shift/entries/:id', requireAdmin, async (req, res) => {
  try {
    const entries = await dbLoad('entries', []);
    const idx = entries.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'エントリーが見つかりません' });
    ['staffId','date','period','isPaidLeave','isLocked','note'].forEach(f => {
      if (req.body[f] !== undefined) entries[idx][f] = req.body[f];
    });
    await dbSave('entries', entries);
    res.json(entries[idx]);
  } catch (e) {
    console.error('PUT entries error:', e.message);
    res.status(500).json({ error: 'シフト更新に失敗しました: ' + e.message });
  }
});

app.delete('/api/shift/entries/:id', requireAdmin, async (req, res) => {
  try {
    const entries = await dbLoad('entries', []);
    const idx = entries.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'エントリーが見つかりません' });
    if (entries[idx].isLocked) return res.status(403).json({ error: 'ロックされたシフトは削除できません' });
    entries.splice(idx, 1);
    await dbSave('entries', entries);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE entries error:', e.message);
    res.status(500).json({ error: 'シフト削除に失敗しました: ' + e.message });
  }
});

app.post('/api/shift/entries/move', requireAdmin, async (req, res) => {
  try {
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
  } catch (e) {
    console.error('POST entries/move error:', e.message);
    res.status(500).json({ error: 'シフト移動に失敗しました: ' + e.message });
  }
});

// ---- Clinic days ----
app.get('/api/shift/clinic-days', async (req, res) => {
  const { year, month } = req.query;
  let days = await dbLoadSafe('clinic_days', []);
  if (year && month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    days = days.filter(d => d.date?.startsWith(prefix));
  }
  res.json(days);
});

app.post('/api/shift/clinic-days', requireAdmin, async (req, res) => {
  try {
    const { date, isOpen, note } = req.body;
    if (!date || isOpen === undefined) return res.status(400).json({ error: 'dateとisOpenは必須です' });
    const days = await dbLoad('clinic_days', []);
    const idx = days.findIndex(d => d.date === date);
    const record = { date, isOpen: !!isOpen, note: note || '', updatedAt: new Date().toISOString() };
    if (idx !== -1) days[idx] = record; else days.push(record);
    await dbSave('clinic_days', days);
    res.json(record);
  } catch (e) {
    console.error('POST clinic-days error:', e.message);
    res.status(500).json({ error: '診療日保存に失敗しました: ' + e.message });
  }
});

// ---- Settings ----
app.get('/api/shift/settings', async (req, res) => {
  res.json(await loadSettings(true)); // safe=true: DB障害時もデフォルト設定を返す
});

app.put('/api/shift/settings', requireAdmin, async (req, res) => {
  try {
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
    console.log('設定保存:', JSON.stringify(updated.closedDays));
    res.json(updated);
  } catch (e) {
    console.error('PUT settings error:', e.message);
    res.status(500).json({ error: '設定保存に失敗しました: ' + e.message });
  }
});

// ---- Holidays ----
app.get('/api/shift/holidays', (req, res) => {
  const { year } = req.query;
  res.json([...HOLIDAYS].filter(h => !year || h.startsWith(year)));
});

// ---- Points ----
// year/monthは締め期間の開始月 (例: 5月 = 5/11〜6/10)
app.get('/api/shift/points', async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'yearとmonthは必須です' });
    const yr = parseInt(year);
    const mo = parseInt(month);

    // 締め期間: M/11 〜 (M+1)/10
    const startDate = `${yr}-${String(mo).padStart(2, '0')}-11`;
    const endMo = mo === 12 ? 1 : mo + 1;
    const endYr = mo === 12 ? yr + 1 : yr;
    const endDate = `${endYr}-${String(endMo).padStart(2, '0')}-10`;

    const [allEntries, staff, settings] = await Promise.all([
      dbLoadSafe('entries', []),
      dbLoadSafe('staff', []),
      loadSettings(true),
    ]);
    const entries = allEntries.filter(e => e.date >= startDate && e.date <= endDate);
    const pts = settings.points;
    const result = {};
    staff.forEach(s => {
      result[s.id] = {
        name: s.name, role: s.role, contractType: s.contractType,
        details: [], total: 0,
        workingDays: 0,
        weekdayCount: 0, saturdayCount: 0, sundayCount: 0, holidayCount: 0, paidLeaveBonus: 0,
        periodStart: startDate, periodEnd: endDate,
      };
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
        row.workingDays++;
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
  } catch (e) {
    console.error('GET points error:', e.message);
    res.status(500).json({ error: 'ポイント取得に失敗しました' });
  }
});

// ---- Auto-generate shifts ----
app.post('/api/shift/auto-generate', requireAdmin, async (req, res) => {
  try {
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

    console.log(`自動生成開始: ${prefix}, スタッフ${staff.length}人, 休診日: [${settings.closedDays}]`);

    if (staff.length === 0) {
      return res.status(400).json({ error: 'スタッフが登録されていません。先にスタッフを登録してください。' });
    }

    // ロック済み以外の今月分を削除
    let entries = allEntries.filter(e => !e.date?.startsWith(prefix) || e.isLocked);
    const lockedKeys = new Set(
      entries.filter(e => e.date?.startsWith(prefix) && e.isLocked).map(e => `${e.staffId}:${e.date}`)
    );

    // 全日付を取得
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

    const openDays = allDays.filter(d => d.isOpen);
    console.log(`開院日数: ${openDays.length}日`);

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
    openDays.forEach(d => {
      dayAssignments[d.dateStr] = staff.map(s => s.id).filter(id => !lockedKeys.has(`${id}:${d.dateStr}`));
    });

    // スタッフごとの休み日を決定
    const daysOffMap = {};
    staff.forEach((s, staffIdx) => {
      daysOffMap[s.id] = new Set();
      let totalDaysOff = 0;

      weeks.forEach((w, wi) => {
        const weekDays = weekGroups[w];
        const closedCount = weekDays.filter(d => !d.isOpen).length;
        const openDaysInWeek = weekDays.filter(d => d.isOpen);

        if (openDaysInWeek.length === 0) return;

        // 契約に基づく週あたり必要休日数
        let contractDaysOff;
        if (s.contractType === 'weekly2') {
          contractDaysOff = 2;
        } else {
          // 隔週休3日：スタッフごとにずらして交互
          contractDaysOff = (wi + staffIdx) % 2 === 0 ? 3 : 2;
        }

        // 休診日が既に満たしている分を差し引く
        const extraDaysOff = Math.max(0, contractDaysOff - closedCount);

        console.log(`  ${s.name} 週${wi}(${openDaysInWeek.length}開院日, 休診${closedCount}日): 契約${contractDaysOff}日→追加休み${extraDaysOff}日`);

        if (extraDaysOff === 0) return;

        // 候補：土曜以外を優先してローテーション
        const candidates = [...openDaysInWeek]
          .filter(day => !lockedKeys.has(`${s.id}:${day.dateStr}`))
          .sort((a, b) => (a.dow === 6 ? 1 : 0) - (b.dow === 6 ? 1 : 0));

        if (candidates.length <= extraDaysOff) {
          // 候補数が必要休日数以下なら全部休みにはできないので縮小
          // (最低1日は出勤する)
          const maxOff = Math.max(0, candidates.length - 1);
          if (maxOff === 0) return;
        }

        const maxAssign = Math.min(extraDaysOff, Math.max(0, candidates.length - 1));
        if (maxAssign === 0) return;

        const offset = (staffIdx * 3 + wi * 2) % candidates.length;
        const rotated = [...candidates.slice(offset), ...candidates.slice(0, offset)];

        let assigned = 0;
        for (const day of rotated) {
          if (assigned >= maxAssign) break;
          let canRemove = true;
          for (const rule of (settings.minStaff || [])) {
            if (rule.dayType !== getDayType(day.dateStr) && rule.dayType !== 'any') continue;
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
            totalDaysOff++;
          }
        }
      });

      console.log(`  ${s.name}: 休み${totalDaysOff}日割り当て`);
    });

    // エントリーを生成
    const newEntries = [];
    staff.forEach(s => {
      openDays.forEach(day => {
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
    openDays.forEach(day => {
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
    console.log(`自動生成完了: ${newEntries.length}件`);
    res.json({ ok: true, generated: newEntries.length, warnings });
  } catch (e) {
    console.error('POST auto-generate error:', e.message);
    res.status(500).json({ error: '自動生成に失敗しました: ' + e.message });
  }
});

// ---- Debug endpoint ----
app.get('/api/shift/debug', requireAdmin, async (req, res) => {
  try {
    const [staff, settings, entries] = await Promise.all([
      dbLoad('staff', null),
      dbLoad('settings', null),
      dbLoad('entries', null),
    ]);
    res.json({
      staffCount: Array.isArray(staff) ? staff.length : 'load failed',
      staffRaw: staff,
      settingsClosedDays: settings?.closedDays ?? 'load failed',
      entriesCount: Array.isArray(entries) ? entries.length : 'load failed',
      dbUrl: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:([^@]+)@/, ':***@') : 'not set',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
