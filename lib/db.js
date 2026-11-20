'use strict';
/**
 * db.js: one way to open the database, for every script.
 *
 * Default: a local database stored in the program folder (datos/base). It is
 * created automatically the first time it is opened. No server, no account,
 * no connection string. The engine is PostgreSQL compiled to run inside Node
 * (PGlite), so every query in this program works unchanged.
 *
 * Optional: if .env contains DATABASE_URL, that external PostgreSQL server is
 * used instead (for people who want their data on a server of their own).
 *
 * The local database can be opened by one process at a time. open() takes a
 * lock file and waits for other processes to finish, so scripts, the panel and
 * the agent can all run without stepping on each other.
 *
 *   const db = await open();
 *   const r = await db.query('SELECT ... WHERE id = $1', [1]);   // r.rows, r.rowCount, r.command
 *   await db.end();
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.JOB_SEEKER_ROOT || path.resolve(__dirname, '..');
const DATA_DIR = process.env.JOB_SEEKER_DATA || path.join(ROOT, 'datos');
const LOCAL_DIR = path.join(DATA_DIR, 'base');
const LOCK_PATH = path.join(DATA_DIR, 'base.lock');
const LOCK_WAIT_MS = 60000;
const LOCK_STALE_MS = 10 * 60000;

function externalUrl() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return null;
  const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m);
  if (!m) return null;
  const url = m[1].trim().replace(/^['"]|['"]$/g, '');
  return url ? url.replace(/sslmode=(require|prefer|verify-ca)\b/i, 'sslmode=verify-full') : null;
}

function describe() {
  const url = externalUrl();
  if (!url) return { kind: 'local', location: LOCAL_DIR };
  try { const u = new URL(url); return { kind: 'external', location: `${u.username}@${u.host}${u.pathname}` }; } catch { return { kind: 'external', location: '(invalid DATABASE_URL)' }; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

async function acquireLock() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(LOCK_PATH, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      fs.closeSync(fd);
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Someone holds it. Take it over only if that process is gone or the lock is very old.
      let holder = null;
      try { holder = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8')); } catch { /* being written or removed */ }
      const stale = holder && (!pidAlive(holder.pid) || Date.now() - holder.at > LOCK_STALE_MS);
      if (stale) { try { fs.unlinkSync(LOCK_PATH); } catch { /* another process took care of it */ } continue; }
      if (Date.now() - started > LOCK_WAIT_MS) throw new Error('La base de datos está ocupada por otro proceso. Esperá a que termine y volvé a intentar.');
      await sleep(120 + Math.floor(Math.random() * 120));
    }
  }
}

function releaseLock() {
  try {
    const holder = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (holder.pid === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch { /* already gone */ }
}

// Same shape as a node-postgres result, whatever the engine.
function shape(r) {
  return { rows: r.rows || [], rowCount: r.rowCount != null ? r.rowCount : (r.affectedRows != null && !(r.rows && r.rows.length) ? r.affectedRows : (r.rows || []).length), command: r.command || '', fields: r.fields || [] };
}

async function openLocal() {
  await acquireLock();
  let db;
  try {
    const { PGlite } = await import('@electric-sql/pglite');
    db = new PGlite(LOCAL_DIR);
    await db.waitReady;
  } catch (e) {
    releaseLock();
    throw e;
  }
  let closed = false;
  const onExit = () => releaseLock();
  process.once('exit', onExit);
  return {
    kind: 'local',
    /** With params: one statement. Without: one or several; several return an array of results. */
    async query(text, params) {
      if (params && params.length) return shape(await db.query(text, params));
      const results = await db.exec(text);
      if (results.length === 1) return shape(results[0]);
      return results.length ? results.map(shape) : shape({});
    },
    async end() {
      if (closed) return;
      closed = true;
      try { await db.close(); } finally { releaseLock(); process.removeListener('exit', onExit); }
    },
  };
}

async function openExternal(url) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  return {
    kind: 'external',
    query: (text, params) => client.query(text, params),
    end: () => client.end().catch(() => {}),
  };
}

/** Open the database. Always call end() when done; the local one stays locked until then. */
async function open() {
  const url = externalUrl();
  return url ? openExternal(url) : openLocal();
}

/** Open, run fn(db), close. */
async function withDb(fn) {
  const db = await open();
  try { return await fn(db); } finally { await db.end(); }
}

module.exports = { open, withDb, describe, ROOT, DATA_DIR };
