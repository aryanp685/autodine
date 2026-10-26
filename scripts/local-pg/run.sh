#!/usr/bin/env bash
# ============================================================================
# Build a throwaway database from this repository's migrations, on a LOCAL
# PostgreSQL, so the migration and its checks can be executed without a
# Supabase project.
#
#   PGBIN=/path/to/postgres/bin  PGHOST=/tmp/pgdata  ./scripts/local-pg/run.sh
#
# WHAT THIS IS
#   A harness. It proves the SQL in this repository runs and that the checks
#   behave — nothing more. Every file it adds on top of supabase/migrations is
#   marked LOCAL HARNESS ONLY.
#
# WHAT THIS IS NOT
#   A production schema. Three tables (table_qr_codes, table_verification_
#   sessions, qr_verification_attempts) are created by no migration in this
#   repository; 005_scaffold_missing_tables.sql reconstructs them from the code
#   that reads them. A real branch database must be cloned with pg_dump, not
#   built this way (docs/migration-…-review.md §2.1).
# ============================================================================
set -euo pipefail

: "${PGBIN:?set PGBIN to a directory containing psql}"
: "${PGHOST:?set PGHOST to the socket or host of a local postgres}"
DB="${DB:-adine_local}"

psql() { "$PGBIN/psql" -v ON_ERROR_STOP=1 -q "$@"; }

"$PGBIN/dropdb" --if-exists "$DB" 2>/dev/null || true
"$PGBIN/createdb" "$DB"

# Supabase's own objects, then the repository's migrations, with the scaffold
# inserted at the one point where the missing tables are first needed.
psql -d "$DB" -f scripts/local-pg/000_supabase_shim.sql

for f in supabase/migrations/*.sql; do
  case "$(basename "$f")" in
    20261021000006*) psql -d "$DB" -f scripts/local-pg/005_scaffold_missing_tables.sql ;;
  esac
  # pgcrypto is not bundled with every local install; PG13+ has gen_random_uuid.
  sed 's/^create extension if not exists "pgcrypto";/-- pgcrypto skipped: PG13+ provides gen_random_uuid/' "$f" \
    | psql -d "$DB" > /dev/null
  echo "applied $(basename "$f")"
done

echo
echo "database $DB built. Next:"
echo "  $PGBIN/psql -d $DB -f scripts/branch-db/03-verify-after.sql     # objects"
echo "  $PGBIN/psql -d $DB -f supabase/checks/06_scan_limits.sql        # behaviour (needs data)"
echo "  $PGBIN/psql -d $DB -f scripts/local-pg/900_local_seed.sql       # one restaurant, table, card, order"
echo "  THROTTLE_DB_URL=postgresql://postgres@/$DB?host=$PGHOST npx vitest run app/menu/throttle-db.integration.test.tsx"
