#!/usr/bin/env node
/**
 * linkedin-easy-apply.js — Search and apply to LinkedIn Easy Apply jobs automatically.
 *
 * Uses agent-browser via the browser.js wrapper (session must be open first).
 * Searches for jobs, clicks Easy Apply, fills forms with data from DB,
 * submits applications, and registers them in DB.
 *
 * Usage:
 *   node .agents/skills/browser-automation/scripts/browser.js open "https://www.linkedin.com"   # ensure session
 *   node scripts/linkedin-easy-apply.js                          # keywords from DB profile
 *   node scripts/linkedin-easy-apply.js --keywords '"AI Engineer" OR "GenAI"'
 *   node scripts/linkedin-easy-apply.js --max 5                  # limit to 5 jobs
 *   node scripts/linkedin-easy-apply.js --dry-run                # list jobs without applying
 *   node scripts/linkedin-easy-apply.js --session apply-1         # use a specific browser session
 *
 * Flags:
 *   --keywords <q>   Search keywords (default: derived from DB profile.title + profile.skills)
 *   --location <loc> Location filter (default: derived from DB job_preferences.location or personal_info.country)
 *   --max <n>        Max jobs to apply (default: 10; also limited by today's cap)
 *   --posted <w>     Only postings from the last day | week | month (default: week)
 *   --force          Ignore the daily window, cap and rest days for this run
 *   --dry-run        List matching jobs without applying
 *   --json           Output results as JSON
 *   --session <name> Browser session name (default: "default". Use a different name to run in parallel with other agents via attach)
 *
 * Exit codes:
 *   0 = success
 *   1 = no jobs found
 *   2 = browser not running / error
 */
'use strict';

const { execSync, execFileSync } = require('child_process');
const { jitter, betweenApplications, gate, windowClosed, shuffle, sleepSync } = require('../lib/humanize');
const A = require('../lib/answers');
const jobFilter = require('../lib/job-filter');
const safety = require('../lib/safety');
const fitLib = require('../lib/fit');
const { spawnSync } = require('child_process');

// --- Strict answers -------------------------------------------------------
// A question is filled only with something the user stated (see lib/answers.js).
// Questions with no stated answer are collected here; the application is then
// abandoned without submitting and the questions are shown to the user.
/** Why a job was left out, in plain words. */
function reasonText(reason) {
  const r = String(reason || '');
  const rest = r.includes(':') ? r.slice(r.indexOf(':') + 1).trim() : '';
  if (r.startsWith('already_applied')) return `ya te postulaste${rest ? `: ${rest}` : ''}`;
  if (r.startsWith('possible_duplicate')) return `parece repetida de una que ya tenés${rest ? `: ${rest}` : ''}`;
  if (r.startsWith('avoid_company')) return `empresa que evitás: ${rest}`;
  if (r.startsWith('salary_low')) return `salario publicado de ${rest}`;
  if (r.startsWith('description_avoid')) return `la descripción menciona "${rest}"`;
  if (r.startsWith('avoid:')) return `el título contiene "${rest}"`;
  if (r.startsWith('not_senior:')) return `"${rest}" solo vale en puestos senior`;
  if (r.startsWith('location:')) return `presencial o híbrido fuera de tus lugares: ${rest}`;
  if (r === 'off_target_title') return 'el título no coincide con tus puestos objetivo';
  if (r === 'no_target_titles_configured') return 'no hay puestos objetivo cargados';
  if (r.startsWith('low_fit')) return `afinidad ${rest}/100, por debajo de tu mínimo`;
  if (r === 'db_unavailable') return 'la base de datos no respondió y no se pudo confirmar si ya te postulaste: queda para la próxima';
  return r;
}

// Technical trace of each form step. Hidden with --quiet (the panel uses it).
let QUIET = false;
function dbg(text) { if (!QUIET) process.stdout.write(text); }
let UNANSWERED = [];
let CTX = { answers: {}, personal: {}, profile: {} };
// Labels that are page controls, not form questions (LinkedIn's search box, for one).
const NOT_A_QUESTION = /^(buscar|search|busca|búsqueda|busqueda|search by title, skill, or company)$/i;
function noteUnanswered(label, type, options) {
  const q = String(label).replace(/\s+/g, ' ').trim();
  if (!q || q.length < 3 || NOT_A_QUESTION.test(q) || UNANSWERED.some((u) => A.norm(u.question) === A.norm(q))) return;
  UNANSWERED.push({ question: q.slice(0, 300), type, options: (options || []).slice(0, 25) });
  dbg(`[no-answer "${q.slice(0, 50)}"] `);
}
const path = require('path');

// --- Helpers ---

let SESSION = 'default'; // set by --session flag in main()

// agent-browser `snapshot -i` emits "@eN role "name"" lines; this script's
// parsers expect the playwright-style "- role "name" [ref=eN]" shape.
function normalizeSnap(snap) {
  return snap.split('\n').map(line => {
    // Compact form: `@e1 textbox "Label"` -> `- textbox "Label" [ref=e1]`
    const m = line.match(/^(\s*)@([a-z][0-9a-z]+)\s+(\w[\w-]*)\s+"([^"]*)"(.*)$/);
    if (m) return `${m[1]}- ${m[3]} "${m[4]}" [ref=${m[2]}]${m[5]}`;
    // Attribute form: `- textbox "Label" [required, ref=e21]: value`
    //              -> `- textbox "Label" [ref=e21]: value`, true states appended as `[checked]` / `[selected]`.
    // The parsers below expect the ref alone in its bracket.
    const a = line.match(/^(.*?)\[([^\]\n]*\bref=([a-z][0-9a-z]+)[^\]\n]*)\](.*)$/);
    if (!a || /^ref=[a-z][0-9a-z]+$/.test(a[2].trim())) return line;
    const states = a[2].split(',').map((x) => x.trim())
      .map((x) => (/^(checked|selected|active|disabled)(=true)?$/.test(x) ? x.replace('=true', '') : null))
      .filter(Boolean).map((x) => ` [${x}]`).join('');
    return `${a[1]}[ref=${a[3]}]${a[4]}${states}`;
  }).join('\n');
}

function cli(args, timeout = 30000) {
  const sessionFlag = SESSION !== 'default' ? `-s=${SESSION} ` : '';
  try {
    const wrapper = require('path').resolve(__dirname, '../.agents/skills/browser-automation/scripts/browser.js');
    const sessionArgs = SESSION !== 'default' ? ['--session', SESSION] : [];
    return execFileSync(process.execPath, [wrapper, 'exec', ...sessionArgs, ...args.split(' ')], {
      encoding: 'utf-8',
      timeout,
      cwd: process.cwd(),
    });
  } catch (e) {
    return e.stdout || e.message;
  }
}

// Use helpers from lib/ for resilient browser operations
const {
  goto: helperGoto,
  evalJSON,
  waitFor,
} = require('../lib/browser-helpers');

function snapshot() {
  const raw = cli('snapshot -i');
  return normalizeSnap(raw);
}

function sleep(ms) {
  sleepSync(jitter(ms));
}

function click(ref) {
  return cli(`click @${ref}`);
}

// Values are passed as one argument each, so text with spaces or quotes arrives intact.
function cliArgs(argv, timeout = 30000) {
  try {
    const wrapper = require('path').resolve(__dirname, '../.agents/skills/browser-automation/scripts/browser.js');
    const sessionArgs = SESSION !== 'default' ? ['--session', SESSION] : [];
    return execFileSync(process.execPath, [wrapper, 'exec', ...sessionArgs, ...argv], { encoding: 'utf-8', timeout, cwd: process.cwd() });
  } catch (e) {
    return e.stdout || e.message;
  }
}

function fill(ref, value) {
  return cliArgs(['fill', `@${ref}`, String(value)]);
}

function selectOption(ref, value) {
  return cliArgs(['select', `@${ref}`, String(value)]);
}

function press(key) {
  return cli(`press ${key}`);
}

function goto(url) {
  helperGoto(url, { session: SESSION });
}

// --- LinkedIn warning signs (lib/safety.js) ---
function signInSnapshot(snap) {
  const s = String(snap || '').toLowerCase();
  return s.includes('captcha') || s.includes('security check') ? 'captcha' : null;
}
/** 'captcha' | 'checkpoint' | 'restricted' | 'limit' | 'session' | null, from the URL, an open dialog and the snapshot. */
function warningSign(snap) {
  const o = evalJSON(`(function(){var d=document.querySelector('[role="alertdialog"],[role="dialog"],.artdeco-modal');return JSON.stringify({url:location.href,text:(d?d.innerText:'').slice(0,3000)});})()`, { session: SESSION });
  const p = o && typeof o === 'object' ? o : {};
  const url = String(p.url || '');
  if (/linkedin\.com\/(authwall|login|uas\/login|signup)\b/i.test(url)) return 'session';
  const fromUrl = safety.detect('', url);
  if (fromUrl) return fromUrl;
  // Dialog text only for limit and restriction notices: form questions may mention security checks.
  const fromDialog = safety.detect(p.text || '', '');
  if (fromDialog === 'limit' || fromDialog === 'restricted') return fromDialog;
  return signInSnapshot(snap);
}
/** Pauses LinkedIn applying (except for a closed session) and ends the run. */
function stopForSign(kind, ctx) {
  if (kind === 'session') {
    console.log('\n*** La sesión de LinkedIn se cerró. Abrí el panel y tocá "Iniciar sesión en LinkedIn"; después volvé a intentar. ***');
  } else {
    const p = safety.pause(kind, ctx.where || (ctx.dryRun ? 'durante una simulación' : 'durante una postulación'));
    console.log(`\n*** ${safety.message(p)} ***`);
    // The automatic run sends its own notification at the end (scripts/auto-run.js).
    if (!process.env.JOB_SEEKER_AUTO) require('../lib/notify').notify('Job Seeker frenó las postulaciones en LinkedIn', safety.message(p));
    if (kind === 'captcha' || kind === 'checkpoint') console.log('Podés resolver la verificación a mano en la ventana de Chrome. La pausa queda igual, como cuidado de tu cuenta.');
  }
  if (ctx.jsonOutput) console.log(JSON.stringify(ctx.results || [], null, 2));
  process.exit(kind === 'limit' ? 0 : 1);
}

// Runs one read-only query in a separate process. Returns the rows, or null when the database
// did not answer (busy or broken). The wait is longer than the database lock wait (60 s), and a
// busy database is retried once, so a panel request in progress does not make a check fail.
function dbQuery(sql) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const rows = JSON.parse(
        execFileSync(process.execPath, [require("path").join(__dirname, "db.js"), sql], {
          encoding: 'utf-8',
          timeout: 90000,
          cwd: __dirname,
        })
      );
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      if (attempt === 0) sleepSync(3000);
    }
  }
  return null;
}

function extractRef(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1] : null;
}

// --- DB data loader ---

function loadUserData() {
  const userId = parseInt(process.env.USER_ID || '1', 10);
  const rows = dbQuery(`SELECT data->'profile' AS profile, data->'personal_info' AS personal, data->'job_preferences' AS prefs, data->'form_answers' AS form_answers, data->'cv_text' AS cv_text FROM users WHERE id = ${userId}`);
  // Without the user's filters and answers nothing can be screened safely: stop here.
  if (rows === null) { console.error('No pude leer tu configuración de la base de datos; freno sin postular. Probá de nuevo en unos minutos.'); process.exit(1); }
  const row = rows[0];
  return {
    profile: row?.profile || {},
    personal: row?.personal || {},
    prefs: row?.prefs || {},
    formAnswers: row?.form_answers || {},
    cvText: typeof row?.cv_text === 'string' ? row.cv_text : '',
  };
}

// --- Form answers (loaded from DB, not hardcoded) ---
// Keys in users.data.form_answers:
//   python_experience, ai_experience, openai_experience, english_level, spanish_level,
//   location, current_company, linkedin_url, blog_url, salary_usd, salary_usd_max,
//   salary_cop, notice_period, availability_date, availability_weeks,
//   genai_tools, aws_experience, english_comfort,
//   diversity_accessibility, diversity_gender, diversity_ethnicity,
//   disability, sponsorship, relative_at_company, consent_future_jobs, seniority
// If a key is missing from DB, the field is skipped (not invented). Gold Rule 5c.

let ANSWERS = {};

// --- Easy Apply flow ---

function findEasyApplyJobs(snap) {
  const jobs = [];
  const lines = snap.split('\n');
  const strongRefs = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Job title: "- strong [ref=eXXXX]: Job Title"
    const strongMatch = line.match(/- strong \[ref=([a-z][0-9a-z]+)\]: (.+)/);
    if (strongMatch) {
      strongRefs[strongMatch[1]] = strongMatch[2].trim();
    }

    // Easy Apply button: "button "Easy Apply to <role> at <company>""
    const btnMatch = line.match(/button "Easy Apply to (.+?) at (.+?)" \[ref=([a-z][0-9a-z]+)\]/);
    if (btnMatch) {
      jobs.push({
        role: btnMatch[1],
        company: btnMatch[2],
        buttonRef: btnMatch[3],
      });
    }
  }

  return jobs;
}

/**
 * Extract jobs from the job list (left panel) using eval.
 * More reliable than snapshot parsing: reads all cards, not just the expanded one.
 * Returns [{role, company, easyApply, url}].
 */
// Selectors for a job card in the results list. LinkedIn changes its markup often,
// so links to a job ("/jobs/view/<id>" or "?currentJobId=<id>") also count as cards.
const CARD_SEL = '[componentkey^="job-card-component-ref-"], main .job-card-container, [data-job-id], .jobs-search-results__list-item, li[data-occludable-job-id], main a[href*="/jobs/view/"], main a[href*="currentJobId="]';

// The results list renders cards only as they scroll into view: scroll it to the end
// (a few steps, with pauses) so every card on the page has its title and company.
function loadAllCards() {
  let last = -1; let still = 0;
  for (let i = 0; i < 12 && still < 2; i++) {
    const r = evalJSON(`(function(){
      const sel = ${JSON.stringify(CARD_SEL)};
      // Scroll every scrollable panel that holds job cards (the results list), or the page.
      const boxes = Array.from(document.querySelectorAll('main *, body > div *')).filter((n) => {
        if (n.scrollHeight <= n.clientHeight + 20) return false;
        if (!/(auto|scroll)/.test(getComputedStyle(n).overflowY)) return false;
        return !!n.querySelector('li[data-occludable-job-id], [data-job-id], a[href*="/jobs/view/"], a[href*="currentJobId="]');
      });
      boxes.forEach((b) => { b.scrollTop = Math.min(b.scrollTop + b.clientHeight * 0.8, b.scrollHeight); });
      if (!boxes.length) window.scrollBy(0, window.innerHeight * 0.8);
      const end = boxes.length ? boxes.every((b) => b.scrollTop + b.clientHeight >= b.scrollHeight - 5) : window.innerHeight + window.scrollY >= document.body.scrollHeight - 5;
      return JSON.stringify({ n: document.querySelectorAll(sel).length, end: end });
    })()`, { session: SESSION }) || { n: 0, end: true };
    still = (r.end && r.n === last) ? still + 1 : 0;
    last = r.n;
    sleep(600 + Math.floor(Math.random() * 500));
  }
}

