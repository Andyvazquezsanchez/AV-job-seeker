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

const SITES = {
  computrabajo: {
    label: 'Computrabajo',
    search: (kw) => `https://ar.computrabajo.com/trabajo-de-${slug(kw)}`,
    job: /^https:\/\/ar\.computrabajo\.com\/ofertas-de-trabajo\/oferta-de-trabajo-de-[^?#]+/i,
  },
  bumeran: {
    label: 'Bumeran',
    search: (kw) => `https://www.bumeran.com.ar/empleos-busqueda-${slug(kw)}.html`,
    job: /^https:\/\/www\.(bumeran|zonajobs)\.com\.ar\/empleos\/[^?#]+-\d+\.html/i,
  },
  zonajobs: {
    label: 'ZonaJobs',
    search: (kw) => `https://www.zonajobs.com.ar/empleos-busqueda-${slug(kw)}.html`,
    job: /^https:\/\/www\.(zonajobs|bumeran)\.com\.ar\/empleos\/[^?#]+-\d+\.html/i,
  },
};
const ALL = Object.keys(SITES);

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
const NOISE = /^(postulacion rapida|postulacion facil|presencial|remoto|hibrido|destacad[oa]|nuevo|nueva|urgente|oferta oculta|confidencial|empresa confidencial|ver oferta|postularme|postulate|guardar|compartir|full.?time|part.?time|jornada (completa|parcial|partida|reducida)|tiempo (completo|parcial)|\d+ postulantes?|recomendad[oa]|apto discapacidad|\+\d+|salario a convenir)$/;
const DATE = /^(hace|publicado|publicada|actualizado|actualizada|ayer|hoy|mas de|\d{1,2} de [a-z]+)/;

/** Company, place and date from the text lines of a result card. */
function parseCard(title, lines) {
  const t = strip(title).trim();
  const out = { company: '', location: '', posted: '' };
  for (const raw of (lines || []).map((l) => String(l || '').trim()).filter(Boolean)) {
    const l = raw.replace(/^\d[,.]\d\s+/, '').trim(); // "4,3 Empresa" (rating, then name)
    const n = strip(l);
    if (!l || n === t || /^\d[,.]\d$/.test(l)) continue;
    if (!out.posted && DATE.test(n)) { out.posted = l; continue; }
    if (!out.location && (PLACES.some((p) => n === p || n.endsWith(`, ${p}`) || n.startsWith(`${p},`) || n.includes(`, ${p}`)) || /\bgba\b/.test(n))) { out.location = l; continue; }
    if (NOISE.test(n) || l.length > 80 || l.length < 2) continue;
    if (!out.company) out.company = l;
  }
  return out;
}

/** Code for the page: job links with the text lines of their card. */
function extractCode(site) {
  return `(function(){
    var re = new RegExp(${JSON.stringify(SITES[site].job.source)}, 'i');
    var seen = {}, out = [];
    document.querySelectorAll('a[href]').forEach(function (a) {
      var href = (a.href || '').split('#')[0].split('?')[0];
      if (!re.test(href) || seen[href]) return;
      seen[href] = 1;
      var card = a.closest('article') || a.closest('[class*="box_offer"],[class*="aviso"],[class*="Aviso"],[class*="card"],[class*="Card"],li') || (a.parentElement && a.parentElement.parentElement) || a;
      var h = card.querySelector('h1,h2,h3');
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
  var best = '';
  var c = document.querySelectorAll('[class*="descrip"],[id*="descrip"],[class*="Descrip"],[class*="detail"],[class*="Detail"],article,main');
  for (var i = 0; i < c.length; i++) { var t = (c[i].innerText || '').trim(); if (t.length > best.length && t.length < 20000) best = t; }
  if (best.length < 200) best = (document.body && document.body.innerText || '').trim();
  return JSON.stringify(best.slice(0, 8000));
})()`;

module.exports = { SITES, ALL, slug, sourceOf, parseCard, extractCode, DESCRIPTION_CODE };
