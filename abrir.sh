#!/bin/sh
# Job Seeker: open the panel on macOS or Linux. Run: sh abrir.sh
cd "$(dirname "$0")"
exec node scripts/dashboard.js --open
