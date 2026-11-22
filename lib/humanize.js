'use strict';
/**
 * humanize.js: variable pacing so automated runs do not repeat exact timings.
 *
 * - jitter(ms): never shorter than the original wait (so UI timing assumptions
 *   still hold), between 1.0x and 1.9x, with a small chance of a longer
 *   "distraction" pause on waits of one second or more.
 * - betweenApplications(): wait between two applications: 25 to 80 s, and every
 *   4 to 7 applications a longer break of 2 to 5 minutes.
 *
 * - gate(): daily window (opens at 07:00 plus a per-day random 0-45 min, closes
 *   at 19:00 in the user's time zone) and, for LinkedIn only, a daily cap (10-15
 *   on full days, half on half days, 0 on rest days; fixed per date; all of
 *   it adjustable in the user's settings) counted from the
 *   applications table. Company sites keep the window and the Sunday rest.
 *   Also for LinkedIn: a gradual start (the first weeks after the first automatic
 *   application cap at 5, then 10, ...), half the cap for a few days after a
 *   safety pause, and no applying at all while a safety pause is on (lib/safety.js).
 * - shuffle(): random order of jobs.
 *
 * Set HUMANIZE_OFF=1 to disable everything (tests, debugging). Scripts also
 * accept --force to bypass the window and the cap for one run.
 * HUMANIZE_START_HOUR / HUMANIZE_END_HOUR change the window; HUMANIZE_NOW is for tests.
 */
const rand = (min, max) => min + Math.random() * (max - min);

function jitter(ms) {
  if (process.env.HUMANIZE_OFF === '1') return ms;
  let out = ms * rand(1.0, 1.9);
  if (ms >= 1000 && Math.random() < 0.05) out += rand(1500, 5000);
  return Math.round(out);
}

let appCount = 0;
let nextBreakAt = Math.floor(rand(4, 8));

function betweenApplications() {
  if (process.env.HUMANIZE_OFF === '1') return 5000;
  appCount += 1;
  let ms = rand(25000, 80000);
  if (appCount >= nextBreakAt) {
    ms = rand(120000, 300000);
    appCount = 0;
    nextBreakAt = Math.floor(rand(4, 8));
  }
  return Math.round(ms);
}

// ---------------------------------------------------------------------------
// Daily schedule: working window, daily cap, rest days (Buenos Aires time)
// ---------------------------------------------------------------------------
const { spawnSync } = require('child_process');
const path = require('path');

// Defaults. The user can change them in the configuration page or in
// config/perfil.json (users.data.automation); HUMANIZE_* env vars override both.
const DEFAULTS = {
  timezone: 'America/Argentina/Buenos_Aires',
  start_hour: 7, end_hour: 19,
  daily_cap_min: 10, daily_cap_max: 15,
  rest_days: ['sun'], half_days: ['sat'],
  company_cap: 5,
  ramp_weeks: 2,
};

let _settings = null;
let _settingsAt = 0;
const DB_TIMEOUT = 90000;
const dbJs = () => path.join(__dirname, '..', 'scripts', 'db.js');

/** Automation settings: defaults, then the user's saved values, then env overrides. Re-read at most every 30 s. */
function settings() {
  if (_settings && Date.now() - _settingsAt < 30000) return _settings;
  let saved = {};
  if (process.env.HUMANIZE_OFF !== '1' && process.env.HUMANIZE_NO_DB !== '1') {
    const uid = Number.parseInt(process.env.USER_ID || '1', 10) || 1;
    const r = spawnSync(process.execPath, [dbJs(), `SELECT data->'automation' AS a FROM users WHERE id = ${uid}`], { encoding: 'utf8', timeout: DB_TIMEOUT });
    try { saved = JSON.parse(r.stdout)[0].a || {}; } catch { saved = {}; }
  }
  _settings = settingsFrom(saved);
  _settingsAt = Date.now();
  return _settings;
}

