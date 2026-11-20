#!/usr/bin/env node
/**
 * externos.js: LinkedIn jobs without Easy Apply that passed your filters, saved by
 * each simulation or application run (datos/avisos-externos.json).
 *
 *   node scripts/externos.js list [--all]                 the ones the user sent to the agent (or all)
 *   node scripts/externos.js mark <id> <estado> [--note "..."]
 *        estados: sin revisar | pendiente | para el agente | en cola | postulado | descartado
 *
 * Output is JSON. The agent applies on the company site following AGENTS.md.
 */
const ext = require('../lib/external');

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'list') {
    const all = rest.includes('--all');
    const items = ext.load().filter((j) => all || j.status === 'para el agente');
    console.log(JSON.stringify(items, null, 2));
  } else if (cmd === 'mark') {
    const ni = rest.indexOf('--note');
    const note = ni >= 0 ? rest[ni + 1] : '';
    const args = ni >= 0 ? rest.slice(0, ni) : rest;
    const [id, ...st] = args;
    console.log(JSON.stringify(ext.mark(id, st.join(' '), note), null, 2));
  } else {
    console.log(`Uso: node scripts/externos.js list [--all] | mark <id> <${ext.STATUSES.join('|')}> [--note "..."]`);
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
