'use strict';
/**
 * ats-boards.js: open jobs of companies that publish them through the public job-board APIs of
 * Greenhouse, Lever and Ashby. Read only: public data, no account, no key, no browser.
 *
 *   parseBoard(text)  -> { type, slug, url } for a careers page address, or null
 *   fetchBoard(board) -> [{ id, role, company, location, url, description, remote }]
 *   placeOk(location, remote, prefs, country) -> { pass, reason }
 *
 * Endpoints (documented by each provider for building careers pages):
 *   Greenhouse  https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 *   Lever       https://api.lever.co/v0/postings/{slug}?mode=json   (api.eu.lever.co for EU boards)
 *   Ashby       https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true
 */
const { strip } = require('./match');

const LABEL = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby' };

/** The board behind a careers address ("https://jobs.lever.co/acme", "boards.greenhouse.io/acme", "ashby:acme"). */
function parseBoard(text) {
  const raw = String(text || '').trim();
  const short = raw.match(/^(greenhouse|lever|lever-eu|ashby)\s*:\s*([A-Za-z0-9._-]+)$/i);
  if (short) {
    const t = short[1].toLowerCase();
    return t === 'lever-eu' ? { type: 'lever', slug: short[2], eu: true, url: raw } : { type: t, slug: short[2], url: raw };
  }
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const first = u.pathname.split('/').filter(Boolean)[0] || '';
  const valid = (s) => /^[A-Za-z0-9._-]{1,80}$/.test(s);
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const token = u.searchParams.get('for') || (first !== 'embed' ? first : '');
    return valid(token) ? { type: 'greenhouse', slug: token, url: raw } : null;
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') return valid(first) ? { type: 'lever', slug: first, eu: host.includes('.eu.'), url: raw } : null;
  if (host === 'jobs.ashbyhq.com') {
    let name = first; try { name = decodeURIComponent(first); } catch { /* keep */ }
    return /^[A-Za-z0-9 ._-]{1,80}$/.test(name) ? { type: 'ashby', slug: name, url: raw } : null;
  }
  return null;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
/** Plain text from job HTML, keeping line breaks between blocks and list items. */
function htmlText(html) {
  const h = decode(html); // Greenhouse sends the HTML itself escaped.
  return decode(h.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/ul|\/ol)[^>]*>/gi, '\n').replace(/<\s*li[^>]*>/gi, '\n- ').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const nice = (slug) => String(slug).replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

async function getJson(url, timeoutMs = 20000) {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'JobSeeker (busqueda personal)' }, signal: AbortSignal.timeout(timeoutMs) });
  if (r.status === 404) throw new Error('no existe esa página de empleo (revisá la dirección)');
  if (!r.ok) throw new Error(`el sitio respondió ${r.status}`);
  return r.json();
}

/** Normalized jobs of one board. */
async function fetchBoard(board, get = getJson) {
  const s = encodeURIComponent(board.slug);
  if (board.type === 'greenhouse') {
    const [meta, data] = await Promise.all([
      get(`https://boards-api.greenhouse.io/v1/boards/${s}`).catch(() => ({})),
      get(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`),
    ]);
    const company = (meta && meta.name) || nice(board.slug);
    return (data.jobs || []).map((j) => ({
      id: String(j.id), role: j.title || '', company, location: (j.location && j.location.name) || '',
      url: j.absolute_url || '', description: htmlText(j.content || ''), remote: /remot/i.test((j.location && j.location.name) || ''),
    }));
  }
  if (board.type === 'lever') {
    const data = await get(`https://api.${board.eu ? 'eu.' : ''}lever.co/v0/postings/${s}?mode=json`);
    return (Array.isArray(data) ? data : []).map((j) => {
      const c = j.categories || {};
      const lists = (j.lists || []).map((l) => `${l.text || ''}\n${htmlText(l.content || '')}`).join('\n\n');
      return {
        id: String(j.id), role: j.text || '', company: nice(board.slug),
        location: [c.location, ...(Array.isArray(c.allLocations) ? c.allLocations : [])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' | '),
        url: j.hostedUrl || j.applyUrl || '', description: [j.descriptionPlain || htmlText(j.description || ''), lists, j.additionalPlain || ''].filter(Boolean).join('\n\n'),
        remote: j.workplaceType === 'remote' || /remot/i.test(c.location || ''),
      };
    });
  }
  if (board.type === 'ashby') {
    const data = await get(`https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=true`);
    return (data.jobs || []).filter((j) => j.isListed !== false).map((j) => ({
      id: String(j.id || j.jobUrl || j.title), role: j.title || '', company: nice(board.slug),
      location: [j.location, ...((j.secondaryLocations || []).map((x) => x && (x.location || x)))].filter((x) => typeof x === 'string' && x).join(' | '),
      url: j.jobUrl || j.applyUrl || '', description: j.descriptionPlain || htmlText(j.descriptionHtml || ''),
      remote: j.isRemote === true || j.workplaceType === 'Remote', salary: (j.compensation && j.compensation.compensationTierSummary) || null,
    }));
  }
  throw new Error(`tipo de página desconocido: ${board.type}`);
}

const WIDE = /\b(anywhere|worldwide|global|latam|latin america|latinoamerica|america latina|south america|sudamerica|americas)\b/;
/**
 * Whether the job's place works for the user: remote without another country, a wide
 * region (LATAM, worldwide), the user's country, or one of the on-site places they accept.
 */
function placeOk(location, remote, prefs = {}, country = 'Argentina') {
  const loc = String(location || '');
  const n = ` ${strip(loc)} `;
  if (!loc.trim()) return remote ? { pass: true, reason: 'remote' } : { pass: true, reason: 'location_not_checked' };
  const places = [country, ...(Array.isArray(prefs.onsite_places) ? prefs.onsite_places : [])].map((p) => strip(p)).filter(Boolean);
  if (places.some((p) => n.includes(` ${p} `))) return { pass: true, reason: 'place' };
  if (WIDE.test(n)) return { pass: true, reason: 'region' };
  const modes = Array.isArray(prefs.work_modes) && prefs.work_modes.length ? prefs.work_modes : ['remote', 'hybrid', 'onsite'];
  // "Remote" with nothing else named, or remote within the user's own country.
  const rest = n.replace(/\b(remote|remoto|remota|fully|full|100|home|office|anywhere|or|o|y|and|hybrid|hibrido)\b/g, ' ').replace(/[^a-z]/g, '');
  if ((remote || /\bremot/.test(n)) && !rest && modes.includes('remote')) return { pass: true, reason: 'remote' };
  return { pass: false, reason: `location:${loc.slice(0, 80)}` };
}

module.exports = { parseBoard, fetchBoard, placeOk, htmlText, LABEL };
