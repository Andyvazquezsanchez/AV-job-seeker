'use strict';
/**
 * jobs.js: runs the panel's actions as child processes, one at a time.
 * Only the actions listed here can be started, with arguments built here:
 * nothing typed in the page ever reaches a command line.
 */
const path = require('path');
const { spawn } = require('child_process');
const runlock = require('./runlock');

const ROOT = process.env.JOB_SEEKER_ROOT || path.resolve(__dirname, '..');
const S = (name) => path.join(ROOT, 'scripts', name);
const MAX_LINES = 3000;

function plan(action, params = {}) {
  const n = Number.parseInt(params.max, 10);
  const max = String(Number.isInteger(n) ? Math.min(Math.max(n, 1), 25) : 10);
  switch (action) {
    case 'login': return { title: 'Iniciar sesión en LinkedIn', steps: [[S('linkedin-session.js'), 'login']] };
    case 'simulate': return { title: `Simulación: hasta ${max} avisos, sin enviar nada`, steps: [[S('linkedin-session.js'), 'check'], [S('linkedin-easy-apply.js'), '--dry-run', '--quiet', '--max', max]] };
    case 'apply': return { title: `Postulación real: hasta ${max} avisos`, steps: [[S('linkedin-session.js'), 'check'], [S('linkedin-easy-apply.js'), '--quiet', '--max', max]] };
    case 'site': {
      const url = String(params.url || '');
      if (!/^https:\/\/[^\s]+$/i.test(url)) return null;
      return { title: 'Iniciar sesión en el sitio de la empresa', steps: [[S('linkedin-session.js'), 'site', url]] };
    }
    case 'agent': return { title: 'Agente: postulación a avisos externos', steps: [[S('agent-run.js')]] };
    case 'close': return { title: 'Cerrar la ventana del programa', steps: [[S('linkedin-session.js'), 'close']] };
    default: return null;
  }
}

let current = null;
let counter = 0;
// Set when the user sends a job to the agent while another task runs: it starts after that one.
let agentWanted = false;

function push(job, chunk) {
  job.buffer += chunk;
  const parts = job.buffer.split(/\r?\n/);
  job.buffer = parts.pop();
  for (const line of parts) job.lines.push(line);
  if (job.lines.length > MAX_LINES) { const extra = job.lines.length - MAX_LINES; job.lines.splice(0, extra); job.dropped += extra; }
}

function runStep(job, index) {
  if (job.stopped) return finish(job, null);
  if (index >= job.steps.length) return finish(job, 0);
  const child = spawn(process.execPath, job.steps[index], {
    cwd: ROOT, windowsHide: true,
    env: { ...process.env, BROWSER_NO_GUIDE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  job.child = child;
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => push(job, d));
  child.stderr.on('data', (d) => push(job, d));
  child.on('error', (e) => { push(job, `\nNo se pudo iniciar: ${e.message}\n`); finish(job, 1); });
  child.on('close', (code) => {
    if (job.done) return;
    if (code === 0 && !job.stopped) return runStep(job, index + 1);
    finish(job, code);
  });
}

function finish(job, code) {
  if (job.done) return;
  if (job.buffer) { job.lines.push(job.buffer); job.buffer = ''; }
  job.done = true; job.child = null; job.exitCode = code; job.endedAt = new Date().toISOString();
  runlock.release();
  if (agentWanted) setTimeout(() => { if (agentWanted) start('agent'); }, 1500);
}

function start(action, params) {
  if (current && !current.done) return { error: 'Ya hay una tarea en curso. Esperá a que termine o detenela.' };
  if (action === 'agent') agentWanted = false;
  const p = plan(action, params);
  if (!p) return { error: 'Acción desconocida' };
  if (action === 'site') params = { ...params, url: undefined };
  if (action !== 'close') {
    const got = runlock.acquire('panel');
    if (!got.ok) return { error: got.holder.owner === 'automática' ? 'Hay una postulación automática en curso. Esperá a que termine.' : 'Ya hay una tarea en curso.' };
  }
  current = { id: ++counter, action, title: p.title, steps: p.steps, lines: [], dropped: 0, buffer: '', done: false, stopped: false, exitCode: null, startedAt: new Date().toISOString(), endedAt: null, child: null };
  runStep(current, 0);
  return { ok: true, id: current.id };
}

// On Windows, kill() ends only the direct child; the agent (Claude Code) or a browser helper
// started by it would keep running. taskkill /T ends the whole tree.
function killTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try { require('child_process').spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 15000 }); return; } catch { /* fall back */ }
  }
  try { child.kill(); } catch { /* already gone */ }
}

function stop() {
  if (!current || current.done) return { ok: true, running: false };
  current.stopped = true;
  current.lines.push('', 'Detenido por vos. Lo que ya se había enviado queda registrado.');
  killTree(current.child);
  return { ok: true, running: false };
}

function status(since = 0) {
  if (!current) return { running: false, id: 0, lines: [], total: 0 };
  const total = current.dropped + current.lines.length;
  const from = Math.max(0, Math.min((Number(since) || 0) - current.dropped, current.lines.length));
  return {
    id: current.id, action: current.action, title: current.title,
    running: !current.done, stopped: current.stopped, exitCode: current.exitCode,
    startedAt: current.startedAt, endedAt: current.endedAt,
    total, lines: current.lines.slice(from),
    partial: current.done ? '' : current.buffer.slice(-300),
  };
}

/** Starts the agent now, or right after the task in progress. */
function startAgent() {
  if (current && !current.done) {
    if (current.action === 'agent') { agentWanted = true; return { ok: true, running: true }; }
    agentWanted = true;
    return { ok: true, later: true };
  }
  const r = start('agent');
  if (r.error) { agentWanted = true; return { ok: true, later: true }; }
  return { ok: true, started: true, id: r.id };
}

module.exports = { plan, start, stop, status, startAgent };
