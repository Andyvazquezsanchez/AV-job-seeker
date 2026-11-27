'use strict';
/**
 * cv-choice.js: which CV to attach to a job, decided from the job itself.
 *
 *   1. The user's own rules ("Recruiter IT = CV_IT.pdf"), when a rule's words
 *      appear in the job title or description.
 *   2. The language of the job description: English -> English CV, Spanish ->
 *      Spanish CV, any other language (Portuguese, German...) -> English CV.
 *   3. When the description is too short or mixed: the job location. A country
 *      or city where Spanish is spoken -> Spanish CV; anywhere else -> English CV.
 *   4. Otherwise the Spanish CV (or the only one configured).
 *
 * Pure functions, no browser: the apply script passes the job text in and gets
 * back { lang, file, path, reason }. file is the name LinkedIn shows for that
 * CV (the PDF's file name), path the PDF on this computer, used to upload it
 * when LinkedIn no longer has it saved.
 */

const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Short, frequent words that only one of the languages uses.
const ES = new Set(('de la que el en los del las por con una para se es su al lo como mas sus pero esta este son ser desde hasta sobre entre cuando tambien '
  + 'buscamos ofrecemos requisitos experiencia empresa equipo trabajo conocimientos manejo funciones responsabilidades deseable excluyente '
  + 'nuestro nuestra nuestros seras sera tendras somos estamos anos puesto beneficios horario modalidad zona').split(' '));
const EN = new Set(('the and to of for with is you our we are on will be as your an or this that from at by have has who what it its they their '
  + 'experience team work skills requirements role about years responsibilities job company looking join offer ability strong '
  + 'knowledge benefits within across including preferred required').split(' '));
const PT = new Set(('voce nao sao tambem vaga nossa nosso pela pelo das dos ao em uma com experiencia conhecimento atividades requisitos beneficios trabalho '
  + 'empresa equipe desejavel').split(' '));
// Words shared by Spanish and Portuguese do not count for Portuguese.
for (const w of [...PT]) if (ES.has(w)) PT.delete(w);

/** 'es' | 'en' | 'other' | null (too short or too mixed to tell). */
function detectLanguage(text) {
  const words = strip(text).match(/[a-zñ]+/g) || [];
  let es = 0, en = 0, pt = 0;
  for (const w of words.slice(0, 4000)) {
    if (ES.has(w)) es++;
    if (EN.has(w)) en++;
    if (PT.has(w)) pt++;
  }
  const total = es + en + pt;
  if (total < 12) return null;
  if (pt / total > 0.3 && pt > es * 0.6) return 'other';
  if (en / total >= 0.62) return 'en';
  if (es / total >= 0.62) return 'es';
  return null;
}

const SPANISH_PLACES = ['argentina', 'buenos aires', 'caba', 'capital federal', 'cordoba', 'rosario', 'mendoza', 'tucuman', 'mar del plata', 'la plata',
  'neuquen', 'salta', 'santa fe', 'chile', 'santiago', 'valparaiso', 'uruguay', 'montevideo', 'paraguay', 'asuncion', 'bolivia', 'peru', 'lima',
  'arequipa', 'ecuador', 'quito', 'guayaquil', 'colombia', 'bogota', 'medellin', 'barranquilla', 'venezuela', 'caracas', 'mexico', 'cdmx',
  'guadalajara', 'monterrey', 'guatemala', 'honduras', 'el salvador', 'nicaragua', 'costa rica', 'panama', 'cuba', 'republica dominicana',
  'santo domingo', 'puerto rico', 'espana', 'spain', 'madrid', 'barcelona', 'valencia', 'sevilla', 'malaga', 'bilbao', 'latam', 'latinoamerica',
  'america latina'];
const OTHER_PLACES = ['united states', 'estados unidos', 'usa', 'canada', 'brasil', 'brazil', 'sao paulo', 'rio de janeiro', 'portugal', 'lisboa', 'lisbon',
  'united kingdom', 'reino unido', 'london', 'londres', 'ireland', 'irlanda', 'dublin', 'germany', 'alemania', 'berlin', 'france', 'francia', 'paris',
  'netherlands', 'paises bajos', 'amsterdam', 'italy', 'italia', 'switzerland', 'suiza', 'poland', 'polonia', 'india', 'singapore', 'australia',
  'new york', 'california', 'texas', 'florida', 'miami', 'toronto', 'emea', 'north america', 'europe', 'europa'];

const hasPlace = (text, place) => new RegExp(`(^|[^a-z])${place.replace(/ /g, '\\s+')}([^a-z]|$)`).test(text);