// Job search with AI (2026): each card is div[role=button][componentkey="job-card-component-ref-<id>"],
// with no link; the title is in the "Descartar empleo «...»" button, then company and place in <p>.
function findSemanticJobs() {
  return evalJSON(`(function(){
    const cards = Array.from(document.querySelectorAll('[componentkey^="job-card-component-ref-"]'))
      .filter((c) => !c.parentElement || !c.parentElement.closest('[componentkey^="job-card-component-ref-"]'));
    const clean = (t) => (t || '').replace(/\\s+/g, ' ').replace(/^(Seleccionado|Selected),\\s*/i, '')
      .replace(/\\((empleo verificado|verified job|verificado)\\)/gi, '').replace(/\\bwith verification\\b/gi, '').replace(/\\s+/g, ' ').trim();
    const seen = new Set();
    return JSON.stringify(cards.map((c) => {
      const id = (c.getAttribute('componentkey') || '').replace('job-card-component-ref-', '');
      if (!id || seen.has(id)) return null;
      seen.add(id);
      let role = '';
      const dis = Array.from(c.querySelectorAll('button[aria-label]')).map((b) => b.getAttribute('aria-label')).find((l) => /[«"“]/.test(l) && /(descartar|dismiss)/i.test(l));
      if (dis) { const m = dis.match(/[«"“]\\s*(.+?)\\s*[»"”]/); if (m) role = clean(m[1]); }
      if (!role) { const sp = Array.from(c.querySelectorAll('span[aria-hidden="true"], span')).map((e) => clean(e.textContent)).find((t) => t.length > 2); role = sp || ''; }
      const ps = Array.from(c.querySelectorAll('p')).map((e) => clean(e.textContent))
        .filter((t) => t && t !== '·' && !(role && t.includes(role)));
      const text = c.textContent;
      const salary = Array.from(c.querySelectorAll('p, span')).map((e) => clean(e.textContent))
        .filter((t) => /\\d/.test(t) && /(\\$|usd|ars|€|£)/i.test(t) && t.length < 120);
      return {
        role: role,
        company: ps[0] || '',
        location: ps[1] || '',
        salary: [...new Set(salary)].slice(0, 3),
        easyApply: text.includes('Solicitud sencilla') || text.includes('Easy Apply'),
        url: /^\\d+$/.test(id) ? 'https://www.linkedin.com/jobs/view/' + id + '/' : '',
      };
    }).filter((j) => j && j.role));
  })()`, { session: SESSION }) || [];
}

function findEasyApplyJobsFromDOM() {
  const semantic = findSemanticJobs();
  if (semantic.length) return semantic;
  return evalJSON(`(function(){
    const sel = ${JSON.stringify(CARD_SEL)};
    const raw = Array.from(document.querySelectorAll(sel)).map((el) => {
      if (el.tagName === 'A') return el.closest('li') || el.closest('[data-job-id]') || el.parentElement && el.parentElement.parentElement || el;
      return el;
    });
    // An element holding links to more than one job is the list, not a card.
    const jobKey = (a) => { const h = a.getAttribute('href') || ''; const m = h.match(/currentJobId=(\\d+)/) || h.match(/\\/jobs\\/view\\/([^/?#]+)/); return m ? m[1] : h; };
    const jobsIn = (el) => new Set(Array.from(el.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="]')).map(jobKey)
      .concat(Array.from(el.querySelectorAll('[data-job-id]')).map((x) => x.getAttribute('data-job-id')))).size;
    const set = new Set(raw.filter((c) => c && jobsIn(c) <= 1));
    // Keep the outermost element of each card (a link or [data-job-id] inside an li counts once).
    const cards = Array.from(set).filter((c) => !Array.from(set).some((o) => o !== c && o.contains(c)));
    if (cards.length === 0) return JSON.stringify([]);
    const clean = (t) => {
      let x = (t || '').replace(/\\s+/g, ' ').trim();
      x = x.replace(/^(Seleccionado|Selected),\\s*/i, '');
      x = x.replace(/\\((Empleo verificado|Verified job|Verificado)\\)/gi, '').replace(/\\bwith verification\\b/gi, '').replace(/\\s+/g, ' ').trim();
      const m = x.match(/^(.+?)\\s*\\1$/);
      x = m ? m[1].trim() : x;
      // Button labels (feedback, save, dismiss) are not job titles.
      return /^(compartir comentarios|share (positive|negative) feedback|descartar|dismiss|guardar|save|ocultar|hide)/i.test(x) ? '' : x;
    };
    return JSON.stringify(cards.map(c => {
      // LinkedIn UI changes frequently: try multiple selectors for title
      const titleEl = Array.from(c.querySelectorAll('.job-card-list__title--link strong, .job-card-list__title--link, a.job-card-container__link strong, .artdeco-entity-lockup__title, h3, .job-title, .job-card-list__title, strong, [class*="title"]'))
        .find((e) => !e.closest('button') && clean(e.textContent));
      // Company: try h4, then div with company-name class, then any div that looks like a company
      let companyEl = c.querySelector('.artdeco-entity-lockup__subtitle, .job-card-container__primary-description, h4, .company-name, .job-card-container__company-name, [class*="company"]');
      if (!companyEl) {
        // Fallback: find a div whose text is short and not the title or location
        const divs = c.querySelectorAll('div');
        for (const d of divs) {
          const txt = d.textContent.trim();
          if (txt.length > 2 && txt.length < 60 && !txt.includes('remoto') && !txt.includes('Remote')
              && !txt.includes('Solicitud') && !txt.includes('Easy Apply')
              && d.querySelector('strong') === null) {
            companyEl = d;
            break;
          }
        }
      }
      const linkEl = c.tagName === 'A' ? c : c.querySelector('a[href*="/jobs/view/"], a[href*="currentJobId="]');
      // Easy Apply badge: check text, aria-label, and button class
      const hasEasyApplyText = c.textContent.includes('Easy Apply') || c.textContent.includes('Solicitud sencilla');
      const hasEasyApplyBtn = !!c.querySelector('button[aria-label*="Easy Apply"], button[aria-label*="Solicitud sencilla"], .job-card-container__easy-apply, .jobs-apply-button');
      let role = '';
      if (titleEl) {
        const vis = titleEl.querySelector('span[aria-hidden="true"]');
        role = clean((vis || titleEl).textContent);
        if (titleEl.tagName === 'STRONG' && role.length > 100) role = '';
      }
      if (!role && linkEl) role = clean(linkEl.getAttribute('aria-label') || (linkEl.innerText || '').split(String.fromCharCode(10))[0] || '');
      // Job link: the card's own link, or one built from the job id.
      const inner = c.querySelector('[data-job-id], [data-occludable-job-id]');
      const href = linkEl ? linkEl.href : '';
      let id = c.getAttribute('data-occludable-job-id') || c.getAttribute('data-job-id') || (inner && (inner.getAttribute('data-job-id') || inner.getAttribute('data-occludable-job-id'))) || '';
      const m = href.match(/currentJobId=(\\d+)/) || href.match(/\\/jobs\\/view\\/(\\d+)/);
      if (m) id = m[1];
      let url = href;
      if (!/\\/jobs\\/view\\//.test(href) && /^\\d+$/.test(id)) url = 'https://www.linkedin.com/jobs/view/' + id + '/';
      const locEl = c.querySelector('.job-card-container__metadata-item, .job-card-container__metadata-wrapper li, .artdeco-entity-lockup__caption, [class*="metadata"]');
      const salary = [...c.querySelectorAll('.job-card-container__metadata-item, .job-card-container__metadata-wrapper li, [class*="salary"], [class*="compensation"], [class*="metadata"] li, [class*="metadata"] span')]
        .map((e) => e.textContent.replace(/\\s+/g, ' ').trim()).filter((t) => /\\d/.test(t) && /(\\$|usd|ars|€|£)/i.test(t) && t.length < 120);
      return {
        role: role,
        location: locEl ? locEl.textContent.replace(/\\s+/g, ' ').trim().slice(0, 200) : '',
        salary: [...new Set(salary)].slice(0, 3),
        company: companyEl ? clean(companyEl.textContent) : '',
        easyApply: hasEasyApplyText || hasEasyApplyBtn,
        url: url,
      };
    }).filter(j => j.role));
  })()`, { session: SESSION }) || [];
}

// When a search page yields no cards, keep a copy of it so the cause can be checked.
// Jobs without Easy Apply: same searches without that filter, same checks (title, company,
// place, already applied, salary, description). The ones that pass are saved for the agent.
function collectExternal({ searches, location, userData, posted, expFilter, quiet, limit = 10 }) {
  const ext = require('../lib/external');
  const say = (t) => { if (!quiet) console.log(t); };
  say('\nAvisos sin solicitud sencilla (para el agente):');
  let found = [];
  searches.forEach((q, i) => {
    sleep(3000 + Math.floor(Math.random() * 4000));
    goto(jobFilter.buildSearchUrl({ keywords: q, location, prefs: userData.prefs, posted, easyApply: false }) + expFilter);
    waitFor(`document.querySelectorAll(${JSON.stringify(CARD_SEL)}).length > 0`, { timeout: 15000, session: SESSION });
    sleep(1500);
    { const sign = warningSign(''); if (sign) stopForSign(sign, { where: 'durante una búsqueda', jsonOutput: false, results: [] }); }
    loadAllCards();
    const got = uniqueJobs(findEasyApplyJobsFromDOM()).filter((j) => !j.easyApply);
    say(`  Búsqueda ${i + 1} de ${searches.length}: ${got.length} sin solicitud sencilla`);
    found = found.concat(got);
  });
  // New jobs that pass the quick filters, plus the ones left "sin revisar" by an earlier run.
  const pool = [];
  for (const j of uniqueJobs(found)) {
    if (ext.has(j)) continue;
    let c = jobFilter.checkTitle(j.role || '', userData.prefs, userData.profile);
    if (c.pass) c = jobFilter.checkCompany(j.company, userData.prefs);
    if (c.pass) c = jobFilter.checkLocation(j.location, userData.prefs);
    if (c.pass) { const k = alreadyKnown(j); if (k) c = { pass: false, reason: k }; }
    if (c.pass) c = jobFilter.checkSalary(j, userData.prefs);
    if (c.pass) pool.push(j);
  }
  const waiting = ext.load().filter((e) => e.status === 'sin revisar').map((e) => ({ ...e, saved: e.id }));
  const queue = waiting.concat(shuffle(pool));
  const saved = [];
  let visited = 0;
  for (const j of queue) {
    if (visited >= limit) break;
    visited++;
    if (!j.url) continue;
    goto(j.url);
    sleep(2500);
    const sc = screenJob(j, userData);
    if (sc.skip) {
      say(`  - ${j.role} en ${j.company} [${reasonText(sc.reason)}]`);
      if (j.saved && sc.reason !== 'db_unavailable') ext.mark(j.saved, 'descartado', reasonText(sc.reason));
      continue;
    }
    const s = j.salaryFound;
    const salary = s ? `${s.currency === 'USD' ? 'US$' : '$'} ${s.monthlyMax.toLocaleString('es-AR')} por mes (máximo)` : (j.saved ? j.salary : null);
    const fr = fitRecord(j);
    const e = j.saved ? ext.update(j.saved, { status: 'pendiente', salary, ...(fr ? { fit: fr } : {}) }) : ext.add({ ...j, salary_text: salary, fit: fr }, 'pendiente');
    if (e) saved.push(e);
    sleep(1500 + Math.floor(Math.random() * 2500));
  }
  // The rest stay listed so the user can see them now; the next run reads their description.
  const rest = queue.slice(visited).filter((j) => !j.saved);
  rest.forEach((j) => ext.add(j, 'sin revisar'));
  if (saved.length) {
    say(`  Pasaron todos tus filtros ${saved.length}; quedan para que elijas en "Avisos para revisar":`);
    saved.forEach((e) => say(`  #${e.id} ${e.role} en ${e.company}${e.location ? ` (${e.location})` : ''}`));
  } else say('  No hubo avisos nuevos que pasen tus filtros.');
  const left = queue.length - visited;
  if (left > 0) say(`  ${left} más quedaron "sin revisar": ya los ves en "Avisos para revisar" y la próxima corrida lee su descripción.`);
  return saved;
}

