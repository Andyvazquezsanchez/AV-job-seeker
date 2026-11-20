'use strict';
/**
 * runlock.js: only one LinkedIn run at a time (panel action or automatic run), since
 * both use the same Chrome window and the same records. The lock is a small file in
 * datos/ with the process id; a lock whose process is gone, or older than 4 hours, is stale.
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const FILE = path.join(DATA_DIR, 'corrida.lock');
const MAX_AGE = 4 * 60 * 60 * 1000;

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; }
}
/** Who holds the lock now, or null. */
function holder() {
  const h = read();
  if (!h) return null;
  const old = Date.now() - Date.parse(h.started || 0) > MAX_AGE;
  if (old || !alive(h.pid)) { try { fs.unlinkSync(FILE); } catch { /* gone */ } return null; }
  return h;
}
function acquire(owner) {
  const h = holder();
  if (h && h.pid !== process.pid) return { ok: false, holder: h };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ pid: process.pid, owner, started: new Date().toISOString() }));
  return { ok: true };
}
function release() {
  const h = read();
  if (h && h.pid === process.pid) { try { fs.unlinkSync(FILE); } catch { /* gone */ } }
}
module.exports = { acquire, release, holder, FILE };
