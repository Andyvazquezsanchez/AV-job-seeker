'use strict';
/**
 * followup.js: which applications are worth a follow-up message, and a draft to start from.
 * Pure functions; the data lives in applications.data:
 *   stage_history: [{ stage, from, moved_at }]   (moves between stages)
 *   followups:     [ISO dates]                    (the user said "Ya hice seguimiento")
 *   followup_at:   ISO date                       (postponed until then)
 *   followup_off:  true                           (the user does not want reminders for this one)
 *
 * Rules (days without any movement):
 *   applied, in review, contacted: from 10 to 45 days; at most 2 reminders
 *   first contact, interview:      from 7 to 30 days;  at most 3 reminders
 *   offer:                         from 4 to 21 days;  at most 2 reminders
 * Past the upper limit the application is marked as stale: a message rarely helps by then,
 * and the user may prefer to close it.
 * Nothing is sent: the user copies the draft, adapts it and sends it themselves.
 */
const DAY = 86400000;
const RULES = {
  applied: { after: 10, until: 45, max: 2, kind: 'postulacion' },
  in_review: { after: 10, until: 45, max: 2, kind: 'postulacion' },
  contacted: { after: 10, until: 45, max: 2, kind: 'postulacion' },
  screening: { after: 7, until: 30, max: 3, kind: 'proceso' },
  interview: { after: 7, until: 30, max: 3, kind: 'proceso' },
  offer: { after: 4, until: 21, max: 2, kind: 'oferta' },
};

const time = (d) => { const t = d ? new Date(d).getTime() : NaN; return Number.isFinite(t) ? t : null; };

/** Last movement: application date, stage moves and follow-ups already made. */
function lastMove(app) {
  const ts = [time(app.applied_at)];
  for (const h of Array.isArray(app.stage_history) ? app.stage_history : []) ts.push(time(h && h.moved_at));
  for (const f of Array.isArray(app.followups) ? app.followups : []) ts.push(time(f));
  const ok = ts.filter((t) => t !== null);
  return ok.length ? new Date(Math.max(...ok)).toISOString() : null;
}

/** { due, days, kind, count, max, after } or null when the stage has no follow-up rule. */
function status(app, now = Date.now()) {
  const r = RULES[app.status];
  if (!r || app.followup_off) return null;
  const last = time(lastMove(app));
  if (last === null) return null;
  const days = Math.floor((now - last) / DAY);
  const count = Array.isArray(app.followups) ? app.followups.length : 0;
  const until = time(app.followup_at);
  const stale = days > r.until;
  const due = days >= r.after && !stale && count < r.max && !(until !== null && until > now);
  return { due, stale, days, kind: r.kind, count, max: r.max, after: r.after, postponed_until: until !== null && until > now ? new Date(until).toISOString() : null };
}

/** A short draft to adapt. No opening question marks, a warm close, nothing invented. */
function draft(app, opts = {}) {
  const role = app.role || 'la posición';
  const company = app.company || 'la empresa';
  const sign = opts.firstName ? `\n${opts.firstName}` : '';
  const st = status(app) || {};
  if (st.kind === 'oferta') {
    return `Hola [nombre]! Muchas gracias otra vez por la propuesta para ${role}. Quería contarte que la sigo con mucho interés y consultarte si hay novedades sobre los próximos pasos o algo que necesiten de mi parte.\n\nTe mando un saludo grande!${sign}`;
  }
  if (st.kind === 'proceso') {
    return `Hola [nombre]! Gracias otra vez por el tiempo y la charla sobre la búsqueda de ${role}. Quería consultarte si hay novedades sobre los próximos pasos; sigo con muchas ganas de sumarme a ${company}.\n\nQuedo a disposición para lo que necesites. Te mando un saludo!${sign}`;
  }
  const days = Number.isInteger(st.days) && st.days > 0 ? `Hace ${st.days} días` : 'Hace unos días';
  return `Hola [nombre]! ${days} me postulé a la búsqueda de ${role} en ${company} y quería consultarte si el proceso sigue abierto. La posición me interesa mucho y, si les sirve, puedo contarles más sobre mi experiencia.\n\nMuchas gracias por tu tiempo. Te mando un saludo!${sign}`;
}

module.exports = { RULES, lastMove, status, draft };
