// Safety checks added after the end-to-end review: CSV cells, the run lock, the schedule input,
// the panel's allowed actions and the local server's protections (host, token, origin, input).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'js-audit-'));
process.env.JOB_SEEKER_DATA = path.join(tmp, 'datos');
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('CSV cells', () => {
  const { csvCell } = require('../../lib/tracking');
  it('text that looks like a formula is neutralized', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell('+54 11 5555')).toBe("'+54 11 5555");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
  it('plain values and numbers stay as they are', () => {
    expect(csvCell('Empresa Uno')).toBe('Empresa Uno');
    expect(csvCell('-12')).toBe('-12');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell(null)).toBe('');
  });
});

describe('run lock', () => {
  const lock = require('../../lib/runlock');
  it('the same process can take it again, and releasing frees it', () => {
    expect(lock.acquire('panel').ok).toBe(true);
    expect(lock.acquire('panel').ok).toBe(true);
    lock.release();
    expect(lock.holder()).toBe(null);
  });
  it('a lock held by a live process blocks; a dead one is cleared', () => {
    fs.mkdirSync(path.dirname(lock.FILE), { recursive: true });
    fs.writeFileSync(lock.FILE, JSON.stringify({ pid: process.ppid, owner: 'automática', started: new Date().toISOString() }));
    const r = lock.acquire('panel');
    expect(r.ok).toBe(false);
    expect(r.holder.owner).toBe('automática');
    fs.writeFileSync(lock.FILE, JSON.stringify({ pid: 999999, owner: 'automática', started: new Date().toISOString() }));
    expect(lock.acquire('panel').ok).toBe(true);
    lock.release();
  });
});

describe('automatic run settings', () => {
  const schedule = require('../../lib/schedule');
  it('accepts valid days, times and cap', () => {
    expect(schedule.clean({ times: ['9:05', '18:30'], days: ['vie', 'lun'], max: 40 })).toEqual({ times: ['09:05', '18:30'], days: ['lun', 'vie'], max: 25 });
  });
  it('rejects anything else', () => {
    expect(() => schedule.clean({ times: ['25:00'], days: ['lun'] })).toThrow();
    expect(() => schedule.clean({ times: ['10:00; rm -rf'], days: ['lun'] })).toThrow();
    expect(() => schedule.clean({ times: ['10:00'], days: ['domingo'] })).toThrow();
  });
});

describe('panel actions', () => {
  const jobs = require('../../lib/jobs');
  it('only https links open in the program window', () => {
    expect(jobs.plan('site', { url: 'https://empresa.example/careers' })).not.toBe(null);
    expect(jobs.plan('site', { url: 'javascript:alert(1)' })).toBe(null);
    expect(jobs.plan('site', { url: 'https://x.example/a b' })).toBe(null);
    expect(jobs.plan('rm -rf')).toBe(null);
  });
  it('the number of jobs is always between 1 and 25', () => {
    expect(jobs.plan('apply', { max: 500 }).steps[1]).toContain('25');
    expect(jobs.plan('simulate', { max: 'x' }).steps[1]).toContain('10');
  });
});

describe('local server', () => {
  const port = 7600 + Math.floor(Math.random() * 300);
  let child;
  let token = '';
  const req = (opts, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, ...opts }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });

  beforeAll(async () => {
    child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'dashboard.js'), '--port', String(port)], {
      env: { ...process.env, JOB_SEEKER_DATA: path.join(tmp, 'datos') }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve) => { child.stdout.on('data', (d) => { if (/panel abierto/.test(String(d))) resolve(); }); setTimeout(resolve, 8000); });
    const page = await req({ path: '/', headers: { host: `localhost:${port}` } });
    token = (page.body.match(/const TOKEN = ["']([0-9a-f]+)["']/) || [])[1] || '';
  }, 20000);
  afterAll(() => { if (child) child.kill(); });

  it('serves the panel with a token', () => {
    expect(token).toMatch(/^[0-9a-f]{48}$/);
  });
  it('refuses other host names (DNS rebinding)', async () => {
    const r = await req({ path: '/', headers: { host: 'evil.example' } });
    expect(r.status).toBe(403);
  });
  it('refuses the API without the token or from another website', async () => {
    expect((await req({ path: '/api/status', headers: { host: `localhost:${port}` } })).status).toBe(403);
    expect((await req({ path: '/api/status', headers: { host: `localhost:${port}`, 'x-config-token': token, origin: 'https://evil.example' } })).status).toBe(403);
  });
  it('answers with the token', async () => {
    const r = await req({ path: '/api/status', headers: { host: `localhost:${port}`, 'x-config-token': token } });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toHaveProperty('database');
  }, 30000);
  it('checks what a stage change asks for', async () => {
    const h = { host: `localhost:${port}`, 'x-config-token': token, 'content-type': 'application/json' };
    expect((await req({ path: '/api/etapa', method: 'POST', headers: h }, JSON.stringify({ id: 1, stage: 'borrar' }))).status).toBe(400);
    expect((await req({ path: '/api/etapa', method: 'POST', headers: h }, JSON.stringify({ id: 'x', stage: 'offer' }))).status).toBe(400);
    expect((await req({ path: '/api/etapa', method: 'POST', headers: { ...h, 'content-type': 'text/plain' } }, '{}')).status).toBe(415);
  });
});
