'use strict';
/**
 * dpapi.js: Windows Data Protection (DPAPI) for the current Windows user, through
 * Windows PowerShell. Data protected here can only be read back by the same user on
 * the same computer, so a copied file is useless elsewhere.
 *
 *   protect(buf)   -> Buffer, or null when DPAPI is not available
 *   unprotect(buf) -> Buffer, or null when it cannot be read
 *
 * The data travels over stdin (base64), never on the command line.
 * JOB_SEEKER_FAKE_DPAPI=1 swaps in a reversible stand-in, only for tests on other systems.
 */
const { spawnSync } = require('child_process');

const SCRIPT = (op) => [
  'Add-Type -AssemblyName System.Security',
  '$in = [Console]::In.ReadToEnd().Trim()',
  '$b = [Convert]::FromBase64String($in)',
  `$o = [System.Security.Cryptography.ProtectedData]::${op}($b, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)`,
  '[Console]::Out.Write([Convert]::ToBase64String($o))',
].join('\n');

const FAKE = Buffer.from('FAKE-DPAPI:');
function fake(op, buf) {
  if (op === 'Protect') return Buffer.concat([FAKE, Buffer.from(buf).reverse()]);
  if (!buf.subarray(0, FAKE.length).equals(FAKE)) return null;
  return Buffer.from(buf.subarray(FAKE.length)).reverse();
}

function run(op, buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return null;
  if (process.env.JOB_SEEKER_FAKE_DPAPI === '1') return fake(op, buf);
  if (process.platform !== 'win32') return null;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(SCRIPT(op), 'utf16le').toString('base64')], {
    input: buf.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  if (r.status !== 0 || !r.stdout || !r.stdout.trim()) return null;
  try { const out = Buffer.from(r.stdout.trim(), 'base64'); return out.length ? out : null; } catch { return null; }
}

const protect = (buf) => run('Protect', buf);
const unprotect = (buf) => run('Unprotect', buf);

/** True when a round trip works on this computer. */
function available() {
  const probe = Buffer.from('job-seeker');
  const p = protect(probe);
  const back = p && unprotect(p);
  return !!(back && back.equals(probe));
}

module.exports = { protect, unprotect, available };
