#!/usr/bin/env node
/**
 * portales.js: searches the user's target titles on Computrabajo, Bumeran and ZonaJobs with
 * the program's own Chrome window, reads the results like a person would (a few searches,
 * with pauses), applies the same filters as LinkedIn and adds the new jobs to "Avisos para
 * revisar". It never applies: on these sites the user applies with their own account.
 *
 * Sites: Configuración > "Otros portales donde buscar" (job_preferences.other_portals);
 * empty = the three. Titles: the first four target titles.
 *
 * Usage: node scripts/portales.js [--max-desc 12]
 * Exit codes: 0 done, 2 Chrome could not be opened.
 */
'use strict';
const h = require('../lib/browser-helpers');
const store = require('../lib/store');
const ext = require('../lib/external');
const portales = require('../lib/portales');
const jobFilter = require('../lib/job-filter');
const fitLib = require('../lib/fit');
const { findMatch } = require('../lib/match');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const MAX_DESC = Math.min(Math.max(Number.parseInt(arg('--max-desc', '12'), 10) || 12, 0), 40);
const say = (t) => process.stdout.write(t + '\n');
const pauseMs = (a, b) => a + Math.floor(Math.random() * (b - a));
const clean = (u) => String(u || '').split('?')[0].replace(/\/+$/, '');

(async () => {
  const { d, apps } = await store.withDb(async (c) => {
    await store.ensureSchema(c);
    const data = (await store.getUserData(c)) || {};
    const rows = (await c.query('SELECT company, role, url FROM applications WHERE user_id = $1', [store.USER_ID])).rows;
    return { d: data, apps: rows };
  });
  const prefs = d.job_preferences || {};
  const profile = d.profile || {};
  const titles = jobFilter.targetTitles(prefs, profile).slice(0, 4);
  if (!titles.length) { say('Primero cargá tus puestos objetivo en Configuración.'); say('Avisos nuevos para revisar: 0'); return; }
  const sites = (Array.isArray(prefs.other_portals) && prefs.other_portals.length ? prefs.other_portals : portales.ALL).filter((s) => portales.SITES[s]);
  const user = { prefs, profile, formAnswers: d.form_answers || {}, cvText: typeof d.cv_text === 'string' ? d.cv_text : '' };
  const minFit = Number.parseInt(prefs.min_fit, 10) || 0;
  const appUrls = new Set(apps.map((a) => clean(a.url)).filter(Boolean));

  // 1. Search pages, in the program's window.
  const first = portales.SITES[sites[0]].search(titles[0]);
  if (!h.ensure()) h.openBrowser(first, { headed: true });
  const found = new Map();
  const why = {};
  const count = (k) => { why[k] = (why[k] || 0) + 1; };
  let opened = 0;
  for (const site of sites) {
    let blocked = false;
    for (const title of titles) {
      if (blocked) break;
      const url = portales.SITES[site].search(title);
      if (opened++) h.sleep(pauseMs(4000, 9000));
      h.goto(url);
      h.waitFor('document.readyState === "complete"', { timeout: 20000 });
      h.sleep(pauseMs(2500, 4500));
      const r = h.evalJSON(portales.extractCode(site));
      if (!r || typeof r !== 'object') { say(`${portales.SITES[site].label}: no pude leer la búsqueda "${title}".`); continue; }
      if (r.blocked) { say(`${portales.SITES[site].label} pidió una verificación o bloqueó la búsqueda: freno en este sitio por hoy.`); blocked = true; break; }
      let n = 0;
      for (const j of r.jobs || []) {
        const key = clean(j.url);
        if (found.has(key)) continue;
        const card = portales.parseCard(j.title, j.lines);
        found.set(key, { url: j.url, role: j.title, ...card, source: portales.sourceOf(j.url) || site });
        n++;
      }
      say(`${portales.SITES[site].label}, "${title}": ${n} avisos en la página.`);
    }
  }
  if (!opened) { say('No pude abrir Chrome. Verificá que Google Chrome esté instalado y volvé a intentar.'); process.exit(2); }

  // 2. Filters, as with LinkedIn.
  const candidates = [];
  for (const j of found.values()) {
    if (!j.role || !jobFilter.checkTitle(j.role, prefs, profile).pass) { count('puesto'); continue; }
    if (j.company && !jobFilter.checkCompany(j.company, prefs).pass) { count('empresa'); continue; }
    if (j.location && !jobFilter.checkLocation(j.location, prefs).pass) { count('lugar'); continue; }
    if (ext.has({ url: j.url }) || appUrls.has(clean(j.url)) || (j.company && findMatch({ company: j.company, role: j.role }, apps))) { count('ya conocido'); continue; }
    candidates.push(j);
  }

  // 3. Description (a few per run, with pauses), fit and the list.
  let added = 0;
  for (const [i, j] of candidates.entries()) {
    let description = '';
    if (i < MAX_DESC) {
      h.sleep(pauseMs(3500, 8000));
      h.goto(j.url);
      h.waitFor('document.readyState === "complete"', { timeout: 20000 });
      h.sleep(pauseMs(1500, 3000));
      const t = h.evalJSON(portales.DESCRIPTION_CODE);
      description = typeof t === 'string' ? t : '';
      const dc = jobFilter.checkDescription(description, prefs);
      if (description && !dc.pass) { count('descripción'); continue; }
    }
    let fit = null;
    try { fit = description ? fitLib.score({ role: j.role, company: j.company, location: j.location, description }, user) : null; } catch { fit = null; }
    if (fit && minFit > 0 && fit.score < minFit) { count('afinidad'); continue; }
    const summary = fitLib.summary(fit);
    const e = ext.add({ role: j.role, company: j.company || 'Empresa sin nombre', location: j.location, url: j.url, source: j.source,
      fit: summary ? { ...summary, description: description.slice(0, 8000) } : null }, 'pendiente');
    if (e) added++;
  }
  const left = Object.entries(why).map(([k, n]) => `${n} por ${k}`).join(', ');
  say(`Revisé ${found.size} avisos en ${sites.map((s) => portales.SITES[s].label).join(', ')}.${left ? ` Descartados: ${left}.` : ''}`);
  if (candidates.length > MAX_DESC) say(`Leí la descripción de los primeros ${MAX_DESC}; el resto quedó sin afinidad (abrilos para leerlos).`);
  say(`Avisos nuevos para revisar: ${added}`);
})().catch((e) => { say(`No pude buscar en los portales: ${e.message}`); process.exit(1); });
