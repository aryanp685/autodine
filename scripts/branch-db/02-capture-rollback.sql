-- ============================================================================
-- AutoDine — branch-DB validation, step 2: capture the ROLLBACK ARTIFACTS
--
-- RUN THIS BEFORE APPLYING THE MIGRATION and SAVE THE OUTPUT to a file. It is
-- read-only; it only prints definitions.
--
-- WHAT IT GIVES YOU
--
--   A. the exact current body of the two functions the migration REPLACES
--      (place_public_order, get_public_order). Restoring these is Tier 3 of the
--      rollback: without them, dropping the new columns breaks the order path.
--   B. the current column list of every table the migration touches, so the
--      "before" shape is recorded rather than remembered.
--   C. confirmation that the four functions being ADDED do not exist yet, so a
--      rollback is a clean drop rather than a guess.
--
-- HOW TO SAVE IT
--
--   psql "$BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f scripts/branch-db/02-capture-rollback.sql \
--        > branch-rollback-$(date +%Y%m%d-%H%M).sql
--
-- The file you get back is plain SQL: the function bodies are the exact
-- `CREATE OR REPLACE FUNCTION` statements that were live before the migration.
--
-- ALSO TAKE A SCHEMA DUMP (see docs/branch-db-validation.md §4) — the two
-- together are the rollback: one file to restore the functions, one dump to
-- restore the shape.
-- ============================================================================

select '--- A. functions being replaced (restore these to roll back) ---' as section;

select p.proname as function_name,
       pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('place_public_order','get_public_order')
 order by 1;

select '--- B. current shape of the tables being altered ---' as section;

select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('restaurants','orders','table_verification_sessions')
 order by table_name, ordinal_position;

select '--- C. the four functions being added must not exist yet (0 rows) ---' as section;

select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('open_table_session','stamp_guest_verification',
                     'confirm_table_orders','reject_table_orders')
 order by 1;
