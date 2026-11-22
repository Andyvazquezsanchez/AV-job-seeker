'use strict';
/**
 * safety.js: stop applying on LinkedIn for a few days after a warning sign
 * (a captcha, a verification page, a restriction notice or the daily limit
 * message). Kept in datos/pausa-linkedin.json so every process sees it:
 *   { reason, detail, since, until, cleared_at }
 *
 * - detect(text, url): which warning sign a page shows, or null.
 * - pause(reason): starts or extends the pause.
 * - active(): the running pause, or null.
 * - clear(): the user resumes by hand (panel "Reanudar").
 * - recovering(): true during the 3 days after a pause ends; the daily cap is halved.
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const FILE = path.join(DATA_DIR, 'pausa-linkedin.json');
const DAY = 86400000;
const RECOVERY_DAYS = 3;

// Days of pause for each sign. The daily limit only needs the next day.
const REASONS = {
  captcha: { days: 3, text: 'LinkedIn pidió una verificación (captcha)' },
  checkpoint: { days: 3, text: 'LinkedIn pidió verificar que sos vos' },
  restricted: { days: 7, text: 'LinkedIn avisó que la cuenta tiene restricciones' },
  limit: { days: 1, text: 'LinkedIn avisó que llegaste al límite de solicitudes del día' },
};

const now = () => (process.env.HUMANIZE_NOW ? new Date(process.env.HUMANIZE_NOW) : new Date());

function read() {
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return d && typeof d === 'object' ? d : null; } catch { return null; }
}
function write(d) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, FILE);
}

/** Which warning sign the page shows: 'captcha' | 'checkpoint' | 'restricted' | 'limit' | null. */
function detect(text, url) {
  const u = String(url || '');
  const t = String(text || '').toLowerCase();
  if (/linkedin\.com\/checkpoint\//i.test(u)) return /restrict/i.test(u) ? 'restricted' : 'checkpoint';
  if (/(account|cuenta)[^.\n]{0,40}(restricted|restringida|suspendida|suspended)|temporarily restricted|restringimos (temporalmente )?tu cuenta/.test(t)) return 'restricted';
  if (/limit daily submissions|reached the (daily )?easy apply limit|come back tomorrow to continue applying|limitamos (la cantidad|el número) de solicitudes|alcanzaste el límite (diario )?de solicitudes|vuelve mañana para seguir|volvé mañana para seguir/.test(t)) return 'limit';
  if (t.includes('captcha') || t.includes('security check') || t.includes('verificación de seguridad') || t.includes('control de seguridad')) return 'captcha';
  return null;
}

/** The pause in force, or null. */
function active() {
  const d = read();
  if (!d || d.cleared_at || !d.until) return null;
  if (new Date(d.until) <= now()) return null;
  const r = REASONS[d.reason] || { text: d.reason };
  return { ...d, text: r.text };
}

/** Starts a pause, or extends the current one when the new end is later. */
function pause(reason, detail) {
  const r = REASONS[reason] || { days: 3 };
  const t = now();
  const until = new Date(t.getTime() + r.days * DAY);
  const cur = active();
  if (cur && new Date(cur.until) >= until) return cur;
  const d = { reason, detail: String(detail || '').slice(0, 300), since: t.toISOString(), until: until.toISOString(), cleared_at: null };
  write(d);
  return { ...d, text: (REASONS[reason] || { text: reason }).text };
}

/** The user resumes before the pause ends. */
function clear() {
  const d = read();
  if (!d) return { ok: true, was: null };
  if (!d.cleared_at) { d.cleared_at = now().toISOString(); write(d); }
  return { ok: true, was: d.reason };
}

/** True during the few days after a pause ended (by time or by hand): the cap is halved. */
function recovering() {
  const d = read();
  if (!d || !d.until) return false;
  const ended = d.cleared_at ? new Date(d.cleared_at) : new Date(d.until);
  const t = now();
  return ended <= t && t.getTime() - ended.getTime() < RECOVERY_DAYS * DAY;
}

/** Text for the console when a run stops because of a pause. */
function message(p) {
  const until = new Date(p.until).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  return `Postulación en LinkedIn en pausa hasta el ${until}: ${p.text}. Es una medida de cuidado de tu cuenta. Si ya lo resolviste, tocá "Reanudar" en el panel.`;
}

module.exports = { FILE, REASONS, RECOVERY_DAYS, detect, active, pause, clear, recovering, message };
