#!/usr/bin/env node
/**
 * dashboard.js: the local panel. Runs only on this computer.
 *
 *   /           panel with buttons (sign in, simulate, apply, sync, export)
 *   /config     configuration and imports
 *   /tablero    tracking board (pipeline by stage)
 *
 * Usage:
 *   node scripts/dashboard.js                Start on port 7531
 *   node scripts/dashboard.js --port 8080    Use another port
 *   node scripts/dashboard.js --open         Open it in the default browser
 *
 * Every /api/ request needs the random token of this run, which only the
 * pages served by this process know.
 */
'use strict';

const USER_ID = Number.parseInt(process.env.USER_ID || '1', 10) || 1;

const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const ACTIVE_STAGES = [
  'discovered', 'contacted', 'applied', 'in_review',
  'screening', 'interview', 'offer', 'hired',
];

async function getDb() {
  return require('../lib/db').open();
}

// Stages that can be set by hand from the tracking page ("skipped" is only for jobs the filters discarded).
const MOVABLE_STAGES = [...ACTIVE_STAGES, 'rejected', 'withdrawn'];

// Where an application came from, for the filter of the tracking page.
function originOf(r) {
  const notes = String(r.notes || '');
  if (/^Postulación propia/i.test(notes)) return 'propia';
  if (r.platform === 'history' || r.source === 'history_import' || r.source === 'tracking_file') return 'planilla';
  if (r.platform === 'linkedin') return 'linkedin';
  return 'sitio';
}

async function fetchPipelineData() {
  const client = await getDb();
  try {
    const { rows: apps } = await client.query(`
      SELECT id, platform, company, role, url, status, applied_at,
             data->>'source' AS source, data->>'notes' AS notes, data->>'location' AS location,
             data->'stage_history' AS stage_history, data->'followups' AS followups, data->>'followup_at' AS followup_at,
             (data->>'followup_off')::boolean AS followup_off, data->'fit' AS fit, (data->>'description') IS NOT NULL AS has_desc
      FROM applications
      WHERE user_id = ${USER_ID} AND status <> 'skipped'
      ORDER BY applied_at DESC NULLS LAST, id DESC
    `);
    const { rows: skipped } = await client.query(
      `SELECT count(*)::int AS n FROM applications WHERE user_id = ${USER_ID} AND status = 'skipped'`);

    const { rows: messages } = await client.query(`
      SELECT id, channel, direction, sender, subject, status, received_at
      FROM messages
      WHERE user_id = ${USER_ID}
      ORDER BY COALESCE(received_at, sent_at) DESC
      LIMIT 10
    `).catch(() => ({ rows: [] }));

    const { rows: userRows } = await client.query(`SELECT name, data->'form_answers'->>'first_name' AS first FROM users WHERE id = ${USER_ID}`).catch(() => ({ rows: [{ name: '' }] }));
    const fu = require('../lib/followup');
    const first = userRows[0]?.first || '';

    return {
      apps: apps.map((r) => {
        const base = { status: r.status, applied_at: r.applied_at, stage_history: r.stage_history, followups: r.followups, followup_at: r.followup_at, followup_off: r.followup_off, role: r.role, company: r.company };
        const st = fu.status(base);
        const f = r.fit && typeof r.fit === 'object' ? r.fit : null;
        return {
          id: r.id, company: r.company || '', role: r.role || '', url: webUrl(r.url),
          status: r.status, applied_at: r.applied_at, location: r.location || '', origin: originOf(r),
          last_move: fu.lastMove(base),
          history: (Array.isArray(r.stage_history) ? r.stage_history : []).slice(-8).map((h) => ({ stage: h.stage, from: h.from, at: h.moved_at })),
          followup: st ? { ...st, draft: st.due ? fu.draft(base, { firstName: first }) : null } : null,
          fit: f ? { score: f.score, parts: f.parts || [], have: f.have || [], reworded: f.reworded || [], missing: f.missing || [] } : null,
          has_desc: !!r.has_desc,
        };
      }),
      skipped: skipped[0] ? skipped[0].n : 0,
      novedades: (() => { try { return require('../lib/novedades').pending().map((n) => ({ id: n.id, app_id: n.app_id, company: n.company, role: n.role, to: n.to_stage, why: n.why, mail: n.mail })); } catch { return []; } })(),
      messages,
      userName: userRows[0]?.name || '',
      stages: MOVABLE_STAGES,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    await client.end();
  }
}

// Shared client code for the fit box (Avisos para revisar and Seguimiento), inlined in the page (strict CSP).
let _fitUi = null;
function fitUi() {
  if (_fitUi === null) { try { _fitUi = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'templates', 'fit-ui.js'), 'utf8'); } catch { _fitUi = ''; } }
  return _fitUi;
}

