'use strict';
/**
 * fit.js: how well a job matches the user (0 to 100) and which of the job's key
 * terms the CV already has. Pure functions: no browser, no database.
 *
 *   score(job, user)  -> { score, parts: [{ key, label, points, max, note }], keywords }
 *   keywords(description, cvText, opts) -> { have, reworded: [{ term, cv }], missing }
 *
 * job:  { role, company, location, description }
 * user: { prefs (job_preferences), profile, formAnswers, cvText }
 *
 * The terms come from the job description itself. A small table of general
 * workplace words (Spanish and English) links equivalent forms, so "recruiting"
 * in a job and "reclutamiento" in a CV count as the same idea written differently.
 * Nothing is ever added to a CV here: the result is shown to the user, who decides.
 */
const jobFilter = require('./job-filter');

const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clean = (s) => strip(s).replace(/[^a-z0-9+#.ñ]+/g, ' ').replace(/\s+/g, ' ').trim();

const STOP = new Set(('a al algo algun alguna como con contar cada de del desde donde dos e el ella en entre era es esa ese eso esta este esto estos estas etc '
  + 'ha hacia hasta la las le les lo los mas me mi muy nos o otra otro para pero por que se ser si sin sobre su sus te tener tu tus un una uno unos unas y ya '
  + 'the a an and or of to in on for with at by from as is are be been being it its this that these those our your their we you they will would can could '
  + 'should may might must has have had do does did not no all any both each more most other some such than too very via per '
  + 'buscamos busca buscando requisitos requerimientos deseable deseables excluyente excluyentes indispensable importante valorable '
  + 'experiencia experience conocimiento conocimientos knowledge manejo dominio uso use using solido solida solidos fuerte fuertes strong excellent excelente '
  + 'buen buena buenos buenas good great alto alta high capacidad ability able skills skill habilidad habilidades competencia competencias '
  + 'minimo minima al menos least plus nice similar similares relacionado relacionada related afines afin preferentemente preferably preferred required requerido '
  + 'anos ano years year meses months tareas tasks funciones responsabilidades responsibilities role rol puesto posicion position empresa company equipo team '
  + 'trabajo trabajar work working ofrecemos offer beneficios benefits nuestro nuestra our ideal persona candidate candidato candidata perfil profile '
  + 'nivel level etc tambien also otros otras others areas area clientes cliente nuevo nueva new y/o '
  + 'responsable responsible lograr achieve brindar provide asegurar ensure apoyar support participar participate colaborar collaborate realizar perform '
  + 'above below ideally idealmente usd ars salary salario remote remoto weekly daily monthly semanal mensual diario ideal plus ventaja').split(/\s+/));

// Equivalent forms across Spanish and English for general workplace words.
// Several professions, no candidate data. Each group is one idea.
const GROUPS = [
  ['seleccion', 'reclutamiento', 'recruiting', 'recruitment', 'talent acquisition', 'adquisicion de talento', 'hunting', 'headhunting', 'sourcing'],
  ['recursos humanos', 'rrhh', 'human resources', 'hr', 'people', 'gestion de personas', 'capital humano', 'human capital'],
  ['liderazgo', 'leadership', 'lider', 'leader', 'liderar', 'lead', 'conduccion de equipos', 'team management', 'gestion de equipos'],
  ['capacitacion', 'formacion', 'training', 'learning and development', 'l&d', 'aprendizaje y desarrollo'],
  ['evaluacion de desempeno', 'performance review', 'performance management', 'gestion del desempeno', 'evaluaciones de desempeno'],
  ['clima laboral', 'clima organizacional', 'employee engagement', 'engagement', 'encuesta de clima'],
  ['liquidacion de sueldos', 'nomina', 'payroll', 'remuneraciones', 'compensaciones', 'compensation', 'comp and ben', 'compensaciones y beneficios'],
  ['induccion', 'onboarding'],
  ['relaciones laborales', 'labor relations', 'employee relations'],
  ['gestion del cambio', 'change management'],
  ['cultura organizacional', 'organizational culture', 'company culture', 'cultura'],
  ['negociacion', 'negotiation', 'negociar', 'negotiate'],
  ['comunicacion', 'communication', 'comunicacion interna', 'internal communication'],
  ['ventas', 'sales', 'comercial', 'business development', 'desarrollo de negocios'],
  ['atencion al cliente', 'customer service', 'customer support', 'soporte al cliente', 'customer success', 'experiencia del cliente', 'customer experience'],
  ['analisis de datos', 'data analysis', 'analytics', 'analitica', 'data analytics'],
  ['finanzas', 'finance', 'financiero', 'financial'],
  ['contabilidad', 'accounting', 'contable'],
  ['presupuesto', 'budget', 'budgeting', 'presupuestos'],
  ['gestion de proyectos', 'project management', 'proyectos', 'projects', 'pmo'],
  ['procesos', 'processes', 'process improvement', 'mejora de procesos', 'mejora continua', 'continuous improvement'],
  ['trabajo en equipo', 'teamwork', 'colaboracion', 'collaboration'],
  ['ingles', 'english'], ['portugues', 'portuguese'], ['espanol', 'spanish'],
  ['logistica', 'logistics', 'supply chain', 'cadena de suministro', 'cadena de abastecimiento'],
  ['compras', 'purchasing', 'procurement', 'abastecimiento'],
  ['calidad', 'quality', 'quality assurance', 'qa', 'control de calidad'],
  ['seguridad e higiene', 'health and safety', 'hse', 'seguridad y salud ocupacional', 'ehs'],
  ['desarrollo de software', 'software development', 'programacion', 'programming', 'coding'],
  ['base de datos', 'bases de datos', 'database', 'databases', 'sql'],
  ['reportes', 'reporting', 'informes', 'reports', 'tableros', 'dashboards'],
  ['indicadores', 'kpi', 'kpis', 'metricas', 'metrics'],
  ['planificacion', 'planning', 'planeamiento'],
  ['estrategia', 'strategy', 'estrategico', 'strategic'],
  ['partes interesadas', 'stakeholders', 'stakeholder management', 'gestion de stakeholders'],
  ['administracion', 'administration', 'administrativo', 'administrative'],
  ['marketing', 'mercadotecnia'],
  ['redes sociales', 'social media'],
  ['entrevistas', 'interviews', 'interviewing', 'entrevistas por competencias', 'competency based interviews', 'behavioral interviews'],
  ['herramientas de ia', 'inteligencia artificial', 'artificial intelligence', 'ai', 'ia', 'genai', 'ia generativa', 'generative ai'],
  ['excel', 'microsoft excel', 'planillas de calculo', 'spreadsheets', 'google sheets'],
  ['tecnologia', 'it', 'tech', 'technology', 'sistemas', 'tecnologia de la informacion', 'information technology'],
  ['empleador', 'employer branding', 'marca empleadora'],
  ['diversidad e inclusion', 'diversity and inclusion', 'dei', 'd&i', 'diversidad', 'inclusion'],
];
const GROUP_OF = new Map();
GROUPS.forEach((g, i) => g.forEach((w) => GROUP_OF.set(clean(w), i)));

// Crude stem: enough to match "reclutador" with "reclutamiento" or "recruiter" with "recruiting".
const SUFFIX = /(aciones|acion|amientos|amiento|imientos|imiento|adoras|adores|adora|ador|azgo|antes|ante|mente|idades|idad|ivos|ivas|ivo|iva|istas|ista|ismo|ciones|cion|ados|adas|ado|ada|idos|idas|ido|ida|ar|er|ir|ments|ment|ings|ing|ers|er|ed|ions|ion|ities|ity|ives|ive|ly|es|s)$/;
function stem(w) {
  const x = clean(w);
  if (x.length <= 4 || /[0-9+#.]/.test(x)) return x;
  const s = x.replace(SUFFIX, '');
  return s.length >= 4 ? s : x.slice(0, 4);
}
const words = (s) => clean(s).split(' ').filter(Boolean);
const contentWords = (s) => words(s).filter((w) => !STOP.has(w) && w.length > 1);
// Singular form, so "encuestas de clima" and "encuesta de clima" count as the same words.
const sing = (w) => (w.length > 4 && /[^s]es$/.test(w) && !/(ies|ces)$/.test(w) ? w.slice(0, -2) : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);
const singSeq = (s) => words(s).map(sing).join(' ');
const stemSeq = (s) => words(s).map(stem).join(' ');
// Single words too general to be a requirement on their own.
const GENERIC = new Set(['desarrollo', 'gestion', 'proceso', 'procesos', 'analisis', 'iniciativas', 'iniciativa', 'personas', 'lideres', 'areas', 'operaciones',
  'organizacion', 'negocio', 'negocios', 'mejora', 'mejoras', 'herramientas', 'herramienta', 'sistemas', 'plan', 'planes', 'programa', 'programas',
  'management', 'development', 'process', 'business', 'operations', 'tools', 'program', 'programs', 'initiatives', 'people', 'leaders', 'licenciatura',
  'titulo', 'carrera', 'afines', 'graduado', 'estudiante', 'bachelor', 'degree', 'partner', 'socio', 'roles', 'role', 'perfiles', 'requirements', 'requisitos']);
const TRAIL = /\s+(?:skills?|habilidades|abilities|knowledge|conocimientos?|experience|experiencia|tools?|herramientas?|avanzad[oa]s?|advanced)$/i;
// Verbs and generic heads at the start of a requirement ("Gestionar procesos de recruiting" -> "recruiting").
const VERB_LEAD = new RegExp('^(?:' + ['gestionar', 'liderar', 'acompañar', 'manejar', 'administrar', 'coordinar', 'desarrollar', 'diseñar', 'implementar',
  'analizar', 'armar', 'elaborar', 'participar', 'asegurar', 'brindar', 'realizar', 'llevar adelante', 'llevar', 'conducir', 'supervisar', 'planificar', 'ejecutar',
  'definir', 'identificar', 'mantener', 'preparar', 'generar', 'impulsar', 'promover', 'colaborar', 'trabajar', 'utilizar', 'usar', 'dominar',
  'conocer', 'contar con', 'tener', 'garantizar', 'velar por', 'controlar', 'reportar', 'atender', 'acompañamiento', 'manage', 'build',
  'develop', 'design', 'analyze', 'analyse', 'create', 'ensure', 'deliver', 'implement', 'define', 'coordinate', 'conduct', 'oversee',
  'collaborate', 'identify', 'maintain', 'prepare', 'source', 'have', 'be'].join('|') + ')\\s+', 'i');
const HEAD_LEAD = /^(?:(?:los|las|el|la|the)\s+)?(?:procesos?|tareas?|iniciativas?|actividades?|herramientas?|plataformas?|proyectos? de mejora|programas?|planes?(?= de acci)|processes|tasks|initiatives|activities|tools|platforms)\s+(?:de|del|of|como|such as)\s+/i;

// --- terms from the job description ---
const REQ_HEAD = /(requisitos|requerimientos|que buscamos|qu[eé] buscamos|te buscamos|perfil buscado|tu perfil|el perfil|conocimientos|habilidades|competencias|skills|requirements|qualifications|what you.?ll bring|what you bring|what we.?re looking for|who you are|must.?have|nice to have|deseable|excluyente|valoraremos|sumar[aá]n|responsabilidades|tus tareas|funciones|responsibilities|what you.?ll do)/i;
const END_HEAD = /^(beneficios|ofrecemos|que ofrecemos|qu[eé] ofrecemos|benefits|perks|we offer|what we offer|sobre nosotros|acerca de|about us|about the company|quienes somos|qui[eé]nes somos)\b/i;
const LEAD = /^(?:(?:experiencia|experience|conocimientos?|knowledge|manejo|dominio|uso|use|familiaridad|familiarity|proficiency|competencia|capacidad|ability|habilidad|nivel|level|formaci[oó]n|background|t[ií]tulo|degree|estudios|graduad[oa]s?|licenciad[oa]s?|s[oó]lid[oa]s?|strong|excellent|excelente|buen[oa]?s?|good|al menos|at least|m[ií]nimo|minimum|\+?\d+\+?\s*(?:a[nñ]os|years)\s*(?:de|of)?|deseable|excluyente|indispensable|preferentemente|preferably|avanzad[oa]|advanced|intermedio|intermediate|comprobable|demostrable|proven|demonstrated|hands.on|en|de|del|con|in|of|with|on|the|la|el|los|las|un|una|a)\s+)+/i;

/** Requirement lines, or the whole text when it has no recognizable sections. */
function requirementText(description) {
  const lines = String(description || '').split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  let on = false;
  for (const l of lines) {
    // A heading: short, not a bullet, and it starts with one of the known words ("Requisitos:", "What you'll bring").
    const head = l.length < 60 && !/^[-*•·●▪◦>]/.test(l) && !/[.;]$/.test(l);
    const bare = l.replace(/^[^a-záéíóúñ]+/i, '');
    if (head && END_HEAD.test(bare)) { on = false; continue; }
    if (head && new RegExp(`^${REQ_HEAD.source}`, 'i').test(bare)) { on = true; continue; }
    if (on) out.push(l);
  }
  return out.length >= 2 ? out : lines;
}

/** Candidate terms with a weight; the strongest first. */
function jobTerms(description, opts = {}) {
  const text = String(description || '');
  if (text.trim().length < 80) return [];
  const exclude = new Set([clean(opts.company || ''), ...words(opts.company || '')].filter(Boolean));
  const req = requirementText(text);
  const all = singSeq(clean(text).replace(/\.(?= |$)/g, ''));
  const found = new Map();
  let order = 0;
  const addTerm = (raw, w) => {
    let t = String(raw || '').replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}+#]+|[^\p{L}\p{N}+#]+$/gu, '');
    for (let i = 0; i < 3; i++) {
      t = t.replace(LEAD, '').trim();
      t = t.replace(VERB_LEAD, '').trim();
      t = t.replace(HEAD_LEAD, '').trim();
    }
    t = t.replace(/\s+(?:de|del|of|en|in|y|and|o|or)$/i, '').trim();
    if (TRAIL.test(t) && contentWords(t.replace(TRAIL, '')).length) t = t.replace(TRAIL, '').trim();
    const c = clean(t);
    if (!c || c.length < 2 || c.length > 40 || /^\d+$/.test(c) || exclude.has(c)) return;
    const cw = contentWords(t);
    if (!cw.length || cw.length > 4) return;
    if (cw.length === 1 && cw[0].length < 3 && !/[A-Z]{2}/.test(t)) return;
    if (cw.length === 1 && GENERIC.has(cw[0])) return;
    const key = singSeq(t);
    const prev = found.get(key);
    const occurrences = (all.match(new RegExp(`(^| )${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`, 'g')) || []).length;
    const weight = w + Math.min(occurrences, 4);
    const pos = prev ? prev.pos : order++;
    if (!prev || prev.weight < weight) found.set(key, { term: t, key, weight, pos });
  };
  // Phrases of requirement lines, split at separators and conjunctions.
  for (const line of req) {
    const body = line.replace(/^[-*•·●▪◦>\d.)\s]+/, '');
    // Known phrases first, so "diversidad e inclusión" is not split at its conjunction.
    const plain = strip(body);
    for (const g of GROUPS) for (const w of g) {
      if (!/\s/.test(w)) continue;
      const at = plain.search(new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`));
      if (at >= 0) { const st = at + (plain[at] === w[0] ? 0 : 1); addTerm(body.slice(st, st + w.length), 3); }
    }
    for (const part of body.split(/[,;:/()•·|]|\s(?:y|e|o|u|and|or|as well as|así como|como|tales como|such as|including|incluyendo|para|for|to|que|that|which|donde|where|en|con|in|with|using|mediante|a través de|through)\s/i)) {
      const p = part.trim();
      if (!p) continue;
      const cw = contentWords(p);
      if (cw.length >= 1 && cw.length <= 4) addTerm(p, 3);
      else if (cw.length > 4) {
        // Long clause: keep acronyms and tool-like names from it.
        for (const m of p.matchAll(/\b([A-Z][A-Za-z0-9+#.]*[A-Z0-9+#][A-Za-z0-9+#.]*|[A-Z]{2,6}s?)\b/g)) addTerm(m[1], 2);
      }
    }
  }
  // Acronyms and names written mid-sentence with a capital (tools, systems), in the requirements.
  const reqText = req.join('\n');
  for (const m of reqText.matchAll(/(?<=[a-záéíóúñ,]\s)((?:\p{Lu}[\p{L}\p{N}+#]*)(?:\s(?:\p{Lu}[\p{L}\p{N}+#]*|de|of))*)/gu)) addTerm(m[1], 1);
  for (const m of reqText.matchAll(/\b([A-Z]{2,6}s?|[A-Za-z]+[+#]{1,2}|[A-Za-z]+\.js|[A-Z][a-z]+[A-Z][A-Za-z]+)\b/g)) addTerm(m[1], 2);
  // A shorter term inside a longer one ("BI" in "Power BI") is dropped.
  for (const k of [...found.keys()]) {
    for (const other of found.keys()) if (other !== k && other.length > k.length && ` ${other} `.includes(` ${k} `) && found.get(other).weight >= found.get(k).weight - 1) { found.delete(k); break; }
  }
  const places = new Set(['argentina', 'buenos aires', 'caba', 'latam', 'remoto', 'remote', 'hibrido', 'hybrid', 'presencial', 'onsite', 'linkedin', 'full time', 'part time', 'lunes', 'viernes', 'monday', 'friday']);
  return [...found.values()]
    .filter((t) => !places.has(t.key))
    .sort((a, b) => b.weight - a.weight || a.pos - b.pos)
    .slice(0, opts.max || 22);
}

// --- comparison with the CV ---
function cvIndex(cvText) {
  // Words as written (for showing them) and their plain form (for comparing), aligned one to one.
  const orig = [];
  const ws = [];
  for (const tok of String(cvText || '').normalize('NFC').split(/[^\p{L}\p{N}+#.]+/u)) {
    const t = tok.replace(/^\.+|\.+$/g, '');
    if (!t) continue;
    for (const w of words(t)) { orig.push(t); ws.push(w); }
  }
  const stems = new Map();
  ws.forEach((w, i) => { const s = stem(w); if (!stems.has(s)) stems.set(s, orig[i]); });
  return { c: ` ${ws.map(sing).join(' ')} `, st: ` ${ws.map(stem).join(' ')} `, ws, orig, stems };
}
/** The CV's own words for a phrase given as a stem sequence, or null. */
function spanOf(idx, seq) {
  const n = seq.split(' ').length;
  const at = idx.ws.findIndex((_, i) => idx.ws.slice(i, i + n).map(stem).join(' ') === seq);
  return at >= 0 ? [...new Set(idx.orig.slice(at, at + n))].join(' ') : null;
}
/** The phrase, in singular, appears as is in the CV. */
const hasPhrase = (idx, phrase) => idx.c.includes(` ${singSeq(phrase)} `);
/** The phrase appears with the same word stems ("encuestas de clima" ~ "encuesta de clima"). */
const hasStems = (idx, phrase) => idx.st.includes(` ${stemSeq(phrase)} `);

/** Where the CV says the same thing with other words, or null. */
function groupsOf(key) {
  const k = clean(key);
  const ks = stemSeq(k);
  const groups = new Set();
  for (const [w, g] of GROUP_OF) {
    const ws = stemSeq(w);
    if (` ${ks} `.includes(` ${ws} `)) groups.add(g);
  }
  return groups;
}
function equivalentInCv(key, idx) {
  // Same stems in the same order ("reclutador IT" ~ "reclutamiento IT").
  if (hasStems(idx, key)) {
    const sp = spanOf(idx, stemSeq(key));
    if (sp) return sp;
  }
  // The same idea from the table: first the whole phrase with the word swapped
  // ("recruiting IT" -> "reclutamiento IT"), then the table word alone.
  const groups = groupsOf(key);
  const ks = ` ${stemSeq(key)} `;
  for (const g of groups) {
    for (const w of GROUPS[g]) {
      const ws = ` ${stemSeq(w)} `;
      if (!ks.includes(ws) || ks === ws) continue;
      for (const alt of GROUPS[g]) {
        if (alt === w) continue;
        const cand = ks.replace(ws, ` ${stemSeq(alt)} `).trim();
        if (idx.st.includes(` ${cand} `)) {
          const sp = spanOf(idx, cand);
          if (sp) return sp;
        }
      }
    }
  }
  for (const g of groups) {
    for (const w of GROUPS[g]) {
      if (singSeq(w) !== singSeq(key) && (hasPhrase(idx, w) || hasStems(idx, w))) return spanOf(idx, stemSeq(w)) || w;
    }
  }
  // Every content word of the term appears in the CV with the same stem.
  const parts = contentWords(key);
  if (!parts.length) return null;
  const hits = parts.map((p) => idx.stems.get(stem(p)));
  if (hits.every(Boolean) && hits.some((h, i) => clean(h) !== parts[i])) return hits.join(' ');
  return null;
}

/** Key terms of the job split in three groups against the CV. */
function keywords(description, cvText, opts = {}) {
  const terms = jobTerms(description, opts);
  const empty = { have: [], reworded: [], missing: [], total: 0 };
  if (!terms.length || !String(cvText || '').trim()) return { ...empty, total: terms.length, missing: terms.map((t) => t.term), no_cv: !String(cvText || '').trim() };
  const idx = cvIndex(cvText);
  const out = { have: [], reworded: [], missing: [], total: 0 };
  const seenIdea = new Set();
  for (const t of terms) {
    // One entry per idea: "HR" and "RRHH" are the same thing for this list.
    const g = [...groupsOf(t.key)];
    const idea = g.length === 1 && GROUPS[g[0]].some((w) => singSeq(w) === t.key) ? `g${g[0]}` : t.key;
    if (seenIdea.has(idea)) continue;
    seenIdea.add(idea);
    if (hasPhrase(idx, t.term)) out.have.push(t.term);
    else {
      const eq = equivalentInCv(t.key, idx);
      if (eq) out.reworded.push({ term: t.term, cv: eq });
      else out.missing.push(t.term);
    }
  }
  out.total = out.have.length + out.reworded.length + out.missing.length;
  return out;
}

// --- seniority, years, place and language ---
const LEVELS = [
  [0, /\b(pasante|pasantia|trainee|intern|internship|becari[oa])\b/],
  [1, /\b(junior|jr|entry level|inicial)\b/],
  [2, /\b(semi ?senior|ssr|semisenior|mid ?level|intermedio)\b/],
  [3, /\b(senior|sr|señor|especialista|specialist|experto|expert)\b/],
  [4, /\b(lider|leader|lead|coordinador[a]?|coordinator|supervisor[a]?|team lead|principal)\b/],
  [5, /\b(manager|gerente|jefe|jefa|head|responsable de)\b/],
  [6, /\b(director[a]?|vp|vice ?president[e]?|chief|c level)\b/],
];
function levelOf(text) {
  const t = strip(text);
  let found = null;
  for (const [n, re] of LEVELS) if (re.test(t)) found = found === null ? n : Math.max(found, n);
  return found;
}
function englishOf(text) {
  const t = strip(text);
  if (!t) return null;
  if (/nativ|bilingu|c2|c1|avanzad|advanced|fluent|fluid|proficien/.test(t)) return 3;
  if (/intermedi|b2|b1|conversacional|conversational|upper/.test(t)) return 2;
  if (/basic|a1|a2|elemental|inicial/.test(t)) return 1;
  return null;
}
function englishRequired(description) {
  const t = strip(description);
  const m = t.match(/(?:ingles|english)[^.\n]{0,40}?(nativo|bilingue|avanzado|fluido|fluent|advanced|proficien\w*|c1|c2|intermedio|intermediate|b1|b2|conversacional|basico|basic)|(fluent|advanced|proficient|bilingual|intermediate)\s+(?:in\s+)?english/);
  if (m) return englishOf(m[1] || m[2]) || 3;
  if (/\b(ingles|english)\b/.test(t)) return 2;
  return null;
}
function yearsRequired(description) {
  const m = strip(description).match(/(\d{1,2})\s*\+?\s*(?:a\s*\d{1,2}\s*)?(?:anos|years)(?:\s+de|\s+of)?\s+(?:experiencia|experience)/);
  return m ? Number(m[1]) : null;
}

/** Fit of a job with the user: { score, parts, keywords }. */
function score(job, user = {}) {
  const prefs = user.prefs || {};
  const fa = user.formAnswers || {};
  const desc = String(job.description || '');
  const parts = [];

  // 1. Position (30): the title against the user's target titles.
  const title = jobFilter.checkTitle(job.role || '', prefs, user.profile || {});
  let tp = 0;
  if (title.pass) tp = 30;
  else {
    const want = new Set(jobFilter.targetTitles(prefs, user.profile || {}).flatMap((t) => contentWords(t)));
    const have = contentWords(job.role || '').filter((w) => want.has(w)).length;
    tp = want.size ? Math.round(18 * Math.min(1, have / 2)) : 15;
  }
  parts.push({ key: 'titulo', label: 'Puesto', points: tp, max: 30, note: title.pass ? 'coincide con tus puestos objetivo' : 'el título no coincide del todo con tus puestos objetivo' });

  // 2. Key terms (40): how many of the job's terms the CV has.
  const kw = keywords(desc, user.cvText || '', { company: job.company });
  if (kw.total && !kw.no_cv) {
    const cover = (kw.have.length + 0.6 * kw.reworded.length) / kw.total;
    parts.push({ key: 'palabras', label: 'Palabras clave', points: Math.round(40 * Math.min(1, cover * 1.15)), max: 40,
      note: `${kw.have.length} de ${kw.total} están en tu CV; ${kw.reworded.length} con otras palabras; ${kw.missing.length} no aparecen` });
  }

  // 3. Level and years (10).
  const jl = levelOf(job.role || '');
  const ul = levelOf([fa.seniority, ...(Array.isArray(prefs.seniority_levels) ? prefs.seniority_levels : [])].filter(Boolean).join(' '));
  let lp = 7; let lnote = 'el aviso no indica nivel';
  if (jl !== null && ul !== null) {
    const d = Math.abs(jl - ul);
    lp = d === 0 ? 10 : d === 1 ? 7 : 2;
    lnote = d === 0 ? 'mismo nivel que buscás' : d === 1 ? 'nivel cercano al que buscás' : 'nivel distinto al que buscás';
  } else if (jl !== null) lnote = 'no cargaste tu seniority';
  const yr = yearsRequired(desc);
  const uy = Number.parseInt(String(fa.years_of_experience || '').match(/\d+/) || '', 10);
  if (yr !== null && Number.isInteger(uy) && uy < yr) { lp = Math.max(0, lp - 4); lnote += `; piden ${yr} años y cargaste ${uy}`; }
  parts.push({ key: 'nivel', label: 'Nivel y experiencia', points: lp, max: 10, note: lnote });

  // 4. Place and work mode (10).
  let pp = 7; let pnote = 'el aviso no indica lugar';
  if (job.location) {
    const lc = jobFilter.checkLocation(job.location, prefs);
    pp = lc.pass ? 10 : 0;
    pnote = lc.pass ? 'lugar o modalidad aceptados' : 'lugar o modalidad fuera de lo que aceptás';
  }
  parts.push({ key: 'lugar', label: 'Lugar y modalidad', points: pp, max: 10, note: pnote });

  // 5. Language (10).
  const req = englishRequired(desc);
  const mine = englishOf(fa.english_level);
  let ip = 10; let inote = 'no piden inglés';
  if (req !== null) {
    if (mine === null) { ip = 6; inote = 'piden inglés y no cargaste tu nivel'; }
    else if (mine >= req) { ip = 10; inote = 'tu nivel de inglés alcanza'; }
    else if (mine === req - 1) { ip = 5; inote = 'piden un nivel de inglés algo más alto que el tuyo'; }
    else { ip = 0; inote = 'piden un nivel de inglés más alto que el tuyo'; }
  }
  parts.push({ key: 'idioma', label: 'Idioma', points: ip, max: 10, note: inote });

  const max = parts.reduce((a, p) => a + p.max, 0);
  const got = parts.reduce((a, p) => a + p.points, 0);
  return { score: Math.round((100 * got) / max), parts, keywords: kw };
}

/** Compact copy to store with a job or an application. */
function summary(fit) {
  if (!fit) return null;
  const k = fit.keywords || {};
  return {
    score: fit.score,
    parts: fit.parts.map((p) => ({ label: p.label, points: p.points, max: p.max, note: p.note })),
    have: (k.have || []).slice(0, 25), reworded: (k.reworded || []).slice(0, 25), missing: (k.missing || []).slice(0, 25),
    at: new Date().toISOString(),
  };
}

/**
 * Instructions for the user's own AI chat: a version of the CV adapted to this job,
 * using the job's words only for what the CV already says, plus the terms the user
 * confirmed they really have. Nothing is invented.
 */
function cvPrompt({ job, cvText, fit, confirmed = [] }) {
  const k = (fit && fit.keywords) || fit || {};
  const rew = (k.reworded || []).map((r) => `- El aviso dice "${r.term}"; mi CV dice "${r.cv}".`).join('\n');
  const conf = (confirmed || []).filter(Boolean).map((t) => `- ${t}`).join('\n');
  const miss = (k.missing || []).filter((t) => !(confirmed || []).includes(t)).map((t) => `- ${t}`).join('\n');
  return [
    'Necesito adaptar mi CV a un aviso de empleo para pasar los filtros automáticos (ATS) sin inventar nada.',
    '',
    'Reglas estrictas:',
    '1. No agregues experiencia, empresas, títulos, herramientas, cifras ni logros que no estén en mi CV o en la lista "Confirmado por mí".',
    '2. Cuando mi CV dice lo mismo que el aviso con otras palabras, usá la palabra exacta del aviso (podés dejar la mía entre paréntesis).',
    '3. Reordená los logros de cada experiencia para que primero aparezca lo que el aviso pide.',
    '4. Agregá al principio un resumen de 3 o 4 líneas y una línea de "Competencias" con las palabras del aviso que sí tengo.',
    '5. Mantené fechas, empresas y puestos tal como están. Mismo idioma que el aviso.',
    '6. Formato simple para ATS: sin tablas, sin columnas, sin íconos.',
    '7. Al final, aparte del CV, listá lo que el aviso pide y yo no tengo, para que yo decida.',
    '',
    `--- AVISO: ${job.role || ''}${job.company ? ` en ${job.company}` : ''} ---`,
    String(job.description || '(pegá acá la descripción del aviso)').slice(0, 12000),
    rew ? `\n--- MISMA IDEA CON OTRAS PALABRAS ---\n${rew}` : '',
    conf ? `\n--- CONFIRMADO POR MÍ (lo tengo aunque no figure en el CV) ---\n${conf}` : '',
    miss ? `\n--- NO FIGURA EN MI CV (no lo agregues) ---\n${miss}` : '',
    `\n--- MI CV ---\n${String(cvText || '(pegá acá tu CV)').slice(0, 30000)}`,
  ].join('\n');
}

module.exports = { score, keywords, jobTerms, summary, cvPrompt, stem, levelOf, englishRequired, yearsRequired, GROUPS };
