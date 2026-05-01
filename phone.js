'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEDULE_FILE = path.join(__dirname, 'data', 'phone-schedule.json');
const CALL_LOG_FILE = path.join(__dirname, 'data', 'call-log.json');

// 日曜=0, 月曜=1, ..., 土曜=6
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const DEFAULT_SCHEDULE = {
  weeklySchedule: {
    sun: { open: false },
    mon: { open: true, start: '09:00', end: '18:00', lunchStart: '13:00', lunchEnd: '14:00' },
    tue: { open: true, start: '09:00', end: '18:00', lunchStart: '13:00', lunchEnd: '14:00' },
    wed: { open: false },
    thu: { open: true, start: '09:00', end: '18:00', lunchStart: '13:00', lunchEnd: '14:00' },
    fri: { open: true, start: '09:00', end: '18:00', lunchStart: '13:00', lunchEnd: '14:00' },
    sat: { open: true, start: '09:00', end: '13:00', lunchStart: null, lunchEnd: null },
    hol: { open: false },
  },
  exceptions: [],
  // スタッフの転送先電話番号（空配列なら転送なし）
  staffPhones: [],
  // 手動上書き: null | 'open' | 'closed'
  manualOverride: null,
  messages: {
    closed: 'お電話ありがとうございます。ただいま診療時間外となっております。発信音のあとにお名前とご用件をお話しください。後ほどご連絡いたします。',
    lunch: 'お電話ありがとうございます。ただいま昼休み中でございます。発信音のあとにお名前とご用件をお話しください。後ほどご連絡いたします。',
    voicemail: '発信音のあとにお名前とご用件をお話しください。後ほどこちらからご連絡いたします。',
  },
};

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadSchedule() {
  try {
    return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SCHEDULE));
  }
}

function saveSchedule(data) {
  ensureDir(SCHEDULE_FILE);
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function loadCallLog() {
  try {
    return JSON.parse(fs.readFileSync(CALL_LOG_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function addCallLog(entry) {
  ensureDir(CALL_LOG_FILE);
  const logs = loadCallLog();
  logs.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...entry });
  if (logs.length > 2000) logs.splice(2000);
  fs.writeFileSync(CALL_LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');
}

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// 日本時間での現在ステータスを判定
// 返り値: { status: 'open'|'closed'|'lunch', reason: string }
function getCurrentStatus() {
  const schedule = loadSchedule();

  if (schedule.manualOverride === 'open') return { status: 'open', reason: 'manual' };
  if (schedule.manualOverride === 'closed') return { status: 'closed', reason: 'manual' };

  const now = new Date();
  const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const yyyy = jst.getFullYear();
  const mm = String(jst.getMonth() + 1).padStart(2, '0');
  const dd = String(jst.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const dayKey = DAY_KEYS[jst.getDay()];
  const cur = jst.getHours() * 60 + jst.getMinutes();

  // 例外日チェック
  const exception = (schedule.exceptions || []).find(e => e.date === dateStr);
  if (exception) {
    if (exception.type === 'closed') return { status: 'closed', reason: 'exception_holiday' };
    // type === 'open'
    const { start, end, lunchStart, lunchEnd } = exception;
    if (lunchStart && lunchEnd && cur >= toMinutes(lunchStart) && cur < toMinutes(lunchEnd)) {
      return { status: 'lunch', reason: 'exception_lunch' };
    }
    if (cur >= toMinutes(start) && cur < toMinutes(end)) {
      return { status: 'open', reason: 'exception_open' };
    }
    return { status: 'closed', reason: 'exception_hours' };
  }

  // 通常スケジュール
  const day = (schedule.weeklySchedule || {})[dayKey];
  if (!day || !day.open) return { status: 'closed', reason: 'holiday' };

  if (day.lunchStart && day.lunchEnd && cur >= toMinutes(day.lunchStart) && cur < toMinutes(day.lunchEnd)) {
    return { status: 'lunch', reason: 'lunch' };
  }
  if (cur >= toMinutes(day.start) && cur < toMinutes(day.end)) {
    return { status: 'open', reason: 'normal' };
  }
  return { status: 'closed', reason: 'hours' };
}

module.exports = { loadSchedule, saveSchedule, loadCallLog, addCallLog, getCurrentStatus, DEFAULT_SCHEDULE };