// Follow-up reminders (lib/followup.js): the user made one, postponed it or turned it off.
async function setFollowup(id, action, days) {
  const client = await getDb();
  try {
    const cur = await client.query(`SELECT data FROM applications WHERE id = $1 AND user_id = ${USER_ID}`, [id]);
    if (!cur.rows.length) return { ok: false, error: 'No encontré esa postulación' };
    const data = cur.rows[0].data || {};
    const now = new Date();
    if (action === 'hecho') {
      data.followups = [...(Array.isArray(data.followups) ? data.followups : []), now.toISOString()].slice(-10);
      delete data.followup_at;
    } else if (action === 'posponer') {
      const n = Number.isInteger(days) && days >= 1 && days <= 60 ? days : 7;
      data.followup_at = new Date(now.getTime() + n * 86400000).toISOString();
    } else if (action === 'apagar') data.followup_off = true;
    else if (action === 'prender') { delete data.followup_off; delete data.followup_at; }
    await client.query(`UPDATE applications SET data = $1::jsonb WHERE id = $2 AND user_id = ${USER_ID}`, [JSON.stringify(data), id]);
    return { ok: true };
  } finally {
    await client.end();
  }
}

// Move one application to another stage, keeping the history of moves.
async function moveStage(id, stage, by = 'tablero') {
  const client = await getDb();
  try {
    const cur = await client.query(`SELECT status, data FROM applications WHERE id = $1 AND user_id = ${USER_ID}`, [id]);
    if (!cur.rows.length) return { ok: false, error: 'No encontré esa postulación' };
    const from = cur.rows[0].status;
    if (from === stage) return { ok: true, from, stage };
    const data = cur.rows[0].data || {};
    const history = Array.isArray(data.stage_history) ? data.stage_history : [];
    history.push({ stage, from, moved_at: new Date().toISOString(), by });
    await client.query(`UPDATE applications SET status = $1, data = $2::jsonb WHERE id = $3 AND user_id = ${USER_ID}`,
      [stage, JSON.stringify({ ...data, stage_history: history.slice(-50) }), id]);
    return { ok: true, from, stage };
  } finally {
    await client.end();
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  let port = 7531;
  let open = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[i + 1], 10); i++; }
    if (args[i] === '--open') open = true;
    if (args[i] === '-h' || args[i] === '--help') {
      console.log('Uso: node scripts/dashboard.js [--port <n>] [--open]');
      process.exit(0);
    }
  }
  return { port, open };
}

function openInBrowser(url) {
  const { spawn } = require('child_process');
  const [cmd, ...cmdArgs] = process.platform === 'darwin' ? ['open', url]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
    : ['xdg-open', url];
  try { spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true, windowsHide: true }).unref(); } catch { /* open it by hand */ }
}

const PAGES = { '/': 'panel.html', '/index.html': 'panel.html', '/config': 'config.html', '/tablero': 'dashboard.html', '/avisos': 'externos.html', '/asistente': 'asistente.html' };
const { csvCell } = require('../lib/tracking');
// Only web links are passed to the pages (a stored javascript: link could run code when clicked).
const webUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');

