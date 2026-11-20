'use strict';
/**
 * review.js: the review queue seen from the panel. The agent leaves an application here when it
 * must not submit on its own (AGENTS.md rule 19); the user approves or rejects it in
 * "Avisos para revisar". Approving starts the agent, which re-opens the form and submits it.
 */
const { USER_ID } = require('./store');

function hist(data, from, to) {
  const h = Array.isArray(data.stage_history) ? data.stage_history.slice() : [];
  h.push({ from, to, at: new Date().toISOString() });
  return h;
}

async function list(c) {
  const r = await c.query(
    `SELECT id, company, role, url, status, data->>'ats' AS ats, data->'review' AS review
     FROM applications WHERE user_id = $1 AND data->'review'->>'state' = ANY($2)
     ORDER BY data->'review'->>'prepared_at'`, [USER_ID, ['pending', 'approved']]);
  return r.rows.map((x) => ({ ...x, review: x.review || {} }));
}

async function get(c, id) {
  const r = await c.query('SELECT id, company, role, url, status, data FROM applications WHERE id = $1 AND user_id = $2', [id, USER_ID]);
  const app = r.rows[0];
  if (!app || !app.data || !app.data.review) throw new Error('Esa postulación ya no está en la cola.');
  return app;
}

async function approve(c, id, note) {
  const app = await get(c, id);
  const data = app.data;
  if (data.review.state !== 'pending') throw new Error('Esa postulación ya estaba aprobada o resuelta.');
  data.review.state = 'approved';
  data.review.approved_at = new Date().toISOString();
  if (note) data.review.user_note = String(note).slice(0, 1000);
  await c.query('UPDATE applications SET data = $1::jsonb WHERE id = $2 AND user_id = $3', [JSON.stringify(data), id, USER_ID]);
  return { id, company: app.company, role: app.role };
}

async function reject(c, id, note) {
  const app = await get(c, id);
  const data = app.data;
  if (!['pending', 'approved'].includes(data.review.state)) throw new Error('Esa postulación ya estaba resuelta.');
  data.review.state = 'rejected';
  if (note) data.review.user_note = String(note).slice(0, 1000);
  data.stage_history = hist(data, app.status, 'skipped');
  await c.query("UPDATE applications SET status = 'skipped', data = $1::jsonb WHERE id = $2 AND user_id = $3", [JSON.stringify(data), id, USER_ID]);
  return { id, company: app.company, role: app.role, notes: data.review.notes || '' };
}

const isLinkedIn = (url) => /linkedin\.com\/jobs\/view\//i.test(String(url || ''));
const asked = (review) => (Array.isArray(review.answers) ? review.answers : [])
  .filter((a) => a && typeof a.question === 'string' && a.question.trim()).map((a) => a.question.trim());

/**
 * Keeps the queue honest: an application waiting only for answers whose questions are no
 * longer pending (answered or discarded) stops waiting. A LinkedIn Easy Apply one leaves the
 * queue (the next run applies to it on its own); any other one keeps its place, ready to approve.
 * Returns how many LinkedIn ones went back to the normal runs.
 */
async function cleanup(c, pendingQuestions) {
  const A = require('./answers');
  const open = new Set((pendingQuestions || []).map((q) => A.norm(q.question)));
  let back = 0;
  for (const a of await list(c)) {
    const reasons = a.review.reasons || [];
    if (!(reasons.length === 1 && reasons[0] === 'missing_answers')) continue;
    if (asked(a.review).some((q) => open.has(A.norm(q)))) continue;
    if (!isLinkedIn(a.url)) continue;
    const r = await c.query('SELECT data FROM applications WHERE id = $1 AND user_id = $2', [a.id, USER_ID]);
    const data = (r.rows[0] && r.rows[0].data) || {};
    delete data.review;
    await c.query('UPDATE applications SET data = $1::jsonb WHERE id = $2 AND user_id = $3', [JSON.stringify(data), a.id, USER_ID]);
    back++;
  }
  return back;
}

/** Takes a LinkedIn Easy Apply application out of the queue so the next run applies to it. */
async function release(c, id) {
  const app = await get(c, id);
  const data = app.data;
  delete data.review;
  await c.query('UPDATE applications SET data = $1::jsonb WHERE id = $2 AND user_id = $3', [JSON.stringify(data), id, USER_ID]);
  return { id };
}

/** Applications decided since they were queued: { applied: [...], rejected: [...] } with company, role, notes. */
async function outcomes(c) {
  const r = await c.query(
    `SELECT company, role, data->'review'->>'state' AS state, data->'review'->>'notes' AS notes
     FROM applications WHERE user_id = $1 AND data->'review'->>'state' = ANY($2)`, [USER_ID, ['submitted', 'rejected']]);
  return r.rows;
}

const REASONS = {
  captcha: 'el sitio pide un captcha',
  login_needed: 'hay que iniciar sesión en el sitio',
  missing_answers: 'hay preguntas que todavía no respondiste (están en Configuración, Preguntas pendientes)',
  human_only_deliverable: 'pide algo que tenés que hacer vos (test, video o similar)',
  job_board_account: 'es un portal de empleo con cuenta propia',
  complex_or_unknown_system: 'el sistema del sitio es complejo o desconocido',
  first_application_on_this_system: 'es la primera vez en este sistema',
  not_a_full_match: 'el aviso no coincide del todo con lo que buscás',
  free_text_answers_written: 'hay respuestas de texto libre redactadas por el agente',
  sensitive_or_legal_questions: 'hay preguntas sensibles o legales',
  new_account_created: 'se creó una cuenta nueva en el sitio',
  previous_submit_failed: 'un envío anterior falló',
  outside_working_window: 'fuera de tu horario',
};
module.exports = { list, approve, reject, outcomes, cleanup, release, isLinkedIn, asked, REASONS };
