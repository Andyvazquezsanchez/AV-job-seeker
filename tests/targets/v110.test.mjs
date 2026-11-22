// Version 1.1: safety pause and gradual start, fit with a job, CV key terms and follow-up reminders.
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'js-v110-'));
process.env.JOB_SEEKER_DATA = path.join(tmp, 'datos');
const require = createRequire(import.meta.url);
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.HUMANIZE_NOW; });

const safety = require('../../lib/safety');
const hz = require('../../lib/humanize');
const fit = require('../../lib/fit');
const fu = require('../../lib/followup');

const TZ = { timezone: 'America/Argentina/Buenos_Aires' };
const MONDAY_11 = '2026-11-23T14:00:00Z';

describe('safety pause', () => {
  beforeEach(() => { fs.rmSync(safety.FILE, { force: true }); process.env.HUMANIZE_NOW = MONDAY_11; });
  it('recognizes LinkedIn warning signs and ignores ordinary text', () => {
    expect(safety.detect('', 'https://www.linkedin.com/checkpoint/challenge/abc')).toBe('checkpoint');
    expect(safety.detect('We limit daily submissions to help ensure each applicant gets the best experience. Come back tomorrow to continue applying.')).toBe('limit');
    expect(safety.detect('Your account has been temporarily restricted')).toBe('restricted');
    expect(safety.detect("Let's do a quick security check")).toBe('captcha');
    expect(safety.detect('Buscamos HR Business Partner con experiencia en selección')).toBe(null);
  });
  it('a pause blocks LinkedIn but not company sites, and resuming halves the cap for a few days', () => {
    expect(hz.gate({ settings: TZ, done: 0, first: '2026-01-01' }).allowed).toBe(true);
    safety.pause('captcha', 'test');
    const g = hz.gate({ settings: TZ, done: 0, first: '2026-01-01' });
    expect(g.allowed).toBe(false);
    expect(g.message).toMatch(/en pausa/);
    expect(hz.gate({ scope: 'sites', settings: TZ }).allowed).toBe(true);
    safety.clear();
    const r = hz.gate({ settings: TZ, done: 0, first: '2026-01-01' });
    expect(r.allowed).toBe(true);
    expect(r.message).toMatch(/mitad del tope/);
  });
  it('a longer pause is not shortened by a shorter one', () => {
    const a = safety.pause('restricted');
    const b = safety.pause('limit');
    expect(b.until).toBe(a.until);
  });
});

describe('daily cap', () => {
  beforeEach(() => { fs.rmSync(safety.FILE, { force: true }); process.env.HUMANIZE_NOW = MONDAY_11; });
  it('gradual start: 5 the first week, 10 the second, then the normal cap', () => {
    expect(hz.gate({ settings: TZ, done: 0, first: '2026-11-20T00:00:00Z' }).cap).toBe(5);
    expect(hz.gate({ settings: TZ, done: 0, first: '2026-11-12T00:00:00Z' }).cap).toBe(10);
    expect(hz.gate({ settings: TZ, done: 0, first: '2026-10-01T00:00:00Z' }).cap).toBeGreaterThanOrEqual(10);
    expect(hz.gate({ settings: TZ, done: 0, first: null }).cap).toBe(5);
    expect(hz.gate({ settings: { ...TZ, ramp_weeks: 0 }, done: 0, first: null }).cap).toBeGreaterThanOrEqual(10);
  });
  it('when the applications of the day cannot be counted, it does not apply', () => {
    const prev = process.env.JOB_SEEKER_ROOT;
    process.env.HUMANIZE_NO_DB = '1';
    const g = hz.gate({ settings: TZ });
    expect(g.allowed).toBe(false);
    expect(g.message).toMatch(/No pude contar/);
    delete process.env.HUMANIZE_NO_DB;
    if (prev) process.env.JOB_SEEKER_ROOT = prev;
  });
});

const JOB = `Acerca del empleo
Buscamos HR Business Partner Senior.

Responsabilidades
- Acompañar a líderes en la gestión de personas y clima laboral.
- Gestionar procesos de recruiting IT y onboarding.
- Armar reportes en Power BI.

Requisitos
- Al menos 5 años de experiencia como HRBP.
- Manejo de Workday (deseable).
- Inglés avanzado (excluyente).

Beneficios
- Prepaga.`;
const CV = 'Profesional de Recursos Humanos. Reclutamiento IT y selección. Encuestas de clima. Inducción y capacitación. Reportes de métricas. Power BI. Inglés C1.';

