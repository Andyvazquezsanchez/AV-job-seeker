'use strict';
/**
 * config.js: the user's own configuration, as one validated object.
 *
 * It maps a flat, documented set of settings to their place in users.data, so
 * the same settings can be edited in the local page (dashboard /config), in a
 * file (config/perfil.json) or by the agent, and always pass the same checks.
 *
 * Only whitelisted keys are accepted, with bounded sizes. Unknown keys are
 * reported and ignored; they never reach the database.
 */

const WORK_MODES = ['remote', 'hybrid', 'onsite'];
const POSTED = ['day', 'week', 'month'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// type: text | list | enumlist | enum | map
const FIELDS = {
  // --- what to look for ---
  target_titles:           { path: ['job_preferences', 'target_titles'], type: 'list', label: 'Puestos objetivo (el título del aviso debe contener alguno)' },
  avoid:                   { path: ['job_preferences', 'avoid'], type: 'list', label: 'Palabras que descartan un aviso por su título' },
  onsite_places:           { path: ['job_preferences', 'onsite_places'], type: 'list', label: 'Lugares aceptados para avisos presenciales o híbridos' },
  senior_only:             { path: ['job_preferences', 'senior_only'], type: 'list', label: 'Palabras del título que solo valen en puestos senior' },
  description_avoid:       { path: ['job_preferences', 'description_avoid'], type: 'list', label: 'Frases que descartan un aviso por su descripción' },
  search_queries:          { path: ['job_preferences', 'search_queries'], type: 'list', max: 20, maxLen: 400, label: 'Búsquedas para LinkedIn (admite booleanos: AND, OR, NOT, comillas, paréntesis)' },
  work_modes:              { path: ['job_preferences', 'work_modes'], type: 'enumlist', values: WORK_MODES, label: 'Modalidad' },
  posted_within:           { path: ['job_preferences', 'posted_within'], type: 'enum', values: POSTED, label: 'Antigüedad máxima del aviso' },
  search_location:         { path: ['job_preferences', 'location'], type: 'text', label: 'Ubicación de búsqueda' },
  salary_min_usd:          { path: ['job_preferences', 'salary_min_usd'], type: 'int', money: true, min: 0, max: 1000000, label: 'Salario mínimo en USD (bruto por mes)' },
  salary_min_ars:          { path: ['job_preferences', 'salary_min_ars'], type: 'int', money: true, min: 0, max: 10000000000, label: 'Salario mínimo en pesos (bruto por mes)' },
  seniority_levels:        { path: ['job_preferences', 'seniority_levels'], type: 'list', label: 'Niveles buscados' },
  ats_boards:              { path: ['job_preferences', 'ats_boards'], type: 'list', max: 100, maxLen: 300, label: 'Páginas de empleo de empresas (Greenhouse, Lever o Ashby), una por línea' },
  other_portals:           { path: ['job_preferences', 'other_portals'], type: 'enumlist', values: ['computrabajo', 'bumeran', 'zonajobs'], label: 'Otros portales donde buscar (computrabajo, bumeran, zonajobs; vacío = los tres)' },
  min_fit:                 { path: ['job_preferences', 'min_fit'], type: 'int', min: 0, max: 100, label: 'Afinidad mínima para postular (0 a 100; vacío o 0 = no filtra)' },
  // --- companies ---
  target_companies:        { path: ['job_preferences', 'target_companies'], type: 'list', max: 300, label: 'Empresas objetivo' },
  avoid_companies:         { path: ['job_preferences', 'avoid_companies'], type: 'list', max: 300, label: 'Empresas a evitar' },
  company_types_preferred: { path: ['job_preferences', 'company_types_preferred'], type: 'list', label: 'Tipos de empresa preferidos' },
  company_types_avoid:     { path: ['job_preferences', 'company_types_avoid'], type: 'list', label: 'Tipos de empresa a evitar' },
  deal_breakers:           { path: ['job_preferences', 'deal_breakers'], type: 'list', maxLen: 300, label: 'Condiciones excluyentes (para la evaluación del agente)' },
  // --- identity and contact ---
  first_name:   { path: ['form_answers', 'first_name'], type: 'text', label: 'Nombre' },
  last_name:    { path: ['form_answers', 'last_name'], type: 'text', label: 'Apellido' },
  email:        { path: ['form_answers', 'email'], type: 'text', label: 'Email' },
  phone:        { path: ['personal_info', 'phone'], type: 'text', label: 'Teléfono (con código de país)' },
  city:         { path: ['personal_info', 'city'], type: 'text', label: 'Ciudad' },
  state:        { path: ['personal_info', 'state'], type: 'text', label: 'Provincia' },
  country:      { path: ['personal_info', 'country'], type: 'text', label: 'País' },
  linkedin_url: { path: ['form_answers', 'linkedin_url'], type: 'text', label: 'URL de LinkedIn' },
  // --- form answers ---
  headline:            { path: ['form_answers', 'headline'], type: 'text', maxLen: 300, label: 'Titular profesional' },
  current_company:     { path: ['form_answers', 'current_company'], type: 'text', label: 'Empresa actual (como querés que figure)' },
  school_name:         { path: ['form_answers', 'school_name'], type: 'text', label: 'Universidad' },
  degree:              { path: ['form_answers', 'degree'], type: 'text', label: 'Título' },
  field_of_study:      { path: ['form_answers', 'field_of_study'], type: 'text', label: 'Carrera' },
  years_of_experience: { path: ['form_answers', 'years_of_experience'], type: 'text', label: 'Años de experiencia totales' },
  experience_years:    { path: ['form_answers', 'experience_years'], type: 'map', label: 'Años de experiencia por tema' },
  english_level:       { path: ['form_answers', 'english_level'], type: 'text', label: 'Nivel de inglés' },
  spanish_level:       { path: ['form_answers', 'spanish_level'], type: 'text', label: 'Nivel de español' },
  notice_period:       { path: ['form_answers', 'notice_period'], type: 'text', label: 'Disponibilidad / preaviso' },
  seniority:           { path: ['form_answers', 'seniority'], type: 'text', label: 'Seniority' },
  salary_default:      { path: ['form_answers', 'salary_default'], type: 'text', label: 'Pretensión salarial cuando no se aclara moneda' },
  salary_ars:          { path: ['form_answers', 'salary_ars'], type: 'text', label: 'Pretensión en ARS' },
  salary_usd:          { path: ['form_answers', 'salary_usd'], type: 'text', label: 'Pretensión en USD' },
  qa:                  { path: ['form_answers', 'qa'], type: 'map', max: 500, maxLen: 2000, label: 'Banco de respuestas (pregunta = respuesta)' },
  // --- pace and limits (defaults in lib/humanize.js) ---
  timezone:         { path: ['automation', 'timezone'], type: 'text', label: 'Zona horaria (IANA, por ejemplo America/Argentina/Buenos_Aires)' },
  start_hour:       { path: ['automation', 'start_hour'], type: 'int', min: 0, max: 23, label: 'Hora de inicio (0 a 23)' },
  end_hour:         { path: ['automation', 'end_hour'], type: 'int', min: 1, max: 24, label: 'Hora de fin (1 a 24)' },
  daily_cap_min:    { path: ['automation', 'daily_cap_min'], type: 'int', min: 0, max: 50, label: 'Tope diario en LinkedIn: mínimo' },
  daily_cap_max:    { path: ['automation', 'daily_cap_max'], type: 'int', min: 0, max: 50, label: 'Tope diario en LinkedIn: máximo' },
  rest_days:        { path: ['automation', 'rest_days'], type: 'enumlist', values: DAYS, label: 'Días sin postulaciones automáticas' },
  half_days:        { path: ['automation', 'half_days'], type: 'enumlist', values: DAYS, label: 'Días con la mitad del tope' },
  company_cap:      { path: ['automation', 'company_cap'], type: 'int', min: 1, max: 20, label: 'Máximo de postulaciones por empresa por día' },
  notify:           { path: ['automation', 'notify'], type: 'enum', values: ['si', 'no'], label: 'Avisos de Windows al terminar la corrida automática o si LinkedIn frena (si o no)' },
  ramp_weeks:       { path: ['automation', 'ramp_weeks'], type: 'int', min: 0, max: 8, label: 'Semanas de arranque gradual en LinkedIn (semana 1 hasta 5 por día, semana 2 hasta 10; 0 = sin arranque gradual)' },
  // --- tracking spreadsheet ---
  tracking_file: { path: ['tracking', 'file'], type: 'text', maxLen: 500, label: 'Tu planilla de seguimiento (.xlsx o .csv): ruta del archivo' },
  auto_log_file: { path: ['tracking', 'log_file'], type: 'text', maxLen: 500, label: 'Dónde guardar el registro de postulaciones automáticas (.csv)' },
  // --- CV and context ---
  cv_path:       { path: ['profile', 'cv_path'], type: 'text', maxLen: 500, label: 'CV en español: ruta del PDF en esta computadora' },
  cv_path_en:    { path: ['profile', 'cv_path_en'], type: 'text', maxLen: 500, label: 'CV en inglés: ruta del PDF en esta computadora' },
  photo_path:    { path: ['profile', 'photo_path'], type: 'text', maxLen: 500, label: 'Foto de perfil: ruta de la imagen en esta computadora (JPG o PNG)' },
  cv_rules:      { path: ['profile', 'cv_rules'], type: 'map', max: 30, maxLen: 500, label: 'Reglas propias (palabras del aviso = nombre o ruta del CV)' },
  cv_text:       { path: ['cv_text'], type: 'text', maxLen: 60000, label: 'Texto del CV' },
  context_notes: { path: ['context_notes'], type: 'text', maxLen: 120000, label: 'Contexto y preferencias (texto libre o Markdown)' },
};

const DEFAULT_MAX = 100;
const DEFAULT_LEN = 200;

function cleanText(v, maxLen) {
  // Control characters are dropped (new lines and tabs stay).
  return String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, maxLen);
}

