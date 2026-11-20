#!/usr/bin/env node
/**
 * db.js: run SQL against the program's database and print JSON.
 *
 * Safety:
 *   - Without --write the statement runs inside a READ ONLY transaction that is
 *     always rolled back, so the database itself rejects any write, however the
 *     SQL is written.
 *   - --write runs inside a transaction: committed on success, rolled back on
 *     error.
 *   - Connection details are never printed.
 *
 * Usage:
 *   node scripts/db.js "<sql>"                  read-only
 *   node scripts/db.js "<sql>" --write          INSERT / UPDATE / DELETE / DDL
 *   node scripts/db.js --file <path> [--write]  run the SQL in a file
 *   node scripts/db.js --tables                 list tables
 *   node scripts/db.js --schema <table>         describe a table
 *   node scripts/db.js --ping                   check the database
 */
'use strict';

const fs = require('fs');
const dbm = require('../lib/db');

function fail(msg, code = 1) {
  console.error(`[db] ${msg}`);
  process.exit(code);
}

function usage() {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(13, 20).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
}

function last(res) {
  return Array.isArray(res) ? res[res.length - 1] : res;
}

async function main() {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  if (has('-h') || has('--help')) return usage();

  const fileIdx = args.indexOf('--file');
  const filePath = fileIdx !== -1 ? args[fileIdx + 1] : null;
  const positional = args.filter((a, i) => !a.startsWith('-') && !(fileIdx !== -1 && i === fileIdx + 1));
  const write = has('--write');

  let db;
  try {
    db = await dbm.open();
  } catch (e) {
    fail(`No se pudo abrir la base de datos: ${e.message}`);
  }

  let problem = null;   // reported after the database is closed cleanly
  try {
    if (has('--ping')) {
      const r = await db.query('SELECT current_database() AS db, version() AS version');
      const info = dbm.describe();
      console.log(JSON.stringify({ ok: true, kind: info.kind, location: info.location, database: r.rows[0].db, version: String(r.rows[0].version).split(' ').slice(0, 2).join(' ') }, null, 2));
      return;
    }
    if (has('--tables')) {
      const r = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
      console.log(JSON.stringify(r.rows.map((x) => x.table_name), null, 2));
      return;
    }
    if (has('--schema')) {
      if (!positional[0]) { problem = '--schema requires a table name'; return; }
      const r = await db.query(
        "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [positional[0]]);
      console.log(JSON.stringify(r.rows, null, 2));
      return;
    }

    let sql = positional[0];
    if (filePath) {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { problem = `--file is not a regular file: ${filePath}`; return; }
      sql = fs.readFileSync(filePath, 'utf8');
    }
    if (!sql) return usage();

    await db.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
    let res;
    try {
      res = await db.query(sql);
      await db.query(write ? 'COMMIT' : 'ROLLBACK');
    } catch (e) {
      try { await db.query('ROLLBACK'); } catch { /* nothing to roll back */ }
      problem = !write && /read-only transaction/i.test(e.message)
        ? 'This statement writes data. Re-run with --write if you really intend to.'
        : `Query failed: ${e.message}`;
      return;
    }
    const r = last(res);
    if (r.rows && (r.rows.length || /^(SELECT|SHOW|VALUES|WITH|EXPLAIN)/i.test(r.command || ''))) console.log(JSON.stringify(r.rows, null, 2));
    else console.log(JSON.stringify({ rowCount: r.rowCount, command: r.command }, null, 2));
  } finally {
    await db.end();
    if (problem) fail(problem);
  }
}

main().catch((e) => fail(`Unexpected: ${e.message}`));
