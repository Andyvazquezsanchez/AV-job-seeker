'use strict';
/** claude-cli.js: finds the Claude Code command on this computer (null when not installed). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let cache = null;
function findClaude() {
  // The panel asks on every refresh: remember the answer for a minute instead of running "where" each time.
  if (cache && Date.now() - cache.at < 60000) return cache.path;
  const found = lookup();
  cache = { at: Date.now(), path: found };
  return found;
}

function lookup() {
  const win = process.platform === 'win32';
  const found = [];
  try {
    const r = spawnSync(win ? 'where' : 'which', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (r.status === 0) found.push(...r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  } catch { /* not on PATH */ }
  const home = os.homedir();
  if (win) {
    found.push(path.join(home, '.local', 'bin', 'claude.exe'));
    if (process.env.APPDATA) found.push(path.join(process.env.APPDATA, 'npm', 'claude.cmd'));
  } else {
    found.push(path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude');
  }
  // On Windows prefer the .exe, then .cmd; skip extension-less shims that cannot be started directly.
  const ok = found.filter((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (win) return ok.find((p) => /\.exe$/i.test(p)) || ok.find((p) => /\.cmd$/i.test(p)) || null;
  return ok[0] || null;
}
module.exports = { findClaude };