function toList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(/\r?\n/);
  return null;
}

/**
 * Validate an incoming object. Returns { clean, errors }.
 * A key set to null or to an empty value clears that setting.
 */
function sanitize(input) {
  const clean = {};
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { clean, errors: ['la configuración debe ser un objeto'] };
  for (const [key, raw] of Object.entries(input)) {
    const f = FIELDS[key];
    if (!f) { errors.push(`clave desconocida, ignorada: ${String(key).slice(0, 60)}`); continue; }
    const maxLen = f.maxLen || DEFAULT_LEN;
    const max = f.max || DEFAULT_MAX;
    if (raw === null || raw === undefined) { clean[key] = null; continue; }
    if (f.type === 'text') {
      if (typeof raw !== 'string' && typeof raw !== 'number') { errors.push(`${key}: se esperaba texto`); continue; }
      clean[key] = cleanText(raw, maxLen) || null;
    } else if (f.type === 'int') {
      if (raw === '') { clean[key] = null; continue; }
      // Money may be typed as "3.100.000", "US$ 2,000" or "2000": keep the digits.
      const nmb = f.money && typeof raw === 'string' ? Number(raw.replace(/[^\d]/g, '') || NaN) : Number(raw);
      if (!Number.isInteger(nmb) || nmb < f.min || nmb > f.max) { errors.push(`${key}: debe ser un entero entre ${f.min} y ${f.max}`); continue; }
      clean[key] = nmb;
    } else if (f.type === 'enum') {
      const v = cleanText(raw, 40).toLowerCase();
      if (!v) { clean[key] = null; continue; }
      if (!f.values.includes(v)) { errors.push(`${key}: debe ser uno de ${f.values.join(', ')}`); continue; }
      clean[key] = v;
    } else if (f.type === 'list' || f.type === 'enumlist') {
      const arr = toList(raw);
      if (!arr) { errors.push(`${key}: se esperaba una lista`); continue; }
      let items = [...new Set(arr.map((x) => cleanText(x, maxLen)).filter(Boolean))].slice(0, max);
      if (f.type === 'enumlist') {
        const bad = items.filter((x) => !f.values.includes(x.toLowerCase()));
        if (bad.length) { errors.push(`${key}: valores no válidos: ${bad.join(', ')} (usar ${f.values.join(', ')})`); continue; }
        items = items.map((x) => x.toLowerCase());
      }
      clean[key] = items;
    } else if (f.type === 'map') {
      if (typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${key}: se esperaba un objeto pregunta/respuesta`); continue; }
      const out = {};
      for (const [k, v] of Object.entries(raw).slice(0, max)) {
        const kk = cleanText(k, 300);
        if (!kk || kk === '__proto__' || kk === 'constructor' || kk === 'prototype') continue;
        if (v === null || v === undefined || (typeof v !== 'string' && typeof v !== 'number')) continue;
        const vv = cleanText(v, maxLen);
        if (vv) out[kk] = vv;
      }
      clean[key] = out;
    }
  }
  // Paths pasted from Windows ("Copiar como ruta de acceso") come wrapped in quotes.
  for (const k of ['tracking_file', 'auto_log_file', 'cv_path', 'cv_path_en']) {
    if (typeof clean[k] === 'string') clean[k] = clean[k].replace(/^["'\s]+|["'\s]+$/g, '') || null;
  }
  if (clean.timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: clean.timezone }); } catch { errors.push(`timezone: zona horaria desconocida "${clean.timezone}"`); delete clean.timezone; }
  }
  if (Number.isInteger(clean.daily_cap_min) && Number.isInteger(clean.daily_cap_max) && clean.daily_cap_min > clean.daily_cap_max) {
    errors.push('daily_cap_min no puede ser mayor que daily_cap_max'); delete clean.daily_cap_min; delete clean.daily_cap_max;
  }
  if (Number.isInteger(clean.start_hour) && Number.isInteger(clean.end_hour) && clean.start_hour >= clean.end_hour) {
    errors.push('start_hour debe ser menor que end_hour'); delete clean.start_hour; delete clean.end_hour;
  }
  if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) { errors.push('email: no parece una dirección válida'); delete clean.email; }
  if (clean.linkedin_url && !/^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(clean.linkedin_url)) { errors.push('linkedin_url: debe empezar con https://www.linkedin.com/'); delete clean.linkedin_url; }
  return { clean, errors };
}

function getPath(obj, path) {
  return path.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}
function setPath(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!o[path[i]] || typeof o[path[i]] !== 'object' || Array.isArray(o[path[i]])) o[path[i]] = {};
    o = o[path[i]];
  }
  const last = path[path.length - 1];
  if (value === null) delete o[last]; else o[last] = value;
}

/** Merge validated settings into a copy of users.data. Keys not present in `clean` are left untouched. */
function applyToData(data, clean) {
  const out = JSON.parse(JSON.stringify(data || {}));
  for (const [key, value] of Object.entries(clean)) setPath(out, FIELDS[key].path, value);
  return out;
}

/** Read the settings back out of users.data (tolerates the older { value, weight } shape). */
function extract(data) {
  const out = {};
  for (const [key, f] of Object.entries(FIELDS)) {
    let v = getPath(data || {}, f.path);
    if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v && f.type !== 'map') v = v.value;
    if (v === undefined || v === null) continue;
    if ((f.type === 'list' || f.type === 'enumlist') && typeof v === 'string') v = v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    out[key] = v;
  }
  return out;
}

const STATUSES = ['discovered', 'contacted', 'applied', 'in_review', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn', 'skipped'];

/** Validate past applications for import. Returns { rows, errors }. */
function sanitizeHistory(input) {
  const rows = [];
  const errors = [];
  if (!Array.isArray(input)) return { rows, errors: ['el historial debe ser una lista'] };
  input.slice(0, 5000).forEach((r, i) => {
    if (!r || typeof r !== 'object') { errors.push(`fila ${i + 1}: no es un objeto`); return; }
    const company = cleanText(r.company || '', 200);
    const role = cleanText(r.role || '', 300);
    if (!company || !role) { errors.push(`fila ${i + 1}: faltan company o role`); return; }
    const status = cleanText(r.status || 'applied', 20).toLowerCase();
    if (!STATUSES.includes(status)) { errors.push(`fila ${i + 1}: estado no válido "${status}"`); return; }
    let url = r.url ? cleanText(r.url, 1000) : null;
    if (url && !/^https?:\/\//i.test(url)) url = null;
    let date = null;
    if (r.date && /^\d{4}-\d{2}-\d{2}/.test(String(r.date)) && !Number.isNaN(Date.parse(String(r.date)))) date = String(r.date).slice(0, 10);
    rows.push({ company, role, url, status, date, platform: cleanText(r.platform || 'history', 40) || 'history', notes: r.notes ? cleanText(r.notes, 1000) : null });
  });
  return { rows, errors };
}

module.exports = { FIELDS, WORK_MODES, POSTED, DAYS, STATUSES, sanitize, applyToData, extract, sanitizeHistory };
