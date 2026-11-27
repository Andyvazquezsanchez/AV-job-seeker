'use strict';
/**
 * job-filter.js: which job titles are on target, and how the LinkedIn search is
 * built. Everything comes from the user's own preferences in the database
 * (users.data.job_preferences); nothing about any profession is hardcoded.
 *
 * Preferences read (each may be a plain value or { value, weight }):
 *   target_titles    words or phrases a title must contain, e.g. ["recursos humanos", "hr business partner", "people"]
 *   avoid            words or phrases that discard a title, e.g. ["ventas", "comercial", "pasante"]
 *   description_avoid  words or phrases that discard a job when they appear in its description, e.g. ["comisiones"]
 *   role_types       fallback for target_titles
 *   search_queries   complete LinkedIn searches written by the user, booleans allowed; one is used per run
 *   search_keywords  phrases for the search box; fallback: target_titles
 *   avoid_companies  companies never applied to
 *   work_modes       any of remote / hybrid / onsite (also "remoto", "hibrido", "presencial")
 *   posted_within    day | 2days | 3days | week | month   (how recent the LinkedIn posting must be; default week)
 *   equivalents      the user's own words that mean the same, one rule per line: "selección = reclutamiento = recruiting"
 *
 * Every comparison goes through lib/text-match.js: no difference with upper case, accents, plural or
 * gender, linking words, abbreviations, words used for the same thing and typing mistakes in long words.
 */
const tm = require('./text-match');
const { norm } = tm;

