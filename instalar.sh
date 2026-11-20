#!/bin/sh
# Job Seeker: installation for macOS and Linux. Run: sh instalar.sh
set -e
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "No encontré Node.js. Instalalo desde https://nodejs.org (versión 22 o superior)."; exit 1; }
[ -d node_modules/@electric-sql/pglite ] || npm ci --omit=dev --ignore-scripts
node scripts/setup.js
echo "Para abrir el panel: sh abrir.sh"
