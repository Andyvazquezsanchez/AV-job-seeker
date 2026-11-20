'use strict';
/**
 * answers.js: decides how a form question may be answered. Pure functions.
 *
 * The rule: a question is answered only with something the user actually
 * stated. Sources, in order:
 *   1. the question bank   users.data.form_answers.qa        { "<question>": "<answer>" }
 *   2. experience by topic users.data.form_answers.experience_years { "<topic>": <years> }
 *   3. explicit keys       form_answers.salary_<currency>, notice_period, english_level, ...
 *   4. contact and identity data handled by the form filler itself ("legacy")
 * Anything else is "unknown": the application stops and the question is put
 * in front of the user. Nothing is guessed.
 *
 * resolve() returns one of:
 *   { kind: 'answer', value }   use this value
 *   { kind: 'legacy' }          a contact/consent field the existing filler handles with DB data
 *   { kind: 'unknown' }         no stated answer: do not fill, do not guess
 */

function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\*+/g, ' ')
    .replace(/\b(required|obligatorio|optional|opcional)\b/g, ' ')
    .replace(/[¿?¡!:;.,()\[\]"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';

const YES = ['yes', 'si', 'sim', 'oui', 'ja', 'true'];
const NO = ['no', 'nao', 'non', 'nein', 'false'];

/** Find the option that corresponds to a stated answer. Returns the option text or null. */
function matchOption(answer, options) {
  if (!Array.isArray(options) || !options.length) return null;
  const a = norm(answer);
  if (!a) return null;
  const normed = options.map((o) => ({ raw: o, n: norm(o) }));
  let hit = normed.find((o) => o.n === a);
  if (hit) return hit.raw;
  if (YES.includes(a)) hit = normed.find((o) => YES.includes(o.n));
  else if (NO.includes(a)) hit = normed.find((o) => NO.includes(o.n));
  if (hit) return hit.raw;
  // A longer option that starts with the stated answer ("Advanced" -> "Advanced (C1)"),
  // only when exactly one option qualifies.
  const starts = normed.filter((o) => o.n.startsWith(a + ' '));
  return starts.length === 1 ? starts[0].raw : null;
}

function bankLookup(bank, label) {
  if (!bank || typeof bank !== 'object') return undefined;
  const key = norm(label);
  if (!key) return undefined;
  for (const [q, a] of Object.entries(bank)) {
    if (norm(q) === key && has(a)) return a;
  }
  return undefined;
}

const YEARS_RE = /(how many years|years of|anos de|cuantos anos|quantos anos|years experience|anos de experiencia|tiempo de experiencia)/;

/**
 * "How many years of experience do you have with X?" -> years for X from the
 * user's own map, or the total when the question names no topic.
 * Returns a number/string, or undefined when the user never stated it.
 */
const GENERIC_TOPIC = /^(work|working|professional|relevant|total|overall|general|laboral|profesional|trabajo|de trabajo|en total|in total)$/;
const FILLER_ONLY = /^((do you have|have you|tienes|tenes|tiene|posee|posees|cuentas|cuenta|laboral|profesional|total|en total|in total|overall)\s*)*$/;

function yearsFor(label, map, total) {
  const l = norm(label);
  if (!YEARS_RE.test(l) || !/(experience|experiencia)/.test(l)) return undefined;

  let topic = '';
  // "years of <topic> experience"
  const pre = l.match(/years of (.+?) experience/);
  if (pre && !GENERIC_TOPIC.test(pre[1].trim())) topic = pre[1].trim();
  if (!topic) {
    // text after the last "experience"/"experiencia"
    const idx = Math.max(l.lastIndexOf('experience'), l.lastIndexOf('experiencia'));
    const rest = l.slice(idx).replace(/^(experience|experiencia)/, '').trim();
    const m = (' ' + rest).match(/^(?:.*?)\s(?:with|in|using|on|as|con|en|como|de|em|com)\s+(.+)$/);
    if (m) topic = m[1].trim();
    // Something follows that is neither filler nor a recognisable topic: do not guess.
    else if (!FILLER_ONLY.test(rest)) return undefined;
  }
  topic = topic.replace(/^(the|a|an|el|la|los|las|un|una)\s+/, '').trim();
  if (!topic || GENERIC_TOPIC.test(topic)) return has(total) ? total : undefined;
  if (!map || typeof map !== 'object') return undefined;
  const entries = Object.entries(map).filter(([, v]) => has(v)).map(([k, v]) => [norm(k), v]);
  const exact = entries.find(([k]) => k === topic);
  if (exact) return exact[1];
  // The topic names exactly one of the user's topics as a whole phrase ("recruiting" in "it recruiting and sourcing").
  const contained = entries.filter(([k]) => k.length >= 3 && new RegExp(`(^| )${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(topic));
  return contained.length === 1 ? contained[0][1] : undefined;
}

const CURRENCIES = ['usd', 'ars', 'eur', 'cop', 'mxn', 'brl', 'clp', 'uyu', 'pen', 'gbp'];
const SALARY_RE = /(salary|salario|salarial|compensation|compensacion|remuneracion|remuneracao|pretension|pretensao|sueldo|expectativa)/;
const DECLINE_RE = /(do not wish|don t wish|prefer not|decline|prefiero no|no deseo|rather not|not to disclose|no quiero responder)/;
const CONSENT_RE = /(privacy|privacidad|terms|terminos|condiciones|conditions|acknowledge|i have read|he leido|consent to the processing|tratamiento de (mis )?datos|data protection|proteccion de datos)/;
const DEMOGRAPHIC_RE = /(gender|genero|race|raza|ethnic|etnia|veteran|veterano|disability|discapacidad|pronoun|pronombre|sexual orientation|orientacion sexual)/;
const HEAR_RE = /(how did you hear|hear about|como supiste|como te enteraste|como conociste|donde viste)/;

/**
 * @param {string} label    question text as shown on the form
 * @param {string[]|null} options  option texts for selects/radios, null for free text
 * @param {object} ctx      { answers, personal, profile }
 */
function resolve(label, options, ctx = {}) {
  const A = ctx.answers || {};
  const P = ctx.personal || {};
  const R = ctx.profile || {};
  const l = norm(label);
  const isChoice = Array.isArray(options) && options.length > 0;
  const answer = (v) => {
    if (!isChoice) return { kind: 'answer', value: String(v) };
    const opt = matchOption(v, options);
    return opt ? { kind: 'answer', value: opt } : { kind: 'unknown' };
  };

  // 1. Question bank: the user's own answer to this exact question.
  const banked = bankLookup(A.qa, label);
  if (banked !== undefined) return answer(banked);

  // 2. Years of experience by topic.
  const yrs = yearsFor(label, A.experience_years, A.years_of_experience);
  if (yrs !== undefined) return answer(yrs);
  if (YEARS_RE.test(l)) return { kind: 'unknown' };

  // 3. Explicit keys.
  if (SALARY_RE.test(l)) {
    const cur = CURRENCIES.find((c) => new RegExp(`(^| )${c}( |$)`).test(l));
    const v = cur ? A[`salary_${cur}`] : A.salary_default;
    return has(v) ? answer(v) : { kind: 'unknown' };
  }
  if (/(notice period|preaviso|periodo de aviso)/.test(l)) return has(A.notice_period) ? answer(A.notice_period) : { kind: 'unknown' };
  if (/(english|ingles)/.test(l) && /(level|nivel|proficiency|dominio)/.test(l) || (isChoice && /^(english|ingles)$/.test(l))) {
    return has(A.english_level) ? answer(A.english_level) : { kind: 'unknown' };
  }
  if (/(spanish|espanol)/.test(l) && /(level|nivel|proficiency|dominio)/.test(l) || (isChoice && /^(spanish|espanol)$/.test(l))) {
    return has(A.spanish_level) ? answer(A.spanish_level) : { kind: 'unknown' };
  }
  if (/seniority/.test(l)) return has(A.seniority) ? answer(A.seniority) : { kind: 'unknown' };
  if (HEAR_RE.test(l)) {
    if (!isChoice) return { kind: 'answer', value: 'LinkedIn' };
    const opt = options.find((o) => /linkedin/i.test(o));
    return opt ? { kind: 'answer', value: opt } : { kind: 'unknown' };
  }

  // 4. Voluntary self-identification: the user's stated value, else an explicit decline option.
  if (DEMOGRAPHIC_RE.test(l)) {
    const key = /(gender|genero)/.test(l) ? 'diversity_gender'
      : /(race|raza|ethnic|etnia)/.test(l) ? 'diversity_ethnicity'
      : /(disability|discapacidad)/.test(l) ? 'disability'
      : /(veteran|veterano)/.test(l) ? 'veteran' : null;
    if (key && has(A[key])) return answer(A[key]);
    if (isChoice) {
      const decline = options.find((o) => DECLINE_RE.test(norm(o)));
      if (decline) return { kind: 'answer', value: decline };
    }
    return { kind: 'unknown' };
  }

  // 5. Required privacy notice / terms acknowledgement.
  if (CONSENT_RE.test(l) && !/(future|futur|marketing|newsletter|talent community|comunidad de talento|other (jobs|positions|opportunities)|otras (vacantes|oportunidades|busquedas))/.test(l)) {
    if (!isChoice) return { kind: 'legacy' };
    const ok = options.find((o) => /^(yes|si|sim|i agree|acepto|i accept|i have read|i acknowledge|i understand|confirm)/.test(norm(o)));
    return ok ? { kind: 'answer', value: ok } : { kind: 'unknown' };
  }

  // A yes/no question is never a contact field ("¿Tenés movilidad propia?" is not a phone number).
  if (isChoice && options.every((o) => YES.includes(norm(o)) || NO.includes(norm(o)))) return { kind: 'unknown' };

  // 6. Contact, identity and education fields the existing filler handles from DB data.
  const phone = String(P.phone || A.phone || '').replace(/\D/g, '');
  const legacyIf = (cond) => (cond ? { kind: 'legacy' } : { kind: 'unknown' });
  if (/^(date|fecha|today s date|date of application|signature date)$/.test(l)) return { kind: 'legacy' };
  if (/(first name|^nombre$|nombre de pila|preferred name|nombre preferido)/.test(l)) return legacyIf(has(A.first_name));
  if (/(last name|apellido|surname)/.test(l)) return legacyIf(has(A.last_name));
  if (/(country code|phone country|codigo de pais|prefijo|prefisso)/.test(l)) return legacyIf(phone.startsWith('54'));
  if (/\b(phone|mobile|celular|telefono|telefone|movil)\b/.test(l)) return legacyIf(phone.length >= 8);
  if (/(e mail|email|correo)/.test(l)) return legacyIf(has(A.email) || has(R.email));
  if (/(linkedin)/.test(l)) return legacyIf(has(A.linkedin_url));
  if (/(github)/.test(l)) return legacyIf(has(A.github_url));
  if (/^(city|ciudad|location|ubicacion|localidad)( .{0,25})?$/.test(l) || /(current location|ubicacion actual|where are you (currently )?(located|based)|ciudad de residencia)/.test(l)) {
    return legacyIf(has(P.city) || has(A.location) || has(R.location));
  }
  if (/^(country|pais)$/.test(l) || /(country of residence|pais de residencia)/.test(l)) return legacyIf(has(P.country));
  if (/^(state|estado|province|provincia|state province)$/.test(l)) return legacyIf(has(P.state));
  if (/(school|escuela|university|universidad)/.test(l)) return legacyIf(has(A.school_name));
  if (/(field of study|major|carrera|area de estudio|disciplina)/.test(l)) return legacyIf(has(A.field_of_study));
  if (/(degree|titulo|education level|nivel de estudios|nivel educativo)/.test(l)) return legacyIf(has(A.degree));
  if (/(current company|empresa actual|current employer|empleador actual|company name|nombre de la empresa)/.test(l)) return legacyIf(has(A.current_company));
  if (/(headline|titular)/.test(l)) return legacyIf(has(A.headline) || has(R.headline));
  if (/^(summary|resumen)( .{0,20})?$/.test(l)) return legacyIf(has(A.summary) || has(R.summary));
  if (/\b(from|to|start|end|desde|hasta|inicio|fin)\b/.test(l) && /\b(month|year|mes|ano)\b/.test(l)) {
    return legacyIf(has(A.edu_from_year) || has(A.edu_to_year));
  }

  return { kind: 'unknown' };
}

module.exports = { norm, matchOption, bankLookup, yearsFor, resolve, CONSENT_RE };
