'use strict';
/**
 * text-match.js: compares words the way a person reads them. Every filter of the program uses it:
 * job titles, words to avoid, "senior only" words, phrases in the description, companies, places,
 * jobs already applied to and the searches over posts.
 *
 *   - Upper and lower case, accents and punctuation do not count: "SELECCIÓN" = "seleccion",
 *     "RR.HH." = "RR HH", "Part-time" = "part time".
 *   - Linking words inside a phrase do not count: "Analista de RRHH" = "Analista RRHH"
 *     (de, del, la, el, en, para, y, and, of, the, for...). A phrase that starts with one keeps it:
 *     "La Plata" is not "Mar del Plata".
 *   - Singular and plural, masculine and feminine: "Analistas" = "Analista", "Coordinadora" = "Coordinador".
 *   - Words written together or apart: "Callcenter" = "Call center", "E-commerce" = "Ecommerce".
 *   - Abbreviations and words used for the same thing (SAME below, plus the user's own list):
 *     "Sr" = "Senior", "RRHH" = "Recursos Humanos", "Selección" = "Reclutamiento". The wide matcher also
 *     takes translations ("HR" = "RRHH", "Recruiter" = "Reclutador"); it is used where more matches help.
 *   - A typing mistake: one letter in words of five letters or more (counted without the plural or
 *     gender ending), two from nine: "Reclutamineto" = "Reclutamiento", "Coordinator" = "Coordinador".
 *     Short words, numbers, the first letter and the last one must be exact (two swapped last letters
 *     count as a mistake), so "Jr" never becomes "Sr" and "Trainee" never becomes "Trainer".
 *   - A phrase written between quotes ("reclutador") is compared word by word as written: only case,
 *     accents and punctuation are ignored.
 *
 * Pure functions, no dependencies.
 */

// Linking words: optional inside a phrase, on either side.
const FILLER = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'en', 'para', 'y', 'al', 'con', 'a', 'of', 'the', 'for', 'and', 'in', 'to', 'with']);

// Abbreviations written in job titles, replaced by the full words before comparing.
const ABBR = {
  hrbp: 'hr business partner', coord: 'coordinador', gte: 'gerente', ing: 'ingeniero', lic: 'licenciado', tec: 'tecnico',
  aux: 'auxiliar', asist: 'asistente', adm: 'administrativo', resp: 'responsable', mgr: 'manager', ejec: 'ejecutivo',
  ta: 'talent acquisition', tl: 'team leader', atc: 'atencion al cliente', rep: 'representante', mkt: 'marketing',
  rrpp: 'relaciones publicas', dev: 'developer',
};

