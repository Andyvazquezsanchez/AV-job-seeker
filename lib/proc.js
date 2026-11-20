'use strict';
/**
 * proc.js: run `node <script> ...` command strings without a shell.
 *
 * The scripts in this repo were written as shell command strings for macOS and
 * Linux. cmd.exe on Windows does not understand single quotes, `VAR=x cmd`
 * prefixes or the `sleep` command, so the same strings broke there. shRun()
 * splits the string itself and starts Node directly with an argument array:
 * identical behaviour on every platform, and no shell to inject into.
 *
 * Quoting rules understood by splitArgs():
 *   'single quotes'  literal
 *   "double quotes"  literal, except \" for a quote (so C:\Users\me stays intact)
 *   unquoted         split on whitespace; a backslash escapes only whitespace,
 *                    quotes or another backslash
 * Nothing is expanded: no variables, globs, pipes or redirections.
 */
const { execFileSync } = require('child_process');

function splitArgs(str) {
  const out = [];
  let cur = '';
  let has = false;
  let i = 0;
  const s = String(str);
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) throw new Error('unterminated single quote in command');
      cur += s.slice(i + 1, end); has = true; i = end + 1;
    } else if (ch === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && s[i + 1] === '"') i++;
        cur += s[i]; i++;
      }
      if (i >= s.length) throw new Error('unterminated double quote in command');
      has = true; i++;
    } else if (ch === '\\' && i + 1 < s.length && /[\s'"\\]/.test(s[i + 1])) {
      cur += s[i + 1]; has = true; i += 2;
    } else if (/\s/.test(ch)) {
      if (has) { out.push(cur); cur = ''; has = false; }
      i++;
    } else {
      cur += ch; has = true; i++;
    }
  }
  if (has) out.push(cur);
  return out;
}

/**
 * Run a command string of the form `[VAR=value ...] node <script> [args...]`.
 * Returns stdout (like execSync). Throws on a non-zero exit, with e.stdout set.
 */
function shRun(cmd, opts = {}) {
  const tokens = splitArgs(cmd);
  const env = { ...process.env, ...(opts.env || {}) };
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
    const t = tokens.shift();
    env[t.slice(0, t.indexOf('='))] = t.slice(t.indexOf('=') + 1);
  }
  if (tokens[0] !== 'node') throw new Error(`shRun only runs node scripts, got: ${tokens[0]}`);
  return execFileSync(process.execPath, tokens.slice(1), { ...opts, env });
}

/** Blocking sleep without the external `sleep` command. */
function sleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.round(ms));
}

module.exports = { splitArgs, shRun, sleepSync };
