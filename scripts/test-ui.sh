#!/usr/bin/env bash
# Build the web app, start the API serving it on a fresh DB, and run the real-browser journey.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${PGHOST:=/tmp}" "${PGPORT:=5544}" "${PGUSER:=postgres}"
export PGHOST PGPORT PGUSER
DB=sg_ui_test
psql -X -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
for f in "$ROOT"/infrastructure/database/migrations/*.sql; do psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f"; done
(cd "$ROOT/apps/web" && npx vite build >/dev/null)
(cd "$ROOT/apps/api" && npx tsc -p tsconfig.json)
export DATABASE_URL="postgresql://$PGUSER@/$DB?host=$PGHOST&port=$PGPORT" JWT_SECRET=$(openssl rand -hex 32) OTP_PEPPER=$(openssl rand -hex 16) \
  LOTTERY_SEED_KEY=$(openssl rand -hex 32) DEV_EXPOSE_OTP=true PORT=3100 WEB_DIST="$ROOT/apps/web/dist" \
  PAYOUT_ENCRYPTION_KEY=$(openssl rand -hex 32) UPLOAD_DIR=$(mktemp -d) PLATFORM_ADMIN_PHONES=+966500000900 REMINDERS_EVERY_MINUTES=0
node "$ROOT/apps/api/dist/apps/api/src/main.js" > "${UI_LOG:-/tmp/sg-ui-api.log}" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -sf localhost:3100/api/v1/health >/dev/null && break; sleep 0.25; done
cd "$ROOT" && RECORD_API="${RECORD_API:-}" SHOTS_DIR="${SHOTS_DIR:-$ROOT/tests/e2e/screenshots}" BASE_URL=http://localhost:3100 python3 -I tests/e2e/ui_journey.py
cd "$ROOT" && BASE_URL=http://localhost:3100 python3 -I tests/e2e/members_journey.py
