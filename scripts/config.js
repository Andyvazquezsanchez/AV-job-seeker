#!/usr/bin/env node
/**
 * config.js: the user's configuration from files.
 *
 *   node scripts/config.js init                      create config/ with an example, and the tables if missing
 *   node scripts/config.js export [--file <path>]    write current settings to config/perfil.json
 *   node scripts/config.js import [--file <path>]    load settings from config/perfil.json (validated)
 *   node scripts/config.js history [--file <path>]   load past applications from config/historial.json
 *   node scripts/config.js context --file <path.md>  store a Markdown/text file as context for the agent
 *   node scripts/config.js sync [--file <xlsx|csv>]  read your tracking spreadsheet (never modifies it)
 *   node scripts/config.js show                      print current settings (JSON)
 *
 * Add --dry-run to import/history to validate without writing.
 * The same settings can be edited in the browser: node scripts/dashboard.js --open, then /config.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('../lib/config');
const store = require('../lib/store');

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : null; };
const dry = argv.includes('--dry-run');
const CONFIG_DIR = path.join(store.REPO_ROOT, 'config');
const out = (o) => console.log(JSON.stringify(o, null, 2));
function fail(m) { const e = new Error(m); e.cli = true; throw e; }

function readJson(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`no existe el archivo: ${file}`);
  if (fs.statSync(file).size > 5 * 1024 * 1024) fail('el archivo supera 5 MB');
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { fail(`JSON inválido en ${file}: ${e.message}`); }
}

const EXAMPLE = {
  first_name: '', last_name: '', email: '', phone: '', city: '', country: '',
  linkedin_url: '',
  target_titles: ['recursos humanos', 'hr business partner', 'talent acquisition'],
  avoid: ['pasante', 'ventas'],
  description_avoid: ['comisiones'],
  search_queries: ['("HR Business Partner" OR HRBP OR "People Partner") NOT (intern OR pasante)'],
  work_modes: ['remote', 'hybrid'],
  posted_within: 'week',
  search_location: 'Argentina',
  avoid_companies: [],
  target_companies: [],
  company_types_preferred: [],
  company_types_avoid: [],
  years_of_experience: '',
  experience_years: { 'recursos humanos': '' },
  english_level: '',
  salary_ars: '',
  salary_usd: '',
  cv_path: '',
  cv_path_en: '',
};

async function main() {
  const cmd = argv[0];
  if (cmd === 'init') {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const ex = path.join(CONFIG_DIR, 'perfil.ejemplo.json');
    if (!fs.existsSync(ex)) fs.writeFileSync(ex, JSON.stringify(EXAMPLE, null, 2) + '\n');
    await store.withDb((c) => store.ensureSchema(c));
    return out({ ok: true, config_dir: CONFIG_DIR, example: ex });
  }
  if (cmd === 'show' || cmd === 'export') {
    const data = await store.withDb((c) => store.getUserData(c));
    const settings = cfg.extract(data || {});
    if (cmd === 'show') return out(settings);
    const file = opt('--file') || path.join(CONFIG_DIR, 'perfil.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
    return out({ ok: true, file, keys: Object.keys(settings).length });
  }
  if (cmd === 'import') {
    const file = opt('--file') || path.join(CONFIG_DIR, 'perfil.json');
    const { clean, errors } = cfg.sanitize(readJson(file));
    if (dry) return out({ dry_run: true, keys: Object.keys(clean), errors });
    await store.withDb(async (c) => { await store.ensureSchema(c); await store.saveSettings(c, clean); });
    return out({ ok: true, saved_keys: Object.keys(clean), errors });
  }
  if (cmd === 'history') {
    const file = opt('--file') || path.join(CONFIG_DIR, 'historial.json');
    const { rows, errors } = cfg.sanitizeHistory(readJson(file));
    if (dry) return out({ dry_run: true, valid_rows: rows.length, errors });
    const res = await store.withDb(async (c) => {
      await store.ensureSchema(c);
      if ((await store.getUserData(c)) === null) fail('primero cargá tu perfil: node scripts/config.js import');
      return store.importHistory(c, rows);
    });
    return out({ ok: true, ...res, errors });
  }
  if (cmd === 'sync') {
    const res = await store.withDb(async (c) => { await store.ensureSchema(c); return store.syncTracking(c, opt('--file')); });
    if (!res.configured) return out({ ok: true, synced: false, note: 'no hay planilla de seguimiento configurada (campo tracking_file)' });
    return out({ ok: true, synced: true, ...res });
  }
  if (cmd === 'context') {
    const file = opt('--file');
    if (!file) fail('falta --file <archivo.md>');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`no existe el archivo: ${file}`);
    const { clean, errors } = cfg.sanitize({ context_notes: fs.readFileSync(file, 'utf8') });
    if (dry) return out({ dry_run: true, characters: (clean.context_notes || '').length, errors });
    await store.withDb((c) => store.saveSettings(c, clean));
    return out({ ok: true, characters: (clean.context_notes || '').length, errors });
  }
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 14).join('\n'));
}

main().catch((e) => { console.error(`[config] ${e.message}`); process.exit(1); });
