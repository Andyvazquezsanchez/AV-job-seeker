import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { detect, decide } = require('../../lib/ats.js');

describe('ats.detect', () => {
  it('recognises systems by hostname', () => {
    expect(detect('https://job-boards.greenhouse.io/acme/jobs/1')).toMatchObject({ ats: 'greenhouse', tier: 'simple' });
    expect(detect('https://jobs.lever.co/acme/1')).toMatchObject({ ats: 'lever', tier: 'simple' });
    expect(detect('https://acme.wd1.myworkdayjobs.com/x')).toMatchObject({ ats: 'workday', tier: 'complex' });
    expect(detect('https://ar.computrabajo.com/x')).toMatchObject({ ats: 'computrabajo', tier: 'board' });
    expect(detect('https://pandape.computrabajo.com/x')).toMatchObject({ ats: 'pandape', tier: 'complex' });
  });
  it('is not fooled by paths, query strings or look-alike hosts', () => {
    for (const u of ['https://evil.com/greenhouse.io/x', 'https://greenhouse.io.evil.com/x', 'https://careers.acme.com/?x=lever.co', 'https://notlever.co/x']) {
      expect(detect(u)).toMatchObject({ ats: 'custom', tier: 'complex' });
    }
  });
  it('rejects non-http URLs', () => {
    expect(detect('javascript:alert(1)').ats).toBe('invalid');
    expect(detect('not a url').ats).toBe('invalid');
  });
});

describe('ats.decide', () => {
  const ok = { tier: 'simple', match: 'must', first_on_ats: false };
  it('allows auto only when every condition holds', () => {
    expect(decide(ok)).toEqual({ decision: 'auto', reasons: [] });
  });
  it.each([
    [{ tier: 'complex' }, 'complex_or_unknown_system'],
    [{ tier: 'board' }, 'job_board_account'],
    [{ tier: undefined }, 'complex_or_unknown_system'],
    [{ match: 'strong' }, 'not_a_full_match'],
    [{ match: undefined }, 'not_a_full_match'],
    [{ first_on_ats: true }, 'first_application_on_this_system'],
    [{ missing_answers: 1 }, 'missing_answers'],
    [{ open_text_answers: 1 }, 'free_text_answers_written'],
    [{ sensitive_questions: 2 }, 'sensitive_or_legal_questions'],
    [{ assessments: 1 }, 'human_only_deliverable'],
    [{ account_created: true }, 'new_account_created'],
    [{ submit_error: true }, 'previous_submit_failed'],
  ])('queues for review: %o', (extra, reason) => {
    const r = decide({ ...ok, ...extra });
    expect(r.decision).toBe('review');
    expect(r.reasons).toContain(reason);
  });
  it('stops on captcha or login wall, even if everything else is fine', () => {
    expect(decide({ ...ok, captcha: true })).toEqual({ decision: 'stop', reasons: ['captcha'] });
    expect(decide({ ...ok, login_wall: true }).decision).toBe('stop');
  });
  it('with no facts at all, never returns auto', () => {
    expect(decide().decision).toBe('review');
    expect(decide({}).decision).toBe('review');
  });
});

describe('site-credentials', () => {
  let dir, creds;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creds-'));
    fs.writeFileSync(path.join(dir, '.env'), 'DATABASE_URL=postgresql://x');
    process.env.JOB_SEEKER_ROOT = dir;
    delete require.cache[require.resolve('../../lib/site-credentials.js')];
    creds = require('../../lib/site-credentials.js');
  });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.JOB_SEEKER_ROOT; });

  it('generates strong, distinct passwords', () => {
    const a = creds.generatePassword(), b = creds.generatePassword();
    expect(a).toHaveLength(20);
    expect(a).not.toBe(b);
    for (const re of [/[A-Z]/, /[a-z]/, /[0-9]/, /[!@#$%*\-_]/]) expect(a).toMatch(re);
  });
  it('stores the password encrypted and reads it back', () => {
    creds.create('Acme Careers', 'me@example.com');
    const { email, password } = creds.getPassword('acme careers');
    expect(email).toBe('me@example.com');
    const file = fs.readFileSync(path.join(dir, '.secrets', 'site-credentials.json'), 'utf8');
    expect(file).not.toContain(password);
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf8')).toMatch(/\nCREDENTIALS_KEY=[0-9a-f]{64}\n$/);
    expect(creds.list()[0]).not.toHaveProperty('secret');
  });
  it('refuses to overwrite an existing entry and fails on tampering', () => {
    expect(() => creds.create('acme-careers', 'x@y.com')).toThrow(/already exist/);
    const p = path.join(dir, '.secrets', 'site-credentials.json');
    const store = JSON.parse(fs.readFileSync(p, 'utf8'));
    store['acme-careers'].secret.data = store['acme-careers'].secret.data.replace(/^../, '00');
    fs.writeFileSync(p, JSON.stringify(store));
    expect(() => creds.getPassword('acme-careers')).toThrow();
  });
});
