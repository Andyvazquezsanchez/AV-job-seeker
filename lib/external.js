'use strict';
/**
 * external.js: jobs that passed the user's filters and wait for the user's choice, kept in
 * datos/avisos-externos.json. Mostly LinkedIn jobs without Easy Apply ("Solicitar" leads to
 * the company's site); also jobs from company job boards (Greenhouse, Lever, Ashby) and from
 * other job sites (Computrabajo, Bumeran, ZonaJobs). `source` says where each one came from
 * (missing = linkedin).
 *
 * Statuses:
 *   sin revisar     passed title, company, place and salary; description not read yet
 *                   (the next run reads it and moves it to "pendiente" or "descartado")
 *   pendiente       passed every filter; waiting for the user to choose
 *   para el agente  the user sent it to the agent (AGENTS.md rule 19b)
 *   en cola         the agent prepared it and it waits for approval in the review queue
 *   postulado       applied (by the agent or by the user)
 *   descartado      filtered out, or the user did not want it
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const FILE = path.join(DATA_DIR, 'avisos-externos.json');
const STATUSES = ['sin revisar', 'pendiente', 'para el agente', 'en cola', 'postulado', 'descartado'];
const key = (u) => String(u || '').split('?')[0].replace(/\/+$/, '');

function load() {
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(d) ? d : []; } catch { return []; }
}
function save(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, FILE);
}
/** The stored entry for this job, or null. */
function find(job) {
  const k = key(job.url);
  return (k && load().find((j) => key(j.url) === k)) || null;
}
const has = (job) => !!find(job);

/** Adds a job with the given status; returns the entry, or null when it was already there. */
function add(job, status = 'pendiente') {
  const list = load();
  const k = key(job.url);
  if (!k || list.some((j) => key(j.url) === k)) return null;
  const id = list.reduce((m, j) => Math.max(m, j.id || 0), 0) + 1;
  const entry = {
    id, status, role: job.role || '', company: job.company || '', location: job.location || '',
    url: k + '/', salary: job.salary_text || null, found_at: new Date().toISOString(),
    ...(job.source && job.source !== 'linkedin' ? { source: job.source } : {}),
    ...(job.fit ? { fit: job.fit } : {}),
  };
  list.push(entry);
  save(list);
  return entry;
}
function mark(id, status, note) {
  if (!STATUSES.includes(status)) throw new Error(`Estado desconocido: ${status}. Válidos: ${STATUSES.join(', ')}`);
  const list = load();
  const e = list.find((j) => j.id === Number(id));
  if (!e) throw new Error(`No hay un aviso externo #${id}`);
  e.status = status;
  e.updated_at = new Date().toISOString();
  if (note !== undefined) e.note = String(note || '').slice(0, 500);
  save(list);
  return e;
}
/** Updates fields of a stored entry (used when a "sin revisar" one gets read). */
function update(id, fields) {
  const list = load();
  const e = list.find((j) => j.id === Number(id));
  if (!e) return null;
  Object.assign(e, fields, { updated_at: new Date().toISOString() });
  save(list);
  return e;
}
module.exports = { FILE, STATUSES, load, find, has, add, mark, update };