describe('fit and key terms', () => {
  it('splits the job terms into present, reworded and missing, without inventing', () => {
    const k = fit.keywords(JOB, CV, { company: 'Acme' });
    expect(k.have).toContain('Power BI');
    expect(k.reworded.map((r) => r.term)).toEqual(expect.arrayContaining(['recruiting IT', 'onboarding', 'clima laboral']));
    expect(k.reworded.find((r) => r.term === 'onboarding').cv).toBe('Inducción');
    expect(k.missing).toEqual(expect.arrayContaining(['HRBP', 'Workday']));
    expect(k.total).toBe(k.have.length + k.reworded.length + k.missing.length);
  });
  it('scores 0 to 100 with a breakdown', () => {
    const r = fit.score({ role: 'HR Business Partner Senior', company: 'Acme', location: 'Buenos Aires', description: JOB },
      { prefs: { target_titles: ['hr business partner'] }, formAnswers: { english_level: 'C1', seniority: 'Senior' }, cvText: CV });
    expect(r.score).toBeGreaterThan(60);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.parts.map((p) => p.key)).toEqual(['titulo', 'palabras', 'nivel', 'lugar', 'idioma']);
  });
  it('without a CV text there is no key-term part, and the prompt keeps the no-invention rule', () => {
    const r = fit.score({ role: 'HR Business Partner', description: JOB }, { prefs: { target_titles: ['hr business partner'] } });
    expect(r.parts.find((p) => p.key === 'palabras')).toBeUndefined();
    const p = fit.cvPrompt({ job: { role: 'HRBP', company: 'Acme', description: JOB }, cvText: CV, fit: fit.score({ role: 'HRBP', description: JOB }, { cvText: CV }), confirmed: ['Workday'] });
    expect(p).toMatch(/No agregues experiencia/);
    expect(p).toMatch(/CONFIRMADO POR MÍ[\s\S]*Workday/);
    expect(p).not.toMatch(/NO FIGURA EN MI CV[^-]*- Workday/);
  });
});

describe('follow-up reminders', () => {
  const day = 86400000;
  const now = Date.parse('2026-11-22T12:00:00Z');
  const at = (d) => new Date(now - d * day).toISOString();
  it('suggests one after 10 quiet days, not before and not when it is too old', () => {
    expect(fu.status({ status: 'applied', applied_at: at(5) }, now).due).toBe(false);
    expect(fu.status({ status: 'applied', applied_at: at(12) }, now).due).toBe(true);
    const old = fu.status({ status: 'applied', applied_at: at(80) }, now);
    expect(old.due).toBe(false);
    expect(old.stale).toBe(true);
  });
  it('a stage move or a follow-up resets the clock; postponed and turned-off ones wait', () => {
    expect(fu.status({ status: 'interview', applied_at: at(40), stage_history: [{ moved_at: at(3) }] }, now).due).toBe(false);
    expect(fu.status({ status: 'applied', applied_at: at(20), followups: [at(2)] }, now).due).toBe(false);
    expect(fu.status({ status: 'applied', applied_at: at(20), followup_at: new Date(now + day).toISOString() }, now).due).toBe(false);
    expect(fu.status({ status: 'applied', applied_at: at(20), followup_off: true }, now)).toBe(null);
    expect(fu.status({ status: 'rejected', applied_at: at(20) }, now)).toBe(null);
  });
  it('the draft has no opening question mark and no invented data', () => {
    const d = fu.draft({ status: 'applied', applied_at: at(12), role: 'HRBP', company: 'Acme' }, { firstName: 'Ana' });
    expect(d).toMatch(/HRBP/);
    expect(d).toMatch(/Acme/);
    expect(d).not.toMatch(/[¿¡—]/);
    expect(d.trim().endsWith('Ana')).toBe(true);
  });
});

describe('Gmail news (subject and preview only)', () => {
  const nov = require('../../lib/novedades');
  const apps = [
    { id: 1, company: 'Acme S.A.', role: 'HR Business Partner', status: 'applied', applied_at: '2026-11-01' },
    { id: 2, company: 'Globex', role: 'Talent Acquisition Lead', status: 'screening', applied_at: '2026-11-02' },
    { id: 3, company: 'Initech', role: 'People Partner', status: 'rejected', applied_at: '2026-11-03' },
  ];
  it('classifies rejections, interviews, views and acknowledgments in Spanish and English', () => {
    expect(nov.classify({ subject: 'Tu postulación en Acme', snippet: 'Lamentablemente decidimos avanzar con otros candidatos' })).toBe('rechazo');
    expect(nov.classify({ subject: 'Next steps', snippet: 'We would like to schedule a call to discuss' })).toBe('entrevista');
    expect(nov.classify({ subject: 'Tu solicitud fue vista por Acme' })).toBe('vista');
    expect(nov.classify({ subject: 'Thank you for applying to Globex' })).toBe('recibida');
    expect(nov.classify({ subject: 'Newsletter semanal', snippet: 'Novedades del mercado' })).toBe(null);
  });
  it('matches only active applications and suggests moving forward or to rejected', () => {
    const m = { from: 'Equipo de Talento <jobs@acme.com>', subject: 'Acme: actualización sobre tu postulación', snippet: 'Lamentablemente no continuaremos' };
    const app = nov.matchApp(m, apps);
    expect(app.id).toBe(1);
    expect(nov.suggest(app, nov.classify(m)).to).toBe('rejected');
    expect(nov.matchApp({ subject: 'Initech te escribió', snippet: 'entrevista' }, apps)).toBe(null);
    expect(nov.suggest(apps[1], 'entrevista').to).toBe('interview');
    expect(nov.suggest(apps[1], 'vista')).toBe(null);
    expect(nov.suggest(apps[0], 'recibida')).toBe(null);
  });
  it('the same mail is never suggested twice', () => {
    const item = { mail: { from: 'x', subject: 'y', link: 'https://mail.google.com/mail/u/0/#all/abc' }, kind: 'rechazo', app_id: 1, to_stage: 'rejected' };
    expect(nov.addAll([item]).length).toBe(1);
    expect(nov.addAll([item]).length).toBe(0);
    const p = nov.pending();
    expect(p.length).toBe(1);
    nov.resolve(p[0].id, 'ignorada');
    expect(nov.pending().length).toBe(0);
  });
});
