#!/usr/bin/env node
/**
 * setup.js: first-time setup. Works on Windows, macOS and Linux.
 *
 *   node scripts/setup.js              prepare everything and say what is ready
 *   node scripts/setup.js --ask        ask before importing each file found in config/
 *   node scripts/setup.js --open       open the panel when done
 *
 * What it does: checks Node and Chrome, creates the local database (a folder
 * named "datos" next to the program), creates config/ with an example, and
 * imports config/perfil.json, config/historial.json and one config/*.md if
 * present. It needs no account, no server and no internet connection.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const ASK = argv.includes('--ask');
const OPEN = argv.includes('--open');
const say = (m) => console.log(m);
const ok = (m) => say(`  [ok] ${m}`);
const warn = (m) => say(`  [!]  ${m}`);

function ask(question, def = '') {
  if (!ASK) return Promise.resolve(def);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(`${question}${def ? ` [${def}]` : ''}: `, (a) => { rl.close(); resolve(a.trim() || def); }));
}
const yes = async (q, def = true) => /^(s|si|sí|y|yes)$/i.test(await ask(`${q} (s/n)`, def ? 's' : 'n'));
const { findChrome } = require('../lib/chrome');

function run(script, args) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8' });
}

async function main() {
  say('\nJob Seeker: instalación guiada\n');

  // 1. Node
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) { warn(`Node ${process.versions.node}: hace falta la versión 22 o superior (https://nodejs.org).`); process.exit(1); }
  ok(`Node ${process.versions.node}`);

  // 2. Dependencies
  const missing = ['@electric-sql/pglite', 'agent-browser'].filter((m) => !fs.existsSync(path.join(ROOT, 'node_modules', ...m.split('/'))));
  if (missing.length) {
    warn(`Faltan componentes (${missing.join(', ')}). Si descargaste el paquete para Windows, volvé a descomprimirlo completo. Si no, corré: npm ci --omit=dev --ignore-scripts`);
    process.exit(1);
  }
  ok('Componentes del programa completos');

  // 3. Chrome
  const chrome = findChrome();
  if (chrome) ok(`Google Chrome encontrado`);
  else warn('No encontré Google Chrome. Hace falta para postular (https://www.google.com/chrome). La configuración funciona igual.');

  // 4. Local database + config folder (created here; nothing to install or sign up for)
  const init = run('config.js', ['init']);
  if (init.status !== 0) { warn(`No pude crear la base de datos: ${(init.stderr || init.stdout).trim().slice(0, 300)}`); process.exit(1); }
  const where = require('../lib/db').describe();
  ok(where.kind === 'local' ? `Base de datos lista en ${where.location}` : `Base de datos externa conectada (${where.location})`);
  ok('Carpeta config lista (hay un ejemplo en config/perfil.ejemplo.json)');

  // 6. Imports
  const cfgDir = path.join(ROOT, 'config');
  const report = (label, r) => {
    if (r.status !== 0) return warn(`${label}: ${(r.stderr || '').trim().slice(0, 300)}`);
    let j = {}; try { j = JSON.parse(r.stdout); } catch { /* ignore */ }
    ok(`${label}${j.inserted !== undefined ? `: ${j.inserted} nuevas, ${j.skipped} repetidas` : ''}`);
    (j.errors || []).forEach((e) => warn(e));
  };
  if (fs.existsSync(path.join(cfgDir, 'perfil.json')) && await yes('Encontré config/perfil.json. Lo importo?')) report('Perfil importado', run('config.js', ['import']));
  if (fs.existsSync(path.join(cfgDir, 'historial.json')) && await yes('Encontré config/historial.json. Lo importo?')) report('Historial importado', run('config.js', ['history']));
  const mds = fs.existsSync(cfgDir) ? fs.readdirSync(cfgDir).filter((f) => /\.(md|txt)$/i.test(f)) : [];
  if (mds.length === 1 && await yes(`Encontré config/${mds[0]}. Lo cargo como contexto?`)) report('Contexto cargado', run('config.js', ['context', '--file', path.join(cfgDir, mds[0])]));
  else if (mds.length > 1) warn(`Hay varios archivos de texto en config/. Cargá el que quieras con: node scripts/config.js context --file config/<archivo>`);

  // 7. Next steps
  say('\nListo. El panel tiene botones para todo lo básico:');
  say(process.platform === 'win32' ? '  doble clic en "Abrir Job Seeker" (o en el acceso directo del Escritorio o del menú Inicio)' : '  sh abrir.sh   (o: node scripts/dashboard.js --open)');
  say('El manual está en MANUAL.md\n');
  if (OPEN) spawn(process.execPath, [path.join(ROOT, 'scripts', 'dashboard.js'), '--open'], { cwd: ROOT, stdio: 'inherit' });
}

main().catch((e) => { warn(e.message); process.exit(1); });
