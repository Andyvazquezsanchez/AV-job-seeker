// Version 1.2: company job boards, other job sites, DPAPI key, Windows notifications and AI prompts.
import { describe, it, expect, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'js-v120-'));
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.JOB_SEEKER_ROOT; delete process.env.JOB_SEEKER_FAKE_DPAPI; });

describe('company job boards (Greenhouse, Lever, Ashby)', () => {
  const b = require('../../lib/ats-boards');
  it('recognizes board addresses and rejects others', () => {
    expect(b.parseBoard('https://boards.greenhouse.io/acme')).toMatchObject({ type: 'greenhouse', slug: 'acme' });
    expect(b.parseBoard('job-boards.greenhouse.io/acme/jobs/1')).toMatchObject({ type: 'greenhouse', slug: 'acme' });
    expect(b.parseBoard('https://boards.greenhouse.io/embed/job_board?for=hooli')).toMatchObject({ slug: 'hooli' });
    expect(b.parseBoard('https://jobs.lever.co/globex/123')).toMatchObject({ type: 'lever', slug: 'globex', eu: false });
    expect(b.parseBoard('https://jobs.eu.lever.co/initech')).toMatchObject({ type: 'lever', eu: true });
    expect(b.parseBoard('https://jobs.ashbyhq.com/linear')).toMatchObject({ type: 'ashby', slug: 'linear' });
    expect(b.parseBoard('ashby:linear')).toMatchObject({ type: 'ashby', slug: 'linear' });
    expect(b.parseBoard('https://example.com/careers')).toBe(null);
    expect(b.parseBoard('https://jobs.lever.co/%3Cscript%3E')).toBe(null);
  });
  it('keeps places that work for the user and drops other countries', () => {
    const prefs = { onsite_places: ['Buenos Aires'] };
    expect(b.placeOk('Remote', true, prefs).pass).toBe(true);
    expect(b.placeOk('LATAM (Remote)', true, prefs).pass).toBe(true);
    expect(b.placeOk('Buenos Aires, Argentina', false, prefs).pass).toBe(true);
    expect(b.placeOk('Remote - US', true, prefs).pass).toBe(false);
    expect(b.placeOk('San Francisco, CA', false, prefs).pass).toBe(false);
    expect(b.placeOk('Remote', true, { work_modes: ['onsite'] }).pass).toBe(false);
  });
  it('normalizes each provider', async () => {
    const fix = {
      'https://boards-api.greenhouse.io/v1/boards/acme': { name: 'Acme Corp' },
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true': { jobs: [{ id: 1, title: 'HRBP', absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', location: { name: 'Remote' }, content: '&lt;p&gt;Hola &amp;amp; chau&lt;/p&gt;' }] },
      'https://api.lever.co/v0/postings/globex?mode=json': [{ id: 'a', text: 'Recruiter', hostedUrl: 'https://jobs.lever.co/globex/a', categories: { location: 'LATAM' }, workplaceType: 'remote', descriptionPlain: 'Texto' }],
      'https://api.ashbyhq.com/posting-api/job-board/initech?includeCompensation=true': { jobs: [{ id: 'z', title: 'People Partner', location: 'Remote', isRemote: true, jobUrl: 'https://jobs.ashbyhq.com/initech/z', descriptionPlain: 'Texto', compensation: { compensationTierSummary: 'USD 40K' } }, { title: 'Oculto', isListed: false }] },
    };
    const get = async (u) => { if (!fix[u]) throw new Error('404'); return fix[u]; };
    const g = await b.fetchBoard(b.parseBoard('boards.greenhouse.io/acme'), get);
    expect(g[0]).toMatchObject({ role: 'HRBP', company: 'Acme Corp', location: 'Remote', remote: true, description: 'Hola & chau' });
    const l = await b.fetchBoard(b.parseBoard('jobs.lever.co/globex'), get);
    expect(l[0]).toMatchObject({ role: 'Recruiter', company: 'Globex', location: 'LATAM', remote: true });
    const a = await b.fetchBoard(b.parseBoard('ashby:initech'), get);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ role: 'People Partner', salary: 'USD 40K', remote: true });
  });
});