// Words and phrases used for the same thing, by language (es, en, or both when the same form is used in
// either). Several professions, no candidate data. Within a language they are the same word for every
// filter. Across languages (a translation: "ventas" and "sales") they count only where more matches help:
// the titles the user looks for and jobs already applied to. Lists that discard or restrict ("avoid",
// "senior only") keep each language apart, because people often rule out a word in one language only.
const SAME = [
  // levels and roles
  { both: ['senior', 'sr', 'snr'], es: ['señor'] },
  { es: ['semi senior', 'semisenior', 'semi sr', 'ssr', 'semi señor'], en: ['mid level', 'mid senior'] },
  { both: ['junior', 'jr', 'jnr'], en: ['entry level'] },
  { es: ['pasante', 'pasantía', 'practicante', 'prácticas profesionales', 'becario'], en: ['intern', 'internship'] },
  { es: ['jefe', 'jefa'] },
  { es: ['gerente', 'gerenta'], en: ['manager'] },
  { es: ['líder', 'lideresa'], en: ['leader', 'lead'] },
  { es: ['coordinador'], en: ['coordinator'] },
  { es: ['analista'], en: ['analyst'] },
  { es: ['asistente'], en: ['assistant'] },
  { es: ['especialista'], en: ['specialist'] },
  { es: ['consultor'], en: ['consultant'] },
  { es: ['asesor'], en: ['advisor', 'adviser'] },
  { es: ['ejecutivo'], en: ['executive'] },
  { es: ['vendedor', 'representante de ventas', 'representante comercial'], en: ['salesman', 'saleswoman', 'sales representative', 'sales rep'] },
  { es: ['desarrollador', 'programador'], en: ['developer', 'programmer'] },
  { es: ['ingeniero'], en: ['engineer'] },
  { es: ['diseñador'], en: ['designer'] },
  { es: ['contador', 'contador público'], en: ['accountant'] },
  { es: ['abogado'], en: ['lawyer', 'attorney'] },
  { es: ['enfermero'], en: ['nurse'] },
  { es: ['médico'], en: ['physician'] },
  { es: ['docente', 'profesor'], en: ['teacher'] },
  { es: ['chofer'], en: ['driver'] },
  { es: ['cajero'], en: ['cashier'] },
  // areas
  { es: ['recursos humanos', 'rrhh', 'rr hh', 'r r h h', 'rh', 'capital humano', 'talento humano', 'gestión de personas'], en: ['human resources', 'hr', 'human capital'] },
  { es: ['selección', 'reclutamiento', 'reclutamiento y selección', 'selección y reclutamiento', 'selección de personal'], en: ['recruiting', 'recruitment', 'selection'] },
  { es: ['reclutador', 'selector', 'cazatalentos'], en: ['recruiter', 'talent hunter'], both: ['headhunter', 'head hunter'] },
  { es: ['adquisición de talento', 'atracción de talento', 'atracción del talento'], en: ['talent acquisition', 'talent attraction'] },
  { both: ['business partner'], es: ['socio de negocio', 'socio de negocios'] },
  { es: ['capacitación', 'formación', 'aprendizaje y desarrollo'], en: ['training', 'learning and development', 'l&d'] },
  { es: ['desarrollo organizacional'], en: ['organizational development'] },
  { es: ['liquidación de sueldos', 'liquidación de haberes', 'nómina', 'nóminas'], both: ['payroll'] },
  { es: ['compensaciones y beneficios'], en: ['compensation and benefits', 'comp and ben', 'comp & ben'], both: ['c&b'] },
  { es: ['beneficios'], en: ['benefits'] },
  { es: ['relaciones laborales'], en: ['labor relations', 'employee relations'] },
  { es: ['experiencia del empleado', 'experiencia del colaborador'], en: ['employee experience'] },
  { es: ['clima laboral', 'clima organizacional'] },
  { es: ['comunicación interna'], en: ['internal communication', 'internal communications'] },
  { es: ['marca empleadora'], en: ['employer branding', 'employer brand'] },
  { es: ['ventas', 'venta'], en: ['sales'] },
  { es: ['atención al cliente', 'atención a clientes', 'servicio al cliente'], en: ['customer service', 'customer care'] },
  { both: ['call center', 'callcenter', 'contact center'], es: ['centro de contacto', 'centro de llamadas'] },
  { es: ['soporte técnico', 'mesa de ayuda'], en: ['technical support'], both: ['help desk', 'helpdesk', 'service desk'] },
  { es: ['soporte'], en: ['support'] },
  { es: ['contabilidad'], en: ['accounting'] },
  { es: ['finanzas'], en: ['finance'] },
  { es: ['tesorería'], en: ['treasury'] },
  { es: ['impuestos'], en: ['tax', 'taxes'] },
  { es: ['auditoría'], en: ['audit', 'auditing'] },
  { es: ['compras', 'abastecimiento'], en: ['purchasing', 'procurement'] },
  { es: ['calidad'], en: ['quality'] },
  { es: ['mantenimiento'], en: ['maintenance'] },
  { es: ['seguridad e higiene', 'higiene y seguridad', 'seguridad y salud ocupacional'], en: ['health and safety'], both: ['hse', 'ehs'] },
  { both: ['marketing'], es: ['mercadotecnia'] },
  { both: ['social media'], es: ['redes sociales'] },
  // conditions
  { es: ['remoto', 'teletrabajo', 'trabajo a distancia'], en: ['remote', 'work from home'], both: ['home office'] },
  { es: ['híbrido', 'semipresencial'], en: ['hybrid'] },
  { es: ['presencial'], en: ['on site', 'onsite', 'in office'] },
  { es: ['medio tiempo', 'media jornada', 'tiempo parcial', 'jornada parcial'], both: ['part time'] },
  { es: ['tiempo completo', 'jornada completa'], both: ['full time'] },
  { es: ['temporal', 'temporario', 'eventual'], en: ['temporary'] },
  { both: ['freelance', 'freelancer'] },
  { es: ['comisiones', 'comisión'], en: ['commission', 'commissions'] },
  { es: ['inglés'], en: ['english'] },
];

