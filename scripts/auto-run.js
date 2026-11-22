#!/usr/bin/env node
/**
 * auto-run.js: the automatic run, started by the Windows Task Scheduler (lib/schedule.js).
 * Checks the LinkedIn session and applies with the user's filters, the same as
 * "Postular ahora" in the panel: daily window, cap, pauses and review rules all apply.
 * Output goes to datos/automatico.log; a short summary to datos/automatico-ultima.json.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DATA_DIR } = require('../lib/db');
const lock = require('../lib/runlock');
const schedule = require('../lib/schedule');

const LOG = path.join(DATA_DIR, 'automatico.log');
const LAST = path.join(DATA_DIR, 'automatico-ultima.json');
const MAX_LOG = 400 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
try { process.title = 'Job Seeker: postulación automática'; } catch { /* not supported */ }

function log(text) {
  process.stdout.write(text);
  fs.appendFileSync(LOG, text);
}
function trimLog() {
  try {
    const st = fs.statSync(LOG);
    if (st.size > MAX_LOG) {
      const keep = fs.readFileSync(LOG, 'utf8').slice(-Math.floor(MAX_LOG / 2));
      fs.writeFileSync(LOG, keep.slice(keep.indexOf('\n') + 1));
    }
  } catch { /* no log yet */ }
}
function finish(result, lines) {
  const out = { started, ended: new Date().toISOString(), result, summary: lines.slice(-25) };
  fs.writeFileSync(LAST, JSON.stringify(out, null, 2));
  log(`\nResultado: ${result}\n`);
  lock.release();
  process.exit(0);
}
function step(args) {
  return new Promise((resolve) => {
    let text = '';
    const child = spawn(process.execPath, args, {
      cwd: path.join(__dirname, '..'), windowsHide: true,
      env: { ...process.env, BROWSER_NO_GUIDE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const on = (d) => { const t = d.toString('utf8'); text += t; log(t); };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
    child.on('error', (e) => { on(`No se pudo iniciar: ${e.message}\n`); resolve({ code: 1, lines: text.split(/\r?\n/).filter((l) => l.trim()) }); });
    child.on('close', (code) => resolve({ code, lines: text.split(/\r?\n/).filter((l) => l.trim()) }));
  });
}

trimLog();
const started = new Date().toISOString();
const when = new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
log(`\n=== ${when} Postulación automática ===\n`);

const settings = schedule.load();
if (!settings.enabled) finish('desactivada; no se hizo nada.', []);

const paused = require('../lib/safety').active();
if (paused) finish(require('../lib/safety').message(paused), []);

const got = lock.acquire('automática');
if (!got.ok) finish(`había otra tarea en curso (${got.holder.owner}); esta corrida se salteó.`, []);

(async () => {
  const s = await step([path.join(__dirname, 'linkedin-session.js'), 'check']);
  if (s.code !== 0) finish('no pude confirmar la sesión de LinkedIn (sin internet o sesión vencida). Si se repite, abrí el panel y tocá "Iniciar sesión en LinkedIn".', s.lines);
  const a = await step([path.join(__dirname, 'linkedin-easy-apply.js'), '--quiet', '--max', String(settings.max)]);
  finish(a.code === 0 ? 'terminó bien.' : 'terminó con un aviso (leé el detalle).', a.lines);
})();