describe('Computrabajo, Bumeran and ZonaJobs', () => {
  const p = require('../../lib/portales');
  it('builds search addresses and recognizes job links', () => {
    expect(p.SITES.computrabajo.search('Analista de RRHH')).toBe('https://ar.computrabajo.com/trabajo-de-analista-de-rrhh');
    expect(p.SITES.bumeran.search('HR Business Partner')).toBe('https://www.bumeran.com.ar/empleos-busqueda-hr-business-partner.html');
    expect(p.SITES.zonajobs.search('Selección')).toBe('https://www.zonajobs.com.ar/empleos-busqueda-seleccion.html');
    expect(p.SITES.bumeran.job.test('https://www.bumeran.com.ar/empleos/analista-acme-1118272121.html')).toBe(true);
    expect(p.SITES.computrabajo.job.test('https://ar.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-analista-AB12')).toBe(true);
    expect(p.sourceOf('https://www.zonajobs.com.ar/empleos/x-1.html')).toBe('zonajobs');
    expect(() => new Function(`return ${p.extractCode('computrabajo')}`)).not.toThrow();
  });
  it('reads company, place and date from a card without inventing', () => {
    expect(p.parseCard('Analista de RRHH', ['Analista de RRHH', '4,3 Acme SA', 'Caballito, Capital Federal', 'Hace 2 días', 'Postulación rápida']))
      .toEqual({ company: 'Acme SA', location: 'Caballito, Capital Federal', posted: 'Hace 2 días' });
    expect(p.parseCard('Recruiter', ['Recruiter', 'Postulación rápida', 'Presencial'])).toEqual({ company: '', location: '', posted: '' });
  });
});

describe('site passwords key protected with DPAPI (Windows)', () => {
  const root = path.join(tmp, 'root');
  const key = 'ab'.repeat(32);
  it('moves an old key from .env to the protected file and keeps reading the passwords', () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, '.env'), `DATABASE_URL=postgresql://x\nCREDENTIALS_KEY=${key}\n`);
    process.env.JOB_SEEKER_ROOT = root;
    process.env.JOB_SEEKER_FAKE_DPAPI = '1';
    delete require.cache[require.resolve('../../lib/site-credentials.js')];
    const creds = require('../../lib/site-credentials.js');
    const box = creds.encrypt(Buffer.from(key, 'hex'), 'secreta-123');
    fs.mkdirSync(path.join(root, '.secrets'), { recursive: true });
    fs.writeFileSync(creds.STORE_PATH, JSON.stringify({ acme: { site: 'acme', email: 'a@b.c', secret: box } }));
    expect(creds.protectKey()).toBe(true);
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    expect(env).not.toMatch(/CREDENTIALS_KEY/);
    expect(env).toMatch(/DATABASE_URL=postgresql:\/\/x/);
    expect(fs.readFileSync(creds.KEY_FILE, 'utf8')).not.toContain(key);
    expect(creds.getPassword('acme').password).toBe('secreta-123');
    expect(creds.protectKey()).toBe(false);
  });
  it('a new key goes straight to the protected file', () => {
    const r2 = path.join(tmp, 'root2');
    fs.mkdirSync(r2, { recursive: true });
    process.env.JOB_SEEKER_ROOT = r2;
    delete require.cache[require.resolve('../../lib/site-credentials.js')];
    const creds = require('../../lib/site-credentials.js');
    creds.create('Globex', 'a@b.c');
    expect(fs.existsSync(path.join(r2, '.env'))).toBe(false);
    expect(fs.existsSync(creds.KEY_FILE)).toBe(true);
    expect(creds.getPassword('globex').password).toHaveLength(20);
  });
  it('without DPAPI the key stays in .env, as before', () => {
    const r3 = path.join(tmp, 'root3');
    fs.mkdirSync(r3, { recursive: true });
    process.env.JOB_SEEKER_ROOT = r3;
    delete process.env.JOB_SEEKER_FAKE_DPAPI;
    delete require.cache[require.resolve('../../lib/site-credentials.js')];
    const creds = require('../../lib/site-credentials.js');
    if (process.platform !== 'win32') {
      creds.create('Initech', 'a@b.c');
      expect(fs.readFileSync(path.join(r3, '.env'), 'utf8')).toMatch(/CREDENTIALS_KEY=[0-9a-f]{64}/);
      expect(fs.existsSync(creds.KEY_FILE)).toBe(false);
    }
  });
});

describe('Windows notification and AI prompts', () => {
  it('escapes the notification text for XML and PowerShell', () => {
    const s = require('../../lib/notify').script('Hola <b>', "Don't & go");
    expect(s).toContain('Hola &lt;b&gt;');
    expect(s).toContain('Don&apos;t &amp; go');
    expect(s).not.toMatch(/<b>/);
  });
  it('interview and application prompts forbid inventing and carry the job and CV', () => {
    const fit = require('../../lib/fit');
    const i = fit.interviewPrompt({ job: { role: 'HRBP', company: 'Acme', description: 'Aviso' }, cvText: 'Mi CV', fit: { keywords: { missing: ['Workday'], reworded: [] } }, stage: 'interview' });
    expect(i).toMatch(/Usá solo experiencia/);
    expect(i).toMatch(/Workday/);
    expect(i).toMatch(/Mi CV/);
    const a = fit.applyPrompt({ job: { role: 'HRBP', company: 'Acme' }, cvText: 'Mi CV', answers: { first_name: 'Ana', qa: { 'Viajes': 'Sí' } } });
    expect(a).toMatch(/no la inventes/);
    expect(a).toMatch(/Nombre: Ana/);
    expect(a).toMatch(/Viajes: Sí/);
    expect(a).not.toMatch(/[—¿¡]/);
  });
});