let jobPagesSaved = 0;
let SAVE_JOB_PAGES = false;
function saveSearchPage(n) {
  try {
    const html = evalJSON('(function(){ return JSON.stringify(document.documentElement.outerHTML.slice(0, 4000000)); })()', { session: SESSION });
    if (typeof html !== 'string' || !html) return null;
    const fs = require('fs'); const path = require('path');
    const dir = path.join(__dirname, '..', 'datos');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, /^aviso/.test(String(n)) ? `diagnostico-${n}.html` : `diagnostico-busqueda-${n}.html`);
    fs.writeFileSync(file, html.replace(/<script[\s\S]*?<\/script>/gi, ''));
    return file;
  } catch { return null; }
}
// The same job can match more than one card selector: keep one per link (or per title and company).
function uniqueJobs(jobs) {
  const seen = new Set();
  return (Array.isArray(jobs) ? jobs : []).filter((j) => {
    const key = (j.url || '').split('?')[0] || `${j.role}|${j.company}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
// Already applied or discarded (by link, or by company and title), checked before opening the job page.
function alreadyKnown(job) {
  if (job.company && job.role && !/^(unknown|linkedin)$/i.test(job.company)) {
    const known = knownJobs();
    if (known === null) return 'db_unavailable';
    const hit = jobMatch.findMatch({ company: job.company, role: job.role }, known);
    if (hit) return `${hit.kind === 'same' ? 'already_applied' : 'possible_duplicate'}: ${hit.match.company} / ${hit.match.role} (${hit.match.status}, #${hit.match.id})`;
  }
  return null;
}

// --- Screening before opening the form ---
// Skips a job that was already applied to (by URL, from the database) or whose
// description contains a phrase the user ruled out. Nothing is clicked here.
const jobMatch = require('../lib/match');
let _knownJobs = null;
function knownJobs() {
  if (_knownJobs) return _knownJobs;
  const uid = parseInt(process.env.USER_ID || '1', 10);
  const rows = dbQuery(`SELECT id, company, role, status FROM applications WHERE user_id = ${uid} AND status IN (${APPLIED_STATUSES})`);
  if (rows === null) return null; // not cached: the next job tries again
  _knownJobs = rows;
  return _knownJobs;
}
const APPLIED_STATUSES = "'applied','contacted','in_review','screening','interview','offer','hired','rejected','withdrawn','skipped'";
function screenJob(job, userData) {
  if (job.url) {
    const uid = parseInt(process.env.USER_ID || '1', 10);
    const rows = dbQuery(`SELECT id FROM applications WHERE user_id = ${uid} AND url = '${String(job.url).replace(/'/g, "''")}' AND status IN (${APPLIED_STATUSES}) LIMIT 1`);
    // If the database did not answer, it is not known whether this job was applied to: skip it.
    if (rows === null) return { skip: true, reason: 'db_unavailable' };
    if (rows.length) return { skip: true, reason: `already_applied (#${rows[0].id})` };
  }
  // Same company and position already known (applied here, imported, or read from
  // the user's tracking spreadsheet), compared with tolerant matching.
  if (job.company && job.role && !/^(unknown|linkedin)$/i.test(job.company)) {
    const known = knownJobs();
    if (known === null) return { skip: true, reason: 'db_unavailable' };
    const hit = jobMatch.findMatch({ company: job.company, role: job.role }, known);
    if (hit) return { skip: true, reason: `${hit.kind === 'same' ? 'already_applied' : 'possible_duplicate'}: ${hit.match.company} / ${hit.match.role} (${hit.match.status}, #${hit.match.id})` };
  }
  const comp = jobFilter.checkCompany(job.company, userData.prefs);
  if (!comp.pass) return { skip: true, reason: comp.reason };
  const lc0 = jobFilter.checkLocation(job.location, userData.prefs);
  if (!lc0.pass) return { skip: true, reason: lc0.reason };
  const d = evalJSON(`(function(){
    let el = document.querySelector('#job-details, .jobs-description__content, .jobs-box__html-content, .jobs-description, [class*="jobs-description"]');
    // Job search with AI (2026): no description class; the text follows an "Acerca del empleo" heading.
    if (!el || !(el.innerText || el.textContent || '').trim()) {
      const h = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, span, strong'))
        .find((e) => /^(acerca del empleo|about the job|sobre el empleo)$/i.test((e.textContent || '').trim()));
      let n = h;
      while (n && n.parentElement && (n.innerText || n.textContent || '').trim().length < 300) n = n.parentElement;
      el = n && n !== document.body ? n : null;
    }
    const locEl = [...document.querySelectorAll('.job-details-jobs-unified-top-card__primary-description-container, .job-details-jobs-unified-top-card__tertiary-description-container, .jobs-unified-top-card__bullet, .jobs-unified-top-card__subtitle-primary-grouping, .top-card-layout__second-subline, [class*="top-card"] [class*="location"], [class*="topcard__flavor--bullet"]')];
    const salEls = [...document.querySelectorAll('[class*="salary"], [class*="compensation"], .job-details-preferences-and-skills, .job-details-jobs-unified-top-card__job-insight, .job-details-fit-level-preferences button, .job-details-fit-level-preferences span, .jobs-unified-top-card__job-insight')];
    const salary = salEls.map((e) => e.textContent.replace(/\\s+/g, ' ').trim()).filter((t) => /\\d/.test(t) && /(\\$|usd|ars|€|£)/i.test(t) && t.length < 160);
    return JSON.stringify({ text: el ? (el.innerText || el.textContent || '').slice(0, 20000) : '', location: locEl.map((e) => e.textContent.trim()).join(' | ').slice(0, 400), salary: [...new Set(salary)].slice(0, 5) });
  })()`, { session: SESSION });
  job.description = (d && d.text) || '';
  // Simulations keep a copy of up to two job pages whose description could not be read.
  if (!job.description && SAVE_JOB_PAGES && jobPagesSaved < 2) {
    jobPagesSaved++;
    saveSearchPage(`aviso-${jobPagesSaved}`);
  }
  if (d && d.location) job.location = [job.location, d.location].filter(Boolean).join(' | ');
  if (d && Array.isArray(d.salary) && d.salary.length) job.salary = [...new Set([...(job.salary || []), ...d.salary])];
  if (!lc0.reason.startsWith('place') && lc0.reason !== 'remote' && d && d.location) {
    const lc1 = jobFilter.checkLocation(d.location, userData.prefs);
    if (!lc1.pass) return { skip: true, reason: lc1.reason };
  }
  const check = jobFilter.checkDescription(d && d.text, userData.prefs);
  if (!check.pass) return { skip: true, reason: check.reason };
  const pay = jobFilter.checkSalary(job, userData.prefs);
  job.salaryFound = pay.salary;
  if (!pay.pass) return { skip: true, reason: pay.reason };
  // Fit with the user (lib/fit.js): shown in simulations and saved with the job; optional minimum.
  try { job.fit = fitLib.score(job, userData); } catch { job.fit = null; }
  const minFit = Number.parseInt(userData.prefs.min_fit, 10);
  if (job.fit && minFit > 0 && job.fit.score < minFit) return { skip: true, reason: `low_fit:${job.fit.score}` };
  return { skip: false };
}

/** Short lines about the fit, for the console. */
function fitLines(fit, indent = '   ') {
  if (!fit) return [];
  const k = fit.keywords || {};
  const out = [`${indent}Afinidad: ${fit.score}/100 (${fit.parts.map((p) => `${p.label.toLowerCase()} ${p.points}/${p.max}`).join(', ')})`];
  if (k.reworded && k.reworded.length) out.push(`${indent}En tu CV con otras palabras: ${k.reworded.slice(0, 5).map((r) => `"${r.term}" (tu CV: ${r.cv})`).join('; ')}`);
  if (k.missing && k.missing.length) out.push(`${indent}No aparecen en tu CV: ${k.missing.slice(0, 8).join(', ')}`);
  if (k.no_cv) out.push(`${indent}Cargá el texto de tu CV en Configuración para ver qué palabras clave te faltan.`);
  return out;
}
/** Fit and an excerpt of the description, saved with an application or a job for the user's review. */
function fitRecord(job) {
  const f = fitLib.summary(job.fit);
  return f ? { ...f, description: String(job.description || '').slice(0, 8000) } : null;
}

// --- Recording (no shell: page text such as company or role never reaches a command line parser) ---
const TARGETS_CLI = require('path').join(__dirname, 'targets.js');
function runTargets(args) {
  const r = spawnSync(process.execPath, [TARGETS_CLI, ...args], { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) dbg(`[record-error ${(r.stderr || '').trim().slice(0, 160)}] `);
  return r.status === 0;
}
function prepareCv(job, userData) {
  const want = cvChoice.chooseCv({ title: job.role, description: job.description, location: job.location }, cvSettings(userData));
  const conf = cvChoice.configured(cvSettings(userData));
  const others = [conf.es, conf.en, ...conf.rules].filter(Boolean).map((c) => c.file).filter((f) => f && cvChoice.normName(f) !== cvChoice.normName(want.file || ''));
  CV = { want, others, seen: false, verified: false, uploaded: false, names: [] };
  return want;
}
function recordApplied(job, match) {
  const args = ['record', '--platform', 'linkedin', '--company', job.company || 'Unknown', '--role', job.role || 'LinkedIn job', '--match', match];
  if (job.url) args.push('--url', job.url);
  if (CV && CV.want && CV.want.file && CV.verified) args.push('--cv', CV.want.file);
  if (_knownJobs) _knownJobs.push({ id: 'nuevo', company: job.company, role: job.role, status: 'applied' });
  const fr = fitRecord(job);
  let file = null;
  if (fr) {
    file = require('path').join(require('os').tmpdir(), `js-fit-${process.pid}-${Date.now()}.json`);
    try { require('fs').writeFileSync(file, JSON.stringify(fr)); args.push('--fit-file', file); } catch { file = null; }
  }
  const ok = runTargets(args);
  if (file) { try { require('fs').unlinkSync(file); } catch { /* ignore */ } }
  return ok;
}
function recordNeedsAnswers(job, questions) {
  const os = require('os'); const fs = require('fs'); const path = require('path');
  const file = path.join(os.tmpdir(), `js-questions-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(questions));
  const args = ['questions', 'add', '--file', file, '--company', job.company || 'Unknown', '--role', job.role || 'LinkedIn job'];
  if (job.url) args.push('--url', job.url);
  const ok = runTargets(args);
  try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  return ok;
}

// Fill one question in the page with a stated answer (never a guess). Used for
// required fields the snapshot-based handlers did not see.
function domFill(question, type, value) {
  const res = evalJSON(`(function(){
    // Only inside the Easy Apply form: never the page behind it (LinkedIn's own search box, for one).
    const root = (function () {
    const c = [...document.querySelectorAll('dialog[open][data-sdui-screen*="EasyApply"], [data-sdui-screen*="EasyApply"], .jobs-easy-apply-modal, [role="dialog"], dialog[open]')]
      .filter((e) => e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    return c[0] || null;
  })();
    if (!root) return JSON.stringify({ ok: false });
    const norm = (t) => (t || '').replace(/\\s+/g, ' ').trim();
    const Q = ${JSON.stringify(String(question))}, V = ${JSON.stringify(String(value))}, T = ${JSON.stringify(String(type))};
    // The field's own label first (label[for], aria-label, aria-labelledby); a
    // wrapper's legend/label only when the field sits in a recognised form element.
    const labelOf = (el) => {
      const own = norm((el.labels && el.labels[0] && el.labels[0].textContent) || el.getAttribute('aria-label') || '');
      if (own) return own;
      const by = norm((el.getAttribute('aria-labelledby') || '').split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '));
      if (by) return by;
      const w = el.closest('fieldset, .fb-form-element, .jobs-easy-apply-form-section__element, [class*="form-element"]');
      return norm((w && w.querySelector('legend, label') && w.querySelector('legend, label').textContent) || '');
    };
    const groupLabel = (g) => norm((g.querySelector('legend') || {}).textContent || g.getAttribute('aria-label') ||
      (g.getAttribute('aria-labelledby') || '').split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '));
    const fire = (el) => { el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); };
    if (T === 'radio') {
      for (const g of root.querySelectorAll('fieldset, [role="radiogroup"]')) {
        const radios = [...g.querySelectorAll('input[type="radio"]')];
        if (!radios.length) continue;
        const legend = groupLabel(g);
        if (legend !== norm(Q)) continue;
        const r = radios.find((x) => norm(x.closest('label')?.textContent || document.querySelector('label[for="' + x.id + '"]')?.textContent || x.value) === norm(V));
        if (!r) return JSON.stringify({ ok: false });
        r.click(); fire(r);
        return JSON.stringify({ ok: r.checked });
      }
    } else if (T === 'select') {
      for (const s of root.querySelectorAll('select')) {
        if (labelOf(s) !== norm(Q)) continue;
        const o = [...s.options].find((x) => norm(x.text) === norm(V));
        if (!o) return JSON.stringify({ ok: false });
        const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        set.call(s, o.value); fire(s);
        return JSON.stringify({ ok: s.value === o.value });
      }
    } else {
      for (const i of root.querySelectorAll('input[type="text"], input[type="number"], input:not([type]), textarea')) {
        if (labelOf(i) !== norm(Q)) continue;
        const proto = i.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, V); fire(i);
        i.dispatchEvent(new Event('blur', {bubbles: true}));
        return JSON.stringify({ ok: i.value === V });
      }
    }
    return JSON.stringify({ ok: false });
  })()`, { session: SESSION });
  return !!(res && res.ok);
}

// Close the Easy Apply dialog without submitting and discard the draft (best effort).
function dismissApplication() {
  try {
    evalJSON(`(function(){
      const d = (function () {
      const c = [...document.querySelectorAll('dialog[open][data-sdui-screen*="EasyApply"], [data-sdui-screen*="EasyApply"], .jobs-easy-apply-modal, [role="dialog"], dialog[open]')]
        .filter((e) => e.offsetWidth || e.offsetHeight || e.getClientRects().length);
      return c[0] || null;
    })();
      const x = d && (d.querySelector('button[aria-label*="Dismiss"], button[aria-label*="Descartar"], button[aria-label*="Cerrar"], button[data-test-modal-close-btn]'));
      if (x) x.click();
      return JSON.stringify({ closed: !!x });
    })()`, { session: SESSION });
    sleep(1200);
    evalJSON(`(function(){
      const b = [...document.querySelectorAll('button')].find((el) => /^(discard|descartar)$/i.test(el.textContent.trim()));
      if (b) b.click();
      return JSON.stringify({ discarded: !!b });
    })()`, { session: SESSION });
    sleep(800);
  } catch (e) { /* the next navigation leaves the dialog anyway */ }
}

// --- CV for each job (lib/cv-choice.js decides; this part acts in the dialog) ---
// The CV is chosen among those saved in LinkedIn by file name. If it is not there,
// it is uploaded from the PDF on this computer. If neither works, or if the review
// step shows a different CV, the application is not sent.
const cvChoice = require('../lib/cv-choice');
const fsCv = require('fs');
let CV = null; // { want: {file, path, lang, reason}, seen, verified, uploaded, names }

function cvSettings(userData) {
  const p = (userData && userData.profile) || {};
  return { cv_path: p.cv_path, cv_path_en: p.cv_path_en, cv_rules: p.cv_rules };
}
function cvLabel(want) {
  if (!want || !want.file) return 'el que LinkedIn tenga marcado';
  return `${want.file}${want.lang ? ` (${cvChoice.LANG_NAME[want.lang]})` : ''}`;
}

// Page-side helpers, shared by every evaluation below. They rely on what the
// dialog shows (file names ending in .pdf/.doc/.docx), not on LinkedIn class names.
const CV_DOM = `
  function cvRoot() {
    return document.querySelector('dialog[open][data-sdui-screen*="EasyApply"]') || document.querySelector('[data-sdui-screen*="EasyApply"]')
      || document.querySelector('.jobs-easy-apply-modal') || document.querySelector('[role="dialog"]') || document.querySelector('dialog[open]');
  }
  function shown(e) { return !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length); }
  function isCvName(t) { return t.length > 4 && t.length < 200 && /\\.(pdf|docx?)$/i.test(t) && !/\\n/.test(t); }
  function nameNodes(r) {
    return [...r.querySelectorAll('h3, h4, h5, p, span, div, label, a, strong')].filter((e) => {
      if (!shown(e)) return false;
      const t = (e.textContent || '').trim();
      return isCvName(t) && ![...e.children].some((ch) => isCvName((ch.textContent || '').trim()));
    });
  }
  function cvCards() {
    const r = cvRoot(); if (!r) return { root: false, cards: [] };
    const nodes = nameNodes(r);
    const count = (el) => nodes.filter((n) => el.contains(n)).length;
    const cards = []; const used = new Set();
    for (const n of nodes) {
      let card = n;
      while (card.parentElement && card.parentElement !== r && count(card.parentElement) === 1) card = card.parentElement;
      if (used.has(card)) continue; used.add(card);
      const name = n.textContent.trim();
      const radio = card.querySelector('input[type="radio"]');
      const role = card.matches('[role="radio"], [aria-checked]') ? card : card.querySelector('[role="radio"], [aria-checked]');
      const rest = (card.textContent || '').replace(name, '');
      const cls = String(card.className || '') + ' ' + [...card.querySelectorAll('[class*="selected"]')].map((x) => x.className).join(' ');
      const hasState = !!(radio || role || card.hasAttribute('aria-pressed') || /selected/i.test(cls) || /\\b(seleccionad[oa]|selected)\\b/i.test(rest));
      const selected = !!((radio && radio.checked) || (role && role.getAttribute('aria-checked') === 'true') || card.getAttribute('aria-pressed') === 'true'
        || /(^|[\\s_-])(selected|is-selected)/i.test(cls) || /\\b(seleccionad[oa]|selected)\\b/i.test(rest));
      cards.push({ name, selected, hasState, el: card, radio, role });
    }
    return { root: true, cards };
  }
  function cvUploadInput() {
    const r = cvRoot(); if (!r) return null;
    const inputs = [...r.querySelectorAll('input[type="file"]')].filter((i) => shown(i) || (i.parentElement && shown(i.parentElement)));
    const text = (i) => [i.id, i.name, i.getAttribute('aria-label'), i.getAttribute('accept'), i.closest('label, div') && i.closest('label, div').textContent].join(' ').toLowerCase();
    return inputs.find((i) => /(resume|curr|\\bcv\\b)/.test(text(i)) && !/(cover|carta|presentaci)/.test(text(i)))
      || inputs.find((i) => !/(cover|carta|presentaci)/.test(text(i))) || null;
  }
  function cvIsStep() {
    const r = cvRoot(); if (!r) return false;
    return cvCards().cards.length > 0 || (!!cvUploadInput() && /(curr[ií]cul|resume|\\bcv\\b)/i.test(r.innerText || r.textContent || ''));
  }
`;

function cvState() {
  const r = evalJSON(`(function(){ ${CV_DOM}
    const c = cvCards();
    return JSON.stringify({ root: c.root, step: cvIsStep(), upload: !!cvUploadInput(),
      cards: c.cards.map((x) => ({ name: x.name, selected: x.selected, hasState: x.hasState })) });
  })()`, { session: SESSION });
  return r && typeof r === 'object' ? r : { root: false, step: false, upload: false, cards: [] };
}

function cvClick(file) {
  return evalJSON(`(function(){ ${CV_DOM}
    const want = ${JSON.stringify(cvChoice.normName(file))};
    const norm = (t) => t.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/\\.(pdf|docx?|odt|rtf)$/i, '').replace(/[^a-z0-9]+/g, '');
    const same = (a, b) => { if (a === b) return true; const [s, l] = a.length <= b.length ? [a, b] : [b, a]; return s.length >= 6 && l.includes(s); };
    const all = cvCards().cards;
    const exact = all.filter((c) => norm(c.name) === want);
    const others = ${JSON.stringify(((CV && CV.others) || []).map(cvChoice.normName))};
    const hit = exact.length ? exact : all.filter((c) => same(norm(c.name), want) && !others.includes(norm(c.name)));
    if (hit.length !== 1) return JSON.stringify({ clicked: false, matches: hit.length });
    const c = hit[0];
    const bad = /(descarg|download|elimin|borrar|delete|remove|quitar|vista previa|preview)/i;
    if (c.radio) {
      const lab = c.radio.id ? document.querySelector('label[for="' + CSS.escape(c.radio.id) + '"]') : null;
      (lab || c.radio).click();
      if (!c.radio.checked) c.radio.click();
    } else if (c.role) {
      c.role.click();
    } else {
      const b = [...c.el.querySelectorAll('button')].find((x) => /(seleccion|select|elegir|choose|usar|use)/i.test((x.getAttribute('aria-label') || '') + ' ' + x.textContent) && !bad.test((x.getAttribute('aria-label') || '') + ' ' + x.textContent));
      (b || c.el).click();
    }
    return JSON.stringify({ clicked: true });
  })()`, { session: SESSION }) || { clicked: false };
}

function cvShowMore() {
  const r = evalJSON(`(function(){ ${CV_DOM}
    const root = cvRoot(); if (!root) return JSON.stringify({ clicked: false });
    const b = [...root.querySelectorAll('button, a[role="button"]')].find((x) => {
      const t = ((x.getAttribute('aria-label') || '') + ' ' + x.textContent).replace(/\\s+/g, ' ');
      return /(mostrar|ver|show|see)/i.test(t) && /(m[aá]s|more)/i.test(t) && /(curr[ií]cul|resume|\\bcv)/i.test(t);
    });
    if (b) { b.click(); return JSON.stringify({ clicked: true }); }
    return JSON.stringify({ clicked: false });
  })()`, { session: SESSION });
  return !!(r && r.clicked);
}

function cvUpload(file) {
  const ok = evalJSON(`(function(){ ${CV_DOM}
    document.querySelectorAll('[data-js-cv-upload]').forEach((e) => e.removeAttribute('data-js-cv-upload'));
    const i = cvUploadInput(); if (!i) return JSON.stringify({ marked: false });
    i.setAttribute('data-js-cv-upload', '1'); return JSON.stringify({ marked: true });
  })()`, { session: SESSION });
  if (!ok || !ok.marked) return false;
  cliArgs(['upload', '[data-js-cv-upload="1"]', file], 60000);
  sleep(5000);
  return true;
}

// Exact name first: "CV.pdf" must not also pick "CV EN.pdf".
// A similar name never counts when it is exactly another of the user's CVs.
function cvFind(cards, file) {
  const n = cvChoice.normName;
  const exact = cards.filter((c) => n(c.name) === n(file));
  if (exact.length) return exact;
  const others = ((CV && CV.others) || []).map(n);
  return cards.filter((c) => cvChoice.sameCv(c.name, file) && !others.includes(n(c.name)));
}

/**
 * Called on every step of the dialog. Returns null to go on, or
 * { stop: message } when the application must not be sent.
 */
function cvStep(isReview) {
  if (!CV || !CV.want || !CV.want.file) return null;
  const want = CV.want;
  let st = cvState();
  if (!st.root) return null;

  if (isReview) {
    // The review step lists the CV that will be sent: it must be the chosen one.
    const names = st.cards.map((c) => c.name);
    if (names.length) {
      if (cvFind(st.cards, want.file).length) { CV.verified = true; return null; }
      return { stop: `en la revisión figura otro CV (${names.join(', ')}) en lugar de ${want.file}` };
    }
    if (CV.seen && !CV.verified) return { stop: `no pude confirmar que el CV elegido (${want.file}) haya quedado seleccionado` };
    return null;
  }

  if (!st.step) return null;
  CV.seen = true;
  CV.names = st.cards.map((c) => c.name);

  let hit = cvFind(st.cards, want.file);
  for (let i = 0; i < 2 && hit.length === 0 && cvShowMore(); i++) {
    sleep(1500);
    st = cvState();
    CV.names = st.cards.map((c) => c.name);
    hit = cvFind(st.cards, want.file);
  }
  if (hit.length === 0 && !CV.uploaded && want.path) {
    if (!fsCv.existsSync(want.path)) return { stop: `LinkedIn no tiene guardado ${want.file} y no encontré el archivo en ${want.path}` };
    if (!st.upload) return { stop: `LinkedIn no tiene guardado ${want.file} y no encontré dónde subirlo` };
    dbg(`[cv-upload ${want.file}] `);
    CV.uploaded = cvUpload(want.path);
    st = cvState();
    CV.names = st.cards.map((c) => c.name);
    hit = cvFind(st.cards, want.file);
  }
  if (hit.length === 0) {
    const seen = CV.names.length ? CV.names.join(', ') : 'ninguno';
    return { stop: `no encontré el CV ${want.file} entre los guardados en LinkedIn (vi: ${seen})${want.path ? '' : ' y no hay ruta para subirlo'}` };
  }
  if (hit.length > 1) return { stop: `hay más de un CV que coincide con ${want.file} (${hit.map((h) => h.name).join(', ')})` };
  if (!hit[0].selected) {
    cvClick(hit[0].name);
    sleep(1200);
    st = cvState();
    hit = cvFind(st.cards, want.file);
  }
  if (hit.length === 1 && hit[0].selected) { CV.verified = true; dbg(`[cv-ok ${hit[0].name}] `); return null; }
  // Selected state not visible in this layout: the review step must confirm it.
  const otherSelected = st.cards.find((c) => c.selected && !cvChoice.sameCv(c.name, want.file));
  if (otherSelected) return { stop: `no pude cambiar el CV: sigue marcado ${otherSelected.name}` };
  dbg('[cv-unverified] ');
  return null;
}

function applyToJob(jobRef, userData) {
  UNANSWERED = [];
  // Click Easy Apply button - try eval first (more reliable), then ref-based click
  const evalResult = evalJSON(`(function(){
    // Try multiple selectors for the Easy Apply button
    const btn = document.querySelector('a[href*="openSDUIApplyFlow"]') ||
                document.querySelector('.jobs-apply-button') ||
                document.querySelector('.job-card-container__easy-apply');
    if (btn) { btn.click(); return JSON.stringify({clicked: true}); }
    return JSON.stringify({clicked: false});
  })()`, { session: SESSION });
  if (!evalResult || !evalResult.clicked) {
    // Fallback: ref-based click
    click(jobRef);
  }
  sleep(5000);

  let steps = 0;
  const maxSteps = 15;

  while (steps < maxSteps) {
    steps++;
    const snap = snapshot();

    // Debug: log what we see in each step
    const hasDialog = snap.includes('dialog');
    const hasProgress = snap.match(/Valor actual: (\d+)/);
    const hasNext = snap.includes('Ir al siguiente paso') || snap.includes('Continue to next step');
    const hasReview = snap.includes('Revisar tu solicitud') || snap.includes('Review your application');
    const hasSubmit = snap.includes('Enviar solicitud') || snap.includes('Submit application');
    const hasRadio = snap.includes('- group ');
    const hasText = snap.includes('textbox ');
    const hasCombo = snap.includes('combobox ');
    // Extract field labels for debugging
    const textLabels = [...snap.matchAll(/- textbox "(.+?)(?:\*)?"(?: \[ref=)?/g)].map(m => m[1].trim()).slice(0, 5);
    const comboLabels = [...snap.matchAll(/- combobox "(.+?)(?:\*)?" /g)].map(m => m[1].trim()).slice(0, 5);
    dbg(`\n[step ${steps} prog=${hasProgress?.[1]||'-'} next=${hasNext} review=${hasReview} submit=${hasSubmit}] `);
    if (textLabels.length) dbg(`texts=[${textLabels.join('|')}] `);
    if (comboLabels.length) dbg(`combos=[${comboLabels.join('|')}] `);

    // Check if submitted (English or Spanish)
    if (snap.includes('application was sent to') || snap.includes('Solicitud enviada') || snap.includes('solicitud fue enviada') || snap.includes('se ha enviado tu solicitud') || snap.includes('tu solicitud se ha enviado')) {
      const companyMatch = snap.match(/application was sent to (.+?)!/) || snap.match(/solicitud (?:fue enviada|se ha enviado|enviada) a (.+?)[!.]/i);
      return { status: 'applied', company: companyMatch ? companyMatch[1] : 'Unknown' };
    }

    // Warning signs (captcha, verification, restriction, daily limit): stop and pause (lib/safety.js).
    // The open dialog is read on the first step and whenever the form shows no way forward.
    const sign = (steps === 1 || (!hasNext && !hasReview && !hasSubmit)) ? warningSign(snap) : signInSnapshot(snap);
    if (sign) return { status: 'warning', sign, error: (safety.REASONS[sign] || { text: sign }).text };

    // CV for this job: choose it on the resume step (does nothing on other steps)
    if (!/button "(?:Submit application|Enviar solicitud|Presentar solicitud)"/.test(snap)) {
      const cvr = cvStep(false);
      if (cvr && cvr.stop) { dismissApplication(); return { status: 'cv_problem', error: cvr.stop }; }
    }

    // Fill required text fields
    // Regex captures values both with quotes ("value") and without quotes (value)
    const textFields = snap.matchAll(/- textbox "(.+?)(\*)?"(?: \[ref=([a-z][0-9a-z]+)\])?(?:: (?:"([^"]+)"|([^\n]+)))?/g);
    for (const field of textFields) {
      const [, label, required, ref, existingValueQuoted, existingValueUnquoted] = field;
      const existingValue = existingValueQuoted || existingValueUnquoted;
      if (existingValue) continue; // skip if already filled (fields without ref still get eval-filled below)

      const labelLower = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      let value = null;
      const resT = A.resolve(label, null, CTX);
      if (resT.kind === 'unknown') { noteUnanswered(label, 'text'); continue; }
      if (resT.kind === 'answer') value = resT.value;
      else if (/^(date|fecha|today'?s date|date of application|signature date)$/i.test(labelLower.trim().replace(/\*+$/, ''))) value = new Date().toLocaleDateString('en-US');
      // Start/availability date fields expect a date, not the notice_period number.
      // 'immediate' availability maps to today's date.
      else if ((labelLower.includes('start') || labelLower.includes('available') || labelLower.includes('earliest') || labelLower.includes('join')) && labelLower.includes('date')) value = new Date().toLocaleDateString('en-US');
      else if (labelLower.includes('first name') || labelLower.includes('nombre')) value = ANSWERS.first_name;
      else if (labelLower.includes('last name') || labelLower.includes('apellido')) value = ANSWERS.last_name;
      else if (labelLower.includes('python')) value = ANSWERS.python_experience;
      else if (labelLower.includes('javascript') || labelLower.includes('java script')) value = ANSWERS.javascript_experience;
      else if (labelLower.includes('typescript') || labelLower.includes('type script')) value = ANSWERS.typescript_experience;
      else if (labelLower.includes('react')) value = ANSWERS.react_experience;
      else if (labelLower.includes('next.js') || labelLower.includes('nextjs') || labelLower.includes('next js')) value = ANSWERS.nextjs_experience || ANSWERS.react_experience;
      else if (labelLower.includes('node') || labelLower.includes('nodejs') || labelLower.includes('node.js')) value = ANSWERS.nodejs_experience;
      else if (labelLower.includes('software engineering') || labelLower.includes('software development')) value = ANSWERS.years_of_experience;
      else if (labelLower.includes('artificial intelligence') || labelLower.includes('ai)') || labelLower.includes('generative ai') || labelLower.includes('genai') || labelLower.includes('gen ai')) value = ANSWERS.ai_experience || ANSWERS.genai_tools;
      else if (labelLower.includes('openai')) value = ANSWERS.openai_experience;
      else if (labelLower === 'state' || labelLower === 'estado' || labelLower.includes('state/province') || labelLower === 'province' || labelLower === 'provincia') value = userData?.personal?.state || ANSWERS.state || ANSWERS.location;
      else if (labelLower.includes('location') || labelLower.includes('country') || labelLower.includes('city') || labelLower.includes('ciudad') || labelLower.includes('ubicaci') || labelLower.includes('localidad')) value = ANSWERS.location;
      else if (labelLower.includes('phone') || labelLower.includes('mobile') || labelLower.includes('celular') || labelLower.includes('cellulare') || labelLower.includes('telefon') || labelLower.includes('teléfono')) {
        // LinkedIn splits phone: country code goes in a separate combobox, this field wants the local number
        const rawPhone = (userData?.personal?.phone || ANSWERS.phone || '').replace(/\D/g, '');
        value = rawPhone.startsWith('549') ? rawPhone.substring(3) : rawPhone.replace(/^54/, '');
      }
      else if (labelLower.includes('school') || labelLower.includes('escuela') || labelLower.includes('university') || labelLower.includes('universidad')) value = ANSWERS.school_name;
      else if (labelLower.includes('degree') || labelLower.includes('título') || labelLower.includes('titulo')) value = ANSWERS.degree;
      else if (labelLower.includes('field of study') || labelLower.includes('major') || labelLower.includes('carrera')) value = ANSWERS.field_of_study;
      else if (labelLower.includes('company')) value = ANSWERS.current_company;
      else if (labelLower.includes('linkedin')) value = ANSWERS.linkedin_url;
      else if (labelLower.includes('github')) value = ANSWERS.github_url;
      else if (labelLower.includes('preferred name') || labelLower.includes('nombre preferido')) value = ANSWERS.first_name;
      else if (labelLower.includes('headline') || labelLower.includes('título profesional') || labelLower.includes('titular')) value = ANSWERS.headline || userData?.profile?.headline;
      else if (labelLower.includes('summary') || labelLower.includes('resumen')) value = ANSWERS.summary || userData?.profile?.summary;
      else if (labelLower.includes('compens') || labelLower.includes('remuneraci') || labelLower.includes('remuneraç') || labelLower.includes('ctc') || labelLower.includes('lpa') || labelLower.includes('maas') || labelLower.includes('beklent') || labelLower.includes('ucret') || labelLower.includes('pay') || labelLower.includes('sueldo') || labelLower.includes('expectativ') || labelLower.includes('expectation') || (labelLower.includes('rate') && labelLower.includes('usd')) || labelLower.includes('hourly rate') || labelLower.includes('preferred rate') || labelLower.includes('asp salarial') || labelLower.includes('aspiración') || (labelLower.includes('expected') && labelLower.includes('salary'))) value = ANSWERS.salary_usd;
      else if (labelLower.includes('1 to 10') || labelLower.includes('del 1 al 10') || labelLower.includes('from 1 to 10')) value = '7';
      else if (labelLower.includes('salary') && labelLower.includes('cop')) value = ANSWERS.salary_cop || ANSWERS.salary_usd;
      else if (labelLower.includes('usd') && (labelLower.includes('salary') || labelLower.includes('salarial') || labelLower.includes('salario'))) value = ANSWERS.salary_usd;
      else if (labelLower.includes('salary') || labelLower.includes('salarial') || labelLower.includes('salario') || labelLower.includes('remuneraci') || labelLower.includes('remuneraç')) value = ANSWERS.salary_usd;
      else if (labelLower.includes('notice') || labelLower.includes('availability') || labelLower.includes('start')) {
        value = labelLower.includes('dd/mm') ? ANSWERS.availability_date : ANSWERS.notice_period;
      }
      else if (labelLower.includes('english') && labelLower.includes('comfort')) {
        value = ANSWERS.english_comfort;
      }
      else if (labelLower.includes('aws')) {
        value = ANSWERS.aws_experience;
      }
      else if (labelLower.includes('genai') || labelLower.includes('ai assisted') || labelLower.includes('development tools')) {
        value = ANSWERS.genai_tools;
      }
      // Generic fallback: "How many years of work experience do you have with X?" (EN/ES/PT)
      else if (labelLower.includes('how many years') || labelLower.includes('quantos anos') || labelLower.includes('cuantos anos') || labelLower.includes('cuántos años') || labelLower.includes('kac yil') || labelLower.includes('kaç yıl') || labelLower.includes('deneyim')) {
        value = ANSWERS.years_of_experience;
      }
      else if ((labelLower.includes('years') || labelLower.includes('anos') || labelLower.includes('años') || labelLower.includes('tiempo')) && (labelLower.includes('experience') || labelLower.includes('experiencia') || labelLower.includes('experiência') || labelLower.includes('working') || labelLower.includes('trabajando') || labelLower.includes('estud') || labelLower.includes('tienes') || labelLower.includes('tiene') || labelLower.includes('tens') || labelLower.includes('têm'))) {
        value = ANSWERS.years_of_experience;
      }

      if (value) {
        dbg(`FILL val="${value}" `);
        const isLocationText = labelLower.includes('location') || labelLower.includes('city') || labelLower.includes('ciudad') || labelLower.includes('ubicaci') || labelLower.includes('school') || labelLower.includes('escuela') || labelLower.includes('universidad') || labelLower.includes('university') || labelLower.includes('company');
        if (isLocationText) {
          // Typeahead field: focus the real input and type keystrokes (fill() doesn't trigger suggestions)
          if (ref) click(ref);
          else evalJSON(`(function(){ const ins=[...document.querySelectorAll('input[type="text"], input:not([type])')]; const lp=${JSON.stringify(label.substring(0,40).toLowerCase())}; const inp=ins.find(i=>{const al=(i.getAttribute('aria-label')||'').toLowerCase(); return al.includes(lp)||lp.includes(al)&&al.length>5;}); if(inp){inp.focus();inp.click();} return inp?'focused':'nf'; })()`, { session: SESSION });
          sleep(400);
          evalJSON(`(function(){ const ae=document.activeElement; if(ae&&ae.value!==undefined){ae.value='';ae.dispatchEvent(new Event('input',{bubbles:true}));} return 'ok'; })()`, { session: SESSION });
          cli(`type "${String(value).replace(/"/g, '\\"')}"`);
          sleep(2500);
          const dbg = evalJSON(`(function(){ const ae=document.activeElement; const lb=document.querySelectorAll('[role="option"], [role="listbox"] li, li[role="option"], [class*="typeahead"] [class*="selectable"], [class*="typeahead"] li, ul[class*="suggestion"] li, [data-test-single-typeahead-entity-form] li'); return JSON.stringify({tag:ae&&ae.tagName, val:ae&&ae.value, opts:lb.length, opt0:lb[0]&&lb[0].innerText}); })()`, { session: SESSION });
          dbg(`[dbgL ${JSON.stringify(dbg)}] `);
          // If suggestions rendered, click the first one; else ArrowDown+Enter
          const clickedSug = evalJSON(`(function(){
            const sels = '[role="option"], [role="listbox"] li, li[role="option"], [class*="typeahead"] [class*="selectable"], [class*="typeahead"] li, ul[class*="suggestion"] li';
            const first = document.querySelector(sels);
            if (!first) return JSON.stringify({clicked:false});
            first.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, view:window}));
            first.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, view:window}));
            first.dispatchEvent(new MouseEvent('click', {bubbles:true, view:window}));
            return JSON.stringify({clicked:true, text:first.innerText&&first.innerText.substring(0,60)});
          })()`, { session: SESSION });
          dbg(`[sug ${JSON.stringify(clickedSug)}] `);
          sleep(800);
        } else if (ref) {
          // Prefer Playwright fill (real focus + input events that commit React state)
          fill(ref, value);
        }
        // Also run eval setter as backup for non-React-controlled fields
        const fillResult = evalJSON(`(function(){
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input[type="email"], input:not([type]), textarea');
          const labelPart = ${JSON.stringify(label.substring(0, 40))};
          for (const inp of inputs) {
            const ariaLabel = (inp.getAttribute('aria-label') || (inp.labels && inp.labels[0] && inp.labels[0].textContent) || '').replace(/\\s+/g, ' ').trim();
            const placeholder = inp.getAttribute('placeholder') || '';
            if ((ariaLabel && (ariaLabel.includes(labelPart) || labelPart.includes(ariaLabel))) || (placeholder && placeholder.includes(labelPart))) {
              nativeSetter.call(inp, ${JSON.stringify(value)});
              inp.dispatchEvent(new Event('input', {bubbles: true}));
              inp.dispatchEvent(new Event('change', {bubbles: true}));
              inp.dispatchEvent(new Event('blur', {bubbles: true}));
              return JSON.stringify({filled: true});
            }
          }
          return JSON.stringify({filled: false});
        })()`, { session: SESSION });
        if (!fillResult || !fillResult.filled) {
          // Field had no snapshot ref and eval found no matching input
          dbg('[nofill] ');
        }
        // Location-like textboxes are often autocompletes: pick the first suggestion
        if (labelLower.includes('location') || labelLower.includes('city') || labelLower.includes('ciudad') || labelLower.includes('ubicaci')) {
          sleep(1500);
          press('ArrowDown');
          sleep(400);
          press('Enter');
          sleep(800);
        }
        sleep(1500);
      } else {
        dbg(`SKIP label="${label.substring(0,40)}" `);
      }
    }

    // Select required comboboxes (only if no selection is made)
    const comboMatches = [...snap.matchAll(/- combobox "(.+?)(\*)?" \[ref=([a-z][0-9a-z]+)\][^\n]*:?\n((?:(?!\s*- combobox|\s*- textbox|\s*- group)[^\n]*\n){0,20})/g)];
    for (const combo of comboMatches) {
      const [, label, required, ref, optionsBlock] = combo;
      // Skip non-form comboboxes (LinkedIn UI elements)
      if (label.toLowerCase().includes('seleccionar idioma') || label.toLowerCase().includes('select language')) continue;
      // Skip if a real option is selected (not "Select an option")
      // For autocomplete fields (location/city), a highlighted suggestion can show as [selected]
      // without being a committed selection, so always process them
      const labelLower = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const isAutocomplete = labelLower.includes('location') || labelLower.includes('city');
      const placeholderRe = /option "(|Select an option|Selecc[^"]*|Selec[^"]*|Elige[^"]*|Choose[^"]*|Bitte[^"]*|Sélectionner[^"]*)"[^\n]*\[selected\]/i;
      const hasRealSelection = optionsBlock.includes('[selected]') && !placeholderRe.test(optionsBlock);
      const isCountryCode = !labelLower.includes('postal') && !labelLower.includes('zip') && (labelLower.includes('phone country') || labelLower.includes('country code') || labelLower.includes('prefisso') || labelLower.includes('código') || labelLower.includes('codigo') || labelLower.includes('paese') || labelLower.includes('país') || labelLower.includes('pais'));
      // Country code: never trust the preselection (LinkedIn defaults to Andorra etc.) — never skip, always enforce Argentina below
      const hasRealSelectionEff = isCountryCode ? false : hasRealSelection;
      let forcedValue = null;
      if (hasRealSelectionEff && !isAutocomplete) {
        // A previously committed demographic affirmative (e.g. "Yes, I have a
        // disability", "protected veteran") must be corrected to the decline option.
        const selOpt = optionsBlock.match(/option "([^"]+)"[^\n]*\[selected\]/)?.[1];
        const declineOpt = optionsBlock.match(/option "([^"]*(do not wish|don't wish|i do not have|don't have|no disability|not a veteran|not disabled|decline|prefer not|prefiero no|no deseo|ninguna)[^"]*)"/i)?.[1];
        if (selOpt && declineOpt && /yes, i have|i have a disability|protected veteran|american indian|alaska native/i.test(selOpt)) {
          dbg(`[combo-fix "${selOpt.substring(0,40)}" -> "${declineOpt.substring(0,40)}"] `);
          forcedValue = declineOpt;
        } else {
          dbg(`[combo-skip "${label.substring(0,30)}" sel="${(selOpt||'').substring(0,40)}"] `);
          continue;
        }
      }

      let optionValue = null;
      const comboOpts = [...optionsBlock.matchAll(/option "([^"]+)"/g)].map((m) => m[1])
        .filter((o) => !/^(select an option|selecc|selec|elige|choose|bitte|sélectionner)/i.test(o.trim()));
      const resC = forcedValue ? { kind: 'legacy' } : A.resolve(label, comboOpts, CTX);
      if (resC.kind === 'unknown') { noteUnanswered(label, 'select', comboOpts); continue; }

      if (resC.kind === 'answer') {
        optionValue = resC.value;
      }
      else if (forcedValue) {
        optionValue = forcedValue;
      }
      else if (labelLower.includes('english') || labelLower.includes('inglés') || labelLower.includes('ingles')) {
        const level = ANSWERS.english_level || 'Professional';
        const optMatch = optionsBlock.match(new RegExp(`option "(${level}|Professional|Advanced|Proficient|Native or bilingual|Competencia profesional|Intermedio|Intermedio-alto|Bilingüe|Bilingue)[^"]*"`));
        optionValue = optMatch ? optMatch[1] : level;
      }
      else if (labelLower.includes('spanish')) {
        const level = ANSWERS.spanish_level || 'Proficient';
        const optMatch = optionsBlock.match(new RegExp(`option "(${level}|Proficient|Advanced|Native or bilingual|Profesional)"`));
        optionValue = optMatch ? optMatch[1] : level;
      }
      else if (labelLower.includes('email')) {
        const email = ANSWERS.email || userData?.profile?.email || '';
        if (email) {
          const optMatch = optionsBlock.match(new RegExp(`option "(${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})"`));
          optionValue = optMatch ? optMatch[1] : email;
        }
      }
      else if (labelLower.includes('phone country') || labelLower.includes('country code') || labelLower.includes('prefisso') || labelLower.includes('código') || labelLower.includes('codigo') || labelLower.includes('paese') || labelLower.includes('país') || labelLower.includes('pais')) {
        const optMatch = optionsBlock.match(/option "([^"]*Argentina[^"]*)"/) || optionsBlock.match(/option "([^"]*\+54[^"]*)"/);
        optionValue = optMatch ? optMatch[1] : 'Argentina (+54)';
      }
      else if (labelLower.includes('location') || labelLower.includes('city')) {
        const city = userData?.personal?.city || userData?.profile?.location || '';
        if (city) {
          const optMatch = optionsBlock.match(new RegExp(`option "([^"]*${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"`));
          optionValue = optMatch ? optMatch[1] : null;
        }
      }
      else if (labelLower.includes('built') && labelLower.includes('ai') || labelLower.includes('rag')) {
        const optMatch = optionsBlock.match(/option "(Yes)"/);
        optionValue = optMatch ? optMatch[1] : 'Yes';
      }
      else if (labelLower.includes('consent') || labelLower.includes('privacy') || labelLower.includes('agree')) {
        const optMatch = optionsBlock.match(/option "(I have read[^"]+)"/);
        if (optMatch) optionValue = optMatch[1];
      }
      else if (labelLower.includes('seniority')) {
        const level = ANSWERS.seniority || 'Senior';
        const optMatch = optionsBlock.match(new RegExp(`option "(${level})"`));
        optionValue = optMatch ? optMatch[1] : level;
      }
      else if ((labelLower.match(/mes de (from|inicio|desde)/) || (labelLower.match(/\bfrom\b|\bstart\b/) && labelLower.match(/\bmonth\b|\bmes\b/)) || labelLower === 'from') && optionsBlock.match(/January|February|Enero|Febrero|Jan|Feb/)) {
        optionValue = ANSWERS.edu_from_month || null;
      }
      else if ((labelLower.match(/año de (from|inicio|desde)/) || (labelLower.match(/\bfrom\b|\bstart\b/) && labelLower.match(/\byear\b|\baño\b/))) && optionsBlock.match(/\b(19|20)\d{2}\b/)) {
        optionValue = ANSWERS.edu_from_year || null;
      }
      else if ((labelLower.match(/mes de (to|hasta|fin)/) || (labelLower.match(/\bto\b|\bend\b|\bhasta\b/) && labelLower.match(/\bmonth\b|\bmes\b/))) && optionsBlock.match(/January|February|Enero|Febrero|Jan|Feb/)) {
        optionValue = ANSWERS.edu_to_month || null;
      }
      else if ((labelLower.match(/año de (to|hasta|fin)/) || (labelLower.match(/\bto\b|\bend\b|\bhasta\b/) && labelLower.match(/\byear\b|\baño\b/))) && optionsBlock.match(/\b(19|20)\d{2}\b/)) {
        optionValue = ANSWERS.edu_to_year || null;
      }
      // Education degree combo: map to the user's real degree (never invent a higher one)
      else if (labelLower.includes('degree') || labelLower.includes('titulo') || labelLower.includes('título') || labelLower.includes('education level') || labelLower.includes('nivel de estudios') || labelLower.includes('nivel educativo')) {
        const deg = (ANSWERS.degree || '').toLowerCase();
        let m = null;
        if (deg.match(/bachiller|secund|high school|secondary/)) {
          m = optionsBlock.match(/option "([^"]*(bachiller|secundar|high school|secondary|diploma)[^"]*)"/i);
        } else if (deg.match(/terciar|technical|técnic|tecnic|associate/)) {
          m = optionsBlock.match(/option "([^"]*(terciar|technical|técnic|tecnic|associate|diploma)[^"]*)"/i);
        } else if (deg.match(/universit|bachelor|licenciat|grado|college/)) {
          m = optionsBlock.match(/option "([^"]*(universit|bachelor|licenciat|grado|college|degree)[^"]*)"/i);
        }
        optionValue = m ? m[1] : null;
      }
      // Field of study combo: pick the user's real field if listed
      else if (labelLower.includes('field of study') || labelLower.includes('area de estudio') || labelLower.includes('área de estudio') || labelLower.includes('disciplina')) {
        const fos = (ANSWERS.field_of_study || '').toLowerCase();
        const m = fos ? optionsBlock.match(new RegExp(`option "([^"]*${fos.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"`, 'i')) : null;
        optionValue = m ? m[1] : null;
      }
      // Country / country of residence combos
      else if (labelLower === 'country' || labelLower === 'pais' || labelLower === 'país' || labelLower.includes('country of residence') || labelLower.includes('pais de residencia') || labelLower.includes('país de residencia')) {
        const country = userData?.personal?.country || 'Argentina';
        const m = optionsBlock.match(new RegExp(`option "([^"]*${country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"`, 'i'));
        optionValue = m ? m[1] : null;
      }
      // Demographic/diversity combos (US EEO-style, voluntary): prefer decline /
      // neutral options. User answers live in form_answers.diversity_* if set.
      else if (labelLower.includes('gender') || labelLower.includes('genero') || labelLower.includes('género') || labelLower.includes('race') || labelLower.includes('ethnic') || labelLower.includes('veteran') || labelLower.includes('disability') || labelLower.includes('lgbtq') || labelLower.includes('sexual orientation')) {
        let m = null;
        if (labelLower.includes('gender') || labelLower.includes('genero') || labelLower.includes('género')) m = ANSWERS.diversity_gender && optionsBlock.match(new RegExp(`option "([^"]*${ANSWERS.diversity_gender}[^"]*)"`, 'i'));
        if (labelLower.includes('veteran')) m = m || optionsBlock.match(/option "([^"]*(not a veteran|no soy veterano)[^"]*)"/i);
        optionValue = m ? m[1] : (optionsBlock.match(/option "([^"]*(do not wish|don't wish|decline|prefiero no|no deseo|i do not wish)[^"]*)"/i)?.[1] || null);
      }
      // Generic Yes/No combobox questions (EN/ES/PT)
      else if (optionsBlock.match(/option "(Yes|No|Sí|Si|Sim|Não)"/)) {
        // Answer Yes for most questions, No for sponsorship/visa/authorization
        const yesWord = optionsBlock.match(/option "(Yes|Sí|Si|Sim)"/)?.[1] || 'Yes';
        const noWord = optionsBlock.match(/option "(No|Não)"/)?.[1] || 'No';
        let answer = yesWord;
        if (labelLower.includes('sponsorship') || labelLower.includes('visa')) answer = noWord;
        if (labelLower.includes('authorized') && labelLower.includes('work')) answer = noWord;
        if (labelLower.includes('currently located in') || labelLower.includes('based in') || labelLower.includes('residing in') || labelLower.includes('located in') || labelLower.includes('ubicado') || labelLower.includes('resides')) answer = noWord;
        const optMatch = optionsBlock.match(new RegExp(`option "(${answer})"`));
        optionValue = optMatch ? optMatch[1] : answer;
      }

      if (optionValue) {
        dbg(`COMBO val="${optionValue}" `);
        // Use eval-based selection for React compatibility
        const selResult = evalJSON(`(function(){
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          const selects = document.querySelectorAll('select');
          const labelPart = ${JSON.stringify(label.substring(0, 40))};
          for (const sel of selects) {
            const ariaLabel = (sel.getAttribute('aria-label') || (sel.labels && sel.labels[0] && sel.labels[0].textContent) || '').replace(/\\s+/g, ' ').trim();
            if (ariaLabel && (ariaLabel.includes(labelPart) || labelPart.includes(ariaLabel))) {
              for (const opt of sel.options) {
                if (opt.text === ${JSON.stringify(optionValue)} || opt.text.trim() === ${JSON.stringify(optionValue)}) {
                  nativeSetter.call(sel, opt.value);
                  sel.dispatchEvent(new Event('change', {bubbles: true}));
                  sel.dispatchEvent(new Event('input', {bubbles: true}));
                  return JSON.stringify({selected: true, value: opt.value});
                }
              }
            }
          }
          return JSON.stringify({selected: false});
        })()`, { session: SESSION });
        if (!selResult || !selResult.selected) {
          // Fallback: ref-based selectOption
          selectOption(ref, optionValue);
        }
        sleep(1000);
      } else if (labelLower.includes('location') || labelLower.includes('city')) {
        // Autocomplete combobox: type and select from suggestions
        dbg(`COMBO_AUTO label="${label.substring(0,30)}" `);
        const city = userData?.personal?.city || userData?.profile?.location || ANSWERS.location || '';
        // Focus the inner input of the combobox (the ref is often a wrapper div)
        const focusRes = cli(`eval "(el) => { const i = el.tagName === 'INPUT' ? el : el.querySelector('input'); if (i) { i.focus(); i.click(); } return i ? i.tagName + ':' + (i.getAttribute('aria-label') || '') : 'none'; }" ${ref}`);
        dbg(`[focus ${String(focusRes).substring(0,60)}] `);
        sleep(500);
        // Type real keystrokes so LinkedIn's typeahead search fires
        cli(`type "${city.replace(/"/g, '\\"')}"`);
        sleep(2500);
        const dbg = evalJSON(`(function(){
          const ae = document.activeElement;
          const opts = document.querySelectorAll('[role="option"], [role="listitem"], li[class*="typeahead"]');
          return JSON.stringify({tag: ae && ae.tagName, val: ae && ae.value ? ae.value.substring(0,30) : '', opts: opts.length});
        })()`, { session: SESSION });
        dbg(`[dbg ${JSON.stringify(dbg)}] `);
        // Try to click the first suggestion (accent-insensitive match); dispatch pointer events because LinkedIn listens to mousedown
        const sugResult = evalJSON(`(function(){
          const norm = s => s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
          const cityN = norm(${JSON.stringify(city)});
          const options = document.querySelectorAll('[role="option"], [role="listitem"], li[class*="basic-typeahead"], [id*="typeahead"] li');
          const fire = (el) => {
            ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
              el.dispatchEvent(new MouseEvent(t, {bubbles:true, cancelable:true, view:window})));
          };
          for (const opt of options) {
            const text = opt.textContent.trim();
            if (text && norm(text).includes(cityN)) {
              fire(opt);
              return JSON.stringify({clicked: true, text: text.substring(0, 40)});
            }
          }
          if (options.length > 0) {
            fire(options[0]);
            return JSON.stringify({clicked: true, text: options[0].textContent.trim().substring(0, 40)});
          }
          return JSON.stringify({clicked: false});
        })()`, { session: SESSION });
        // If the suggestion list is still open (DOM click didn't commit), use keyboard selection
        const listOpen = evalJSON(`(function(){
          const lb = document.querySelector('[role="listbox"]:not([hidden]), [role="listbox"][aria-expanded="true"], ul[class*="typeahead"]');
          const anyInput = document.activeElement;
          const expanded = anyInput && anyInput.getAttribute && anyInput.getAttribute('aria-expanded') === 'true';
          return JSON.stringify({open: !!(lb || expanded)});
        })()`, { session: SESSION });
        if (!sugResult || !sugResult.clicked || (listOpen && listOpen.open)) {
          press('ArrowDown');
          sleep(500);
          press('Enter');
          sleep(1000);
        }
        // Extra fallback: Tab out to commit whatever was typed
        press('Tab');
        sleep(1000);
      } else {
        // For comboboxes with no matching handler, try eval-based selection.
        // Pick the best candidate from the visible options when available.
        dbg(`COMBO_EVAL label="${label.substring(0,30)}" `);
        const opts = [...optionsBlock.matchAll(/option "([^"]+)"/g)].map(m => m[1]);
        const nonPlaceholder = opts.filter(o => !/select|selecc|selec|elige|choose|bitte|sélectionner/i.test(o));
        let answer = 'Yes';
        if (labelLower.includes('sponsorship') || labelLower.includes('visa')) answer = 'No';
        if (labelLower.includes('authorized') && labelLower.includes('work')) answer = 'No';
        if (labelLower.includes('citizen') && labelLower.includes('us')) answer = 'No';
        if (labelLower.includes('manufacturing') || labelLower.includes('mes') || labelLower.includes('scada')) answer = 'No';
        if (labelLower.includes('based in') && (labelLower.includes('latin america') || labelLower.includes('latam'))) answer = 'Yes';
        if (labelLower.includes('remote') && labelLower.includes('year')) answer = 'Yes';
        if (labelLower.includes('hear about') || labelLower.includes('how did you hear') || labelLower.includes('cómo supiste') || labelLower.includes('como te enteraste')) {
          answer = opts.find(o => /linkedin/i.test(o)) || 'LinkedIn';
        }
        if (labelLower.includes('government official')) answer = 'No';
        if (labelLower.includes('privacy') || labelLower.includes('receipt') || labelLower.includes('acknowledge') || labelLower.includes('understand that') || labelLower.includes('confirm')) {
          answer = opts.find(o => /yes|i have read|i acknowledge|i understand|confirm/i.test(o)) || 'Yes';
        }
        if (labelLower.includes('use ai') || labelLower.includes('ai tools')) {
          answer = opts.find(o => /regularly|daily|frequent|everyday|productiv/i.test(o)) || (nonPlaceholder[0] || 'Yes');
        }
        // Demographic/medical option lists under generic labels ("Please check one of the
        // boxes below"): never pick an affirmative disability/veteran/declared answer.
        // Prefer explicit decline / negative options over inventing data (Gold Rule 5c).
        const decline = opts.find(o => /do not wish|don't wish|i do not have|don't have|no disability|not a veteran|not disabled|decline|prefer not|prefiero no|no deseo|ninguna/i.test(o));
        if (decline) answer = decline;
        // Strict answers: this branch may only pick an explicit decline option.
        // Anything else would be a guess, so the question goes to the user instead.
        if (!decline) { noteUnanswered(label, 'select', nonPlaceholder); continue; }
        // Long option lists (degree/field-of-study catalogs, industry lists) mean the
        // combo needs a real answer — never pick an arbitrary option from a big list.
        if (opts.length > 6 && !opts.includes(answer)) {
          const other = opts.find(o => /^(other|otro|otra)$/i.test(o.trim()));
          if (other) { answer = other; }
          else { dbg(`[combo-skip-long "${label.substring(0,30)}"] `); continue; }
        }
        // If no options visible in snapshot, try the computed answer; else prefer it if it exists in options
        if (opts.length && !opts.includes(answer)) {
          answer = nonPlaceholder[0] || answer;
        }
        // Final guard: if the picked option asserts a demographic/medical fact and no
        // decline option exists, leave the combo empty rather than fabricate.
        if (/disability|disabled|veteran|hispanic|latino|female|male|gender|genero|ethnic|etnia|raza/i.test(answer) && !decline) {
          dbg(`[combo-skip-risky "${answer.substring(0,40)}"] `);
          continue;
        }

        const selectResult = evalJSON(`(function(){
          const labelPart = ${JSON.stringify(label.replace(/"/g, '\\"').substring(0, 80))};
          const selects = document.querySelectorAll('select');
          for (const select of selects) {
            const al = select.getAttribute('aria-label') || '';
            if (!(al.includes(labelPart) || labelPart.includes(al) && al.length > 5)) continue;
            for (const opt of select.options) {
              if (opt.text.trim() === ${JSON.stringify(answer)}) {
                opt.selected = true;
                select.dispatchEvent(new Event('change', {bubbles: true}));
                return JSON.stringify({selected: true, value: opt.value});
              }
            }
            // Fallback: first non-placeholder option — only for short (yes/no-ish) lists;
            // never invent a pick from long catalogs (degree/field-of-study/industry).
            const nonPh = [...select.options].filter(o => !/select|selecc|selec|elige|choose/i.test(o.text));
            if (nonPh.length <= 6) {
              const opt = nonPh[0];
              if (opt) {
                opt.selected = true;
                select.dispatchEvent(new Event('change', {bubbles: true}));
                return JSON.stringify({selected: true, value: opt.value, fallback: opt.text});
              }
            }
          }
          return JSON.stringify({selected: false});
        })()`, { session: SESSION });
        if (!selectResult || !selectResult.selected) {
          try { selectOption(ref, answer); } catch(e) {}
        }
        sleep(1000);
      }
    }

    // Unlabeled From/To month+year comboboxes (education/experience editors render
    // them without aria-labels). Context comes from the nearest "From"/"To" text.
    const dateRes = evalJSON(`(function(){
      const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre','january','february','march','april','may','june','july','august','september','october','november','december'];
      const vals = {
        from_month: ${JSON.stringify(ANSWERS.edu_from_month || '')}, from_year: ${JSON.stringify(ANSWERS.edu_from_year || '')},
        to_month: ${JSON.stringify(ANSWERS.edu_to_month || '')}, to_year: ${JSON.stringify(ANSWERS.edu_to_year || '')},
      };
      const filled = [];
      document.querySelectorAll('select').forEach(sel => {
        if (sel.getAttribute('aria-label')) return;               // labeled combos handled above
        if (sel.selectedIndex > 0 && sel.value) return;           // already selected
        const optTexts = [...sel.options].map(o => o.text.trim().toLowerCase());
        const isMonth = optTexts.some(o => MONTHS.includes(o));
        const isYear = optTexts.filter(o => /^(19|20)\\d{2}$/.test(o)).length > 3;
        if (!isMonth && !isYear) return;
        // Walk up to find the From/To context of this select's group
        let ctx = null, el = sel;
        for (let i = 0; i < 8 && el; i++) {
          el = el.parentElement;
          if (!el) break;
          const t = (el.innerText || '').toLowerCase();
          if (/\\bfrom\\b|desde/.test(t) && t.length < 400) { ctx = 'from'; break; }
          if (/\\bto\\b|\\bhasta\\b|\\bend\\b/.test(t) && t.length < 400) { ctx = 'to'; break; }
        }
        if (!ctx) return;
        const want = vals[ctx + '_' + (isMonth ? 'month' : 'year')];
        if (!want) return;
        const opt = [...sel.options].find(o => o.text.trim().toLowerCase() === want.toLowerCase() || o.value === want);
        if (!opt) return;
        const ns = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        ns.call(sel, opt.value);
        sel.dispatchEvent(new Event('change', {bubbles: true}));
        sel.dispatchEvent(new Event('input', {bubbles: true}));
        filled.push(ctx + ':' + opt.text.trim());
      });
      return JSON.stringify(filled);
    })()`, { session: SESSION });
    if (dateRes && dateRes.length) dbg(`[dates ${JSON.stringify(dateRes)}] `);

    // Click required radio buttons (Yes/No groups)
    // Regex handles both English ("Required") and Spanish ("Obligatorio") required indicators
    const radioGroups = [...snap.matchAll(/- group "(.+?)" \[ref=([a-z][0-9a-z]+)\]:([\s\S]*?)(?=- group |- heading |- paragraph)/g)];
    for (const group of radioGroups) {
      const [, label, groupRef, blockContent] = group;
      const block = group[0];
      // Check if required: look for *, Required, or Obligatorio in label or block
      const isRequired = label.includes('*') || label.includes('Required') || label.includes('Obligatorio')
        || block.includes('Required') || block.includes('Obligatorio');
      if (!isRequired) continue;

      // Check if already has a checked radio
      if (block.includes('[checked]') || block.includes('[active]')) continue;

      const labelLower = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      // Strict answers: only the user's stated answer is clicked.
      const radioOpts = [...block.matchAll(/radio "([^"]+)"/g)].map((m) => m[1]);
      const resR = A.resolve(label, radioOpts, CTX);
      if (resR.kind !== 'answer') { noteUnanswered(label, 'radio', radioOpts); continue; }
      let targetLabel = resR.value;
      // Find the radio element ref for the target option
      // Try matching radio "Label" first, then generic ref: "Label"
      const radioRegex = new RegExp(`radio "${targetLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i');
      const radioMatch = block.match(radioRegex);
      if (radioMatch) {
        // Find the ref of the generic element containing this radio
        const refRegex = new RegExp(`- generic \\[ref=([a-z][0-9a-z]+)\\]:\\s*\\n\\s*- radio "${targetLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i');
        const refMatch = block.match(refRegex);
        if (refMatch) {
          click(refMatch[1]);
          sleep(1000);
        }
      } else {
        // Fallback: find generic label ref
        const targetRegex = new RegExp(`- generic \\[ref=([a-z][0-9a-z]+)\\]: "?${targetLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`);
        const targetMatch = block.match(targetRegex);
        if (targetMatch) {
          click(targetMatch[1]);
          sleep(1000);
        }
      }
    }

    // DOM fallback: required radiogroups not visible in snapshot (e.g. custom fieldsets)
    const radioResult = true ? '[]' : evalJSON(`(function(){
      const answered = [];
      const groups = document.querySelectorAll('fieldset, [role="radiogroup"], [data-test-form-builder-radio-button-form-component]');
      for (const g of groups) {
        const radios = g.querySelectorAll('input[type="radio"]');
        if (!radios.length) continue;
        if (g.querySelector('input[type="radio"]:checked')) continue;
        const legend = (g.querySelector('legend')?.textContent || g.getAttribute('aria-label') || g.closest('.fb-form-element')?.querySelector('label,legend')?.textContent || '').trim().toLowerCase();
        const labels = [...radios].map(r => (r.closest('label')?.textContent || r.value || '').trim());
        let pick = labels.findIndex(l => /^yes|sí$|si$|sim$/i.test(l));
        if (/sponsor|visa|authorized|citizen|clearance|disab|relative|government|residen|work in (the )?(us|usa|canada|eu|uk)|authorized to work/i.test(legend)) {
          const noIdx = labels.findIndex(l => /^no|não|non$/i.test(l));
          if (noIdx >= 0) pick = noIdx;
        }
        if (pick < 0) pick = 0;
        const r = radios[pick];
        r.click();
        r.dispatchEvent(new Event('change', {bubbles:true}));
        answered.push({legend: legend.substring(0,50), picked: labels[pick]});
      }
      return JSON.stringify(answered);
    })()`, { session: SESSION });
    const radioArr = Array.isArray(radioResult) ? radioResult : (() => { try { return JSON.parse(radioResult || '[]'); } catch { return []; } })();
    if (radioArr.length) {
      dbg(`[radios ${JSON.stringify(radioArr)}] `);
      sleep(1000);
    }

    // DOM fallback: required selects still empty (snapshot may show placeholder as [selected])
    const selRes = true ? '[]' : evalJSON(`(function(){
      const done = [];
      document.querySelectorAll('select').forEach(s => {
        if (s.value && s.selectedOptions[0] && s.selectedOptions[0].text.trim() !== '') return;
        const wrapper = s.closest('.fb-form-element, .jobs-easy-apply-form-section__element, [class*="form-element"]') || s.parentElement;
        const label = ((wrapper && (wrapper.querySelector('label,legend')?.textContent || '')) || s.getAttribute('aria-label') || '').trim().toLowerCase();
        const opts = [...s.options].filter(o => o.value !== '' && !/selec|elig|choos|select/i.test(o.text));
        if (!opts.length) return;
        let pick = null;
        const noQ = /sponsor|visa|authorized|autoriz|citizen|clearance|disab|relative|government|residen|indigenous|autochton|travail|canada|french|anglais/i.test(label);
        if (noQ) pick = opts.find(o => /^(no|não|non)$/i.test(o.text.trim())) || null;
        if (!pick && /english|anglais|ingl/i.test(label)) pick = opts.find(o => /professional|advanced|proficien|fluent|interm/i.test(o.text));
        if (!pick && /salary|salarial|attentes/i.test(label)) pick = opts[Math.min(1, opts.length - 1)];
        if (!pick) pick = opts.find(o => /linkedin|yes|sí|si$/i.test(o.text.trim())) || opts[0];
        pick.selected = true;
        s.dispatchEvent(new Event('change', {bubbles: true}));
        s.dispatchEvent(new Event('input', {bubbles: true}));
        done.push({label: label.substring(0,40), val: pick.text.trim().substring(0,40)});
      });
      return JSON.stringify(done);
    })()`, { session: SESSION });
    const selArr = (() => { try { return JSON.parse(selRes || '[]'); } catch { return []; } })();
    if (selArr.length) {
      dbg(`[selects ${JSON.stringify(selArr)}] `);
      sleep(1000);
    }

    // Check required checkboxes and click them
    const checkboxMatches = [...snap.matchAll(/- generic \[ref=([a-z][0-9a-z]+)\]:\s*\n\s*- checkbox "(.+?)"/g)];
    for (const cb of checkboxMatches) {
      const [block, ref, label] = cb;
      if (block.includes('[checked]')) continue;
      // Only required privacy/terms boxes; never marketing, follow-company or skill checkboxes.
      if (!A.CONSENT_RE.test(A.norm(label)) || /(future|marketing|newsletter|follow|seguir)/i.test(label)) continue;
      click(ref);
      sleep(1000);
    }
    // Direct checkboxes (no generic wrapper): `- checkbox "label" [ref=x]`.
    // Only consent/terms-type labels — never opt into marketing/disability/etc.
    const directCbs = [...snap.matchAll(/- checkbox "([^"]+)"(?:\s+\[[^\]]*\])*\s+\[ref=([a-z][0-9a-z]+)\](?:\s+\[[^\]]*\])*/g)];
    for (const cb of directCbs) {
      const [line, label, ref] = cb;
      if (line.includes('[checked]')) continue;
      if (!/consent|terms|conditions|privacy|agree|accept|acepto|términos|terminos|condiciones|privacidad|consentimiento|consiento/i.test(label)) continue;
      click(ref);
      sleep(1000);
    }

    // Strict answers: required questions the handlers above could not see (custom
    // widgets) are collected from the DOM, without filling anything.
    const emptyReq = evalJSON(`(function(){
      // Only inside the Easy Apply form: never the page behind it (LinkedIn's own search box, for one).
      const root = (function () {
      const c = [...document.querySelectorAll('dialog[open][data-sdui-screen*="EasyApply"], [data-sdui-screen*="EasyApply"], .jobs-easy-apply-modal, [role="dialog"], dialog[open]')]
        .filter((e) => e.offsetWidth || e.offsetHeight || e.getClientRects().length);
      return c[0] || null;
    })();
      if (!root) return JSON.stringify([]);
      const out = [];
      const norm = (t) => (t || '').replace(/\\s+/g, ' ').trim();
      const labelOf = (el) => {
        const own = norm((el.labels && el.labels[0] && el.labels[0].textContent) || el.getAttribute('aria-label') || '');
        if (own) return own;
        const by = norm((el.getAttribute('aria-labelledby') || '').split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '));
        if (by) return by;
        const w = el.closest('fieldset, .fb-form-element, .jobs-easy-apply-form-section__element, [class*="form-element"]');
        return norm((w && w.querySelector('legend, label') && w.querySelector('legend, label').textContent) || '');
      };
      const groupLabel = (g) => norm((g.querySelector('legend') || {}).textContent || g.getAttribute('aria-label') ||
        (g.getAttribute('aria-labelledby') || '').split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '));
      root.querySelectorAll('fieldset, [role="radiogroup"]').forEach((g) => {
        const radios = g.querySelectorAll('input[type="radio"]');
        if (!radios.length || g.querySelector('input[type="radio"]:checked')) return;
        const req = g.querySelector('[required], [aria-required="true"]') || /required|obligatori/i.test(g.textContent);
        if (!req) return;
        out.push({ question: groupLabel(g), type: 'radio',
          options: [...radios].map((r) => (r.closest('label')?.textContent || document.querySelector('label[for="' + r.id + '"]')?.textContent || r.value || '').trim()) });
      });
      root.querySelectorAll('select').forEach((s) => {
        if (!(s.required || s.getAttribute('aria-required') === 'true')) return;
        if (s.value && s.selectedIndex > 0) return;
        out.push({ question: labelOf(s), type: 'select', options: [...s.options].map((o) => o.text.trim()).filter((t, i) => i > 0 && t) });
      });
      root.querySelectorAll('input[type="text"], input[type="number"], input:not([type]), textarea').forEach((i) => {
        if (!(i.required || i.getAttribute('aria-required') === 'true') || i.value) return;
        if (i.closest('header, nav, [role="search"], [role="banner"]') || /^(buscar|search)/i.test(i.getAttribute('placeholder') || i.getAttribute('aria-label') || '')) return;
        out.push({ question: labelOf(i), type: 'text', options: [] });
      });
      return JSON.stringify(out.slice(0, 20));
    })()`, { session: SESSION });
    const emptyArr = Array.isArray(emptyReq) ? emptyReq : (() => { try { return JSON.parse(emptyReq || '[]'); } catch { return []; } })();
    for (const e of emptyArr) {
      if (!e || !e.question) continue;
      // Leave alone what the handlers above can fill from stated data on the next pass.
      const r = A.resolve(e.question, e.options && e.options.length ? e.options : null, CTX);
      if (r.kind === 'unknown') noteUnanswered(e.question, e.type, e.options);
      else if (r.kind === 'answer') {
        const ok = domFill(e.question, e.type, r.value);
        dbg(`[dom-fill "${e.question.slice(0, 40)}" ${ok ? 'ok' : 'failed'}] `);
      }
    }
    if (UNANSWERED.length) {
      dismissApplication();
      return { status: 'needs_answers', questions: UNANSWERED.slice() };
    }

    // Find and click Continue/Review/Submit button (English or Spanish)
    // Attr-tolerant: snapshot may render `button "Siguiente" [active] [ref=...]`.
    // Scope to the dialog region first: pages can contain non-dialog buttons with
    // the same label (carousels, pagination) that hijack the first regex match.
    const dialogIdx = snap.indexOf('- dialog [');
    const dialogSnap = dialogIdx >= 0 ? snap.slice(dialogIdx) : snap;
    const refTail = '(?:\\s+\\[[^\\]]*\\])*\\s+\\[ref=([a-z][0-9a-z]+)\\]';
    let actionRef = null;
    const findBtn = (labelRe) => {
      const re = new RegExp('button "' + labelRe + '"' + refTail);
      return extractRef(dialogSnap, re) || extractRef(snap, re);
    };
    // Detect on the DIALOG only — page-level text (e.g. carousel "Siguiente") must
    // not select the branch, and LinkedIn also renders a bare "Revisar" button.
    if (dialogSnap.match(/button "(?:Submit application|Enviar solicitud|Presentar solicitud)"/)) {
      // Last check before sending: the CV that goes is the one chosen for this job.
      const cvr = cvStep(true);
      if (cvr && cvr.stop) { dismissApplication(); return { status: 'cv_problem', error: cvr.stop }; }
      if (CV && CV.want && CV.want.file && !CV.seen && !CV.verified) dbg('[cv-step-not-seen] ');
      actionRef = findBtn('(?:Submit application|Enviar solicitud|Presentar solicitud)');
    } else if (dialogSnap.match(/button "(?:Review(?: your application)?|Revisar(?: tu solicitud)?|Revisa tu solicitud)"/)) {
      actionRef = findBtn('(?:Review(?: your application)?|Revisar(?: tu solicitud)?|Revisa tu solicitud)');
    } else if (dialogSnap.match(/button "(?:Continue to next step|Ir al siguiente paso|Continuar al siguiente paso|Siguiente)"/)) {
      actionRef = findBtn('(?:Continue to next step|Ir al siguiente paso|Continuar al siguiente paso|Siguiente)');
    }

    if (actionRef) {
      dbg(`actionRef=${actionRef} `);
      click(actionRef);
      sleep(3000);
    } else {
      dbg('NO ACTION REF ');
      // Try eval-based click as fallback
      const evalClick = evalJSON(`(function(){
        const btns = document.querySelectorAll('button');
        let disabledFound = null;
        for (const b of btns) {
          const text = b.textContent.trim();
          if (text.includes('Revisar') || text.includes('Review') || text.includes('Enviar') || text.includes('Submit') || text.includes('Siguiente') || text.includes('Next')) {
            if (b.disabled || b.getAttribute('aria-disabled') === 'true' || b.getAttribute('disabled') !== null) {
              disabledFound = disabledFound || text;
              continue;
            }
            b.click();
            return JSON.stringify({clicked: true, text: text});
          }
        }
        return JSON.stringify({clicked: false, disabledBtn: disabledFound});
      })()`, { session: SESSION });
      // If the button is disabled, surface the validation error(s) blocking it
      if (evalClick && evalClick.disabledBtn) {
        const errs = evalJSON(`(function(){
          const msgs = [...document.querySelectorAll('[role="alert"], .fb-form-element__error-text, [class*="error-message"], [class*="error-text"], [aria-live]')]
            .map(e => e.textContent.trim()).filter(t => t.length > 2 && t.length < 200);
          return JSON.stringify(msgs.slice(0, 5));
        })()`, { session: SESSION });
        dbg(`[errs ${JSON.stringify(errs)}] `);
      }
      dbg(`evalClick=${JSON.stringify(evalClick)} `);
      // Diagnostic: dump required-but-empty or invalid fields (helps see what blocks Next/Review)
      const blockers = evalJSON(`(function(){
        const out = [];
        document.querySelectorAll('[aria-invalid="true"], .artdeco-text-input--error, select[required]:not([value]), input[required]').forEach(el => {
          out.push({tag: el.tagName, label: (el.getAttribute('aria-label')||el.id||'').substring(0,50), val: el.value});
        });
        document.querySelectorAll('input, select, textarea').forEach(el => {
          if (el.required && !el.value) out.push({req: true, label: (el.getAttribute('aria-label')||'').substring(0,50)});
        });
        document.querySelectorAll('fieldset, [role="radiogroup"]').forEach(g => {
          if (!g.querySelector('input:checked')) out.push({radio: (g.getAttribute('aria-label')||g.querySelector('legend')?.textContent||'').substring(0,60)});
        });
        return JSON.stringify(out.slice(0,8));
      })()`, { session: SESSION });
      const blockerArr = Array.isArray(blockers) ? blockers : (() => { try { return JSON.parse(blockers || '[]'); } catch { return []; } })();
      if (blockerArr.length) {
        dbg(`[blocked ${JSON.stringify(blockerArr)}] `);
      }
      sleep(3000);
    }
  }

  return { status: 'timeout', error: 'Max steps reached without submission' };
}

