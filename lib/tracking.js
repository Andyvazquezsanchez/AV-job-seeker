'use strict';
/**
 * tracking.js: keep the program in step with the spreadsheet where the user
 * tracks their applications.
 *
 *   IN   syncFromFile(db, file): reads an .xlsx or .csv (never writes to it),
 *        finds the tables that have a company column and a position column,
 *        and adds or updates those applications in the database, so nothing
 *        the user already applied to (or discarded) is applied to again.
 *   OUT  appendLog(row): appends every application the program submits to a
 *        CSV file that a person, a spreadsheet or another tool can read.
 */
const fs = require('fs');
const path = require('path');
const { readWorkbook, excelDate, parseCsv } = require('./xlsx-read');
const { strip, findMatch } = require('./match');

const HEAD = {
  company: /^(empresa|compania|company|organizacion|empleador|employer)$/,
  role: /^(puesto|rol|role|posicion|position|cargo|titulo|title|job title|busqueda|vacante)$/,
  status: /^(estado|status|etapa|stage|certeza)$/,
  date: /^(fecha|date|fecha de postulacion|applied|applied at|fecha postulacion)$/,
  url: /^(link|url|enlace|aviso)$/,
  notes: /^(notas|nota|notes|detalle|motivo|comentarios|observaciones)$/,
};

const RANK = { discovered: 0, contacted: 1, applied: 2, in_review: 3, screening: 4, interview: 5, offer: 6, hired: 7 };
const TERMINAL = ['rejected', 'withdrawn', 'skipped'];

/** Free-text status from a spreadsheet -> one of the program's statuses. */
function mapStatus(text, sheetName) {
  const t = strip(text);
  const sheet = strip(sheetName);
  if (/descart/.test(sheet)) return 'skipped';
  if (/rechaz|reject/.test(sheet)) return /espera|pending/.test(t) ? 'applied' : 'rejected';
  if (!t) return 'applied';
  if (/descart|no envi|skip/.test(t)) return 'skipped';
  if (/rechaz|reject|no avanz|cerrad|declin/.test(t)) return 'rejected';
  if (/retir|withdr|desist/.test(t)) return 'withdrawn';
  if (/contrat|hired|ingres/.test(t)) return 'hired';
  if (/oferta|offer/.test(t)) return 'offer';
  if (/entrevista|interview|en proceso|in process/.test(t)) return 'interview';
  if (/screening|llamada|filtro/.test(t)) return 'screening';
  if (/stand by|revision|review|evaluac/.test(t)) return 'in_review';
  if (/contact/.test(t)) return 'contacted';
  return 'applied';
}

function toDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return excelDate(v);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);   // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Find application tables in a set of sheets. Returns [{company, role, status, date, url, notes, sheet}]. */
function extractApplications(sheets) {
  const out = [];
  for (const sheet of sheets) {
    let headerAt = -1, cols = null;
    for (let i = 0; i < Math.min(sheet.rows.length, 20) && headerAt === -1; i++) {
      const found = {};
      (sheet.rows[i] || []).forEach((cell, c) => {
        const h = strip(cell);
        for (const [k, re] of Object.entries(HEAD)) if (found[k] === undefined && re.test(h)) found[k] = c;
      });
      if (found.company !== undefined && found.role !== undefined) { headerAt = i; cols = found; }
    }
    if (headerAt === -1) continue;
    for (const row of sheet.rows.slice(headerAt + 1)) {
      const company = String(row[cols.company] ?? '').trim();
      const role = String(row[cols.role] ?? '').trim();
      if (!company || !role) continue;
      let url = cols.url !== undefined ? String(row[cols.url] ?? '').trim() : '';
      if (!/^https?:\/\//i.test(url)) url = '';
      out.push({
        company: company.slice(0, 200), role: role.slice(0, 300),
        status: mapStatus(cols.status !== undefined ? row[cols.status] : '', sheet.name),
        date: cols.date !== undefined ? toDate(row[cols.date]) : null,
        url: url ? url.slice(0, 1000) : null,
        notes: cols.notes !== undefined && row[cols.notes] != null ? String(row[cols.notes]).slice(0, 1000) : null,
        sheet: sheet.name,
      });
    }
  }
  return out;
}

function readTrackingFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`no existe el archivo de seguimiento: ${file}`);
  if (/\.xlsx$/i.test(file)) return extractApplications(readWorkbook(file));
  if (/\.(csv|txt)$/i.test(file)) return extractApplications([{ name: path.basename(file), rows: parseCsv(fs.readFileSync(file, 'utf8')) }]);
  throw new Error('el archivo de seguimiento debe ser .xlsx o .csv');
}

