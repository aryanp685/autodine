#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# This runner deliberately refuses remote DB hosts. GitHub Actions and the
# documented local Docker/PostgreSQL setup both connect through loopback.
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-autodine-local-only-e2e}"
DB="autodine_e2e"
PGBIN="${PGBIN:-$(dirname "$(command -v psql || true)")}"
PGRST_VERSION="${PGRST_VERSION:-v16.5}"
PGRST_PORT="${PGRST_PORT:-3001}"
APP_PORT="${APP_PORT:-3100}"
ARTIFACTS="${E2E_ARTIFACTS_DIR:-test-results/throttle-e2e}"
QR_TOKEN='localcard0000000000000000000000000000000000000000000000000001'

case "$PGHOST" in
  127.0.0.1|localhost|::1) ;;
  *) echo "Refusing non-local PostgreSQL host '$PGHOST'; production/remote DBs are forbidden." >&2; exit 2 ;;
esac
: "${PGBIN:?PostgreSQL client tools (psql, createdb, dropdb) are required}"
for tool in psql createdb dropdb; do
  [[ -x "$PGBIN/$tool" ]] || {
    echo "Missing PostgreSQL client tool: $PGBIN/$tool" >&2
    exit 2
  }
done
for tool in curl tar xz openssl node npm npx; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Missing required tool: $tool" >&2
    exit 2
  }
done

mkdir -p "$ARTIFACTS"
POSTGREST_PID=''
POSTGREST_PROXY_PID=''
APP_PID=''
POSTGREST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/autodine-postgrest.XXXXXX")"
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  if [[ -n "$POSTGREST_PROXY_PID" ]]; then
    kill "$POSTGREST_PROXY_PID" 2>/dev/null || true
    wait "$POSTGREST_PROXY_PID" 2>/dev/null || true
  fi
  if [[ -n "$POSTGREST_PID" ]]; then
    kill "$POSTGREST_PID" 2>/dev/null || true
    wait "$POSTGREST_PID" 2>/dev/null || true
  fi
  if [[ -x "$PGBIN/dropdb" ]]; then
    "$PGBIN/dropdb" --if-exists --force --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" "$DB" \
      >>"$ARTIFACTS/cleanup.log" 2>&1 || true
  fi
  rm -rf "$POSTGREST_TMP"
  exit "$status"
}
trap cleanup EXIT INT TERM

export PGHOST PGPORT PGUSER PGPASSWORD
export DB PGBIN

printf 'Building isolated database %s at %s:%s\n' "$DB" "$PGHOST" "$PGPORT" | tee "$ARTIFACTS/run.log"
./scripts/local-pg/run.sh 2>&1 | tee "$ARTIFACTS/migrations.log"
"$PGBIN/psql" -v ON_ERROR_STOP=1 -q -d "$DB" -f scripts/local-pg/900_local_seed.sql \
  2>&1 | tee "$ARTIFACTS/seed.log"
"$PGBIN/psql" -v ON_ERROR_STOP=1 -q -d "$DB" -f scripts/local-pg/910_local_e2e_seed.sql \
  2>&1 | tee -a "$ARTIFACTS/seed.log"

# A dedicated NOINHERIT login lets PostgREST switch to the anon role after JWT
# verification. Its random password exists only for this disposable run.
DB_AUTH_PASSWORD="$(openssl rand -hex 24)"
"$PGBIN/psql" -v ON_ERROR_STOP=1 -q -d "$DB" \
  -c "ALTER ROLE authenticator WITH LOGIN NOINHERIT PASSWORD '${DB_AUTH_PASSWORD}';" \
  -c "GRANT anon, authenticated, service_role TO authenticator;" \
  2>&1 | tee -a "$ARTIFACTS/seed.log"

LOCAL_E2E_JWT_SECRET="${LOCAL_E2E_JWT_SECRET:-$(openssl rand -hex 32)}"
if [[ "${#LOCAL_E2E_JWT_SECRET}" -lt 32 ]]; then
  echo 'LOCAL_E2E_JWT_SECRET must contain at least 32 characters.' >&2
  exit 2
fi
export LOCAL_E2E_JWT_SECRET
ANON_JWT="$(node scripts/e2e/create-local-anon-jwt.mjs)"

# PostgREST is downloaded from its pinned GitHub release. It runs only on the
# local loopback interface and only connects to the disposable database above.
POSTGREST_ARCHIVE="postgrest-${PGRST_VERSION}-linux-static-x86-64.tar.xz"
POSTGREST_URL="https://github.com/PostgREST/postgrest/releases/download/${PGRST_VERSION}/${POSTGREST_ARCHIVE}"
curl --fail --location --silent --show-error "$POSTGREST_URL" -o "$POSTGREST_TMP/postgrest.tar.xz"
tar -xJf "$POSTGREST_TMP/postgrest.tar.xz" -C "$POSTGREST_TMP"
POSTGREST_BIN="$POSTGREST_TMP/postgrest"
[[ -x "$POSTGREST_BIN" ]] || { echo 'PostgREST release archive did not contain an executable.' >&2; exit 2; }