/** Settings from a saved users.data.automation object (no database access). */
function settingsFrom(saved) {
  saved = saved && typeof saved === 'object' ? saved : {};
  const s = { ...DEFAULTS };
  const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
  for (const [k, min, max] of [['start_hour', 0, 23], ['end_hour', 1, 24], ['daily_cap_min', 0, 50], ['daily_cap_max', 0, 50], ['company_cap', 1, 20], ['ramp_weeks', 0, 8]]) {
    const v = int(saved[k], min, max);
    if (v !== null) s[k] = v;
  }
  for (const k of ['rest_days', 'half_days']) if (Array.isArray(saved[k])) s[k] = saved[k].map((d) => String(d).toLowerCase());
  if (typeof saved.timezone === 'string') {
    try { new Intl.DateTimeFormat('en', { timeZone: saved.timezone }); s.timezone = saved.timezone; } catch { /* keep default */ }
  }
  if (process.env.HUMANIZE_START_HOUR) s.start_hour = Number.parseInt(process.env.HUMANIZE_START_HOUR, 10);
  if (process.env.HUMANIZE_END_HOUR) s.end_hour = Number.parseInt(process.env.HUMANIZE_END_HOUR, 10);
  if (!(s.start_hour < s.end_hour)) { s.start_hour = DEFAULTS.start_hour; s.end_hour = DEFAULTS.end_hour; }
  if (s.daily_cap_min > s.daily_cap_max) s.daily_cap_min = s.daily_cap_max;
  return s;
}

function now() {
  return process.env.HUMANIZE_NOW ? new Date(process.env.HUMANIZE_NOW) : new Date();
}

