'use strict';
/**
 * novedades.js: news about applications found in the user's Gmail (subject and preview only),
 * turned into stage suggestions that the user applies or ignores in "Seguimiento".
 * Nothing changes on its own and no email is opened, labeled, archived or answered.
 *
 *   classify({ from, subject, snippet }) -> 'rechazo' | 'entrevista' | 'vista' | 'recibida' | null
 *   matchApp(mail, apps)                -> the application the mail talks about, or null
 *   suggest(mail, app, kind)            -> { to, why } or null (only moves forward, or to rejected)
 * Suggestions are kept in datos/sugerencias-gmail.json.
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');
const { normCompany, strip } = require('./match');

const FILE = path.join(DATA_DIR, 'sugerencias-gmail.json');

const PATTERNS = {
  rechazo: [
    /lamentablemente/, /no (continuaremos|avanzaremos|seguiremos|vamos a (continuar|avanzar|seguir))/, /decidimos (avanzar|continuar|seguir) con otr/,
    /otros? (candidat|perfil)/, /no (fuiste|has sido|resultaste) seleccionad/, /en esta oportunidad no/, /no podremos avanzar/,
    /unfortunately/, /not (be )?moving forward/, /decided (to )?(move|proceed|go) forward with other/, /will not be (moving|proceeding)/,
    /other candidates/, /not (been )?selected/, /regret to inform/, /position has been filled/, /pursue other candidates/,
  ],
  entrevista: [
    /entrevista/, /agendar|coordinar (una|un) (llamad|reuni|charla|encuentro)/, /tu disponibilidad|nos pasas tu disponibilidad|horarios disponibles/,
    /proximos pasos/, /te invitamos a (una|un|participar)/, /videollamada|meet google|zoom us|teams microsoft/, /calendly/,
    /interview/, /schedule (a|an) (call|chat|meeting)/, /your availability/, /next steps/, /we would like to (invite|meet|talk|speak)/, /phone screen/,
  ],
  vista: [/(tu )?solicitud (fue|ha sido) vista/, /vio tu solicitud|vieron tu solicitud/, /application was viewed/, /viewed your application/],
  recibida: [
    /recibimos tu (postulacion|solicitud|cv|candidatura)/, /gracias por (postularte|tu postulacion|tu interes|aplicar)/, /tu solicitud (se envio|fue enviada|ha sido enviada)/,
    /thank you for (applying|your application|your interest)/, /we (have )?received your application/, /application (was )?(received|sent|submitted)/,
  ],
};
const ORDER = ['rechazo', 'entrevista', 'vista', 'recibida'];

/** Kind of news in a mail, from its sender, subject and preview. */
function classify(mail) {
  const t = strip([mail.subject, mail.snippet].filter(Boolean).join(' '));
  if (!t) return null;
  for (const k of ORDER) if (PATTERNS[k].some((re) => re.test(t))) return k;
  return null;
}

const ACTIVE = ['applied', 'in_review', 'contacted', 'screening', 'interview', 'offer'];
const RANK = { discovered: 0, contacted: 1, applied: 1, in_review: 2, screening: 3, interview: 4, offer: 5, hired: 6 };

/** The active application whose company is named in the mail (sender, subject or preview). */
function matchApp(mail, apps) {
  const text = ` ${strip([mail.from, mail.subject, mail.snippet].filter(Boolean).join(' '))} `;
  const hits = [];
  for (const a of apps) {
    if (!ACTIVE.includes(a.status)) continue;
    const c = normCompany(a.company);
    if (!c || c.length < 3 || /^(linkedin|unknown|sin empresa|confidencial|confidential)$/.test(c)) continue;
    if (text.includes(` ${c} `) || (c.length >= 5 && text.replace(/ /g, '').includes(c.replace(/ /g, '')))) {
      const roleWords = strip(a.role).split(' ').filter((w) => w.length > 3);
      const score = roleWords.filter((w) => text.includes(` ${w} `)).length;
      hits.push({ a, score });
    }
  }
  if (!hits.length) return null;
  hits.sort((x, y) => y.score - x.score || new Date(y.a.applied_at || 0) - new Date(x.a.applied_at || 0));
  // Two applications at the same company and nothing in the mail tells them apart: no guess.
  if (hits.length > 1 && hits[0].score === hits[1].score && hits[0].a.company === hits[1].a.company && hits[0].score === 0) return null;
  return hits[0].a;
}

const WHY = {
  rechazo: 'parece un rechazo',
  entrevista: 'parece una invitación a entrevista o una propuesta para coordinar una llamada',
  vista: 'la empresa vio tu postulación',
};

/** The stage to suggest: only forward, or to rejected; none for an acknowledgment. */
function suggest(app, kind) {
  if (!app || !kind || kind === 'recibida') return null;
  const cur = RANK[app.status] ?? 0;
  let to = null;
  if (kind === 'rechazo') to = 'rejected';
  else if (kind === 'entrevista') to = cur >= RANK.screening ? 'interview' : 'screening';
  else if (kind === 'vista') to = 'in_review';
  if (!to || to === app.status) return null;
  if (to !== 'rejected' && (RANK[to] ?? 0) <= cur) return null;
  return { to, why: WHY[kind] };
}

// --- stored suggestions ---
function load() {
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(d) ? d : []; } catch { return []; }
}
function save(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list.slice(-300), null, 2));
  fs.renameSync(tmp, FILE);
}
const mailKey = (m) => m.link || `${strip(m.from)}|${strip(m.subject)}|${strip(m.date)}`;

/** Adds the new ones (a mail is never suggested twice); returns the ones added. */
function addAll(items) {
  const list = load();
  const seen = new Set(list.map((s) => s.key));
  let id = list.reduce((m, s) => Math.max(m, s.id || 0), 0);
  const added = [];
  for (const it of items) {
    const key = mailKey(it.mail);
    if (seen.has(key)) continue;
    seen.add(key);
    const s = { id: ++id, key, state: 'nueva', created_at: new Date().toISOString(), ...it };
    list.push(s);
    added.push(s);
  }
  if (added.length) save(list);
  return added;
}
function pending() { return load().filter((s) => s.state === 'nueva'); }
function resolve(id, state) {
  if (!['aplicada', 'ignorada'].includes(state)) throw new Error('Estado inválido');
  const list = load();
  const s = list.find((x) => x.id === Number(id));
  if (!s) return null;
  s.state = state; s.resolved_at = new Date().toISOString();
  save(list);
  return s;
}

module.exports = { FILE, classify, matchApp, suggest, load, addAll, pending, resolve, PATTERNS };