PGRST_DB_HOST="$PGHOST"
if [[ "$PGRST_DB_HOST" == *:* ]]; then
  PGRST_DB_HOST="[$PGRST_DB_HOST]"
fi
export PGRST_DB_URI="postgres://authenticator:${DB_AUTH_PASSWORD}@${PGRST_DB_HOST}:${PGPORT}/${DB}"
export PGRST_DB_SCHEMAS=public
export PGRST_DB_ANON_ROLE=anon
export PGRST_DB_EXTRA_SEARCH_PATH=public
export PGRST_JWT_SECRET="$LOCAL_E2E_JWT_SECRET"
PGRST_UPSTREAM_PORT="${PGRST_UPSTREAM_PORT:-3002}"
export PGRST_SERVER_HOST=127.0.0.1
export PGRST_SERVER_PORT="$PGRST_UPSTREAM_PORT"
export PGRST_LOG_LEVEL=info
"$POSTGREST_BIN" >"$ARTIFACTS/postgrest.log" 2>&1 &
POSTGREST_PID=$!

# PostgREST serves its API at /. Supabase JS expects /rest/v1, so this tiny
# loopback-only proxy strips that prefix without changing database behavior.
export LOCAL_POSTGREST_PROXY_HOST=127.0.0.1
export LOCAL_POSTGREST_PROXY_PORT="$PGRST_PORT"
export LOCAL_POSTGREST_UPSTREAM_HOST=127.0.0.1
export LOCAL_POSTGREST_UPSTREAM_PORT="$PGRST_UPSTREAM_PORT"
export LOCAL_POSTGREST_APP_ORIGIN="http://localhost:${APP_PORT}"
node scripts/e2e/postgrest-path-proxy.mjs >"$ARTIFACTS/postgrest-proxy.log" 2>&1 &
POSTGREST_PROXY_PID=$!

wait_http() {
  local url="$1" description="$2" accept_header="${3:-}"
  for _ in $(seq 1 60); do
    if [[ -n "$accept_header" ]]; then
      curl --fail --silent --show-error -H "$accept_header" "$url" -o /dev/null 2>/dev/null && {
        echo "$description is ready: $url" | tee -a "$ARTIFACTS/run.log"
        return 0
      }
    elif curl --fail --silent --show-error "$url" -o /dev/null 2>/dev/null; then
      echo "$description is ready: $url" | tee -a "$ARTIFACTS/run.log"
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for $description at $url" >&2
  tail -100 "$ARTIFACTS/postgrest.log" >&2 || true
  return 1
}

wait_http "http://127.0.0.1:${PGRST_PORT}/rest/v1/" 'local PostgREST API' 'Accept: application/openapi+json'
# Read-only preflight mirrors the app's storefront, card, and menu reads. It
# does not call open_table_session, spend a scan, or place an order.
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:${PGRST_PORT}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_JWT"
export NEXT_TELEMETRY_DISABLED=1
node scripts/e2e/check-local-api.mjs 2>&1 | tee "$ARTIFACTS/api-preflight.log"
npm run build 2>&1 | tee "$ARTIFACTS/next-build.log"
"$ROOT/node_modules/.bin/next" start -H 127.0.0.1 -p "$APP_PORT" \
  >"$ARTIFACTS/next-start.log" 2>&1 &
APP_PID=$!
wait_http "http://127.0.0.1:${APP_PORT}/menu?s=kings-of-kings" 'Next.js app'

# Verify the actual Playwright-managed browser and all linked system libraries,
# including NSPR/NSS. The full ldd output is retained as an artifact.
./scripts/e2e/check-chromium-runtime.sh 2>&1 | tee "$ARTIFACTS/chromium-runtime.log"

export E2E_BASE_URL="http://localhost:${APP_PORT}"
export E2E_QR_TOKEN="$QR_TOKEN"
export PLAYWRIGHT_JSON_OUTPUT_NAME="$ARTIFACTS/playwright-results.json"
set +e
npx playwright test --config playwright.integration.config.ts --project=throttle \
  --reporter=list,json 2>&1 | tee "$ARTIFACTS/playwright.log"
PLAYWRIGHT_STATUS=${PIPESTATUS[0]}
set -e

set +e
node scripts/e2e/assert-throttle-results.mjs "$PLAYWRIGHT_JSON_OUTPUT_NAME" \
  2>&1 | tee "$ARTIFACTS/result-summary.txt"
ASSERTION_STATUS=${PIPESTATUS[0]}
set -e

if [[ "$PLAYWRIGHT_STATUS" -ne 0 || "$ASSERTION_STATUS" -ne 0 ]]; then
  exit 1
fi

echo 'Both isolated browser E2E cases passed.' | tee -a "$ARTIFACTS/run.log"
