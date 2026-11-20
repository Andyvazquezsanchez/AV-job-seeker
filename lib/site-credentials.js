'use strict';
/**
 * site-credentials.js: passwords for accounts the agent creates on company
 * career sites. They are generated per site, encrypted with AES-256-GCM and
 * kept in .secrets/site-credentials.json on this machine. They are never
 * written to the database and never printed unless the user asks to reveal one.
 *
 * The key is CREDENTIALS_KEY in .env (created on first use).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.JOB_SEEKER_ROOT || path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const STORE_DIR = path.join(ROOT, '.secrets');
const STORE_PATH = path.join(STORE_DIR, 'site-credentials.json');

function readEnvKey() {
  if (!fs.existsSync(ENV_PATH)) return null;
  const m = fs.readFileSync(ENV_PATH, 'utf8').match(/^CREDENTIALS_KEY=([0-9a-f]{64})\s*$/m);
  return m ? Buffer.from(m[1], 'hex') : null;
}

function getKey({ create = false } = {}) {
  let key = readEnvKey();
  if (key || !create) return key;
  key = crypto.randomBytes(32);
  const prefix = fs.existsSync(ENV_PATH) && !fs.readFileSync(ENV_PATH, 'utf8').endsWith('\n') ? '\n' : '';
  fs.appendFileSync(ENV_PATH, `${prefix}CREDENTIALS_KEY=${key.toString('hex')}\n`, { mode: 0o600 });
  return key;
}

function encrypt(key, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return { iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), data: data.toString('hex') };
}

function decrypt(key, box) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'hex'));
  d.setAuthTag(Buffer.from(box.tag, 'hex'));
  return Buffer.concat([d.update(Buffer.from(box.data, 'hex')), d.final()]).toString('utf8');
}

function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); } catch { return {}; }
}

function saveStore(store) {
  fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
}

const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// 20 characters with at least one of each class; avoids look-alike characters
// and symbols that some sites reject.
function generatePassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%*-_'];
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = sets.map(pick);
  const all = sets.join('');
  while (chars.length < 20) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function create(site, email) {
  const id = slug(site);
  if (!id) throw new Error('site name is empty');
  const store = loadStore();
  if (store[id]) throw new Error(`credentials for "${id}" already exist (use reveal, or remove the entry to recreate)`);
  const key = getKey({ create: true });
  store[id] = { site, email, created_at: new Date().toISOString(), secret: encrypt(key, generatePassword()) };
  saveStore(store);
  return { id, email };
}

function getPassword(site) {
  const id = slug(site);
  const entry = loadStore()[id];
  if (!entry) throw new Error(`no credentials stored for "${id}"`);
  const key = getKey();
  if (!key) throw new Error('CREDENTIALS_KEY is missing from .env; the stored passwords cannot be read');
  return { email: entry.email, password: decrypt(key, entry.secret) };
}

function list() {
  return Object.entries(loadStore()).map(([id, e]) => ({ id, site: e.site, email: e.email, created_at: e.created_at }));
}

module.exports = { create, getPassword, list, generatePassword, encrypt, decrypt, slug, STORE_PATH };
