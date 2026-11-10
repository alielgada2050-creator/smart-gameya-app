#!/usr/bin/env bash
# Recreate the test database, apply all migrations, build and run the API end-to-end tests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${PGHOST:=/tmp}" "${PGPORT:=5544}" "${PGUSER:=postgres}"
export PGHOST PGPORT PGUSER
DB=sg_api_test
psql -X -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
for f in "$ROOT"/infrastructure/database/migrations/*.sql; do psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f"; done
export DATABASE_URL="postgresql://$PGUSER@/$DB?host=$PGHOST&port=$PGPORT"
cd "$ROOT/apps/api" && npx tsc -p tsconfig.json && node --test --test-concurrency=1 dist/apps/api/test/e2e.test.js dist/apps/api/test/features.test.js dist/apps/api/test/ordering.test.js dist/apps/api/test/terms.test.js
