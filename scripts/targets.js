#!/usr/bin/env node
/**
 * targets.js: helper CLI for applications on company career sites and job
 * boards (everything that is not LinkedIn Easy Apply).
 *
 * The agent drives the browser; this script holds the parts that must not be
 * left to judgment: which system a URL belongs to, whether an application may
 * be submitted automatically or needs the user's final OK, the daily window and
 * caps, the review queue, and the passwords of accounts created on those sites.
 *
 * Usage:
 *   node scripts/targets.js detect <url>
 *   node scripts/targets.js gate [--company "<name>"]
 *   node scripts/targets.js pause <action|page|between>
 *   node scripts/targets.js decide --url <url> --match <must|strong|nice> [--facts '<json>']
 *   node scripts/targets.js record --company <c> --role <r> --url <u> --match <m> [--platform linkedin] [--cv <file name>]
 *   node scripts/targets.js queue add --company <c> --role <r> --url <u> --match <m>
 *                                     --reasons <a,b> [--answers-file <path.json> | --answers-json '<json>'] [--notes "<text>"]
 *   node scripts/targets.js queue list [--all]
 *   node scripts/targets.js queue show <id>
 *   node scripts/targets.js queue approve <id> | reject <id> [--note "<text>"]
 *   node scripts/targets.js queue submitted <id>
 *   node scripts/targets.js questions add --url <u> (--file <path.json> | --json '<json array>')
 *   node scripts/targets.js questions list                      questions no stated answer exists for
 *   node scripts/targets.js questions answer <id> "<answer>"    save the USER's answer to the question bank
 *   node scripts/targets.js questions skip <id>                 drop a question without answering
 *   node scripts/targets.js questions ready                     blocked applications that can be retried now
 *   node scripts/targets.js creds new <site> --email <email>
 *   node scripts/targets.js creds fill <site> <selector> [--tab <name>]
 *   node scripts/targets.js creds list
 *   node scripts/targets.js creds reveal <site>        (for the user, not the agent)
 *
 * All output is JSON unless noted. Database access uses bound parameters.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { detect, decide } = require('../lib/ats');
const humanize = require('../lib/humanize');
const creds = require('../lib/site-credentials');
const answers = require('../lib/answers');

const REPO_ROOT = process.env.JOB_SEEKER_ROOT || path.resolve(__dirname, '..');
const USER_ID = Number.parseInt(process.env.USER_ID || '1', 10);
const automation = () => humanize.settings();
const MATCHES = ['must', 'strong', 'nice'];

// Errors are thrown, not exited on, so an open database is always closed first.
function fail(msg) {
  const e = new Error(msg);
  e.cli = true;
  throw e;
}
function out(obj) {
  console.log(JSON.stringify(obj, null, 2));
}


// ---------- args ----------
const argv = process.argv.slice(2);
function opt(name) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : null;
}
function positional(skip) {
  // positional arguments after the first `skip` words, ignoring "--flag value" pairs
  const res = [];
  for (let i = skip; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { i++; continue; }
    res.push(argv[i]);
  }
  return res;
}
function need(name) {
  const v = opt(name);
  if (!v) fail(`${name} is required`);
  return v;
}

// ---------- db ----------
async function withDb(fn) {
  return require('../lib/db').withDb(fn);
}

const APPLIED_STAGES = ['applied', 'in_review', 'screening', 'interview', 'offer', 'hired', 'rejected'];

async function companyAppliedToday(client, company) {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM applications
     WHERE user_id = $1 AND lower(company) = lower($2) AND status = ANY($3)
       AND (applied_at AT TIME ZONE $4)::date = (NOW() AT TIME ZONE $4)::date`,
    [USER_ID, company, APPLIED_STAGES, automation().timezone]);
  return r.rows[0].n;
}

async function findByUrl(client, url) {
  const r = await client.query(
    'SELECT id, status, data FROM applications WHERE user_id = $1 AND url = $2 ORDER BY id LIMIT 1', [USER_ID, url]);
  return r.rows[0] || null;
}

function pushHistory(data, from, stage) {
  const history = Array.isArray(data.stage_history) ? data.stage_history.slice() : [];
  history.push({ stage, moved_at: new Date().toISOString(), from });
  return history;
}

function checkMatch(m) {
  if (!MATCHES.includes(m)) fail(`--match must be one of: ${MATCHES.join(', ')}`);
  return m;
}

function checkUrl(u) {
  const d = detect(u);
  if (d.ats === 'invalid') fail('--url must be an http(s) URL');
  return d;
}

// ---------- commands ----------
async function cmdGate() {
  if (process.env.HUMANIZE_OFF === '1') return out({ allowed: true, message: 'limits disabled (HUMANIZE_OFF=1)' });
  const company = opt('--company');
  // Company sites and job boards: working window and Sunday rest, no daily total.
  // The 10-15 daily cap belongs to LinkedIn and is enforced by linkedin-easy-apply.js.
  const g = humanize.gate({ scope: 'sites' });
  const res = { allowed: g.allowed, message: g.message };
  if (g.allowed && company) {
    const n = await withDb((c) => companyAppliedToday(c, company));
    res.company_done_today = n;
    res.company_cap = automation().company_cap;
    if (n >= automation().company_cap) {
      res.allowed = false;
      res.message = `Company cap reached: ${n} applications to ${company} today (max ${automation().company_cap}).`;
    }
  }
  out(res);
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function cmdPause() {
  const kind = argv[1];
  const rand = (a, b) => a + Math.random() * (b - a);
  let ms;
  if (kind === 'action') ms = rand(1500, 5000);           // between two clicks or fields
  else if (kind === 'page') ms = rand(6000, 18000);       // reading a job description or a new page
  else if (kind === 'between') ms = Math.random() < 0.15 ? rand(120000, 300000) : rand(25000, 80000); // between applications
  else fail('pause needs one of: action, page, between');
  if (process.env.HUMANIZE_OFF === '1') ms = 0;
  ms = Math.round(ms);
  sleepMs(ms);
  out({ paused_ms: ms });
}

async function cmdDecide() {
  const url = need('--url');
  const d = checkUrl(url);
  const match = checkMatch(need('--match'));
  let facts = {};
  const raw = opt('--facts');
  if (raw) {
    try { facts = JSON.parse(raw); } catch { fail('--facts must be valid JSON'); }
    if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) fail('--facts must be a JSON object');
  }
  // tier, match and first_on_ats are computed here; values passed in --facts cannot override them
  const firstOnAts = await withDb(async (c) => {
    const r = await c.query(
      `SELECT count(*)::int AS n FROM applications WHERE user_id = $1 AND data->>'ats' = $2 AND status = ANY($3)`,
      [USER_ID, d.ats, APPLIED_STAGES]);
    return r.rows[0].n === 0;
  });
  const result = decide({ ...facts, tier: d.tier, match, first_on_ats: firstOnAts });
  if (result.decision === 'auto' && process.env.HUMANIZE_OFF !== '1') {
    const g = humanize.gate({ scope: 'sites' });
    if (!g.allowed) {
      result.decision = 'review';
      result.reasons.push('outside_working_window');
    }
  }
  out({ ats: d.ats, tier: d.tier, host: d.host, ...result });
}

// Every submitted application is appended to the user's CSV log (see lib/tracking.js).
async function logApplied(c, row) {
  try {
    const store = require('../lib/store');
    const tracking = require('../lib/tracking');
    const data = (await store.getUserData(c)) || {};
    const channel = row.channel === 'linkedin' ? 'LinkedIn (Solicitud sencilla)' : `Sitio o ATS de la empresa (${row.channel})`;
    // The time zone comes from the data already loaded: the database is open here,
    // so nothing that opens it again (like humanize.settings) may be called.
    let tz = (data.automation && data.automation.timezone) || 'America/Argentina/Buenos_Aires';
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { tz = 'America/Argentina/Buenos_Aires'; }
    return tracking.appendLog(store.logFileFrom(data), { ...row, channel }, new Date(), tz).written;
  } catch (e) {
    return `no se pudo registrar: ${e.message}`;
  }
}

async function cmdRecord() {
  const company = need('--company'), role = need('--role');
  const platformOpt = opt('--platform');
  if (platformOpt && platformOpt !== 'linkedin') fail('--platform only accepts: linkedin');
  const url = opt('--url');
  if (!url && platformOpt !== 'linkedin') fail('--url is required');
  const d = url ? checkUrl(url) : { ats: 'linkedin' };
  const platform = platformOpt || d.ats;
  const match = checkMatch(need('--match'));
  const cv = (opt('--cv') || '').replace(/[\u0000-\u001f]/g, '').slice(0, 200) || null;
  await withDb(async (c) => {
    const existing = url ? await findByUrl(c, url) : null;
    if (existing && APPLIED_STAGES.includes(existing.status)) fail(`already applied (application #${existing.id})`);
    const base = existing ? (existing.data || {}) : {};
    const data = { ...base, ats: d.ats, source: platform === 'linkedin' ? 'linkedin_easy_apply' : 'targets', match, auto_submitted: true,
      stage_history: pushHistory(base, existing ? existing.status : null, 'applied') };
    if (cv) data.cv = cv;
    if (data.review && ['pending', 'approved'].includes(data.review.state)) {
      data.review = { ...data.review, state: 'submitted', submitted_at: new Date().toISOString() };
    }
    let id;
    if (existing) {
      await c.query(`UPDATE applications SET status = 'applied', applied_at = NOW(), platform = $1, data = $2::jsonb WHERE id = $3 AND user_id = $4`,
        [platform, JSON.stringify(data), existing.id, USER_ID]);
      id = existing.id;
    } else {
      const r = await c.query(
        `INSERT INTO applications (user_id, platform, company, role, url, status, applied_at, data)
         VALUES ($1, $2, $3, $4, $5, 'applied', NOW(), $6::jsonb) RETURNING id`,
        [USER_ID, platform, company, role, url, JSON.stringify(data)]);
      id = r.rows[0].id;
    }
    const log = await logApplied(c, { company, role, url, channel: platform, cv });
    out({ id, status: 'applied', platform, log });
  });
}

// ---------- question bank ----------
// users.data.pending_questions: [{ id, question, type, options, jobs: [url], first_seen }]
// users.data.form_answers.qa:   { "<question>": "<answer>" }   (only ever written from the user's own answers)
async function loadUser(c) {
  const r = await c.query('SELECT data FROM users WHERE id = $1', [USER_ID]);
  if (!r.rows[0]) fail(`user ${USER_ID} not found`);
  return r.rows[0].data || {};
}
async function saveKey(c, key, value) {
  await c.query(`UPDATE users SET data = jsonb_set(COALESCE(data, '{}'::jsonb), $1::text[], $2::jsonb, true) WHERE id = $3`,
    [key, JSON.stringify(value), USER_ID]);
}

async function cmdQuestions() {
  const sub = argv[1];

  if (sub === 'add') {
    // Questions come inline (--json) or from a file (--file).
    let incoming;
    const inline = opt('--json');
    if (inline) {
      try { incoming = JSON.parse(inline); } catch { fail('--json must contain valid JSON'); }
    } else {
      const file = need('--file');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`--file is not a file: ${file}`);
      try { incoming = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('--file must contain valid JSON'); }
    }
    if (!Array.isArray(incoming)) fail('--file must contain a JSON array of questions');
    const url = opt('--url');
    return withDb(async (c) => {
      const data = await loadUser(c);
      const pending = Array.isArray(data.pending_questions) ? data.pending_questions : [];
      let nextId = pending.reduce((m, q) => Math.max(m, q.id || 0), 0) + 1;
      for (const q of incoming) {
        if (!q || typeof q.question !== 'string' || !q.question.trim()) continue;
        const key = answers.norm(q.question);
        let item = pending.find((x) => answers.norm(x.question) === key);
        if (!item) {
          item = { id: nextId++, question: q.question.trim().slice(0, 300), type: String(q.type || 'text').slice(0, 20),
            options: Array.isArray(q.options) ? q.options.map((o) => String(o).slice(0, 120)).slice(0, 25) : [], jobs: [], first_seen: new Date().toISOString() };
          pending.push(item);
        }
        if (url && !item.jobs.includes(url)) item.jobs.push(url);
      }
      await saveKey(c, ['pending_questions'], pending);
      let appId = null;
      if (url) {
        const d = checkUrl(url);
        const review = { state: 'pending', reasons: ['missing_answers'], answers: incoming, notes: null, prepared_at: new Date().toISOString() };
        const existing = await findByUrl(c, url);
        if (existing && !APPLIED_STAGES.includes(existing.status)) {
          const nd = { ...(existing.data || {}), ats: d.ats, review };
          await c.query('UPDATE applications SET data = $1::jsonb WHERE id = $2 AND user_id = $3', [JSON.stringify(nd), existing.id, USER_ID]);
          appId = existing.id;
        } else if (!existing) {
          const r = await c.query(
            `INSERT INTO applications (user_id, platform, company, role, url, status, data) VALUES ($1, $2, $3, $4, $5, 'discovered', $6::jsonb) RETURNING id`,
            [USER_ID, d.ats, opt('--company') || 'Unknown', opt('--role') || 'Unknown', url, JSON.stringify({ ats: d.ats, review })]);
          appId = r.rows[0].id;
        }
      }
      out({ pending_questions: pending.length, application: appId });
    });
  }

  if (sub === 'list') {
    return withDb(async (c) => {
      const data = await loadUser(c);
      out((data.pending_questions || []).map((q) => ({ id: q.id, question: q.question, type: q.type, options: q.options, blocked_jobs: (q.jobs || []).length })));
    });
  }

  if (sub === 'ready') {
    return withDb(async (c) => {
      const data = await loadUser(c);
      const ctx = { answers: data.form_answers || {}, personal: data.personal_info || {}, profile: data.profile || {} };
      const r = await c.query(
        `SELECT id, company, role, url, platform, data->'review'->'answers' AS questions FROM applications
         WHERE user_id = $1 AND data->'review'->>'state' = 'pending' AND data->'review'->'reasons' ? 'missing_answers'`, [USER_ID]);
      const ready = r.rows.filter((a) => Array.isArray(a.questions) && a.questions.every((q) =>
        q && q.question && answers.resolve(q.question, q.options && q.options.length ? q.options : null, ctx).kind !== 'unknown'));
      out(ready.map((a) => ({ id: a.id, company: a.company, role: a.role, url: a.url, platform: a.platform })));
    });
  }

  if (sub === 'answer' || sub === 'skip') {
    const id = Number.parseInt(argv[2], 10);
    if (!Number.isInteger(id)) fail(`questions ${sub} needs a question id (see: questions list)`);
    return withDb(async (c) => {
      const data = await loadUser(c);
      const pending = Array.isArray(data.pending_questions) ? data.pending_questions : [];
      const item = pending.find((q) => q.id === id);
      if (!item) fail(`question #${id} is not pending`);
      const rest = pending.filter((q) => q.id !== id);
      if (sub === 'skip') {
        await saveKey(c, ['pending_questions'], rest);
        return out({ id, skipped: true });
      }
      const given = positional(3)[0];
      if (given === undefined || !String(given).trim()) fail('questions answer needs the answer text');
      let value = String(given).trim();
      if (item.options && item.options.length) {
        const optHit = answers.matchOption(value, item.options);
        if (!optHit) fail(`the answer must be one of: ${item.options.join(' | ')}`);
        value = optHit;
      }
      const fa = data.form_answers && typeof data.form_answers === 'object' ? data.form_answers : {};
      const qa = fa.qa && typeof fa.qa === 'object' ? fa.qa : {};
      qa[item.question] = value;
      await saveKey(c, ['form_answers'], { ...fa, qa });
      await saveKey(c, ['pending_questions'], rest);
      out({ id, question: item.question, saved_answer: value, remaining: rest.length });
    });
  }
  fail('questions needs one of: add, list, answer, skip, ready');
}

async function cmdQueue() {
  const sub = argv[1];

  if (sub === 'add') {
    const company = need('--company'), role = need('--role'), url = need('--url');
    const d = checkUrl(url);
    const match = checkMatch(need('--match'));
    const reasons = need('--reasons').split(',').map((s) => s.trim()).filter(Boolean);
    let answers = null;
    const af = opt('--answers-file');
    const aj = opt('--answers-json');
    if (aj) { try { answers = JSON.parse(aj); } catch { fail('--answers-json must be valid JSON'); } }
    else if (af) {
      if (!fs.existsSync(af) || !fs.statSync(af).isFile()) fail(`--answers-file is not a file: ${af}`);
      try { answers = JSON.parse(fs.readFileSync(af, 'utf8')); } catch { fail('--answers-file must contain valid JSON'); }
    }
    const review = { state: 'pending', reasons, answers, notes: opt('--notes') || null, prepared_at: new Date().toISOString() };
    return withDb(async (c) => {
      const existing = await findByUrl(c, url);
      if (existing && APPLIED_STAGES.includes(existing.status)) fail(`already applied (application #${existing.id})`);
      let id;
      if (existing) {
        const data = { ...(existing.data || {}), ats: d.ats, source: 'targets', match, review };
        await c.query('UPDATE applications SET data = $1::jsonb WHERE id = $2 AND user_id = $3', [JSON.stringify(data), existing.id, USER_ID]);
        id = existing.id;
      } else {
        const data = { ats: d.ats, source: 'targets', match, review };
        const r = await c.query(
          `INSERT INTO applications (user_id, platform, company, role, url, status, data)
           VALUES ($1, $2, $3, $4, $5, 'discovered', $6::jsonb) RETURNING id`,
          [USER_ID, d.ats, company, role, url, JSON.stringify(data)]);
        id = r.rows[0].id;
      }
      out({ id, review: 'pending', reasons });
    });
  }

  if (sub === 'list') {
    const states = argv.includes('--all') ? ['pending', 'approved', 'rejected', 'submitted'] : ['pending', 'approved'];
    return withDb(async (c) => {
      const r = await c.query(
        `SELECT id, company, role, url, data->>'ats' AS ats, data->>'match' AS match,
                data->'review'->>'state' AS state, data->'review'->'reasons' AS reasons,
                data->'review'->>'prepared_at' AS prepared_at
         FROM applications
         WHERE user_id = $1 AND data->'review'->>'state' = ANY($2)
         ORDER BY data->'review'->>'prepared_at'`, [USER_ID, states]);
      out(r.rows);
    });
  }

  const id = Number.parseInt(argv[2], 10);
  if (!Number.isInteger(id)) fail(`queue ${sub || ''} needs an application id`);

  return withDb(async (c) => {
    const r = await c.query('SELECT id, company, role, url, status, data FROM applications WHERE id = $1 AND user_id = $2', [id, USER_ID]);
    const app = r.rows[0];
    if (!app) fail(`application #${id} not found`);
    const data = app.data || {};
    if (!data.review) fail(`application #${id} is not in the review queue`);

    if (sub === 'show') return out({ id: app.id, company: app.company, role: app.role, url: app.url, status: app.status, ats: data.ats, match: data.match, review: data.review });

    const save = (status, extra = {}) => c.query(
      `UPDATE applications SET status = $1, data = $2::jsonb${extra.applied ? ', applied_at = NOW()' : ''} WHERE id = $3 AND user_id = $4`,
      [status, JSON.stringify(data), id, USER_ID]);

    if (sub === 'approve') {
      if (data.review.state !== 'pending') fail(`application #${id} is "${data.review.state}", not pending`);
      data.review.state = 'approved';
      data.review.approved_at = new Date().toISOString();
      if (opt('--note')) data.review.user_note = opt('--note');
      await save(app.status);
      return out({ id, review: 'approved', next: 'open the form, re-check the answers against review.answers, submit, then run: queue submitted ' + id });
    }
    if (sub === 'reject') {
      if (!['pending', 'approved'].includes(data.review.state)) fail(`application #${id} is "${data.review.state}"`);
      data.review.state = 'rejected';
      if (opt('--note')) data.review.user_note = opt('--note');
      data.stage_history = pushHistory(data, app.status, 'skipped');
      await save('skipped');
      return out({ id, review: 'rejected', status: 'skipped' });
    }
    if (sub === 'submitted') {
      if (data.review.state !== 'approved') fail(`application #${id} is "${data.review.state}"; only approved applications can be marked submitted`);
      data.review.state = 'submitted';
      data.review.submitted_at = new Date().toISOString();
      data.stage_history = pushHistory(data, app.status, 'applied');
      await save('applied', { applied: true });
      const log = await logApplied(c, { company: app.company, role: app.role, url: app.url, channel: data.ats || 'sitio' });
      return out({ id, review: 'submitted', status: 'applied', log });
    }
    fail('queue needs one of: add, list, show, approve, reject, submitted');
  });
}

function cmdCreds() {
  const sub = argv[1];
  const site = positional(2)[0];
  try {
    if (sub === 'list') return out(creds.list());
    if (!site) fail(`creds ${sub || ''} needs a site name`);

    if (sub === 'new') {
      const email = need('--email');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('--email is not a valid address');
      const r = creds.create(site, email);
      return out({ site: r.id, email: r.email, stored: 'local, encrypted', next: `fill it with: creds fill ${r.id} <selector>` });
    }

    if (sub === 'fill') {
      const selector = positional(2)[1];
      if (!selector) fail('creds fill needs a selector or @ref for the password field');
      const { password } = creds.getPassword(site);
      const wrapper = path.join(REPO_ROOT, '.agents', 'skills', 'browser-automation', 'scripts', 'browser.js');
      const args = [wrapper, 'exec', 'fill', selector, password];
      if (opt('--tab')) args.push('--tab', opt('--tab'));
      const r = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, BROWSER_DEBUG: '' } });
      // Never echo the browser tool's output as-is: it could repeat the value.
      if (r.status !== 0) {
        const msg = ((r.stderr || '') + (r.stdout || '')).split(password).join('[hidden]').trim().slice(0, 400);
        fail(`could not fill the password field: ${msg || 'unknown error'}`);
      }
      return out({ site: creds.slug(site), filled: selector });
    }

    if (sub === 'reveal') {
      if (!process.stdout.isTTY) fail('reveal only works when the user runs it in their own terminal');
      const c = creds.getPassword(site);
      return console.log(`${c.email}\n${c.password}`);
    }
    fail('creds needs one of: new, fill, list, reveal');
  } catch (e) {
    fail(e.message);
  }
}

async function main() {
  if (!Number.isInteger(USER_ID) || USER_ID < 1) fail('USER_ID must be a positive integer');
  switch (argv[0]) {
    case 'detect': {
      if (!argv[1]) fail('detect needs a URL');
      return out(detect(argv[1]));
    }
    case 'gate': return cmdGate();
    case 'pause': return cmdPause();
    case 'decide': return cmdDecide();
    case 'record': return cmdRecord();
    case 'queue': return cmdQueue();
    case 'questions': return cmdQuestions();
    case 'creds': return cmdCreds();
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 33).join('\n'));
  }
}

main().catch((e) => {
  console.error(`[targets] ${e.cli ? e.message : `Unexpected: ${e.message}`}`);
  process.exit(1);
});
