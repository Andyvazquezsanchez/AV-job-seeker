// Local database, tracking spreadsheet, duplicate matching, text extraction and panel actions.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'js-test-'));
process.env.JOB_SEEKER_DATA = path.join(tmp, 'datos');
const require = createRequire(import.meta.url);
const match = require('../../lib/match');
const tracking = require('../../lib/tracking');
const extract = require('../../lib/extract');
const xlsx = require('../../lib/xlsx-read');
const cfg = require('../../lib/config');
const jobs = require('../../lib/jobs');
const store = require('../../lib/store');
const dbm = require('../../lib/db');

afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('duplicate matching', () => {
  const known = [{ id: 1, company: 'Empresa Uno S.R.L.', role: 'HR Business Partner', status: 'applied' }];
  it('same company written differently and same role', () => {
    expect(match.findMatch({ company: 'EmpresaUno', role: 'HR Business Partner' }, known).kind).toBe('same');
    expect(match.findMatch({ company: 'Empresa Uno', role: 'HR Business Partner' }, known).kind).toBe('same');
  });
  it('legal form and accents do not matter', () => {
    expect(match.findMatch({ company: 'empresa uno srl', role: 'hr business partner' }, known).kind).toBe('same');
  });
  it('another company is not a match', () => {
    expect(match.findMatch({ company: 'Empresa Dos', role: 'HR Business Partner' }, known)).toBeNull();
  });
  it('same company, unrelated role is not the same job', () => {
    const hit = match.findMatch({ company: 'Empresa Uno', role: 'Analista de Compensaciones' }, known);
    expect(hit === null || hit.kind !== 'same').toBe(true);
  });
});

describe('tracking spreadsheet', () => {
  const sheets = [
    { name: 'Resumen', rows: [['Total', 3]] },
    { name: 'Postulaciones', rows: [['Mi búsqueda'], [], ['N°', 'Fecha', 'Mes', 'Empresa', 'Puesto', 'Canal', 'Estado', 'Origen del dato', 'Notas'],
      [1, '03/11/2026', 'Nov', 'Acme', 'HRBP', 'LinkedIn', 'Enviada', 'chat', ''],
      [2, 46329, 'Nov', 'Globex', 'Talent Lead', 'Mail', 'En proceso', 'mail', 'entrevista el lunes'],
      [3, '', '', '', 'sin empresa', '', '', '', '']] },
    { name: 'Descartes', rows: [['N°', 'Empresa', 'Puesto', 'Motivo'], [1, 'Initech', 'Recruiter', 'sueldo bajo']] },
    { name: 'Rechazos', rows: [['N°', 'Fecha', 'Mes', 'Empresa', 'Puesto', 'Certeza'], [1, '2026-10-01', 'Oct', 'Umbrella', 'HR Manager', 'alta']] },
  ];
  const rows = tracking.extractApplications(sheets);
  it('finds the tables below title rows and skips incomplete rows', () => {
    expect(rows.map((r) => r.company)).toEqual(['Acme', 'Globex', 'Initech', 'Umbrella']);
  });
  it('maps states from the cell or from the sheet name', () => {
    expect(rows.map((r) => r.status)).toEqual(['applied', 'interview', 'skipped', 'rejected']);
  });
  it('reads dates written as text or as Excel serial numbers', () => {
    expect(rows[0].date).toBe('2026-11-03');
    expect(rows[1].date).toMatch(/^2026-\d\d-\d\d$/);
  });
  it('csv with semicolons and quotes', () => {
    const parsed = xlsx.parseCsv('Empresa;Puesto;Estado\r\n"Acme; Inc";"Jefe ""People""";Enviada\r\n');
    expect(parsed[1]).toEqual(['Acme; Inc', 'Jefe "People"', 'Enviada']);
  });
  it('the outgoing log is a new csv; it never touches the tracking file', () => {
    const file = path.join(tmp, 'log', 'auto.csv');
    tracking.appendLog(file, { company: 'Acme; SA', role: 'HRBP', channel: 'LinkedIn', status: 'Enviada', url: 'https://x.test/1' }, new Date('2026-11-16T15:00:00Z'));
    tracking.appendLog(file, { company: 'Globex', role: 'Lead', channel: 'LinkedIn', status: 'Enviada', url: '' }, new Date('2026-11-16T16:00:00Z'));
    const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(tracking.LOG_HEADER.join(';'));
    expect(lines[1]).toContain('"Acme; SA"');
    expect(lines[1]).toContain('16/11/2026;12:00');
  });
});

describe('text extraction', () => {
  it('contact data from a pasted CV', () => {
    const { found } = extract.contactFromText('LAURA GOMEZ\nHR Manager\nlaura@ejemplo.com | +54 9 11 4444-5555 | linkedin.com/in/laura-gomez\nAcme 2018-2026');
    expect(found).toMatchObject({ first_name: 'Laura', last_name: 'Gomez', email: 'laura@ejemplo.com', phone: '+54 9 11 4444-5555', linkedin_url: 'https://www.linkedin.com/in/laura-gomez' });
  });
  it('label: value lists', () => {
    const { found } = extract.contactFromText('Nombre: Juan Pablo Pérez\nCelular: 11 5555-0000\nPaís: Argentina\nInglés: C1');
    expect(found).toMatchObject({ first_name: 'Juan Pablo', last_name: 'Pérez', phone: '11 5555-0000', country: 'Argentina', english_level: 'C1' });
  });
  it('year ranges, dates and ID numbers are not phones', () => {
    expect(extract.contactFromText('Nombre Apellido\nDNI 30123456\n2018-2026\n12/03/1990').found.phone).toBeUndefined();
  });
  it('invents nothing when there is nothing', () => {
    expect(extract.contactFromText('experiencia en selección y capacitación').found).toEqual({});
  });
  it('pdf uploads get a clear explanation', () => {
    expect(() => extract.textFromUpload('cv.pdf', Buffer.from('%PDF'))).toThrow(/PDF/);
  });
});

