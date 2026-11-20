#!/usr/bin/env node
/**
 * agent-run.js: started from the panel when the user sends LinkedIn jobs without Easy Apply
 * to the agent ("Para el agente" in Avisos para revisar). For each job with that status, oldest
 * first, it runs Claude Code without a conversation (claude -p) in this folder, limited to
 * this program's own commands, and shows what it does. The agent follows AGENTS.md rule 19b:
 * it submits only when `targets.js decide` returns auto and queues everything else.
 */
const path = require('path');
const { spawn } = require('child_process');
const ext = require('../lib/external');
const { findClaude } = require('../lib/claude-cli');

const ROOT = path.join(__dirname, '..');
// Only this program's own commands, for Bash (Git for Windows) and for PowerShell (Windows without Git).
const CMDS = ['node scripts/externos.js', 'node scripts/targets.js', 'node scripts/config.js', 'node .agents/skills/browser-automation/scripts/browser.js'];
const ALLOWED = ['Read', 'Glob', 'Grep']
  .concat(CMDS.map((c) => `Bash(${c} *)`), CMDS.map((c) => `PowerShell(${c} *)`))
  .join(',');

// Files the user set in Configuración, so the agent can upload them when a form asks.
let FILES = '';
function loadFiles() {
  try {
    const store = require('../lib/store');
    return store.withDb(async (c) => {
      const d = (await store.getUserData(c)) || {};
      const p = d.profile || {};
      const lines = [];
      if (p.cv_path) lines.push(`CV en español: ${p.cv_path}`);
      if (p.cv_path_en) lines.push(`CV en inglés: ${p.cv_path_en}`);
      if (p.photo_path) lines.push(`Foto de perfil: ${p.photo_path}`);
      FILES = lines.length ? `Archivos del usuario para subir cuando el formulario los pida (usá estas rutas tal cual): ${lines.join('; ')}.` : '';
    });
  } catch { return Promise.resolve(); }
}

function prompt(item) {
  return [
    `Seguí AGENTS.md, regla 19b. Postulate solo al aviso externo #${item.id}: "${item.role}" en ${item.company} (${item.url}).`,
    'Nadie va a responder preguntas durante esta corrida: no esperes aprobación ni respuestas.',
    `Enviá la postulación solo si \`node scripts/targets.js decide\` devuelve auto. En cualquier otro caso, completá lo que se pueda y dejala en la cola con \`targets.js queue add\`, agregando --notes "externo #${item.id}" (el usuario la aprueba o la rechaza desde el panel).`,
    "Si el formulario pregunta algo que el usuario no tiene respondido, no lo inventes: registralo con `node scripts/targets.js questions add --url <url del formulario> --json '[{\"question\":\"...\",\"type\":\"text\"}]'` (para opciones agregá \"options\":[...]) y dejá el aviso en cola. No hace falta crear archivos: usá --json y, en queue add, --answers-json.",
    FILES || 'El usuario no cargó archivos para subir: si el formulario pide un archivo obligatorio (foto, CV), dejalo en cola con ese motivo.',
    'Si el formulario pide una foto y el usuario no cargó "Foto de perfil", no registres la foto como pregunta: dejalo en cola con el motivo "falta foto de perfil".',
    'Si el sitio pide iniciar sesión y no hay una cuenta creada por vos con `targets.js creds`, no intentes adivinar ni restablecer contraseñas: dejalo en cola con el motivo login_needed; el usuario inicia sesión desde el panel.',
    'Si la descripción no pasa los filtros del usuario, no te postules.',
    `Al terminar marcá el aviso con \`node scripts/externos.js mark ${item.id} <en cola|postulado|descartado> --note "<motivo>"\` y respondé en una sola línea, en español, qué pasó.`,
    'Usá siempre rutas con barras normales, como están escritas acá.',
  ].join('\n');
}

const say = (t) => process.stdout.write(t + '\n');
const short = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '...' : t; };