/** Lower case, no accents, punctuation as spaces ("RR.HH." -> "rr hh"); "c++" and "c#" keep their signs. */
function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`´]/g, '')
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .split(' ').map((w) => w.replace(/^[+#]+/, '')).filter(Boolean).join(' ');
}

// Words that keep their last vowel because without it they are another word ("interna" is not "intern").
const KEEP = new Set(['interna', 'interno', 'calle']);

/** Without the plural and the gender ending: "analistas" -> "analist", "coordinadora" -> "coordinador". */
function stem(w) {
  if (!/^[a-z]+$/.test(w)) return w;
  let s = w;
  if (s.length > 4 && s.endsWith('s')) s = s.slice(0, -1);
  if (s.length > 4 && /[aeo]$/.test(s) && !KEEP.has(s)) s = s.slice(0, -1);
  return s;
}

/** Edit distance with two swapped letters counting as one; max + 1 when it is larger than max. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < low) low = v;
    }
    if (low > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Two word stems that are the same word, maybe with a typing mistake. */
function close(a, b) {
  if (a === b) return true;
  if (!/^[a-z]+$/.test(a) || !/^[a-z]+$/.test(b)) return false;
  const n = Math.min(a.length, b.length);
  if (n < 5 || a[0] !== b[0]) return false;
  // Words that differ at the end are usually different words ("trainee"/"trainer", "analista"/"analisis").
  const swapped = a.slice(0, -2) + a.slice(-1) + a.slice(-2, -1);
  if (a[a.length - 1] !== b[b.length - 1] && swapped !== b) return false;
  const max = n >= 9 ? 2 : 1;
  return distance(a, b, max) <= max;
}

/** The same single word, written differently ("Analistas" and "analista", "Reclutamineto" and "reclutamiento"). */
function sameWord(a, b) {
  const x = norm(a), y = norm(b);
  return !!x && (x === y || close(stem(x), stem(y)));
}

function rawTokens(s) {
  const out = [];
  for (const w of norm(s).split(' ')) {
    if (!w) continue;
    for (const x of (ABBR[w] || w).split(' ')) out.push({ w: x, s: stem(x), f: FILLER.has(x) });
  }
  return out;
}

function eq(p, t) {
  if (p.x) return !t.c && p.w === t.w;
  if (p.c || t.c) return !!(p.c && t.c) && p.c.some((id) => t.c.includes(id));
  if (p.f || t.f) return p.w === t.w;
  return p.s === t.s || close(p.s, t.s);
}
const joinEq = (a, b, x) => /^[a-z]+$/.test(a.w + b.w) && (a.w + b.w === x.w || stem(a.w + b.w) === x.s);
const plain = (t) => !t.f && !t.c;

/**
 * Does phrase P match the text T starting at T[j]? Returns the position after the match, or -1.
 * Linking words are optional inside the phrase (not before its first word); two words of one side
 * may be one word on the other, written exactly ("call center" / "callcenter").
 */
function walk(P, T, i, j) {
  if (i === P.length) return j;
  const p = P[i];
  if (p.f && i > 0) { const r = walk(P, T, i + 1, j); if (r >= 0) return r; }
  if (j >= T.length) return -1;
  const t = T[j];
  if (eq(p, t)) { const r = walk(P, T, i + 1, j + 1); if (r >= 0) return r; }
  if (t.f && i > 0 && !p.f) { const r = walk(P, T, i, j + 1); if (r >= 0) return r; }
  if (plain(p) && plain(t)) {
    const q = P[i + 1], u = T[j + 1];
    if (q && plain(q) && joinEq(p, q, t)) { const r = walk(P, T, i + 2, j + 1); if (r >= 0) return r; }
    if (u && plain(u) && joinEq(t, u, p)) { const r = walk(P, T, i + 1, j + 2); if (r >= 0) return r; }
  }
  return -1;
}

function contains(T, P) {
  if (!P.length) return false;
  for (let j = 0; j < T.length; j++) if (walk(P, T, 0, j) >= 0) return true;
  return false;
}

/** Group lines ("a = b = c") from the user's settings. */
function userGroups(lines) {
  const out = [];
  for (const l of lines || []) {
    const parts = String(l).split(/[=,;]/).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) out.push(parts);
  }
  return out;
}

/**
 * A matcher with the built-in equivalences plus the user's own (their lines win, in every language).
 * wide: translations count too.
 */
function compile(extra = [], wide = false) {
  const groups = userGroups(extra).map((both) => ({ both })).concat(SAME);
  const variants = [];
  groups.forEach((g, gi) => {
    for (const lang of ['both', 'es', 'en']) {
      for (const v of g[lang] || []) {
        const seq = rawTokens(v);
        const ids = wide ? [`#${gi}`] : lang === 'both' ? [`#${gi}es`, `#${gi}en`] : [`#${gi}${lang}`];
        if (seq.length && !seq[0].f) variants.push({ seq, ids });
      }
    }
  });
  variants.sort((a, b) => b.seq.length - a.seq.length);
  const byLetter = new Map();
  for (const v of variants) {
    const k = v.seq[0].w[0];
    if (!byLetter.has(k)) byLetter.set(k, []);
    byLetter.get(k).push(v);
  }
  // Each run of words that is one of the variants becomes the group's single word.
  // Typing mistakes keep the first letter, so only variants with the same first letter are tried.
  function canon(raw) {
    const out = [];
    for (let i = 0; i < raw.length;) {
      const t = raw[i];
      let hit = null;
      if (!t.f) {
        for (const v of byLetter.get(t.w[0]) || []) {
          const end = walk(v.seq, raw, 0, i);
          if (end > i) { hit = { c: v.ids, w: v.ids[0], s: v.ids[0], end }; break; }
        }
      }
      if (hit) { out.push(hit); i = hit.end; } else { out.push(t); i++; }
    }
    return out;
  }
  const cache = new Map();
  function tokens(s) {
    const key = String(s == null ? '' : s);
    let v = cache.get(key);
    if (!v) {
      const raw = rawTokens(key);
      v = { raw, can: canon(raw) };
      if (cache.size > 3000) cache.clear();
      cache.set(key, v);
    }
    return v;
  }
  // Two readings are compared: the words as written, and the words with each group as one word.
  // The first keeps "ventas" inside "Representante de ventas"; the second makes "HR" equal "RRHH".
  const has = (text, phrase) => {
    const q = String(phrase == null ? '' : phrase).trim().match(/^["\u201c\u201d](.+)["\u201c\u201d]$/);
    const T = tokens(text);
    if (q) return contains(T.raw, rawTokens(q[1]).map((x) => ({ ...x, x: true })));
    const P = tokens(phrase);
    return contains(T.raw, P.raw) || contains(T.can, P.can);
  };
  const content = (seq) => seq.filter((x) => !x.f);
  const whole = (A, B) => A.length > 0 && walk(A, B, 0, 0) === B.length;
  return {
    tokens,
    has,
    /** The first phrase of the list found in the text, or undefined. */
    find: (text, phrases) => (phrases || []).find((p) => String(p || '').trim() && has(text, p)),
    /** Same words in the same order, linking words aside ("Generalista de RRHH" = "Generalista RRHH"). */
    same: (a, b) => {
      const A = tokens(a), B = tokens(b);
      return whole(content(A.raw), content(B.raw)) || whole(content(A.can), content(B.can));
    },
    /** b's words are the first words of a ("YPF Luz" starts with "YPF"). */
    startsWith: (a, b) => {
      const A = tokens(a), B = tokens(b);
      return [[A.raw, B.raw], [A.can, B.can]].some(([x, y]) => content(y).length > 0 && walk(content(y), content(x), 0, 0) >= 0);
    },
  };
}

const base = compile();
const wide = compile([], true);
const byPrefs = new Map();
/**
 * The matcher for a user: built-in equivalences plus their own lines (job_preferences.equivalents).
 * wide: translations count too (for the titles the user looks for).
 */
function forPrefs(prefs, isWide = false) {
  const v = prefs && prefs.equivalents;
  const raw = v && typeof v === 'object' && !Array.isArray(v) && 'value' in v ? v.value : v;
  const lines = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\r?\n/) : [];
  if (!userGroups(lines).length) return isWide ? wide : base;
  const key = JSON.stringify([lines, isWide]);
  if (!byPrefs.has(key)) {
    if (byPrefs.size > 20) byPrefs.clear();
    byPrefs.set(key, compile(lines, isWide));
  }
  return byPrefs.get(key);
}

module.exports = {
  norm, stem, close, distance, sameWord, compile, base, wide, forPrefs, SAME, ABBR, FILLER,
  has: base.has, find: base.find, same: base.same, startsWith: base.startsWith,
};