describe('settings', () => {
  it('paths pasted with quotes are cleaned', () => {
    expect(cfg.sanitize({ tracking_file: '"C:\\Users\\usuario\\Mi planilla.xlsx"' }).clean.tracking_file).toBe('C:\\Users\\usuario\\Mi planilla.xlsx');
  });
});

describe('panel actions', () => {
  it('only known actions exist', () => {
    expect(jobs.plan('rm -rf /')).toBeNull();
    expect(jobs.plan('--force')).toBeNull();
  });
  it('simulation never applies and real runs never bypass the limits', () => {
    const sim = jobs.plan('simulate', { max: 7 }).steps.flat();
    expect(sim).toContain('--dry-run');
    const real = jobs.plan('apply', { max: 7 }).steps.flat();
    expect(real).not.toContain('--force');
    expect(real).not.toContain('--dry-run');
  });
  it('the amount is a bounded number, whatever is sent', () => {
    expect(jobs.plan('apply', { max: '999' }).steps[1].slice(-1)[0]).toBe('25');
    expect(jobs.plan('apply', { max: '3; del *' }).steps[1].slice(-1)[0]).toBe('3');
    expect(jobs.plan('apply', { max: 'x' }).steps[1].slice(-1)[0]).toBe('10');
  });
  it('both runs check the LinkedIn session first', () => {
    expect(jobs.plan('simulate').steps[0].join(' ')).toMatch(/linkedin-session\.js check$/);
    expect(jobs.plan('apply').steps[0].join(' ')).toMatch(/linkedin-session\.js check$/);
  });
});

describe('local database', () => {
  beforeAll(async () => {
    await store.withDb(async (c) => {
      await store.ensureSchema(c);
      await store.saveSettings(c, cfg.sanitize({ first_name: 'Nombre', last_name: 'Apellido', email: 'nombre@ejemplo.com', target_titles: ['hr'] }).clean);
    });
  });
  it('is created by itself as a folder, with no server', () => {
    expect(dbm.describe().kind).toBe('local');
    expect(fs.existsSync(path.join(process.env.JOB_SEEKER_DATA, 'base'))).toBe(true);
  });
  it('releases its lock after each use', () => {
    expect(fs.existsSync(path.join(process.env.JOB_SEEKER_DATA, 'base.lock'))).toBe(false);
  });
  it('syncing the same rows twice adds nothing the second time', async () => {
    const rows = [
      { company: 'Acme', role: 'HRBP', status: 'applied', date: '2026-11-03', url: null, notes: null, sheet: 'Postulaciones' },
      { company: 'Globex', role: 'Talent Lead', status: 'interview', date: null, url: null, notes: null, sheet: 'Postulaciones' },
    ];
    const first = await store.withDb((c) => tracking.syncRows(c, rows, 1));
    const second = await store.withDb((c) => tracking.syncRows(c, rows, 1));
    expect(first).toMatchObject({ read: 2, inserted: 2 });
    expect(second).toMatchObject({ read: 2, inserted: 0, updated: 0, unchanged: 2 });
  });
  it('a later state in the file moves the job forward, never backward', async () => {
    const up = await store.withDb((c) => tracking.syncRows(c, [{ company: 'Acme', role: 'HRBP', status: 'rejected', date: null, url: null, notes: null, sheet: 'Rechazos' }], 1));
    expect(up.updated).toBe(1);
    const back = await store.withDb((c) => tracking.syncRows(c, [{ company: 'Acme', role: 'HRBP', status: 'applied', date: null, url: null, notes: null, sheet: 'Postulaciones' }], 1));
    expect(back).toMatchObject({ updated: 0, unchanged: 1 });
    const r = await store.withDb((c) => c.query(`SELECT status FROM applications WHERE company = 'Acme'`));
    expect(r.rows[0].status).toBe('rejected');
  });
});

import { describe as d2, it as i2, expect as e2 } from 'vitest';
import { createRequire as cr2 } from 'module';
const jf2 = cr2(import.meta.url)('../../lib/job-filter.js');
d2('senior_only', () => {
  const p = { target_titles: ['rrhh', 'seleccion', 'hr analyst'], senior_only: ['analista', 'analyst'] };
  i2('blocks non senior analysts', () => {
    e2(jf2.checkTitle('Analista de RR. HH.', p).pass).toBe(false);
    e2(jf2.checkTitle('Analista Ssr de RRHH', p).pass).toBe(false);
    e2(jf2.checkTitle('Analista Semi Senior de Selección', p).pass).toBe(false);
    e2(jf2.checkTitle('HR Analyst', p).pass).toBe(false);
  });
  i2('keeps senior analysts and other titles', () => {
    e2(jf2.checkTitle('Analista Sr. de Selección', p).pass).toBe(true);
    e2(jf2.checkTitle('Senior HR Analyst', p).pass).toBe(true);
    e2(jf2.checkTitle('Jefe de RRHH', p).pass).toBe(true);
  });
});
