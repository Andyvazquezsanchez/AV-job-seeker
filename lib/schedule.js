'use strict';
/**
 * schedule.js: the automatic run, as a task in the Windows Task Scheduler that starts
 * scripts/auto-run.js on the days and at the times the user chose. Settings are kept in
 * datos/automatico.json. The task runs only while the user is signed in to Windows
 * (Chrome opens on screen) and, if the computer was off at that time, as soon as it is on.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, DATA_DIR } = require('./db');

const TASK = 'Job Seeker - postulacion automatica';
const FILE = path.join(DATA_DIR, 'automatico.json');
const DAYS = { lun: 'Monday', mar: 'Tuesday', mie: 'Wednesday', jue: 'Thursday', vie: 'Friday', sab: 'Saturday', dom: 'Sunday' };
const DEFAULTS = { enabled: false, times: ['10:00'], days: ['lun', 'mar', 'mie', 'jue', 'vie'], max: 5 };

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
function save(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
}

/** Checks and normalizes what the panel sent. Throws with a message for the user. */
function clean(input = {}) {
  const times = [...new Set((Array.isArray(input.times) ? input.times : []).map((t) => String(t).trim()).filter(Boolean))];
  if (!times.length) throw new Error('Elegí al menos un horario.');
  if (times.length > 3) throw new Error('Se pueden elegir hasta 3 horarios por día.');
  const norm = times.map((t) => {
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`Horario inválido: ${t}. Usá el formato 10:30.`);
    return `${m[1].padStart(2, '0')}:${m[2]}`;
  }).sort();
  const days = (Array.isArray(input.days) ? input.days : []).filter((d) => DAYS[d]);
  if (!days.length) throw new Error('Elegí al menos un día.');
  const n = Number.parseInt(input.max, 10);
  const max = Number.isInteger(n) ? Math.min(Math.max(n, 1), 25) : 5;
  return { times: norm, days: Object.keys(DAYS).filter((d) => days.includes(d)), max };
}

function runner() {
  const bundled = path.join(ROOT, 'runtime', 'node.exe');
  return fs.existsSync(bundled) ? bundled : process.execPath;
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function powershell(script) {
  const enc = Buffer.from(script, 'utf16le').toString('base64');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  if (r.error) throw new Error(`No pude abrir PowerShell: ${r.error.message}`);
  return r;
}

function install(s) {
  if (process.platform !== 'win32') throw new Error('La postulación automática se programa solo en Windows.');
  const days = s.days.map((d) => DAYS[d]).join(',');
  const triggers = s.times.map((t) => {
    const [h, m] = t.split(':').map(Number);
    return `(New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${days} -At ([datetime]::Today.AddHours(${h}).AddMinutes(${m})))`;
  }).join(', ');
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$a = New-ScheduledTaskAction -Execute ${q(runner())} -Argument ${q(`"${path.join(ROOT, 'scripts', 'auto-run.js')}"`)} -WorkingDirectory ${q(ROOT)}`,
    `$t = @(${triggers})`,
    '$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3)',
    `Register-ScheduledTask -TaskName ${q(TASK)} -Action $a -Trigger $t -Settings $s -Description ${q('Job Seeker: busca y se postula en LinkedIn con tus filtros.')} -Force | Out-Null`,
    'Write-Output "ok"',
  ].join('\n');
  const r = powershell(script);
  if (r.status !== 0 || !/ok/.test(r.stdout)) throw new Error(`Windows no aceptó la tarea programada: ${(r.stderr || r.stdout || '').trim().split('\n')[0]}`);
}

function uninstall() {
  if (process.platform !== 'win32') return;
  powershell(`Unregister-ScheduledTask -TaskName ${q(TASK)} -Confirm:$false -ErrorAction SilentlyContinue`);
}

/** True when the task exists in Windows (null when it can't be checked). Remembered for a minute:
 * asking PowerShell takes a second or two, and the panel must not freeze meanwhile. */
let known = null;
function installed() {
  if (process.platform !== 'win32') return null;
  if (known && Date.now() - known.at < 60000) return known.value;
  let value = null;
  try {
    const r = powershell(`if (Get-ScheduledTask -TaskName ${q(TASK)} -ErrorAction SilentlyContinue) { "si" } else { "no" }`);
    value = /si/.test(r.stdout);
  } catch { value = null; }
  known = { at: Date.now(), value };
  return value;
}

function enable(input) {
  const s = { ...clean(input), enabled: true };
  install(s);
  known = { at: Date.now(), value: true };
  save(s);
  return s;
}
function disable() {
  uninstall();
  known = { at: Date.now(), value: false };
  const s = { ...load(), enabled: false };
  save(s);
  return s;
}
module.exports = { load, save, clean, enable, disable, installed, TASK, DAYS, FILE };