function val(p) {
  if (p && typeof p === 'object' && !Array.isArray(p) && 'value' in p) return p.value;
  return p;
}
function list(p) {
  const v = val(p);
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

/** The text has the phrase, compared with lib/text-match.js (m: the user's matcher). */
function containsPhrase(text, phrase, m = tm.base) {
  return m.has(text || '', phrase || '');
}

function targetTitles(prefs = {}, profile = {}) {
  let t = list(prefs.target_titles);
  if (!t.length) t = list(prefs.role_types);
  if (!t.length && profile.title) t = [String(profile.title)];
  return t;
}

/** Returns { pass, reason }. A title passes when it contains a target phrase and no avoided phrase. */
function checkTitle(title, prefs = {}, profile = {}) {
  const targets = targetTitles(prefs, profile);
  if (!targets.length) return { pass: false, reason: 'no_target_titles_configured' };
  // Lists that discard or restrict keep each language apart; the titles looked for also take translations.
  const m = tm.forPrefs(prefs);
  const avoided = m.find(title || '', list(prefs.avoid));
  if (avoided) return { pass: false, reason: `avoid:${avoided}` };
  const hit = tm.forPrefs(prefs, true).find(title || '', targets);
  if (!hit) return { pass: false, reason: 'off_target_title' };
  // Words that only count in senior positions (e.g. "analista", "analyst").
  const only = m.find(title || '', list(prefs.senior_only));
  if (only && !isSenior(title)) return { pass: false, reason: `not_senior:${only}` };
  return { pass: true, reason: `target:${hit}` };
}

/** Senior, Sr or Señor in the title; semi senior and Ssr do not count. */
// Each word also covers its equivalents and forms (lib/text-match.js): "sr", "líder", "leader", "gerente", "jefa", "coordinator".
const SEMI = ['semi senior'];
const SENIOR = ['senior', 'lead', 'manager', 'head', 'director', 'jefe', 'coordinador', 'principal', 'staff'];
function isSenior(title) {
  if (tm.wide.find(title || '', SEMI)) return false;
  // Senior, or a leadership title ("Lead Recruiter", "Recruiting Manager", "Jefe de Selección").
  return !!tm.wide.find(title || '', SENIOR);
}

/**
 * Screen the job description for phrases the user rules out
 * (job_preferences.description_avoid, e.g. ["comisiones", "venta directa"]).
 * Returns { pass, reason }. With no list or no text there is nothing to check.
 */
/**
 * Signs of a fake job offer, in any source: asking the candidate for money, "simple tasks" paid by
 * the day, contact by Telegram, asking the candidate to invest. Returns a short label or null.
 */
const SCAM = [
  ['pide dinero', /(deb(e|es|eras|era|era) (abonar|pagar|depositar|transferir)|tenes que (abonar|pagar|depositar|transferir)|costo de inscripcion|cuota de (inscripcion|ingreso)|pago (previo|inicial|por adelantado)|registration fee|pay (a|the|an) (fee|deposit)|starter kit fee)/],
  ['tareas pagadas por dia', /(tareas? (simples?|sencillas?) (desde|en|con) (tu |el )?(celular|casa|telefono)|dar (likes|me gusta)|calificar (productos|hoteles|apps)|ganancias? diarias?|daily earnings|gana (hasta )?(usd |us\$ ?|\$ ?)\d[\d.,]* (por|al|cada) dia|earn \$?\d[\d,]* (per|a) day)/],
  ['contacto por Telegram', /(contact|escrib|envi|comunic|mand|write|message|reach)[a-z]* [^.\n]{0,40}telegram/],
  ['pide invertir', /(inversion (inicial|minima)|(tenes|debes|deberas|tendras) que invertir|investment (required|of))/],
];
function scamSign(text) {
  const t = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  const hit = t && SCAM.find(([, re]) => re.test(t));
  return hit ? hit[0] : null;
}

function checkDescription(text, prefs = {}) {
  const scam = scamSign(text);
  if (scam) return { pass: false, reason: `possible_scam:${scam}` };
  const phrases = list(prefs.description_avoid);
  if (!phrases.length || !text) return { pass: true, reason: 'not_checked' };
  const hit = tm.forPrefs(prefs).find(text, phrases);
  return hit ? { pass: false, reason: `description_avoid:${hit}` } : { pass: true, reason: 'description_ok' };
}

/** Returns { pass, reason }: false when the job publishes a salary below the user's minimum (lib/salary.js). */
function checkSalary(job, prefs = {}) {
  const r = require('./salary').checkSalary(job, { salary_min_usd: val(prefs.salary_min_usd), salary_min_ars: val(prefs.salary_min_ars) });
  return { pass: r.pass, reason: r.reason, salary: r.salary };
}

/** Returns { pass, reason }: false when the company is on the user's avoid list (whole-phrase match). */
function checkCompany(company, prefs = {}) {
  const hit = tm.forPrefs(prefs).find(company || '', list(prefs.avoid_companies));
  return hit ? { pass: false, reason: `avoid_company:${hit}` } : { pass: true, reason: 'company_ok' };
}

function searchKeywords(prefs = {}, profile = {}) {
  // The user's own boolean searches win; one is picked per run so that
  // consecutive runs do not repeat the same query.
  const queries = list(prefs.search_queries);
  if (queries.length) return queries[Math.floor(Math.random() * queries.length)];
  let k = list(prefs.search_keywords);
  if (!k.length) k = targetTitles(prefs, profile);
  return k.slice(0, 6).map((s) => `"${s.replace(/"/g, '')}"`).join(' OR ');
}

const WT = [
  [/onsite|on site|presencial|oficina/, '1'],
  [/remote|remoto/, '2'],
  [/hybrid|hibrido/, '3'],
];
const TPR = { day: 'r86400', '2days': 'r172800', '3days': 'r259200', week: 'r604800', month: 'r2592000' };

/** Easy Apply search URL. Work mode and recency filters are added only when the user stated them. */
function buildSearchUrl({ keywords, location, prefs = {}, posted, easyApply = true }) {
  const params = new URLSearchParams();
  params.set('keywords', keywords);
  if (location) params.set('location', location);
  if (easyApply) params.set('f_AL', 'true');
  const modes = list(prefs.work_modes).concat(list(prefs.modalities)).map(norm);
  const codes = [...new Set(WT.filter(([re]) => modes.some((m) => re.test(m))).map(([, c]) => c))].sort();
  if (codes.length && codes.length < 3) params.set('f_WT', codes.join(','));
  const within = posted || val(prefs.posted_within) || 'week';
  if (TPR[within]) params.set('f_TPR', TPR[within]);
  params.set('sortBy', 'DD');
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

/**
 * On-site and hybrid jobs must be in one of the places the user accepts (prefs.onsite_places).
 * Remote jobs pass anywhere. The place is the first part of the location, before the first comma
 * ("Mar del Plata, Provincia de Buenos Aires" is Mar del Plata). No list or no location: passes.
 */
// "caba" (or "capital federal") in the list also covers its comunas and barrios.
const CABA = ['caba', 'capital federal', 'ciudad autonoma de buenos aires', 'ciudad de buenos aires',
  'agronomia', 'almagro', 'balvanera', 'barracas', 'belgrano', 'boedo', 'caballito', 'chacarita', 'coghlan', 'colegiales', 'constitucion',
  'flores', 'floresta', 'la boca', 'la paternal', 'liniers', 'mataderos', 'monte castro', 'monserrat', 'montserrat', 'microcentro', 'nueva pompeya',
  'nunez', 'palermo', 'parque avellaneda', 'parque chacabuco', 'parque chas', 'parque patricios', 'puerto madero', 'recoleta', 'retiro',
  'saavedra', 'san cristobal', 'san nicolas', 'san telmo', 'velez sarsfield', 'versalles', 'villa crespo', 'villa del parque', 'villa devoto',
  'villa general mitre', 'villa lugano', 'villa luro', 'villa ortuzar', 'villa pueyrredon', 'villa real', 'villa riachuelo', 'villa santa rita',
  'villa soldati', 'villa urquiza', 'tribunales', 'once'];

function checkLocation(location, prefs = {}) {
  let places = list(prefs.onsite_places);
  const caba = places.some((p) => ['caba', 'capital federal'].includes(norm(p)));
  if (caba) places = [...new Set(places.concat(CABA))];
  const loc = String(location || '').split('|')[0].trim();
  if (!places.length || !loc) return { pass: true, reason: 'location_not_checked' };
  const n = norm(loc);
  if (/remot|remote|teletrabajo|home office/.test(n)) return { pass: true, reason: 'remote' };
  const place = loc.replace(/\([^)]*\)/g, ' ').split(',')[0].trim();
  if (/^(argentina|latam|latinoamerica|america latina)$/.test(norm(place))) return { pass: true, reason: 'country_only' };
  if (caba && /^comuna \d+$/.test(norm(place))) return { pass: true, reason: 'place:caba' };
  const ok = tm.forPrefs(prefs).find(place, places);
  return ok ? { pass: true, reason: `place:${ok}` } : { pass: false, reason: `location:${loc}` };
}

module.exports = {
  checkLocation, containsPhrase,
  checkSalary, checkTitle, isSenior, checkDescription, scamSign, checkCompany, targetTitles, searchKeywords, buildSearchUrl, list, val };
