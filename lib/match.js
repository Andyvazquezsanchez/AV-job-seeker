'use strict';
/**
 * match.js: decide whether two job records are the same job, even when the
 * company or the title is written slightly differently in each place
 * ("Acme S.A." vs "ACME", "HR Business Partner Sr" vs "HR Business Partner Sr.").
 */

function strip(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const LEGAL = /\b(s a|sa|srl|s r l|sas|s a s|inc|llc|ltd|ltda|gmbh|corp|corporation|co|company|group|grupo|argentina|latam|global|international|holding|holdings)\b/g;

/** Company name without legal forms and generic words; falls back to the plain form if nothing is left. */
function normCompany(s) {
  const plain = strip(s);
  const core = plain.replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
  return core || plain;
}

function normRole(s) {
  return strip(s);
}

const words = (s) => s.split(' ').filter(Boolean);
/** True when every word of the shorter phrase appears, in order and contiguously, in the longer one. */
function containsPhrase(longer, shorter) {
  return shorter.length >= 4 && (` ${longer} `).includes(` ${shorter} `);
}

function sameCompany(a, b) {
  const x = normCompany(a), y = normCompany(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // "mercadolibre" vs "mercado libre", "tiendanube" vs "tienda nube"
  if (x.length >= 5 && x.replace(/ /g, '') === y.replace(/ /g, '')) return true;
  // "ypf" vs "ypf vmos punta colorada": one name is the start of the other
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 3 && words(l).slice(0, words(s).length).join(' ') === s;
}

/**
 * Compare a candidate job with a known one.
 * Returns 'same' (same company and same title), 'similar' (same company and one
 * title contains the other) or null.
 */
function compareJobs(a, b) {
  if (!sameCompany(a.company, b.company)) return null;
  const x = normRole(a.role), y = normRole(b.role);
  if (!x || !y) return null;
  if (x === y) return 'same';
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return containsPhrase(l, s) ? 'similar' : null;
}

/** First known job that matches, preferring an exact match. */
function findMatch(job, known) {
  let similar = null;
  for (const k of known) {
    const c = compareJobs(job, k);
    if (c === 'same') return { match: k, kind: 'same' };
    if (c === 'similar' && !similar) similar = k;
  }
  return similar ? { match: similar, kind: 'similar' } : null;
}

module.exports = { strip, normCompany, normRole, sameCompany, compareJobs, findMatch };