/**
 * Bring the database in line with the tracking rows.
 * New jobs are inserted; known ones get their status updated when the file is
 * further along (or says the job is closed). Returns counts.
 */
async function syncRows(db, rows, userId, source = 'tracking_file') {
  const res = await db.query('SELECT id, company, role, status FROM applications WHERE user_id = $1', [userId]);
  const known = res.rows.map((r) => ({ ...r }));
  let inserted = 0, updated = 0, unchanged = 0;
  await db.query('BEGIN');
  try {
    for (const r of rows) {
      const hit = findMatch(r, known);
      if (!hit || hit.kind !== 'same') {
        const ins = await db.query(
          `INSERT INTO applications (user_id, platform, company, role, url, status, applied_at, data)
           VALUES ($1, 'history', $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), $7::jsonb) RETURNING id`,
          [userId, r.company, r.role, r.url, r.status, r.date, JSON.stringify({ source, sheet: r.sheet, notes: r.notes })]);
        known.push({ id: ins.rows[0].id, company: r.company, role: r.role, status: r.status });
        inserted++;
        continue;
      }
      const cur = hit.match.status;
      const advance = TERMINAL.includes(r.status) ? cur !== r.status && !TERMINAL.includes(cur)
        : (RANK[r.status] ?? 0) > (RANK[cur] ?? 0) && !TERMINAL.includes(cur);
      if (advance) {
        await db.query('UPDATE applications SET status = $1 WHERE id = $2 AND user_id = $3', [r.status, hit.match.id, userId]);
        hit.match.status = r.status;
        updated++;
      } else unchanged++;
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
  return { read: rows.length, inserted, updated, unchanged };
}

async function syncFromFile(db, file, userId) {
  return syncRows(db, readTrackingFile(file), userId);
}

// ---- outgoing log ----
const LOG_HEADER = ['Fecha', 'Hora', 'Empresa', 'Puesto', 'Canal', 'Estado', 'Link', 'Origen'];
// A CSV cell. Text that starts like a formula (=, +, -, @) gets a leading apostrophe, so a job
// title copied from a website can never run as a formula when the file is opened in Excel.
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Append one line to the log of applications submitted by the program.
 * Semicolon-separated with a BOM so Excel opens it directly. If the file is
 * locked (open in Excel), the line goes to a "-pendiente" file next to it and
 * is merged the next time the main file can be written.
 */
function appendLog(file, row, when = new Date(), timeZone = 'America/Argentina/Buenos_Aires') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(when).map((x) => [x.type, x.value]));
  const line = [`${p.day}/${p.month}/${p.year}`, `${p.hour}:${p.minute}`, row.company, row.role, row.channel, row.status || 'Enviada', row.url, row.origin || (row.cv ? `Job Seeker (automática), CV: ${row.cv}` : 'Job Seeker (automática)')].map(csvCell).join(';') + '\r\n';
  const pending = file.replace(/(\.csv)?$/i, '-pendiente.csv');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    let extra = '';
    if (fs.existsSync(pending)) extra = fs.readFileSync(pending, 'utf8');
    if (!fs.existsSync(file)) fs.writeFileSync(file, '﻿' + LOG_HEADER.join(';') + '\r\n');
    fs.appendFileSync(file, extra + line);
    if (extra) fs.unlinkSync(pending);
    return { written: file };
  } catch (e) {
    fs.appendFileSync(pending, line);
    return { written: pending, reason: e.code || e.message };
  }
}

module.exports = { extractApplications, readTrackingFile, syncRows, syncFromFile, appendLog, mapStatus, toDate, csvCell, LOG_HEADER };