// --- Derive search keywords from DB profile ---

function deriveKeywordsFromProfile(userData) {
  const title = userData.profile?.title || userData.profile?.role;
  const rawSkills = userData.profile?.skills || [];
  const skills = Array.isArray(rawSkills)
    ? rawSkills
    : Object.values(rawSkills).flat();
  const prefs = userData.prefs || {};

  // Build keyword string from profile title + top skills
  // If profile has a title, use it as primary keyword
  // Add top 3-4 skills as OR clauses
  const parts = [];
  if (title) parts.push(`"${title}"`);

  // Add skills that look like job titles or key technologies
  const jobLikeSkills = skills.filter((s) =>
    s.match(/engineer|developer|architect|manager|lead|director|scientist|consultant/i)
  );
  const techSkills = skills.filter((s) =>
    !s.match(/engineer|developer|architect|manager|lead|director|scientist|consultant/i)
  ).slice(0, 2);

  jobLikeSkills.slice(0, 2).forEach((s) => parts.push(`"${s}"`));
  techSkills.forEach((s) => parts.push(`"${s}"`));

  if (parts.length === 0) {
    // Fallback: use role_types from job_preferences
    const roleTypes = prefs.role_types?.value || [];
    roleTypes.slice(0, 3).forEach((r) => parts.push(`"${r}"`));
  }

  return parts.length > 0 ? parts.join(' OR ') : '';
}