function runOne(claude, item, text) {
  return new Promise((resolve) => {
    // Manual mode ("default"): only the commands in ALLOWED run; anything else is refused, since
    // nobody is there to approve it. Auto mode would let other actions through.
    const args = ['-p', '--permission-mode', 'default', '--output-format', 'stream-json', '--verbose', '--max-turns', '80', '--allowedTools', ALLOWED];
    const cmd = /\.cmd$/i.test(claude);
    const child = spawn(cmd ? `"${claude}"` : claude, cmd ? args.map((a) => `"${a}"`) : args, {
      cwd: ROOT, shell: cmd, windowsHide: true, env: { ...process.env, BROWSER_NO_GUIDE: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(text || prompt(item));
    let buf = '';
    let final = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
          for (const c of ev.message.content) {
            if (c.type === 'text' && c.text.trim()) say('  ' + short(c.text, 400));
            if (c.type === 'tool_use') say('  > ' + short(c.input && (c.input.command || c.input.file_path || c.input.pattern) || c.name));
          }
        }
        if (ev.type === 'result') final = ev.result || ev.subtype || '';
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => say('  ' + short(d, 300)));
    child.on('error', (e) => { say(`  No pude iniciar Claude Code: ${e.message}`); resolve({ code: 1, final }); });
    child.on('close', (code) => resolve({ code, final }));
  });
}

function approvedPrompt(app) {
  const r = app.review || {};
  return [
    `Seguí la skill targets, sección "Final approval", para la postulación #${app.id}: "${app.role}" en ${app.company} (${app.url}). El usuario la aprobó desde el panel.`,
    r.user_note ? `Indicación del usuario para esta postulación (aplicala): ${r.user_note}` : '',
    FILES,
    `Mirá lo que quedó preparado con \`node scripts/targets.js queue show ${app.id}\`, abrí el formulario, completalo con review.answers y con las respuestas guardadas del usuario, revisá los límites con \`targets.js gate --company\`, enviá, verificá la confirmación y ejecutá \`node scripts/targets.js queue submitted ${app.id}\`.`,
    "Nadie va a responder preguntas durante esta corrida. Si no podés enviarla (captcha, error del sitio, una pregunta sin respuesta del usuario), no la marques como enviada: registrá la pregunta con `node scripts/targets.js questions add --url <url> --json '[...]'` si corresponde y explicá el motivo en una línea.",
    r.notes && /externo #(\d+)/.test(r.notes) ? `Si la enviaste, marcá también \`node scripts/externos.js mark ${r.notes.match(/externo #(\d+)/)[1]} postulado\`.` : '',
    'Respondé al final en una sola línea, en español, qué pasó. Usá siempre rutas con barras normales.',
  ].filter(Boolean).join('\n');
}

async function approvedQueue() {
  const store = require('../lib/store');
  const review = require('../lib/review');
  return store.withDb(async (c) => { await store.ensureSchema(c); return (await review.list(c)).filter((a) => a.review.state === 'approved'); });
}

(async () => {
  await loadFiles();
  const claude = findClaude();
  if (!claude) {
    say('No encontré Claude Code en esta computadora. Instalalo e iniciá sesión una vez (escribí "claude" en una terminal); después volvé a tocar "Para el agente".');
    process.exit(1);
  }
  const tried = new Set();
  for (;;) {
    const next = ext.load().filter((j) => j.status === 'para el agente' && !tried.has(j.id))
      .sort((a, b) => String(a.updated_at || a.found_at).localeCompare(String(b.updated_at || b.found_at)))[0];
    if (!next) break;
    tried.add(next.id);
    say(`\nAgente: #${next.id} ${next.role} en ${next.company}`);
    const r = await runOne(claude, next);
    if (r.final) say('  Resultado: ' + short(r.final, 500));
    const after = ext.load().find((j) => j.id === next.id);
    if (after && after.status === 'para el agente') {
      ext.mark(next.id, 'pendiente', 'el agente no terminó; podés volver a enviarlo');
      say('  El agente no terminó con este aviso; volvió a "Para elegir".');
    } else if (after) say(`  Estado: ${after.status}${after.note ? ` (${after.note})` : ''}`);
  }
  // Applications the user approved in the panel: the agent re-opens the form and submits it.
  const done = new Set();
  for (;;) {
    let next;
    try { next = (await approvedQueue()).find((a) => !done.has(a.id)); } catch (e) { say(`No pude leer la cola: ${e.message}`); break; }
    if (!next) break;
    done.add(next.id);
    say(`\nAgente: enviar la postulación aprobada #${next.id} ${next.role} en ${next.company}`);
    const r = await runOne(claude, next, approvedPrompt(next));
    if (r.final) say('  Resultado: ' + short(r.final, 500));
    const still = (await approvedQueue().catch(() => [])).some((a) => a.id === next.id);
    say(still ? '  No se envió: sigue aprobada en "Esperan tu aprobación"; podés reintentar.' : '  Enviada.');
  }
  const total = tried.size + done.size;
  say(total ? `\nListo: el agente trabajó ${total} postulación(es).` : 'No hay avisos marcados para el agente ni postulaciones aprobadas.');
})();