/** 'es' | 'en' | null, from a LinkedIn location line such as "Buenos Aires, Argentina (Híbrido)". */
function locationLanguage(location) {
  const t = strip(location);
  if (!t.trim()) return null;
  if (OTHER_PLACES.some((p) => hasPlace(t, p))) return 'en';
  if (SPANISH_PLACES.some((p) => p && hasPlace(t, p))) return 'es';
  return null;
}

/** File name as LinkedIn shows it, from a path on this computer. */
function baseName(p) {
  const s = String(p || '').trim().replace(/^["']|["']$/g, '');
  if (!s) return '';
  return s.split(/[\\/]/).pop();
}

/** Comparable form of a CV name: no accents, no case, no extension, only letters and digits. */
function normName(name) {
  return strip(name).replace(/\.(pdf|docx?|odt|rtf)$/i, '').replace(/[^a-z0-9]+/g, '');
}

/** True when a name shown in LinkedIn is the wanted CV (exact, or one contains the other when long enough). */
function sameCv(shown, wanted) {
  const a = normName(shown), b = normName(wanted);
  if (!a || !b) return false;
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 6 && l.includes(s);
}

/** The CVs the user configured: { es: {file, path}|null, en: ..., rules: [{words, file, path}] }. */
function configured(settings = {}) {
  const one = (p) => (p && String(p).trim() ? { file: baseName(p), path: String(p).trim().replace(/^["']|["']$/g, '') } : null);
  const rules = [];
  const map = settings.cv_rules && typeof settings.cv_rules === 'object' ? settings.cv_rules : {};
  for (const [words, target] of Object.entries(map)) {
    const w = String(words || '').trim();
    const t = String(target || '').trim();
    if (!w || !t) continue;
    const isPath = /[\\/]/.test(t);
    rules.push({ words: w, file: baseName(t), path: isPath ? t : null });
  }
  return { es: one(settings.cv_path), en: one(settings.cv_path_en), rules };
}

// Compared like every filter (lib/text-match.js): case, accents, plural, equivalents, typing mistakes.
function containsWords(text, words) {
  return String(words || '').trim().length > 0 && require('./text-match').has(text || '', words);
}

const LANG_NAME = { es: 'español', en: 'inglés' };

/**
 * Decide the CV for one job.
 * job: { title, description, location }
 * Returns { lang, file, path, reason } or { file: null, reason } when no CV is configured.
 */
function chooseCv(job = {}, settings = {}) {
  const cvs = configured(settings);
  if (!cvs.es && !cvs.en && !cvs.rules.length) return { lang: null, file: null, path: null, reason: 'no hay CV configurados: queda el que LinkedIn tenga marcado' };

  for (const r of cvs.rules) {
    if (containsWords(job.title, r.words) || containsWords(job.description, r.words)) {
      // A rule may name a CV by file only; the path then comes from the language CVs if it is one of them.
      const known = [cvs.es, cvs.en].find((c) => c && sameCv(c.file, r.file));
      return { lang: null, file: r.file, path: r.path || (known && known.path) || null, reason: `regla "${r.words}"` };
    }
  }

  const pick = (lang, why) => {
    const want = cvs[lang];
    if (want) return { lang, file: want.file, path: want.path, reason: why };
    const other = cvs[lang === 'es' ? 'en' : 'es'];
    return { lang: lang === 'es' ? 'en' : 'es', file: other.file, path: other.path, reason: `${why}, pero solo hay CV en ${LANG_NAME[lang === 'es' ? 'en' : 'es']}` };
  };
  if (!cvs.es || !cvs.en) {
    const only = cvs.es ? 'es' : cvs.en ? 'en' : null;
    if (only) return { lang: only, file: cvs[only].file, path: cvs[only].path, reason: `es el único CV cargado` };
  }

  const d = detectLanguage(job.description);
  if (d === 'en') return pick('en', 'el aviso está en inglés');
  if (d === 'other') return pick('en', 'el aviso está en otro idioma');
  if (d === 'es') return pick('es', 'el aviso está en español');

  const l = locationLanguage(job.location);
  if (l === 'en') return pick('en', 'el puesto es fuera de países de habla hispana');
  if (l === 'es') return pick('es', 'el puesto es en un país de habla hispana');

  const t = detectLanguage(`${job.title || ''} ${job.description || ''}`);
  if (t === 'en') return pick('en', 'el aviso parece estar en inglés');
  return pick('es', 'no pude determinar el idioma: uso el de español');
}

module.exports = { chooseCv, detectLanguage, locationLanguage, sameCv, normName, baseName, configured, LANG_NAME };
