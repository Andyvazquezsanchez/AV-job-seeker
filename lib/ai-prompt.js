'use strict';
/**
 * ai-prompt.js: instructions the user copies into the AI chat they already use (ChatGPT, Gemini,
 * Claude, Copilot...). The AI answers with JSON that the user pastes back into Configuración,
 * where it is checked like any import and shown for review before saving.
 */
const cfg = require('./config');

// Settings an AI can propose from a CV and a short conversation.
const PROFILE_KEYS = {
  first_name: 'nombre', last_name: 'apellido', email: 'email', phone: 'teléfono con código de país',
  city: 'ciudad', country: 'país', linkedin_url: 'URL de LinkedIn',
  headline: 'titular profesional breve', current_company: 'empresa actual o última, como quiere que figure',
  school_name: 'universidad o institución principal', degree: 'título obtenido', field_of_study: 'carrera',
  years_of_experience: 'años de experiencia total (número)', english_level: 'nivel de inglés (Básico, Intermedio, Avanzado o Nativo)',
  notice_period: 'disponibilidad o preaviso', salary_ars: 'pretensión salarial bruta mensual en pesos', salary_usd: 'pretensión salarial bruta mensual en dólares',
  experience_years: 'objeto { "tema": años } solo con temas que el CV o la persona confirman (ej. { "selección IT": 5 })',
  target_titles: 'lista de palabras o frases que el título de un aviso que le interesa tiene que contener, en español y en inglés, en minúsculas (ej. "hr business partner", "jefe de rrhh")',
  avoid: 'lista de palabras que descartan un aviso por su título (ej. "pasante", "ventas")',
  senior_only: 'lista de palabras que solo valen si el título también dice Senior, Sr o un cargo de liderazgo (ej. "analista")',
  description_avoid: 'lista de frases que descartan un aviso por su descripción (ej. "solo comisiones")',
  search_queries: 'de 3 a 5 búsquedas booleanas para LinkedIn, con AND, OR, NOT, comillas y paréntesis',
  work_modes: 'lista con algunos de: "remote", "hybrid", "onsite"',
  search_location: 'país o ciudad donde buscar',
  onsite_places: 'lista de ciudades, barrios o partidos a los que puede ir en persona (en minúsculas, sin tildes)',
  salary_min_usd: 'salario mínimo aceptable, bruto mensual en dólares (número)', salary_min_ars: 'salario mínimo aceptable, bruto mensual en pesos (número)',
  target_companies: 'lista de empresas que le interesan', avoid_companies: 'lista de empresas a evitar',
  context_notes: 'resumen en texto de su perfil, lo que busca y lo que no, en primera persona',
};

function profilePrompt(cvText) {
  const keys = Object.entries(PROFILE_KEYS).filter(([k]) => cfg.FIELDS[k]).map(([k, d]) => `- "${k}": ${d}`).join('\n');
  const cv = String(cvText || '').trim();
  return [
    'Necesito que me ayudes a configurar un programa que busca avisos de empleo en LinkedIn y me postula por mí.',
    cv ? 'Abajo está el texto de mi CV.' : 'Te voy a pegar mi CV en el próximo mensaje (o adjuntalo si podés leer archivos).',
    '',
    'Primero haceme, de a una, las preguntas que necesites para entender qué busco: qué puestos, qué nivel, modalidad, en qué zonas puedo trabajar presencial, salario mínimo, qué no quiero hacer y cualquier cosa que el CV no diga. No inventes datos: si algo no está en el CV ni te lo dije, no lo incluyas.',
    '',
    'Cuando tengas todo, respondé SOLO con un objeto JSON (sin texto antes ni después) con estas claves. Las que no correspondan, dejalas afuera:',
    keys,
    '',
    'Reglas: listas como arrays de textos; números sin puntos ni símbolos; todo en el idioma en que esté el dato; nada de comentarios dentro del JSON.',
    cv ? `\n--- MI CV ---\n${cv.slice(0, 40000)}` : '',
  ].join('\n');
}

function questionsPrompt(pending, cvText, context) {
  const qs = (pending || []).map((q) => ({ id: q.id, pregunta: q.question, ...(q.options && q.options.length ? { opciones: q.options } : {}) }));
  const cv = String(cvText || '').trim();
  return [
    'Formularios de postulación a empleos me hicieron estas preguntas y todavía no tengo respuesta guardada. Ayudame a responderlas.',
    'Usá solo lo que dice mi CV o lo que yo te diga. Si una respuesta no surge de ahí, preguntámela antes. Si la pregunta tiene opciones, la respuesta tiene que ser exactamente una de ellas.',
    'Cuando estén todas, respondé SOLO con un objeto JSON { "id": "respuesta" }, sin texto antes ni después.',
    '',
    JSON.stringify(qs, null, 2),
    context ? `\n--- LO QUE BUSCO ---\n${String(context).slice(0, 8000)}` : '',
    cv ? `\n--- MI CV ---\n${cv.slice(0, 40000)}` : '\n(Te paso mi CV en el próximo mensaje.)',
  ].join('\n');
}

/** Finds the JSON object in an AI's answer (it may come inside ``` fences or with text around it). */
function jsonFromReply(text) {
  const s = String(text || '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s;
  const a = body.indexOf('{'); const b = body.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('No encontré un JSON en la respuesta. Pedile a tu IA que responda solo con el JSON.');
  try { return JSON.parse(body.slice(a, b + 1)); } catch { throw new Error('La respuesta tiene un JSON con errores. Pedile a tu IA que lo revise y lo devuelva de nuevo.'); }
}

module.exports = { profilePrompt, questionsPrompt, jsonFromReply, PROFILE_KEYS };
