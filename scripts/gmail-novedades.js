#!/usr/bin/env node
/**
 * gmail-novedades.js: looks at the latest emails in the user's Gmail, in the program's own
 * Chrome window, and leaves stage suggestions for "Seguimiento" (lib/novedades.js).
 *
 * Only the list is read (sender, subject, preview and date); no email is opened, marked as
 * read, labeled, archived, deleted or answered (AGENTS.md rule 11). Nothing leaves this
 * computer, and no stage changes until the user presses "Aplicar".
 *
 * Usage: node scripts/gmail-novedades.js [--days 30]
 * Exit codes: 0 done, 2 Chrome or Gmail could not be opened, 3 Gmail needs a sign-in.
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('../lib/browser-helpers');
const nov = require('../lib/novedades');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const days = Math.min(Math.max(Number.parseInt(arg('--days', '30'), 10) || 30, 1), 90);
const QUERY = `newer_than:${days}d -category:promotions -category:social -in:sent -in:chats`;
const URL = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(QUERY)}`;

function where() {
  const r = h.evalJSON('JSON.stringify(location.href)');
  return typeof r === 'string' ? r : '';
}

// 1. Open Gmail in the program's window (the same one used for LinkedIn).
if (!h.ensure()) h.openBrowser(URL, { headed: true });
else h.goto(URL);
h.sleep(5000);
const url = where();
if (!url) { console.log('No pude abrir Chrome. Verificá que Google Chrome esté instalado y volvé a intentar.'); process.exit(2); }
if (!/^https:\/\/mail\.google\.com\//i.test(url)) {
  console.log('Gmail pide iniciar sesión en la ventana de Chrome del programa.');
  console.log('Iniciá sesión ahí con tu cuenta (y el código de verificación si te lo pide). El programa no ve ni guarda tu contraseña.');
  console.log('Cuando veas tu bandeja, volvé a Seguimiento y tocá otra vez "Buscar novedades en Gmail".');
  process.exit(3);
}

// 2. Read the visible list of results (up to one page, about 50 conversations).
h.waitFor('document.querySelectorAll("tr.zA").length > 0 || /No (hay|se encontraron)|No messages matched|did not match/i.test(document.body.innerText)', { timeout: 20000 });
h.sleep(1500);
const rows = h.evalJSON(`(function(){
  var out = [];
  document.querySelectorAll('tr.zA').forEach(function (r) {
    var s = r.querySelector('span[email]');
    var subj = r.querySelector('.bog, .y6 span');
    var prev = r.querySelector('.y2');
    var date = r.querySelector('td.xW span[title], td.xW span');
    var th = r.querySelector('[data-legacy-thread-id]');
    out.push({
      from: s ? ((s.getAttribute('name') || s.textContent || '') + ' <' + s.getAttribute('email') + '>').trim() : '',
      subject: subj ? subj.textContent.trim() : '',
      snippet: prev ? prev.textContent.replace(/^\\s*-\\s*/, '').trim() : '',
      date: date ? (date.getAttribute('title') || date.textContent || '').trim() : '',
      link: th ? 'https://mail.google.com/mail/u/0/#all/' + th.getAttribute('data-legacy-thread-id') : ''
    });
  });
  return JSON.stringify(out.slice(0, 100));
})()`);
const mails = Array.isArray(rows) ? rows : [];
if (!mails.length) {
  console.log(`No encontré correos de los últimos ${days} días (sin contar promociones ni redes sociales).`);
  process.exit(0);
}

// 3. The user's active applications.
const sql = "SELECT id, company, role, status, applied_at FROM applications WHERE status IN ('applied','in_review','contacted','screening','interview','offer')";
const r = spawnSync(process.execPath, [path.join(__dirname, 'db.js'), sql], { encoding: 'utf8', timeout: 90000 });
let apps;
try { apps = JSON.parse(r.stdout); } catch { apps = null; }
if (!Array.isArray(apps)) { console.log('No pude leer tus postulaciones de la base de datos. Probá de nuevo en unos minutos.'); process.exit(1); }

// 4. Suggestions: a known kind of news about one of those applications, moving it forward.
const found = [];
let related = 0;
for (const m of mails) {
  const kind = nov.classify(m);
  if (!kind) continue;
  const app = nov.matchApp(m, apps);
  if (!app) continue;
  related++;
  const s = nov.suggest(app, kind);
  if (!s) continue;
  found.push({
    mail: { from: m.from.slice(0, 200), subject: m.subject.slice(0, 300), snippet: m.snippet.slice(0, 400), date: m.date.slice(0, 80), link: /^https:\/\/mail\.google\.com\//.test(m.link) ? m.link : '' },
    kind, app_id: app.id, company: app.company, role: app.role, from_stage: app.status, to_stage: s.to, why: s.why,
  });
}
const added = nov.addAll(found);
console.log(`Revisé ${mails.length} correos de los últimos ${days} días. ${related} hablan de postulaciones que tenés activas.`);
if (added.length) {
  console.log(`Encontré ${added.length} novedad(es) nueva(s):`);
  added.forEach((f) => console.log(`  - ${f.company}: ${f.why} ("${f.mail.subject.slice(0, 90)}")`));
  console.log('Revisalas en Seguimiento: cada una se aplica solo si tocás "Aplicar".');
} else console.log('No hay novedades nuevas para cambiar de etapa.');
