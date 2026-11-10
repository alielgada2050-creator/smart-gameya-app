#!/usr/bin/env bash
# The Android/iOS apps load the UI from the device and call the server cross-origin.
# This reproduces that: the native build is served from :5180 and the API from :3100 with CORS for :5180 only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${PGHOST:=/tmp}" "${PGPORT:=5544}" "${PGUSER:=postgres}"
export PGHOST PGPORT PGUSER
DB=sg_native_test
psql -X -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
for f in "$ROOT"/infrastructure/database/migrations/*.sql; do psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f"; done
(cd "$ROOT/apps/web" && VITE_API_ORIGIN=http://localhost:3100 npx vite build --mode native --outDir dist-native --emptyOutDir >/dev/null)
(cd "$ROOT/apps/api" && npx tsc -p tsconfig.json)
DATABASE_URL="postgresql://$PGUSER@/$DB?host=$PGHOST&port=$PGPORT" JWT_SECRET=$(openssl rand -hex 32) OTP_PEPPER=$(openssl rand -hex 16) \
  LOTTERY_SEED_KEY=$(openssl rand -hex 32) DEV_EXPOSE_OTP=true PORT=3100 CORS_ORIGINS=http://localhost:5180 \
  PAYOUT_ENCRYPTION_KEY=$(openssl rand -hex 32) UPLOAD_DIR=$(mktemp -d) REMINDERS_EVERY_MINUTES=0 \
  node "$ROOT/apps/api/dist/apps/api/src/main.js" > /tmp/sg-native-api.log 2>&1 &
API_PID=$!
python3 -m http.server 5180 --bind 127.0.0.1 --directory "$ROOT/apps/web/dist-native" > /dev/null 2>&1 &
WEB_PID=$!
trap 'kill $API_PID $WEB_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -sf localhost:3100/api/v1/health >/dev/null && curl -sf localhost:5180/ >/dev/null && break; sleep 0.25; done
cd "$ROOT" && SHOTS_DIR="${SHOTS_DIR:-$ROOT/tests/e2e/screenshots}" python3 -I tests/e2e/native_journey.py