function localParts(date, st = settings()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: st.timezone, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday, // Mon..Sun
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

// Deterministic per-day randomness: the same date always gives the same cap
// and start offset, so repeated runs on one day agree with each other.
function seeded(day, salt) {
  let h = 1779033703 ^ (day + salt).length;
  for (const ch of day + salt) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let t = (h += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function dailyCap(day, weekday, st = settings()) {
  const wd = String(weekday).toLowerCase();
  if (st.rest_days.includes(wd)) return 0;
  const span = st.daily_cap_max - st.daily_cap_min + 1;
  const full = st.daily_cap_min + Math.floor(seeded(day, 'cap') * span);
  return st.half_days.includes(wd) ? (full > 0 ? Math.max(1, Math.round(full / 2)) : 0) : full;
}

function startOffsetMinutes(day) {
  return Math.floor(seeded(day, 'start') * 46); // 0 to 45 min after the window opens
}

function pad(n) { return String(n).padStart(2, '0'); }
function hhmm(totalMin) { return `${pad(Math.floor(totalMin / 60))}:${pad(totalMin % 60)}`; }

// Applications submitted today on LinkedIn (the daily cap exists because of
// LinkedIn's own limits, so only LinkedIn counts toward it) and the date of the
// first automatic one (for the gradual start). Same SQL for the panel (todaySql).
function todaySql(tz) {
  const zone = String(tz).replace(/'/g, '');
  return "SELECT count(*) FILTER (WHERE status = 'applied' AND platform = 'linkedin' " +
    `AND (applied_at AT TIME ZONE '${zone}')::date = (NOW() AT TIME ZONE '${zone}')::date)::int AS n, ` +
    "min(applied_at) FILTER (WHERE platform = 'linkedin' AND data->>'source' = 'linkedin_easy_apply') AS first FROM applications";
}
/** { n, first } or null when the database did not answer (the caller must not apply then). */
function countAppliedToday(st = settings()) {
  const r = spawnSync(process.execPath, [dbJs(), todaySql(st.timezone)], { encoding: 'utf8', timeout: DB_TIMEOUT });
  try {
    const row = JSON.parse(r.stdout)[0];
    if (!row || !Number.isInteger(row.n)) return null;
    return { n: row.n, first: row.first || null };
  } catch { return null; }
}

/** Cap for the gradual start: week 1 up to 5, week 2 up to 10, ... while within ramp_weeks. */
function rampCap(first, st, at = now()) {
  if (!st.ramp_weeks) return Infinity;
  const start = first ? new Date(first) : at;
  if (Number.isNaN(start.getTime())) return Infinity;
  const week = Math.floor(Math.max(0, at.getTime() - start.getTime()) / (7 * 86400000)) + 1;
  return week <= st.ramp_weeks ? 5 * week : Infinity;
}

/**
 * Decide whether auto-applying is allowed right now.
 * Returns { allowed, message, cap, done, remaining }.
 * opts.scope: 'linkedin' (default) applies the daily cap; 'sites' (company career
 * sites and job boards) applies only the working window and the Sunday rest,
 * because those sites do not share a counter with LinkedIn or with each other.
 * HUMANIZE_OFF=1 disables the gate; callers also honor a --force flag.
 */
const DAY_ES = { mon: 'lunes', tue: 'martes', wed: 'miércoles', thu: 'jueves', fri: 'viernes', sat: 'sábado', sun: 'domingo' };

function gate(opts = {}) {
  if (process.env.HUMANIZE_OFF === '1') return { allowed: true, remaining: Infinity, cap: Infinity, done: 0, message: '' };
  const st = opts.settings ? settingsFrom(opts.settings) : settings();
  const t = localParts(now(), st);
  const sites = opts.scope === 'sites';
  let cap = sites ? (st.rest_days.includes(t.weekday.toLowerCase()) ? 0 : Infinity) : dailyCap(t.day, t.weekday, st);
  const opens = st.start_hour * 60 + startOffsetMinutes(t.day);
  const closes = st.end_hour * 60;
  const notes = [];

  if (!sites) {
    const safety = require('./safety');
    const p = safety.active();
    if (p) return { cap: 0, done: opts.done || 0, remaining: 0, allowed: false, paused: p, message: safety.message(p) };
  }

  let done = 0;
  if (!sites) {
    let count = opts.done !== undefined ? { n: opts.done, first: opts.first || null } : countAppliedToday(st);
    if (!count) {
      return { cap, done: 0, remaining: 0, allowed: false, message: 'No pude contar las postulaciones de hoy (la base de datos no respondió). Freno para no pasarme del tope; probá de nuevo en unos minutos.' };
    }
    done = count.n;
    const ramp = rampCap(count.first, st);
    if (cap > 0 && ramp < cap) { cap = ramp; notes.push(`arranque gradual: hasta ${ramp} por día las primeras semanas`); }
    if (cap > 1 && require('./safety').recovering()) { cap = Math.max(1, Math.floor(cap / 2)); notes.push('mitad del tope por unos días después de una pausa'); }
  }
  const remaining = Math.max(0, cap - done);
  const base = { cap, done, remaining };
  const extra = notes.length ? ` (${notes.join('; ')})` : '';

  if (cap === 0) return { ...base, allowed: false, message: `Hoy es día de descanso (${DAY_ES[t.weekday.toLowerCase()] || t.weekday}): no hay postulaciones automáticas.` };
  if (t.minutes < opens) return { ...base, allowed: false, message: `Fuera de horario: hoy se empieza a las ${hhmm(opens)} (${st.timezone}).` };
  if (t.minutes >= closes) return { ...base, allowed: false, message: `Fuera de horario: la jornada terminó a las ${hhmm(closes)} (${st.timezone}).` };
  if (remaining === 0) return { ...base, allowed: false, message: `Tope del día alcanzado: ${done} de ${cap} postulaciones en LinkedIn${extra}.` };
  if (sites) return { ...base, allowed: true, message: 'Dentro del horario (los sitios de empresas no tienen tope diario).' };
  return { ...base, allowed: true, message: `Tope de hoy en LinkedIn: ${cap}; van ${done}; quedan ${remaining}${extra}.` };
}

// True once the window has closed (used to stop in the middle of a run).
function windowClosed() {
  if (process.env.HUMANIZE_OFF === '1') return false;
  return localParts(now()).minutes >= settings().end_hour * 60;
}

// Blocking sleep that works on Windows, macOS and Linux (no external `sleep` command).
function sleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.round(ms));
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// For scripts that apply but do not do their own cap handling: stop early.
function exitUnlessAllowed() {
  if (process.argv.includes('--force')) return;
  const g = gate();
  if (!g.allowed) {
    console.log(g.message);
    process.exit(0);
  }
}

module.exports = { settings, settingsFrom, jitter, betweenApplications, gate, windowClosed, shuffle, sleepSync, exitUnlessAllowed, dailyCap, localParts, rampCap, todaySql };
