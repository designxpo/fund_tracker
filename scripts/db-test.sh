#!/usr/bin/env bash
# Run supabase/tests/*.sql against $DATABASE_URL. Each file rolls itself back.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL (see .env.db.example)}"
status=0
for f in supabase/tests/*.sql; do
  echo "▶ $f"
  if out=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q -t -f "$f" 2>&1); then
    echo "$out" | grep -E "PASSED|NOTICE" || true
  else
    echo "$out" | grep -E "ERROR|assert|CONTEXT" | head -5
    status=1
  fi
done
exit $status