function deriveLocationFromProfile(userData) {
  const location = userData.prefs?.location?.value;
  const timezones = userData.prefs?.timezones?.value
    || userData.prefs?.strong_preferences?.timezones
    || [];
  const country = userData.personal?.country;

  // Remote-first: if must_have is 100% remote, search worldwide
  const remoteMust = userData.prefs?.must_haves?.remote;
  if (remoteMust && typeof remoteMust === 'string' && /remote/i.test(remoteMust)) {
    return 'Worldwide';
  }

  if (location && typeof location === 'string') return location;
  if (timezones.includes('Global') || timezones.includes('any')) return 'Worldwide';
  if (timezones.includes('Americas') || timezones.includes('Latin America')) return 'Latin America';
  if (country) return country;
  return 'Worldwide';
}

// --- Main ---

function main() {
  const args = process.argv.slice(2);

  let keywords = null; // will be derived from DB if not provided
  let location = null; // will be derived from DB if not provided
  let jobUrl = null; // direct single-job mode
  let maxJobs = 10;
  let posted = null; // day | week | month
  let dryRun = false;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--keywords' && args[i + 1]) { keywords = args[i + 1]; i++; }
    else if (args[i] === '--location' && args[i + 1]) { location = args[i + 1]; i++; }
    else if (args[i] === '--max' && args[i + 1]) { maxJobs = parseInt(args[i + 1], 10); i++; }
    else if (args[i] === '--posted' && args[i + 1]) { posted = args[i + 1]; i++; }
    else if (args[i] === '--dry-run') { dryRun = true; SAVE_JOB_PAGES = true; }
    else if (args[i] === '--json') jsonOutput = true;
    else if (args[i] === '--quiet') QUIET = true;
    else if (args[i] === '--session' && args[i + 1]) { SESSION = args[i + 1]; i++; }
    else if (args[i] === '--job-url' && args[i + 1]) { jobUrl = args[i + 1]; i++; }
  }

  // Safety pause after a LinkedIn warning sign (lib/safety.js). Applying waits until it ends or the
  // user resumes it in the panel; a simulation can still run with --force.
  const pausedNow = safety.active();
  if (pausedNow && (!dryRun || !args.includes('--force'))) {
    console.log(jsonOutput ? '[]' : safety.message(pausedNow));
    process.exit(0);
  }

  // Daily window, cap and rest days (see lib/humanize.js). --force bypasses them for one run.
  if (!dryRun && !args.includes('--force')) {
    const g = gate();
    if (!g.allowed) {
      console.log(jsonOutput ? '[]' : g.message);
      process.exit(0);
    }
    if (maxJobs > g.remaining) {
      if (!jsonOutput) console.log(`Tope de hoy: ${g.cap}; ya van ${g.done}; esta corrida se limita a ${g.remaining}.`);
      maxJobs = g.remaining;
    }
  }

  // The database must answer before anything else: without it the profile is
  // empty, nothing gets recorded and the same jobs would be applied to again.
  const ping = spawnSync(process.execPath, [require('path').join(__dirname, 'db.js'), '--ping'], { encoding: 'utf8', timeout: 30000 });
  if (ping.status !== 0) {
    console.error('No pude abrir la base de datos; freno antes de tocar el navegador.');
    process.exit(1);
  }

  // Read the user's tracking spreadsheet first (if configured), so jobs they
  // applied to or discarded elsewhere are known before anything is opened.
  const sync = spawnSync(process.execPath, [require('path').join(__dirname, 'config.js'), 'sync'], { encoding: 'utf8', timeout: 120000 });
  try {
    const j = JSON.parse(sync.stdout);
    if (j.synced && !jsonOutput) console.log(`Planilla de seguimiento: ${j.read} filas leídas, ${j.inserted} nuevas, ${j.updated} actualizadas.`);
  } catch (e) {
    if (!jsonOutput) console.log(`Aviso: no se pudo leer la planilla de seguimiento (${(sync.stderr || '').trim().slice(0, 160) || 'sin detalle'}). Sigo con lo que ya está registrado.`);
  }

  // Load user data and form answers from DB
  const userData = loadUserData();
  ANSWERS = userData.formAnswers;
  CTX = { answers: ANSWERS, personal: userData.personal, profile: userData.profile };
  if (!jobUrl && !jobFilter.targetTitles(userData.prefs, userData.profile).length) {
    console.error('Todavía no cargaste qué puestos buscás. Abrí Configuración y completá "Puestos objetivo".');
    process.exit(1);
  }

  // Derive keywords and location from profile if not provided via CLI
  // Every saved boolean search runs on each pass (--keywords runs only that one).
  let searches = keywords ? [keywords] : jobFilter.list(userData.prefs.search_queries);
  if (!searches.length) searches = [jobFilter.searchKeywords(userData.prefs, userData.profile) || deriveKeywordsFromProfile(userData)];
  keywords = searches[0];
  if (!location) location = deriveLocationFromProfile(userData);

  if (!jsonOutput) {
    console.log(searches.length > 1 ? `Búsquedas: ${searches.length}` : `Búsqueda: ${keywords}`);
    console.log(`Ubicación: ${location}`);
  }

  // Build search URL
  // f_AL=true → Easy Apply filter
  // f_WT=2 → Remote filter
  // f_E → Experience level: 1=Internship, 2=Entry, 3=Associate, 4=Mid-Senior, 5=Director
  // For junior-mid profiles, include Entry + Associate + Mid-Senior (2,3,4)
  const seniority = userData.prefs?.strong_preferences?.seniority || '';
  let expFilter = '';
  if (seniority.includes('junior') || seniority.includes('entry')) {
    expFilter = '&f_E=2%2C3%2C4'; // Entry + Associate + Mid-Senior
  }
  // Work mode and recency come from the user's preferences (see lib/job-filter.js).
  const searchUrl = jobFilter.buildSearchUrl({ keywords, location, prefs: userData.prefs, posted }) + expFilter;

  // Load auth state to maintain LinkedIn session
  // Skipped: state-load hangs in current agent-browser version.
  // Session is already active via browser.js open, so auth state is not needed.

  // Direct single-job mode: skip search entirely
  if (jobUrl) {
    const results = [];
    const job = { role: '', company: '', url: jobUrl };
    process.stdout.write(dryRun ? `Revisando ${jobUrl} (simulación)... ` : `Postulando a ${jobUrl}... `);
    goto(job.url);
    sleep(3000);
    const oneSign = warningSign('');
    if (oneSign) stopForSign(oneSign, { dryRun, jsonOutput, results });

    // Resolve role/company from the page for DB
    const meta = evalJSON(`(function(){
      const t = document.querySelector('h1, .top-card-layout__title, [class*="job-title"]')?.textContent.trim() || '';
      const c = document.querySelector('[class*="topcard__org"], [class*="company-name"], .top-card-layout__second-subline, [data-tracking-control-name*="company"]')?.textContent.trim() || '';
      return JSON.stringify({role: t.substring(0,120), company: c.substring(0,80)});
    })()`, { session: SESSION });
    const metaObj = (() => { try { return JSON.parse(meta || '{}'); } catch { return meta && typeof meta === 'object' ? meta : {}; } })();
    if (metaObj.role) job.role = metaObj.role;
    if (metaObj.company) job.company = metaObj.company;
    if (!job.role) job.role = 'LinkedIn job';
    if (!job.company) job.company = 'LinkedIn';

    const jobSnap = snapshot();
    if (jobSnap.includes('Solicitud enviada') || jobSnap.includes('Application sent') || jobSnap.includes('application was sent')) {
      console.log('YA POSTULADO: lo salteo');
      results.push({ ...job, status: 'already_applied' });
    } else {
      const patterns = [
        /(?:button|link) "Solicitud sencilla[^"]*" \[ref=([a-z][0-9a-z]+)\]/,
        /(?:button|link) "Easy Apply[^"]*" \[ref=([a-z][0-9a-z]+)\]/,
      ];
      let easyApplyRef = null;
      for (const p of patterns) {
        easyApplyRef = extractRef(jobSnap, p);
        if (easyApplyRef) break;
      }
      if (!easyApplyRef) {
        console.log('SIN BOTÓN DE SOLICITUD SENCILLA');
        results.push({ ...job, status: 'no_button' });
      } else {
        CV = null;
        const screen = screenJob(job, userData);
        if (dryRun) {
          // Simulation of a single job: same checks, nothing is clicked.
          if (screen.skip) console.log(`\nSimulación: no me postularía [${reasonText(screen.reason)}]`);
          else {
            const w = prepareCv(job, userData);
            console.log(`\nSimulación: me postularía a ${job.role} en ${job.company} (no envié nada)`);
            console.log(`   CV: ${cvLabel(w)} (${w.reason})`);
            fitLines(job.fit).forEach((l) => console.log(l));
          }
          return;
        }
        if (!screen.skip) { const w = prepareCv(job, userData); if (!jsonOutput) process.stdout.write(`[CV: ${cvLabel(w)}; ${w.reason}] `); }
        const result = screen.skip ? { status: 'skipped', error: screen.reason } : applyToJob(easyApplyRef, userData);
        results.push({ ...job, ...result, cv: CV && CV.want ? CV.want.file : null });
        if (result.status === 'applied') {
          console.log('ENVIADA');
          recordApplied(job, 'must');
        } else if (result.status === 'needs_answers') {
          console.log(`FALTAN RESPUESTAS (${result.questions.length}): no se envió; quedaron como preguntas pendientes`);
          recordNeedsAnswers(job, result.questions);
        } else if (result.status === 'cv_problem') {
          console.log(`NO SE ENVIÓ POR EL CV: ${result.error}`);
        } else if (result.status === 'warning') {
          stopForSign(result.sign, { dryRun, jsonOutput, results });
        } else {
          console.log(result.status === 'skipped' ? `SALTEADA: ${reasonText(result.error)}` : `NO SE PUDO: ${result.error || result.status}`);
        }
      }
    }
    if (jsonOutput) console.log(JSON.stringify(results, null, 2));
    else console.log(`\nListo: ${results[0]?.status}`);
    return;
  }

  let found = [];
  searches.forEach((q, i) => {
    const url = jobFilter.buildSearchUrl({ keywords: q, location, prefs: userData.prefs, posted }) + expFilter;
    if (!jsonOutput) process.stdout.write(`\nBúsqueda ${i + 1} de ${searches.length}: ${q}\n`);
    if (i > 0) sleep(3000 + Math.floor(Math.random() * 4000));
    goto(url);
    // Wait for job cards to load (in-page polling, not shell sleep)
    waitFor(`document.querySelectorAll(${JSON.stringify(CARD_SEL)}).length > 0`, { timeout: 15000, session: SESSION });
    sleep(1500);
    { const sign = warningSign(''); if (sign) stopForSign(sign, { where: 'durante una búsqueda', jsonOutput: false, results: [] }); }
    loadAllCards();
    // Try DOM extraction first (more reliable, gets all cards)
    let got = uniqueJobs(findEasyApplyJobsFromDOM());
    // Fallback to snapshot parsing if DOM extraction failed
    if (got.length === 0) got = uniqueJobs(findEasyApplyJobs(snapshot()));
    if (!jsonOutput) console.log(`  ${got.length} avisos con solicitud sencilla`);
    // Simulations keep a copy of each results page (in datos/) so a change in LinkedIn can be checked.
    if (got.length === 0 || dryRun) {
      const file = saveSearchPage(i + 1);
      if (file && !jsonOutput && got.length === 0) console.log(`  No pude leer los avisos de esta página. Guardé una copia para revisarla: ${file}`);
      else if (file && !jsonOutput) console.log(`  Copia de la página: ${file}`);
    }
    found = found.concat(got);
  });
  let jobs = uniqueJobs(found);

  if (jobs.length === 0) {
    if (jsonOutput) console.log('[]');
    else console.log(searches.length > 1 ? 'No encontré avisos con solicitud sencilla en ninguna de tus búsquedas.' : 'No encontré avisos con solicitud sencilla para esa búsqueda.');
    process.exit(1);
  }

  // Title filter: the user's own target titles and avoid list (lib/job-filter.js)
  const skipped = [];
  const matching = [];
  for (const j of jobs) {
    let check = jobFilter.checkTitle(j.role || '', userData.prefs, userData.profile);
    if (check.pass) { const cc = jobFilter.checkCompany(j.company, userData.prefs); if (!cc.pass) check = cc; }
    if (check.pass) { const lc = jobFilter.checkLocation(j.location, userData.prefs); if (!lc.pass) check = lc; }
    if (check.pass) { const known = alreadyKnown(j); if (known) check = { pass: false, reason: known }; }
    if (check.pass) { const pay = jobFilter.checkSalary(j, userData.prefs); if (!pay.pass) check = pay; }
    if (check.pass) matching.push(j);
    else skipped.push({ ...j, status: 'skipped', reason: check.reason });
  }
  if (!jsonOutput && skipped.length) {
    console.log(`\nDescartados por tus filtros o porque ya te postulaste (${skipped.length}):`);
    skipped.forEach((j) => console.log(`  - ${j.role} en ${j.company} [${reasonText(j.reason)}]`));
  }

  // Limit to maxJobs
  // Random order, so runs do not always start with the same search results
  const jobsToProcess = shuffle(matching).slice(0, maxJobs);

  if (dryRun) {
    // Open each job page (nothing is clicked or sent) to apply the same checks as a
    // real run: already applied, companies and phrases to avoid, and the CV it would use.
    const pool = shuffle(matching);
    const would = [];
    const leftOut = [];
    let visited = 0;
    if (!jsonOutput) console.log(`\nRevisando los avisos uno por uno (sin enviar nada)...`);
    for (const j of pool) {
      if (would.length >= maxJobs || visited >= maxJobs * 3) break;
      const known = alreadyKnown(j);
      if (known) { leftOut.push({ ...j, reason: known }); continue; }
      visited++;
      if (j.url) { goto(j.url); sleep(2500); }
      const pre = snapshot();
      if (pre.includes('Solicitud enviada') || pre.includes('Application sent') || pre.includes('application was sent')) {
        leftOut.push({ ...j, reason: 'already_applied: LinkedIn la marca como enviada' });
        continue;
      }
      const sc = screenJob(j, userData);
      if (sc.skip) { leftOut.push({ ...j, reason: sc.reason }); continue; }
      const w = cvChoice.chooseCv({ title: j.role, description: j.description, location: j.location }, cvSettings(userData));
      const sal = j.salaryFound;
      would.push({ ...j, fit: fitLib.summary(j.fit), cv: w.file, cv_reason: w.reason, _fit: j.fit, salary_text: sal ? `${sal.currency === 'USD' ? 'US$' : '$'} ${sal.monthlyMin === sal.monthlyMax ? sal.monthlyMax.toLocaleString('es-AR') : `${sal.monthlyMin.toLocaleString('es-AR')} a ${sal.monthlyMax.toLocaleString('es-AR')}`} por mes` : null, description: undefined });
      sleep(1500 + Math.floor(Math.random() * 2500));
    }
    if (jsonOutput) {
      console.log(JSON.stringify({ would_apply: would.map((x) => ({ ...x, _fit: undefined })), left_out: leftOut.map((x) => ({ ...x, description: undefined, fit: undefined })) }, null, 2));
    } else {
      if (leftOut.length) {
        console.log(`\nAl abrir los avisos descarté ${leftOut.length}:`);
        leftOut.forEach((j) => console.log(`  - ${j.role} en ${j.company} [${reasonText(j.reason)}]`));
      }
      console.log(`\nSimulación: me postularía a estos ${would.length} (no envié nada):\n`);
      would.forEach((j, i) => {
        console.log(`${i + 1}. ${j.role} en ${j.company}`);
        console.log(`   CV: ${j.cv || 'el que LinkedIn tenga marcado'} (${j.cv_reason})`);
        if (j.salary_text) console.log(`   Salario publicado: ${j.salary_text}`);
        fitLines(j._fit).forEach((l) => console.log(l));
      });
    }
    if (!jobUrl && userData.prefs.collect_external !== false) {
      try { collectExternal({ searches, location, userData, posted, expFilter, quiet: jsonOutput }); } catch (e) { if (!jsonOutput) console.log(`  No pude revisar los avisos externos: ${e.message}`); }
    }
    process.exit(0);
  }

  // Apply to each job
  const results = [];
  for (const job of jobsToProcess) {
    process.stdout.write(`Postulando a ${job.role} en ${job.company}... `);

    // Navigate directly to the job URL (more reliable than clicking title in search results)
    if (job.url) {
      goto(job.url);
      sleep(3000);
    } else {
      // Fallback: try clicking the job title
      const currentSnap = snapshot();
      const cleanRole = job.role.split('\n')[0].trim().replace(/ with verification$/i, '');
      const titleRef = extractRef(currentSnap, new RegExp(`strong \\[ref=([a-z][0-9a-z]+)\\]: ${cleanRole.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      if (titleRef) {
        click(titleRef);
        sleep(3000);
      }
    }

    // Check if already applied (Spanish: "Solicitud enviada", English: "Application sent")
    const preSnap = snapshot();
    const preSign = warningSign('');
    if (preSign) { console.log('LinkedIn mostró un aviso: freno acá'); stopForSign(preSign, { dryRun, jsonOutput, results }); }
    if (preSnap.includes('Solicitud enviada') || preSnap.includes('Application sent') || preSnap.includes('application was sent')) {
      console.log('YA POSTULADO: lo salteo');
      results.push({ ...job, status: 'already_applied' });
      continue;
    }

    // Re-find the Easy Apply button (refs change after navigation)
    // Try multiple patterns: English/ Spanish, button/ link
    const jobSnap = snapshot();
    const escapedRole = job.role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split('\\n')[0].trim().replace(/ with verification$/i, '').slice(0, 60);
    const patterns = [
      new RegExp(`button "Easy Apply to ${escapedRole}.*?" \\[ref=([a-z][0-9a-z]+)\\]`),
      new RegExp(`link "Easy Apply to ${escapedRole}.*?" \\[ref=([a-z][0-9a-z]+)\\]`),
      new RegExp(`(?:button|link) "Solicitud sencilla[^"]*" \\[ref=([a-z][0-9a-z]+)\\]`),
      new RegExp(`(?:button|link) "Easy Apply[^"]*" \\[ref=([a-z][0-9a-z]+)\\]`),
    ];
    let easyApplyRef = null;
    for (const p of patterns) {
      easyApplyRef = extractRef(jobSnap, p);
      if (easyApplyRef) break;
    }
    if (!easyApplyRef) {
      console.log('SIN BOTÓN DE SOLICITUD SENCILLA');
      results.push({ ...job, status: 'no_button' });
      continue;
    }

    CV = null;
    const screen = screenJob(job, userData);
    if (!screen.skip) { const w = prepareCv(job, userData); if (!jsonOutput) process.stdout.write(`[CV: ${cvLabel(w)}; ${w.reason}] `); }
    const result = screen.skip ? { status: 'skipped', error: screen.reason } : applyToJob(easyApplyRef, userData);
    results.push({ ...job, ...result, cv: CV && CV.want ? CV.want.file : null });

    switch (result.status) {
      case 'applied':
        console.log('ENVIADA');
        recordApplied(job, 'must');
        break;
      case 'needs_answers':
        console.log(`FALTAN RESPUESTAS (${result.questions.length}): no se envió; quedaron como preguntas pendientes`);
        recordNeedsAnswers(job, result.questions);
        break;
      case 'warning':
        console.log(`AVISO DE LINKEDIN (${result.error}): freno acá`);
        stopForSign(result.sign, { dryRun, jsonOutput, results });
        break;
      case 'cv_problem':
        console.log(`NO SE ENVIÓ POR EL CV: ${result.error}`);
        break;
      default:
        console.log(result.status === 'skipped' ? `SALTEADA: ${reasonText(result.error)}` : `NO SE PUDO: ${result.error || result.status}`);
    }

    if (windowClosed()) {
      console.log('Terminó el horario de trabajo configurado; freno acá.');
      break;
    }

    // Variable pause between applications (25-80 s, with a longer break every 4-7)
    if (jobsToProcess.indexOf(job) < jobsToProcess.length - 1) {
      const waitMs = betweenApplications();
      console.log(`  (pausa de ${Math.round(waitMs / 1000)} s antes de la siguiente)`);
      sleepSync(waitMs);
    }
  }

  if (userData.prefs.collect_external !== false) {
    try { collectExternal({ searches, location, userData, posted, expFilter, quiet: jsonOutput }); } catch (e) { if (!jsonOutput) console.log(`  No pude revisar los avisos externos: ${e.message}`); }
  }

  // Summary
  const applied = results.filter((r) => r.status === 'applied').length;
  const failed = results.filter((r) => r.status !== 'applied').length;

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`\nResumen: ${applied} enviadas, ${failed} sin enviar, ${skipped.length} descartadas por filtros`);
  }

  process.exit(0);
}

main();
