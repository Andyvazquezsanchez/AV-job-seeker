'use strict';
/**
 * portales.js: search addresses and result parsing for Argentine job sites
 * (Computrabajo, Bumeran, ZonaJobs). Pure functions; the browser work is in
 * scripts/portales.js. Nothing here applies to a job.
 *
 * The result pages are read without relying on their class names, which change often:
 * job links are recognized by their address, and company, place and date come from the
 * text lines of the card around each link.
 */
const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slug = (s) => strip(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Recency filters of each site, for the most days wanted. Computrabajo: ?pubdate=1|3|7|15|30.
// Bumeran and ZonaJobs: "empleos-publicacion-menor-a-2-dias-busqueda-...". The date shown on each
// card is checked too (ageDays), so a wider site filter never lets an older job through.
const ctAge = (days) => `?pubdate=${[1, 3, 7, 15, 30].find((d) => d >= days) || 30}`;
const naventAge = (days) => (days <= 1 ? 'publicacion-menor-a-2-dias-' : days <= 2 ? 'publicacion-menor-a-3-dias-' : days <= 3 ? 'publicacion-menor-a-4-dias-'
  : days <= 7 ? 'publicacion-menor-a-1-semana-' : days <= 15 ? 'publicacion-menor-a-15-dias-' : 'publicacion-menor-a-1-mes-');

const SITES = {
  computrabajo: {
    label: 'Computrabajo',
    search: (kw, days) => `https://ar.computrabajo.com/trabajo-de-${slug(kw)}${days ? ctAge(days) : ''}`,
    job: /^https:\/\/ar\.computrabajo\.com\/ofertas-de-trabajo\/oferta-de-trabajo-de-[^?#]+/i,
  },
  bumeran: {
    label: 'Bumeran',
    search: (kw, days) => `https://www.bumeran.com.ar/empleos-${days ? naventAge(days) : ''}busqueda-${slug(kw)}.html`,
    job: /^https:\/\/www\.(bumeran|zonajobs)\.com\.ar\/empleos\/[^?#]+-\d+\.html/i,
  },
  zonajobs: {
    label: 'ZonaJobs',
    search: (kw, days) => `https://www.zonajobs.com.ar/empleos-${days ? naventAge(days) : ''}busqueda-${slug(kw)}.html`,
    job: /^https:\/\/www\.(zonajobs|bumeran)\.com\.ar\/empleos\/[^?#]+-\d+\.html/i,
  },
};
const ALL = Object.keys(SITES);

/** Days of a recency setting (day | 2days | 3days | week | month); default a week. */
const DAYS = { day: 1, '2days': 2, '3days': 3, week: 7, month: 30 };
const postedDays = (v) => DAYS[String(v || '').trim()] || 7;

const UNIT = { dia: 1, semana: 7, mes: 30 };
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/**
 * Age in days of the date a card shows: "Hace 7 horas" 0, "Ayer" 1, "Publicado hace 3 días" 3,
 * "Actualizado hace más de 15 días" 16, "15 de noviembre" counted from today. Unknown: null.
 */
function ageDays(text, now = new Date()) {
  const n = strip(text).trim();
  if (!n) return null;
  if (/\b(minutos?|horas?|hoy|recien)\b/.test(n)) return 0;
  if (/\bayer\b/.test(n)) return 1;
  const num = (s) => (/^un[a]?$/.test(s) ? 1 : Number.parseInt(s, 10));
  let m = n.match(/mas de (\d+|una?) (dia|semana|mes)/);
  if (m) return num(m[1]) * UNIT[m[2]] + 1;
  m = n.match(/(\d+|una?) (dia|semana|mes)/);
  if (m) return num(m[1]) * UNIT[m[2]];
  m = n.match(/(\d{1,2}) de ([a-z]+)/);
  if (m && MONTHS.includes(m[2])) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let d = new Date(now.getFullYear(), MONTHS.indexOf(m[2]), Number(m[1]));
    if (d > today) d = new Date(now.getFullYear() - 1, MONTHS.indexOf(m[2]), Number(m[1]));
    return Math.round((today - d) / 86400000);
  }
  return null;
}

/** A card line that says the user already applied on the site (seen when signed in there). */
const APPLIED_LINE = /^(ya aplicaste|ya te postulaste|te postulaste|ya estas postulad[oa]|postulad[oa])\b/;
const appliedInCard = (lines) => (lines || []).some((l) => APPLIED_LINE.test(strip(l).trim()));

/**
 * Already applied, by the tracking records: same company and title (lib/match), or a row of the
 * user's sheet that has the site as the company ("Computrabajo" / "Analista (Acme)"): then the
 * company comes from the parentheses, or else the title alone is compared, only for jobs that do
 * not show their company either (a job that names its company is never hidden by a title alone).
 */
const SITE_NAME = /^(computrabajo|bumeran|zonajobs|zona jobs)$/;
const NO_COMPANY = /^(empresa sin nombre|confidencial|empresa confidencial|importante|reconocida|prestigiosa|empresa (lider|del|de|en|con)\b)/;
function alreadyApplied(job, apps) {
  const { findMatch, normCompany, normRole } = require('./match');
  const known = [];
  const titles = new Set();
  for (const a of apps || []) {
    if (!SITE_NAME.test(normCompany(a.company))) { known.push(a); continue; }
    const m = String(a.role || '').match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (m) known.push({ company: m[2], role: m[1] });
    titles.add(normRole(m ? m[1] : a.role));
  }
  if (job.company && findMatch({ company: job.company, role: job.role }, known)) return true;
  const hidden = !job.company || NO_COMPANY.test(strip(job.company).trim());
  return hidden && titles.has(normRole(job.role));
}

/** The site a job address belongs to. */
function sourceOf(url) {
  const u = String(url || '');
  if (/computrabajo\.com/i.test(u)) return 'computrabajo';
  if (/zonajobs\.com\.ar/i.test(u)) return 'zonajobs';
  if (/bumeran\.com\.ar/i.test(u)) return 'bumeran';
  return null;
}

const PLACES = ['capital federal', 'caba', 'ciudad de buenos aires', 'buenos aires', 'gba', 'cordoba', 'santa fe', 'mendoza', 'tucuman', 'salta', 'neuquen',
  'chubut', 'rio negro', 'entre rios', 'corrientes', 'misiones', 'san juan', 'san luis', 'jujuy', 'la pampa', 'la rioja', 'catamarca', 'santiago del estero',
  'chaco', 'formosa', 'santa cruz', 'tierra del fuego', 'argentina', 'remoto', 'home office'];
const NOISE = /^(postulacion rapida|postulacion facil|presencial|remoto|hibrido|destacad[oa]|nuevo|nueva|urgente|se precisa urgente(\s+empleo destacado)?|empleo destacado|\$ ?[\d.,]+.*|oferta oculta|confidencial|empresa confidencial|ver oferta|postularme|postulate|guardar|compartir|full.?time|part.?time|jornada (completa|parcial|partida|reducida)|tiempo (completo|parcial)|\d+ postulantes?|recomendad[oa]|apto discapacidad|\+\d+|salario a convenir)$/;
const DATE = /^(hace|publicado|publicada|actualizado|actualizada|ayer|hoy|mas de|\d{1,2} de [a-z]+)/;

/** Company, place and date from the text lines of a result card. */
function parseCard(title, lines) {
  const t = strip(title).trim();
  const out = { company: '', location: '', posted: '' };
  let hidden = false; // "Confidencial": the company stays empty, no other line takes its place
  for (const raw of (lines || []).map((l) => String(l || '').trim()).filter(Boolean)) {
    const l = raw.replace(/^\d[,.]\d\s+/, '').trim(); // "4,3 Empresa" (rating, then name)
    const n = strip(l);
    if (!l || n === t || /^\d[,.]\d$/.test(l) || l.length > 80) continue; // long lines are description text
    if (!out.posted && DATE.test(n)) { out.posted = l; continue; }
    if (!out.location && (PLACES.some((p) => n === p || n.endsWith(`, ${p}`) || n.startsWith(`${p},`) || n.includes(`, ${p}`)) || /\bgba\b/.test(n))) { out.location = l; continue; }
    if (/^(empresa )?confidencial$/.test(n)) { hidden = true; continue; }
    if (NOISE.test(n) || l.length > 80 || l.length < 2) continue;
    if (!out.company && !hidden) out.company = l;
  }
  return out;
}

/** Code for the page: job links with the text lines of their card. */
function extractCode(site) {
  return `(function(){
    var re = new RegExp(${JSON.stringify(SITES[site].job.source)}, 'i');
    var norm = function (u) { return (u || '').split('#')[0].split('?')[0]; };
    var jobs = function (el) { var s = {}; el.querySelectorAll('a[href]').forEach(function (x) { var u = norm(x.href); if (re.test(u)) s[u] = 1; }); return Object.keys(s).length; };
    var up = function (el) { var p = el.parentElement; return p && p !== document.body && p.tagName !== 'MAIN' && !p.querySelector('h1') && jobs(p) <= 1; };
    var dated = /^(hace |publicad|actualizad|ayer$|hoy$)/i;
    var seen = {}, out = [];
    document.querySelectorAll('a[href]').forEach(function (a) {
      var href = norm(a.href);
      if (!re.test(href) || seen[href]) return;
      seen[href] = 1;
      // The card: its article, or else the largest block around the link that holds no other job.
      var card = a.closest('article');
      if (!card) { card = a; while (up(card)) card = card.parentElement; }
      var h = card.querySelector('h1,h2') || Array.prototype.filter.call(card.querySelectorAll('h3'), function (x) { return !dated.test((x.innerText || '').trim()); })[0];
      var title = ((h && h.innerText) || a.innerText || a.getAttribute('title') || '').trim().split('\\n')[0];
      var lines = (card.innerText || '').split('\\n').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 16);
      out.push({ url: href, title: title.slice(0, 200), lines: lines });
    });
    var text = (document.body && document.body.innerText || '').slice(0, 3000).toLowerCase();
    var blocked = /captcha|verify you are human|verifica que eres humano|access denied|acceso denegado|just a moment|attention required/.test(text) && out.length === 0;
    return JSON.stringify({ jobs: out.slice(0, 80), blocked: blocked, title: document.title });
  })()`;
}

/** Code for a job page: its description text. */
const DESCRIPTION_CODE = `(function(){
  var text = function (el) { return ((el && el.innerText) || '').trim(); };
  var largest = function (els) { var best = ''; for (var i = 0; i < els.length; i++) { var t = text(els[i]); if (t.length > best.length && t.length < 20000) best = t; } return best; };
  // 1. The description block (id or class with "descrip"); 2. the section under a "Descripción"
  // heading; 3. the main content. The first two leave out the related searches and similar jobs.
  var best = largest(document.querySelectorAll('[id*="descrip" i],[class*="descrip" i]'));
  if (best.length < 200) best = largest(Array.prototype.filter.call(document.querySelectorAll('h1,h2,h3,h4'), function (h) { return /descripci[oó]n/i.test(text(h)); }).map(function (h) { return h.parentElement; }));
  if (best.length < 200) best = largest(document.querySelectorAll('[class*="detail" i],article,main'));
  if (best.length < 200) best = text(document.body);
  return JSON.stringify(best.slice(0, 8000));
})()`;

/** Code for a job page: true when the page shows that the user already applied (signed in on the site). */
const APPLIED_CODE = `(function(){
  var re = /^(ya aplicaste|ya te postulaste|te postulaste|ya est[aá]s postulad|postulad[oa]$)/i;
  var els = document.querySelectorAll('div,span,p,button,a,strong,b,h2,h3,h4,label');
  for (var i = 0; i < els.length; i++) {
    var e = els[i], t = (e.innerText || '').trim();
    if (!t || t.length > 60 || !re.test(t)) continue;
    if (e.offsetParent === null && !e.getClientRects().length) continue; // hidden: not applied
    return JSON.stringify(true);
  }
  return JSON.stringify(false);
})()`;

module.exports = { SITES, ALL, slug, sourceOf, parseCard, extractCode, DESCRIPTION_CODE, APPLIED_CODE, postedDays, ageDays, appliedInCard, alreadyApplied };
