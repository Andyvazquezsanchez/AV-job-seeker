'use strict';
/**
 * store.js: database access for the user's configuration and application
 * history. Bound parameters everywhere; single user (USER_ID, default 1).
 */
const path = require('path');
const cfg = require('./config');
const dbm = require('./db');

const REPO_ROOT = process.env.JOB_SEEKER_ROOT || path.resolve(__dirname, '..');
const USER_ID = Number.parseInt(process.env.USER_ID || '1', 10);

async function withDb(fn) {
  if (!Number.isInteger(USER_ID) || USER_ID < 1) throw new Error('USER_ID debe ser un entero positivo');
  return dbm.withDb(fn);
}

/** Create the tables the program uses when they do not exist yet (see DATA.md). */
async function ensureSchema(c) {
  await c.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, data JSONB DEFAULT '{}')`);
  await c.query(`CREATE TABLE IF NOT EXISTS applications (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), platform TEXT, company TEXT, role TEXT, url TEXT,
    status TEXT DEFAULT 'discovered', applied_at TIMESTAMPTZ DEFAULT NOW(), data JSONB DEFAULT '{}')`);
  await c.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, application_id INTEGER REFERENCES applications(id), user_id INTEGER REFERENCES users(id),
    channel TEXT, direction TEXT, sender TEXT, subject TEXT, body TEXT, draft TEXT, status TEXT DEFAULT 'draft', received_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, data JSONB DEFAULT '{}')`);
  await c.query(`CREATE TABLE IF NOT EXISTS preferences (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), category TEXT NOT NULL, key TEXT NOT NULL, value TEXT,
    confidence REAL DEFAULT 1.0, source TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (user_id, category, key))`);
  await c.query(`CREATE TABLE IF NOT EXISTS company_registrations (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), company TEXT NOT NULL, region TEXT, sector TEXT,
    careers_url TEXT, ats_platform TEXT, registration_status TEXT DEFAULT 'pending', profile_completed BOOLEAN DEFAULT FALSE, profile_url TEXT, login_method TEXT,
    applied_jobs_count INTEGER DEFAULT 0, last_visit_at TIMESTAMPTZ, last_applied_at TIMESTAMPTZ, notes TEXT, data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (user_id, company))`);
}

async function getUserData(c) {
  const r = await c.query('SELECT data FROM users WHERE id = $1', [USER_ID]);
  return r.rows[0] ? (r.rows[0].data || {}) : null;
}

/** Save validated settings. Creates the user row on first use (needs first_name and email). */
async function saveSettings(c, clean) {
  const current = await getUserData(c);
  if (current === null) {
    const name = [clean.first_name, clean.last_name].filter(Boolean).join(' ');
    if (!name || !clean.email) throw new Error('Para crear el usuario hacen falta nombre y email');
    const data = cfg.applyToData({}, clean);
    await c.query('INSERT INTO users (id, name, email, data) VALUES ($1, $2, $3, $4::jsonb)', [USER_ID, name, clean.email, JSON.stringify(data)]);
    await c.query(`SELECT setval(pg_get_serial_sequence('users','id'), (SELECT max(id) FROM users))`);
    return data;
  }
  const data = cfg.applyToData(current, clean);
  await c.query('UPDATE users SET data = $1::jsonb WHERE id = $2', [JSON.stringify(data), USER_ID]);
  return data;
}

/**
 * Insert past applications so they are never applied to again. A row is
 * skipped when the same URL, or the same company and role, already exists.
 */
async function importHistory(c, rows) {
  let inserted = 0, skipped = 0;
  for (const r of rows) {
    const dup = await c.query(
      `SELECT 1 FROM applications WHERE user_id = $1 AND (($2::text IS NOT NULL AND url = $2) OR (lower(company) = lower($3) AND lower(role) = lower($4))) LIMIT 1`,
      [USER_ID, r.url, r.company, r.role]);
    if (dup.rows.length) { skipped++; continue; }
    await c.query(
      `INSERT INTO applications (user_id, platform, company, role, url, status, applied_at, data)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()), $8::jsonb)`,
      [USER_ID, r.platform, r.company, r.role, r.url, r.status, r.date, JSON.stringify({ source: 'history_import', notes: r.notes })]);
    inserted++;
  }
  return { inserted, skipped };
}

/** Removes pending questions the user marked as not real form questions (by id). */
async function discardPending(c, ids) {
  const want = new Set((Array.isArray(ids) ? ids : []).map(String));
  if (!want.size) return 0;
  const data = (await getUserData(c)) || {};
  const pending = Array.isArray(data.pending_questions) ? data.pending_questions : [];
  data.pending_questions = pending.filter((q) => !want.has(String(q.id)));
  await c.query('UPDATE users SET data = $1::jsonb WHERE id = $2', [JSON.stringify(data), USER_ID]);
  return pending.length - data.pending_questions.length;
}

/** Answer pending questions from the configuration page: { "<id>": "<answer>" }. */
async function answerPending(c, answersById) {
  const A = require('./answers');
  const data = (await getUserData(c)) || {};
  const pending = Array.isArray(data.pending_questions) ? data.pending_questions : [];
  const fa = data.form_answers && typeof data.form_answers === 'object' ? data.form_answers : {};
  const qa = fa.qa && typeof fa.qa === 'object' ? { ...fa.qa } : {};
  const errors = [];
  const rest = [];
  let saved = 0;
  for (const q of pending) {
    const given = answersById[String(q.id)];
    if (given === undefined || given === null || !String(given).trim()) { rest.push(q); continue; }
    let value = String(given).trim().slice(0, 2000);
    if (q.options && q.options.length) {
      const hit = A.matchOption(value, q.options);
      if (!hit) { errors.push(`"${q.question}": la respuesta debe ser una de: ${q.options.join(' | ')}`); rest.push(q); continue; }
      value = hit;
    }
    qa[q.question] = value; saved++;
  }
  data.form_answers = { ...fa, qa };
  data.pending_questions = rest;
  await c.query('UPDATE users SET data = $1::jsonb WHERE id = $2', [JSON.stringify(data), USER_ID]);
  return { saved, remaining: rest.length, errors };
}

/** Read the user's tracking spreadsheet (if one is configured, or the given file) into the database. */
async function syncTracking(c, file) {
  const tracking = require('./tracking');
  const row = await getUserData(c);
  const data = row || {};
  const target = file || (data.tracking && data.tracking.file);
  if (!target) return { configured: false };
  if (row === null) throw new Error('Primero cargá tu nombre y tu email en Configuración; después se puede leer la planilla.');
  const res = await tracking.syncFromFile(c, target, USER_ID);
  return { configured: true, file: target, ...res };
}

/** Path of the CSV where submitted applications are logged. */
function logFileFrom(data) {
  return (data && data.tracking && data.tracking.log_file) || path.join(dbm.DATA_DIR, 'postulaciones-automaticas.csv');
}

module.exports = { syncTracking, logFileFrom, REPO_ROOT, USER_ID, withDb, ensureSchema, getUserData, saveSettings, importHistory, answerPending, discardPending };