function main() {
  const { port, open } = parseArgs();
  const crypto = require('crypto');

  // Random per-run token: the API only answers requests that carry it, and only
  // the pages served by this process know it. Another website open in the
  // browser cannot read it, so it cannot read or change anything here.
  const TOKEN = crypto.randomBytes(24).toString('hex');
  const cfg = require('../lib/config');
  const store = require('../lib/store');
  const dbm = require('../lib/db');
  const jobs = require('../lib/jobs');
  const extract = require('../lib/extract');
  const tracking = require('../lib/tracking');
  const { findChrome } = require('../lib/chrome');

  const sendJson = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  const HttpError = class extends Error { constructor(code, message) { super(message); this.code = code; } };

  function authorized(req) {
    const token = String(req.headers['x-config-token'] || '');
    const okToken = token.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(TOKEN));
    const origin = req.headers.origin;
    const okOrigin = !origin || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin);
    return okToken && okOrigin;
  }

  async function readBody(req, limit = 1024 * 1024) {
    if (!/^application\/json/i.test(String(req.headers['content-type'] || ''))) throw new HttpError(415, 'Se esperaba JSON');
    const chunks = []; let size = 0;
    for await (const ch of req) { size += ch.length; if (size > limit) throw new HttpError(413, 'El archivo es demasiado grande'); chunks.push(ch); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) || {}; } catch { throw new HttpError(400, 'JSON inválido'); }
  }

  const upload = (body) => {
    const name = String(body.name || '').slice(0, 200);
    const buf = typeof body.base64 === 'string' ? Buffer.from(body.base64, 'base64') : Buffer.from(String(body.text || ''), 'utf8');
    return { name, buf };
  };

  const api = {
    'GET /api/data': async () => fetchPipelineData(),

    'POST /api/etapa': async (req) => {
      const body = await readBody(req, 4096);
      const id = Number.parseInt(body.id, 10);
      const stage = String(body.stage || '');
      if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Postulación inválida');
      if (!MOVABLE_STAGES.includes(stage)) throw new HttpError(400, 'Etapa inválida');
      const r = await moveStage(id, stage);
      if (!r.ok) throw new HttpError(404, r.error);
      return r;
    },

    // Gmail suggestions (lib/novedades.js): the user applies or ignores each one.
    'POST /api/novedades': async (req) => {
      const body = await readBody(req);
      const nov = require('../lib/novedades');
      const s = nov.pending().find((x) => x.id === Number(body.id));
      if (!s) throw new HttpError(404, 'Esa novedad ya no está pendiente');
      if (body.action === 'ignorar') { nov.resolve(s.id, 'ignorada'); return { ok: true }; }
      if (body.action !== 'aplicar') throw new HttpError(400, 'Acción desconocida');
      if (!MOVABLE_STAGES.includes(s.to_stage)) throw new HttpError(400, 'Etapa inválida');
      const r = await moveStage(Number(s.app_id), s.to_stage, 'gmail');
      if (!r.ok) throw new HttpError(404, r.error);
      nov.resolve(s.id, 'aplicada');
      return { ok: true, from: r.from, stage: s.to_stage };
    },
    'POST /api/seguimiento': async (req) => {
      const body = await readBody(req);
      const id = Number(body.id);
      if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Falta la postulación');
      if (!['hecho', 'posponer', 'apagar', 'prender'].includes(body.action)) throw new HttpError(400, 'Acción desconocida');
      const r = await setFollowup(id, body.action, Number(body.days));
      if (!r.ok) throw new HttpError(404, r.error);
      return r;
    },
    // Instructions for the user's own AI: a CV adapted to one job, without inventing anything (lib/fit.js).
    'POST /api/cv-aviso': async (req) => {
      const body = await readBody(req);
      const id = Number(body.id);
      if (!Number.isInteger(id) || id < 1 || !['externo', 'postulacion'].includes(body.kind)) throw new HttpError(400, 'Pedido inválido');
      const confirmed = (Array.isArray(body.confirmed) ? body.confirmed : []).map((t) => String(t).slice(0, 80)).slice(0, 30);
      const fitLib = require('../lib/fit');
      return store.withDb(async (c) => {
        await store.ensureSchema(c);
        const d = (await store.getUserData(c)) || {};
        const cvText = typeof d.cv_text === 'string' ? d.cv_text : '';
        if (!cvText.trim()) throw new HttpError(400, 'Primero cargá el texto de tu CV en Configuración (sección CV).');
        let job;
        if (body.kind === 'externo') {
          const e = require('../lib/external').load().find((j) => j.id === id);
          if (!e) throw new HttpError(404, 'No encontré ese aviso');
          job = { role: e.role, company: e.company, location: e.location, description: (e.fit && e.fit.description) || '' };
        } else {
          const r = await c.query(`SELECT role, company, data->>'location' AS location, data->>'description' AS description FROM applications WHERE id = $1 AND user_id = $2`, [id, store.USER_ID]);
          if (!r.rows.length) throw new HttpError(404, 'No encontré esa postulación');
          job = r.rows[0];
        }
        const fit = job.description ? fitLib.score(job, { prefs: d.job_preferences || {}, profile: d.profile || {}, formAnswers: d.form_answers || {}, cvText }) : null;
        return { prompt: fitLib.cvPrompt({ job, cvText, fit, confirmed }), score: fit ? fit.score : null };
      });
    },

    'GET /api/config': async () => {
      const data = await store.withDb(async (c) => { await store.ensureSchema(c); return (await store.getUserData(c)) || {}; });
      const fields = Object.fromEntries(Object.entries(cfg.FIELDS).map(([k, f]) => [k, { type: f.type, label: f.label, values: f.values, maxLen: f.maxLen }]));
      const pending = (data.pending_questions || []).map((q) => ({ id: q.id, question: q.question, type: q.type || 'text', options: q.options || [], blocked_jobs: (q.jobs || []).length }));
      return { fields, settings: cfg.extract(data), pending };
    },

    'POST /api/config': async (req) => {
      const body = await readBody(req);
      const { clean, errors } = cfg.sanitize(body.settings);
      const result = await store.withDb(async (c) => {
        await store.ensureSchema(c);
        await store.saveSettings(c, clean);
        if (Array.isArray(body.pending_discard) && body.pending_discard.length) await store.discardPending(c, body.pending_discard);
        return body.pending && typeof body.pending === 'object' ? store.answerPending(c, body.pending) : { saved: 0, errors: [] };
      });
      return { ok: true, errors, pending_saved: result.saved, pending_errors: result.errors };
    },

    'GET /api/status': async () => {
      const info = await store.withDb(async (c) => {
        await store.ensureSchema(c);
        const data = await store.getUserData(c);
        const counts = await c.query(
          `SELECT count(*) FILTER (WHERE status NOT IN ('discovered','skipped'))::int AS total,
                  count(*) FILTER (WHERE data->'review'->>'state' = 'pending')::int AS queue
           FROM applications WHERE user_id = $1`, [store.USER_ID]);
        // Today's LinkedIn count for the daily cap, read here instead of in a second process.
        let today = null;
        try {
          const hz = require('../lib/humanize');
          const st = hz.settingsFrom(data && data.automation);
          const r = await c.query(hz.todaySql(st.timezone));
          if (r.rows[0]) today = { n: Number(r.rows[0].n) || 0, first: r.rows[0].first || null };
        } catch { /* shown as unknown */ }
        return { data, counts: counts.rows[0] || { total: 0, queue: 0 }, today };
      });
      const d = info.data || {};
      const settings = cfg.extract(d);
      const file = d.tracking && d.tracking.file;
      let gate = null;
      try {
        if (info.today) gate = require('../lib/humanize').gate({ settings: d.automation, done: info.today.n, first: info.today.first });
      } catch { /* shown as unknown */ }
      let pause = null;
      try { const p = require('../lib/safety').active(); if (p) pause = { reason: p.reason, text: p.text, until: p.until, since: p.since }; } catch { /* none */ }
      const finite = (n) => (Number.isFinite(n) ? n : null);
      return {
        database: dbm.describe(),
        has_user: info.data !== null,
        name: [settings.first_name, settings.last_name].filter(Boolean).join(' '),
        has_targets: Array.isArray(settings.target_titles) && settings.target_titles.length > 0,
        chrome: !!findChrome(),
        claude: (() => { try { return !!require('../lib/claude-cli').findClaude(); } catch { return false; } })(),
        tracking: { file: file || null, exists: !!(file && fs.existsSync(file)), log_file: store.logFileFrom(d) },
        pending_questions: (d.pending_questions || []).length,
        review_queue: info.counts.queue,
        novedades: (() => { try { return require('../lib/novedades').pending().length; } catch { return 0; } })(),
        externos: (() => { try { const l = require('../lib/external').load(); return { elegir: l.filter((j) => ['pendiente', 'sin revisar'].includes(j.status)).length, agente: l.filter((j) => j.status === 'para el agente').length }; } catch { return null; } })(),
        applications: info.counts.total,
        today: gate ? { allowed: gate.allowed, message: gate.message, cap: finite(gate.cap), done: gate.done, remaining: finite(gate.remaining) } : null,
        pause,
        job: jobs.status(1e9),
      };
    },

    'POST /api/run': async (req) => {
      const body = await readBody(req);
      const action = String(body.action || '');
      if (action === 'apply' && body.confirm !== true) throw new HttpError(400, 'Falta confirmar la postulación real');
      const r = jobs.start(action, { max: body.max });
      if (r.error) throw new HttpError(409, r.error);
      return r;
    },
    'GET /api/job': async (req, url) => jobs.status(url.searchParams.get('since')),

    // The user's own AI chat: instructions to copy, and its JSON answer read back (not saved here).
    'POST /api/ia/perfil': async (req) => {
      const body = await readBody(req);
      const data = await store.withDb(async (c) => { await store.ensureSchema(c); return (await store.getUserData(c)) || {}; });
      const cv = (typeof body.cv === 'string' && body.cv.trim()) || data.cv_text || '';
      return { prompt: require('../lib/ai-prompt').profilePrompt(cv) };
    },
    'POST /api/ia/preguntas': async () => {
      const data = await store.withDb(async (c) => { await store.ensureSchema(c); return (await store.getUserData(c)) || {}; });
      const pend = (data.pending_questions || []).filter((q) => q.type !== 'file');
      if (!pend.length) throw new HttpError(400, 'No hay preguntas pendientes para responder con tu IA.');
      return { prompt: require('../lib/ai-prompt').questionsPrompt(pend, data.cv_text, data.context_notes) };
    },
    'POST /api/ia/leer': async (req) => {
      const body = await readBody(req);
      const AI = require('../lib/ai-prompt');
      let obj;
      try { obj = AI.jsonFromReply(body.text); } catch (e) { throw new HttpError(400, e.message); }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new HttpError(400, 'La respuesta no tiene el formato esperado.');
      if (body.kind === 'preguntas') {
        const answers = {};
        for (const [k, v] of Object.entries(obj)) if (/^\d+$/.test(k) && v != null && String(v).trim()) answers[k] = String(v).trim().slice(0, 2000);
        return { answers };
      }
      const known = Object.fromEntries(Object.entries(obj).filter(([k]) => AI.PROFILE_KEYS[k]));
      const { clean, errors } = cfg.sanitize(known);
      Object.keys(clean).forEach((k) => { if (clean[k] === null) delete clean[k]; });
      return { settings: clean, errors };
    },

    'GET /api/presets': async () => {
      const P = require('../lib/presets');
      return { presets: P.PRESETS, fields: P.PRESET_FIELDS };
    },
    // Guided setup: which areas a pasted CV points to, and searches built from chosen titles.
    'POST /api/asistente': async (req) => {
      const P = require('../lib/presets');
      const body = await readBody(req);
      if (typeof body.text === 'string') return { areas: P.detectAreas(body.text.slice(0, 60000)) };
      if (Array.isArray(body.titles)) return { queries: P.queriesFromTitles(body.titles.slice(0, 60)) };
      throw new HttpError(400, 'Pedido inválido');
    },

    'GET /api/externos': async () => {
      const ext = require('../lib/external');
      // Queued ones the user already decided: submitted counts as applied, rejected as discarded.
      try {
        const done = await store.withDb(async (c) => { await store.ensureSchema(c); return require('../lib/review').outcomes(c); });
        const low = (s) => String(s || '').trim().toLowerCase();
        for (const e of ext.load().filter((j) => j.status === 'en cola')) {
          const hit = done.find((d) => (d.notes && new RegExp(`externo #${e.id}\\b`).test(d.notes)) || (low(d.company) === low(e.company) && low(d.role) === low(e.role)));
          if (hit) ext.mark(e.id, hit.state === 'submitted' ? 'postulado' : 'descartado', hit.state === 'submitted' ? 'enviada por el agente' : 'la rechazaste en la cola');
        }
      } catch { /* the list still shows */ }
      return {
        items: ext.load().map((j) => {
          const f = j.fit && typeof j.fit === 'object' ? j.fit : null;
          return { ...j, url: webUrl(j.url), fit: f ? { score: f.score, parts: f.parts || [], have: f.have || [], reworded: f.reworded || [], missing: f.missing || [] } : null, has_desc: !!(f && f.description) };
        }),
      };
    },
    'GET /api/cola': async () => {
      const review = require('../lib/review');
      return store.withDb(async (c) => {
        await store.ensureSchema(c);
        const data = (await store.getUserData(c)) || {};
        const pend = data.pending_questions || [];
        const back = await review.cleanup(c, pend);
        const A = require('../lib/answers');
        const open = new Set(pend.map((q) => A.norm(q.question)));
        const items = (await review.list(c)).map((a) => ({
          id: a.id, company: a.company, role: a.role, url: webUrl(a.url), ats: a.ats, state: a.review.state,
          linkedin: review.isLinkedIn(a.url),
          missing: review.asked(a.review).filter((q) => open.has(A.norm(q))),
          questions: pend.filter((q) => review.asked(a.review).some((x) => A.norm(x) === A.norm(q.question)))
            .map((q) => ({ id: q.id, question: q.question, options: q.options || [] })),
          reasons: (a.review.reasons || []).map((r) => {
            if (r !== 'missing_answers') return review.REASONS[r] || r;
            const still = review.asked(a.review).filter((q) => open.has(A.norm(q)));
            return still.length ? `faltan respuestas tuyas (${still.join('; ')}): respondelas acá abajo`
              : 'faltaban respuestas tuyas, pero ya no hay preguntas pendientes: podés aprobarla';
          }),
          answers: a.review.answers || null, notes: a.review.notes || '', user_note: a.review.user_note || '',
          prepared_at: a.review.prepared_at || null,
        }));
        return { items, pending_questions: pend.length, released: back };
      });
    },
    // Answers typed next to a queued application: saved to the question bank, like in Configuración.
    'POST /api/preguntas': async (req) => {
      const body = await readBody(req);
      const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
      const r = await store.withDb(async (c) => { await store.ensureSchema(c); return store.answerPending(c, answers); });
      if (r.errors && r.errors.length) throw new HttpError(400, r.errors.join(' '));
      return { ok: true, saved: r.saved };
    },
    'POST /api/cola': async (req) => {
      const review = require('../lib/review');
      const body = await readBody(req);
      const id = Number.parseInt(body.id, 10);
      const action = String(body.action || '');
      if (!Number.isInteger(id) || !['aprobar', 'rechazar', 'reintentar', 'sitio'].includes(action)) throw new HttpError(400, 'Pedido inválido');
      if (action === 'sitio') {
        // Opens the queued form in the program's Chrome window so the user signs in to that site.
        const item = await store.withDb(async (c) => (await review.list(c)).find((a) => a.id === id));
        if (!item) throw new HttpError(404, 'Esa postulación ya no está en la cola.');
        const r = jobs.start('site', { url: item.url });
        if (r.error) throw new HttpError(409, r.error);
        return { ok: true, site: true };
      }
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      try {
        const r = await store.withDb(async (c) => {
          await store.ensureSchema(c);
          const cur = (await review.list(c)).find((a) => a.id === id);
          // LinkedIn Easy Apply: no agent needed; the next run (manual or automatic) applies to it.
          if (cur && review.isLinkedIn(cur.url) && action !== 'rechazar') return { ...(await review.release(c, id)), linkedin: true };
          if (action === 'aprobar') return review.approve(c, id, note);
          if (action === 'rechazar') return review.reject(c, id, note);
          return { id };
        });
        if (action === 'rechazar') {
          const m = String(r.notes || '').match(/externo #(\d+)/);
          if (m) { try { require('../lib/external').mark(m[1], 'descartado', 'la rechazaste en la cola'); } catch { /* not listed */ } }
          return { ok: true };
        }
        if (r.linkedin) return { ok: true, linkedin: true };
        return { ok: true, agent: jobs.startAgent() };
      } catch (e) { throw new HttpError(400, e.message); }
    },
    'POST /api/externos': async (req) => {
      const ext = require('../lib/external');
      const body = await readBody(req);
      const item = ext.load().find((j) => j.id === Number(body.id));
      if (!item) throw new HttpError(404, 'Ese aviso ya no está en la lista.');
      const to = { agente: 'para el agente', yo: 'postulado', descartar: 'descartado', volver: 'pendiente' }[String(body.action)];
      if (!to) throw new HttpError(400, 'Acción desconocida');
      if (to === 'postulado') {
        // Applied by hand: recorded like any other application, and in the CSV for the daily update of the spreadsheet.
        await store.withDb(async (c) => {
          await store.ensureSchema(c);
          await store.importHistory(c, [{ platform: 'linkedin', company: item.company, role: item.role, url: item.url, status: 'applied', date: null, notes: 'Postulación propia, marcada en Avisos para revisar' }]);
          const data = (await store.getUserData(c)) || {};
          let tz = (data.automation && data.automation.timezone) || 'America/Argentina/Buenos_Aires';
          try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { tz = 'America/Argentina/Buenos_Aires'; }
          try {
            require('../lib/tracking').appendLog(store.logFileFrom(data), { company: item.company, role: item.role, url: item.url,
              channel: 'Sitio o ATS de la empresa', origin: 'Postulación propia (marcada en Job Seeker)' }, new Date(), tz);
          } catch { /* the CSV is optional */ }
        });
      }
      const saved = ext.mark(item.id, to, to === 'postulado' ? 'te postulaste vos' : to === 'descartado' ? 'lo descartaste vos' : undefined);
      // Sending a job to the agent starts it (or queues it right after the task in progress).
      const agent = to === 'para el agente' ? jobs.startAgent() : null;
      return { ok: true, item: saved, agent };
    },

    'GET /api/auto': async () => {
      const schedule = require('../lib/schedule');
      const runlock = require('../lib/runlock');
      const dir = require('../lib/db').DATA_DIR;
      let last = null;
      try { last = JSON.parse(fs.readFileSync(path.join(dir, 'automatico-ultima.json'), 'utf8')); } catch { /* never ran */ }
      let log = '';
      try { log = fs.readFileSync(path.join(dir, 'automatico.log'), 'utf8').split(/\r?\n/).slice(-300).join('\n'); } catch { /* never ran */ }
      const h = runlock.holder();
      return { settings: schedule.load(), installed: schedule.installed(), windows: process.platform === 'win32', last, log, running: !!(h && h.owner === 'automática') };
    },
    'POST /api/auto': async (req) => {
      const schedule = require('../lib/schedule');
      const body = await readBody(req);
      try {
        return { ok: true, settings: body.enable ? schedule.enable(body) : schedule.disable() };
      } catch (e) { throw new HttpError(400, e.message); }
    },
    'POST /api/stop': async () => jobs.stop(),
    // Safety pause on LinkedIn (lib/safety.js): the user resumes by hand.
    'POST /api/pausa': async (req) => {
      const body = await readBody(req);
      if (body.action !== 'reanudar') throw new HttpError(400, 'Acción desconocida');
      return require('../lib/safety').clear();
    },

    'POST /api/sync': async () => {
      const res = await store.withDb(async (c) => { await store.ensureSchema(c); return store.syncTracking(c); });
      if (!res.configured) throw new HttpError(400, 'Todavía no indicaste dónde está tu planilla. Cargá la ruta en Configuración, sección Seguimiento.');
      return { ok: true, ...res };
    },

    'POST /api/extract': async (req) => extract.contactFromText((await readBody(req)).text),

    'POST /api/import': async (req) => {
      const body = await readBody(req, 25 * 1024 * 1024);
      const { name, buf } = upload(body);
      if (!buf.length) throw new HttpError(400, 'El archivo está vacío');
      const kind = String(body.kind || '');
      const text = () => buf.toString('utf8').replace(/^﻿/, '');
      const json = () => { try { return JSON.parse(text()); } catch { throw new HttpError(400, 'Ese archivo no es un JSON válido'); } };

      if (kind === 'cv') { const t = extract.textFromUpload(name, buf); return { ok: true, text: t.slice(0, 60000), ...extract.contactFromText(t) }; }
      if (kind === 'perfil') {
        const { clean, errors } = cfg.sanitize(json());
        await store.withDb(async (c) => { await store.ensureSchema(c); await store.saveSettings(c, clean); });
        return { ok: true, message: `Perfil importado: ${Object.keys(clean).length} campos.`, errors };
      }
      if (kind === 'contexto') {
        const { clean, errors } = cfg.sanitize({ context_notes: extract.textFromUpload(name, buf) });
        await store.withDb(async (c) => { await store.ensureSchema(c); await store.saveSettings(c, clean); });
        return { ok: true, message: `Contexto cargado: ${(clean.context_notes || '').length} caracteres.`, errors };
      }
      if (kind === 'historial') {
        return store.withDb(async (c) => {
          await store.ensureSchema(c);
          if ((await store.getUserData(c)) === null) throw new HttpError(400, 'Primero guardá tu nombre y tu email en "Tus datos".');
          if (/\.json$/i.test(name)) {
            const { rows, errors } = cfg.sanitizeHistory(json());
            const r = await store.importHistory(c, rows);
            return { ok: true, message: `Historial importado: ${r.inserted} nuevas, ${r.skipped} que ya estaban.`, errors };
          }
          const rows = /\.xlsx$/i.test(name) ? tracking.extractApplications(require('../lib/xlsx-read').readWorkbook(buf))
            : /\.(csv|txt)$/i.test(name) ? tracking.extractApplications([{ name, rows: require('../lib/xlsx-read').parseCsv(text()) }])
              : null;
          if (!rows) throw new HttpError(400, 'Usá un archivo .json, .csv o .xlsx');
          if (!rows.length) throw new HttpError(400, 'No encontré una tabla con columnas de empresa y puesto en ese archivo.');
          const r = await tracking.syncRows(c, rows, store.USER_ID, 'history_import');
          return { ok: true, message: `Historial importado: ${r.read} filas leídas, ${r.inserted} nuevas, ${r.updated} actualizadas, ${r.unchanged} sin cambios.`, errors: [] };
        });
      }
      throw new HttpError(400, 'Tipo de importación desconocido');
    },

    'GET /api/export': async (req, url) => {
      const what = url.searchParams.get('what');
      return store.withDb(async (c) => {
        await store.ensureSchema(c);
        if (what === 'perfil') return { filename: 'perfil.json', content: JSON.stringify(cfg.extract((await store.getUserData(c)) || {}), null, 2) + '\n' };
        if (what === 'historial') {
          const r = await c.query(`SELECT to_char(applied_at, 'YYYY-MM-DD') AS date, company, role, platform, status, url FROM applications WHERE user_id = $1 ORDER BY applied_at DESC, id DESC`, [store.USER_ID]);
          const lines = [['Fecha', 'Empresa', 'Puesto', 'Canal', 'Estado', 'Link'], ...r.rows.map((x) => [x.date, x.company, x.role, x.platform, x.status, x.url])];
          return { filename: 'postulaciones.csv', content: '﻿' + lines.map((l) => l.map(csvCell).join(';')).join('\r\n') + '\r\n' };
        }
        throw new HttpError(400, 'Exportación desconocida');
      });
    },
  };

  const server = http.createServer(async (req, res) => {
    // Only requests addressed to this machine by a loopback name (blocks DNS rebinding).
    const hostHeader = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    if (!['localhost', '127.0.0.1', '[::1]'].includes(hostHeader)) { res.writeHead(403); res.end('Forbidden'); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");

    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      const handler = api[`${req.method} ${url.pathname}`];
      if (!handler) return sendJson(res, 404, { error: 'No existe' });
      if (!authorized(req)) return sendJson(res, 403, { error: 'No autorizado' });
      try { return sendJson(res, 200, await handler(req, url)); }
      catch (err) { return sendJson(res, err instanceof HttpError ? err.code : 500, { error: err.message }); }
    }

    if (req.method !== 'GET') { res.writeHead(405); res.end('Method not allowed'); return; }
    const page = PAGES[url.pathname];
    if (page) {
      const html = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'templates', page), 'utf8').split('__CONFIG_TOKEN__').join(TOKEN)
        .split('/*__FIT_UI__*/').join(fitUi());
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404); res.end('Not found');
  });

  const url = `http://localhost:${port}`;
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`\n  El panel ya estaba abierto en ${url}.\n`);
      if (open) openInBrowser(url);
      setTimeout(() => process.exit(0), 500);
      return;
    }
    console.error(err.message); process.exit(1);
  });
  // Loopback only: the panel holds personal data and must not be reachable from the network.
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  Job Seeker: panel abierto en ${url}\n`);
    console.log('  Dejá esta ventana abierta mientras lo uses. Para cerrarlo: cerrá esta ventana.\n');
    if (open) openInBrowser(url);
    // A scheduled run made by an older version is registered again with the hidden launcher.
    setTimeout(() => { try { if (require('../lib/schedule').upgrade()) console.log('  Actualicé la tarea programada: la corrida automática ya no abre una ventana negra.\n'); } catch { /* keeps the old one */ } }, 3000);
  });
}

main();
