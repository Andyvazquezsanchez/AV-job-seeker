'use strict';
/**
 * site-credentials.js: passwords for accounts the agent creates on company
 * career sites. They are generated per site, encrypted with AES-256-GCM and
 * kept in .secrets/site-credentials.json on this machine. They are never
 * written to the database and never printed unless the user asks to reveal one.
 *
 * The key (created on first use):
 * - on Windows, in .secrets/clave.dpapi, protected with DPAPI for the current Windows
 *   user (lib/dpapi.js): only that user on this computer can read it. A key found in
 *   .env from an older version is moved there and removed from .env once it reads back.
 * - elsewhere, or if DPAPI does not work, CREDENTIALS_KEY in .env, as before.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.JOB_SEEKER_ROOT || path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const STORE_DIR = path.join(ROOT, '.secrets');
const STORE_PATH = path.join(STORE_DIR, 'site-credentials.json');
const KEY_FILE = path.join(STORE_DIR, 'clave.dpapi');
const dpapi = require('./dpapi');

function readEnvKey() {
  if (!fs.existsSync(ENV_PATH)) return null;
  const m = fs.readFileSync(ENV_PATH, 'utf8').match(/^CREDENTIALS_KEY=([0-9a-f]{64})\s*$/m);
  return m ? Buffer.from(m[1], 'hex') : null;
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Saves the key protected with DPAPI and checks that it reads back; false when it could not. */
function saveProtected(key) {
  const blob = dpapi.protect(key);
  const back = blob && dpapi.unprotect(blob);
  if (!back || !back.equals(key)) return false;
  writeAtomic(KEY_FILE, blob.toString('base64') + '\n');
  const again = dpapi.unprotect(Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64'));
  return !!(again && again.equals(key));
}

function removeEnvKey() {
  if (!fs.existsSync(ENV_PATH)) return;
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  const rest = text.split(/\r?\n/).filter((l) => !/^CREDENTIALS_KEY=/.test(l)).join('\n');
  writeAtomic(ENV_PATH, rest.replace(/\n*$/, '') + (rest.trim() ? '\n' : ''));
}

function readProtectedKey() {
  const blob = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
  const key = dpapi.unprotect(blob);
  if (!key || key.length !== 32) {
    throw new Error('No pude abrir la clave protegida de las contraseñas (.secrets/clave.dpapi). Solo la puede abrir el mismo usuario de Windows que la creó, en esta misma computadora.');
  }
  return key;
}

/** Moves an old key from .env to the DPAPI file (Windows). Returns true when it moved one. */
function protectKey() {
  if (fs.existsSync(KEY_FILE)) return false;
  const key = readEnvKey();
  if (!key || !saveProtected(key)) return false;
  removeEnvKey();
  return true;
}

function getKey({ create = false } = {}) {
  if (fs.existsSync(KEY_FILE)) return readProtectedKey();
  const env = readEnvKey();
  if (env) { protectKey(); return env; }
  if (!create) return null;
  const key = crypto.randomBytes(32);
  if (saveProtected(key)) return key;
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
  if (!key) throw new Error('The key of the stored passwords is missing (.secrets/clave.dpapi or CREDENTIALS_KEY in .env); they cannot be read');
  return { email: entry.email, password: decrypt(key, entry.secret) };
}

function list() {
  return Object.entries(loadStore()).map(([id, e]) => ({ id, site: e.site, email: e.email, created_at: e.created_at }));
}

module.exports = { create, getPassword, list, generatePassword, encrypt, decrypt, slug, protectKey, STORE_PATH, KEY_FILE };
