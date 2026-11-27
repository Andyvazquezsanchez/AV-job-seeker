#!/usr/bin/env node
/**
 * ats-avisos.js: reads the open jobs of the companies the user chose that publish them on
 * Greenhouse, Lever or Ashby (public APIs, no browser and no account), applies the same
 * filters as LinkedIn (titles, companies to avoid, place, phrases to avoid, minimum fit) and
 * adds the new ones to "Avisos para revisar". Nothing is applied to.
 *
 * Boards come from Configuración > "Páginas de empleo de empresas" (job_preferences.ats_boards)
 * and from the careers addresses of users.data.target_companies.
 *
 * Usage: node scripts/ats-avisos.js [--quiet] [--max-new N]   (--max-new: at most N new jobs, up to 60)
 */
'use strict';
const store = require('../lib/store');
const ext = require('../lib/external');
const boardsLib = require('../lib/ats-boards');
const jobFilter = require('../lib/job-filter');
const fitLib = require('../lib/fit');
const { findMatch } = require('../lib/match');

const quiet = process.argv.includes('--quiet');
const say = (t) => process.stdout.write(t + '\n');
const asked = Number.parseInt(process.argv[process.argv.indexOf('--max-new') + 1], 10);
const MAX_NEW = process.argv.includes('--max-new') && asked > 0 ? Math.min(asked, 60) : 60;

function boardsOf(d) {
  const prefs = d.job_preferences || {};
  const raw = [...(Array.isArray(prefs.ats_boards) ? prefs.ats_boards : [])];
  const tc = d.target_companies;
  const walk = (x) => {
    if (!x) return;
    if (Array.isArray(x)) x.forEach(walk);
    else if (typeof x === 'object') { if (typeof x.url === 'string') raw.push(x.url); else Object.values(x).forEach(walk); }
  };
  walk(tc);
  const seen = new Set();
  for (const u of Array.isArray(prefs.ats_boards) ? prefs.ats_boards : []) {
    if (!boardsLib.parseBoard(u)) say(`No reconozco "${String(u).slice(0, 120)}" como página de Greenhouse, Lever o Ashby; la salteo.`);
  }
  return raw.map((u) => boardsLib.parseBoard(u)).filter((b) => b && !seen.has(`${b.type}:${b.slug.toLowerCase()}`) && seen.add(`${b.type}:${b.slug.toLowerCase()}`));
}

(async () => {
  const info = await store.withDb(async (c) => {
    await store.ensureSchema(c);
    const d = (await store.getUserData(c)) || {};
    const apps = (await c.query('SELECT company, role, url FROM applications WHERE user_id = $1', [store.USER_ID])).rows;
    return { d, apps };
  });
  const { d, apps } = info;
  const boards = boardsOf(d);
  if (!boards.length) {
    say('No hay páginas de empleo de empresas cargadas. Sumalas en Configuración, "Páginas de empleo de empresas" (direcciones de Greenhouse, Lever o Ashby).');
    say('Avisos nuevos para revisar: 0');
    return;
  }
  const prefs = d.job_preferences || {};
  const profile = d.profile || {};
  const user = { prefs, profile, formAnswers: d.form_answers || {}, cvText: typeof d.cv_text === 'string' ? d.cv_text : '' };
  const country = (d.personal_info && d.personal_info.country) || 'Argentina';
  const minFit = Number.parseInt(prefs.min_fit, 10) || 0;
  const appUrls = new Set(apps.map((a) => String(a.url || '').split('?')[0].replace(/\/+$/, '')).filter(Boolean));
  let added = 0;
  for (const b of boards) {
    let jobs;
    try { jobs = await boardsLib.fetchBoard(b); } catch (e) { say(`${b.slug} (${boardsLib.LABEL[b.type]}): no pude leerla: ${e.message}`); continue; }
    const why = {};
    const count = (r) => { const k = String(r).split(':')[0]; why[k] = (why[k] || 0) + 1; };
    let fresh = 0;
    for (const j of jobs) {
      if (added >= MAX_NEW) break;
      if (!j.url || !jobFilter.checkTitle(j.role, prefs, profile).pass) { count('puesto'); continue; }
      if (!jobFilter.checkCompany(j.company, prefs).pass) { count('empresa'); continue; }
      const place = boardsLib.placeOk(j.location, j.remote, prefs, country);
      if (!place.pass) { count('lugar'); continue; }
      const desc = jobFilter.checkDescription(j.description, prefs);
      if (!desc.pass) { count(desc.reason.startsWith('possible_scam') ? 'posible estafa' : 'descripción'); continue; }
      const key = j.url.split('?')[0].replace(/\/+$/, '');
      if (ext.has({ url: j.url }) || appUrls.has(key) || findMatch({ company: j.company, role: j.role }, apps)) { count('ya conocido'); continue; }
      let fit = null;
      try { fit = fitLib.score({ role: j.role, company: j.company, location: j.location, description: j.description }, user); } catch { fit = null; }
      if (fit && minFit > 0 && fit.score < minFit) { count('afinidad'); continue; }
      const summary = fitLib.summary(fit);
      const e = ext.add({ role: j.role, company: j.company, location: j.location, url: j.url, salary_text: j.salary || null, source: b.type,
        fit: summary ? { ...summary, description: j.description.slice(0, 8000) } : null }, 'pendiente');
      if (e) { added++; fresh++; }
    }
    const left = Object.entries(why).map(([k, n]) => `${n} por ${k}`).join(', ');
    say(`${jobs[0] ? jobs[0].company : b.slug} (${boardsLib.LABEL[b.type]}): ${jobs.length} avisos publicados, ${fresh} nuevos para revisar${left && !quiet ? `; descartados: ${left}` : ''}.`);
  }
  if (added >= MAX_NEW) say(`Llegué al máximo de ${MAX_NEW} avisos nuevos por vez; el resto aparece en la próxima búsqueda.`);
  say(`Avisos nuevos para revisar: ${added}`);
})().catch((e) => { say(`No pude buscar en las páginas de empleo: ${e.message}`); process.exit(1); });
