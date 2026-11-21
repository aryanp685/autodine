-- ============================================================================
-- AutoDine — branch-DB validation, step 0: PREFLIGHT (read-only)
--
-- RUN THIS FIRST, and connect with the branch project's connection string.
-- Nothing here writes, so it is safe to run twice; if anything says FAIL, STOP
-- and do not apply the migration.
--
-- It answers three questions:
--   1. Which database am I actually connected to?  (a human must confirm it)
--   2. Is it a schema-only clone, and not production?  (mechanical guard)
--   3. Are the migration's prerequisites here, and are its objects still absent?
--
-- WHY "orders must be empty" IS THE PRODUCTION GUARD
--
-- A branch is created from a schema dump, so every table starts with zero rows.
-- Production has real orders. If `orders` has rows before you have applied
-- anything, then either this is not a fresh clone or it is not the branch --
-- and both are reasons to stop rather than to look closer.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Identity. Paste this output into the results log and check the project ref
-- against the dashboard tab you have open. This is the human half of the check;
-- no query can know which project you meant.
-- ---------------------------------------------------------------------------
select current_database()                                        as database_name,
       current_user                                              as connected_as,
       inet_server_addr()::text                                  as server_address,
       (select setting from pg_settings where name = 'server_version') as pg_version,
       (select count(*) from pg_extension)                       as extensions;

-- ---------------------------------------------------------------------------
-- 1. Emptiness: the mechanical "this is a clone, not production" guard.
--    Expect orders = 0, payments = 0, memberships = 0, restaurants = 0.
--    restaurants > 0 is only acceptable if YOU seeded a demo restaurant, which
--    the runbook says to do after this preflight, not before.
-- ---------------------------------------------------------------------------
select (select count(*) from public.orders)      as orders,
       (select count(*) from public.restaurants) as restaurants,
       (select count(*) from public.memberships) as memberships,
       (select count(*) from public.items)       as menu_items;

-- ---------------------------------------------------------------------------
-- 2. Prerequisites must all be true. Any FALSE means the clone is incomplete
--    and the migration will fail part-way (see review doc §2.1/§2.2).
-- ---------------------------------------------------------------------------
select
  exists (select 1 from information_schema.tables
           where table_schema = 'public' and table_name = 'table_qr_codes')                as has_table_qr_codes,
  exists (select 1 from information_schema.tables
           where table_schema = 'public' and table_name = 'table_verification_sessions')   as has_table_verification_sessions,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'place_public_order_core')           as has_place_public_order_core,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'restaurant_can_write')              as has_restaurant_can_write,
  exists (select 1 from information_schema.tables
           where table_schema = 'public' and table_name = 'memberships')                   as has_memberships,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'orders'
             and column_name in ('code','guest_token','prep_status','customer_note','restaurant_id')
          group by table_name having count(*) = 5)                                         as orders_columns_ok,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'restaurants'
             and column_name in ('slug','is_active','tax_rate_bps')
          group by table_name having count(*) = 3)                                         as restaurants_columns_ok;

-- ---------------------------------------------------------------------------
-- 3. The migration's own objects must still be ABSENT — this is the "before"
--    state from review doc §4.1. Any row here means part of it is already
--    applied, or a newer migration added it, and you should stop and say so.
-- ---------------------------------------------------------------------------
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'restaurants' and column_name = 'guest_verification_mode')
     or (table_name = 'orders' and column_name in
         ('hold_required','confirmed_at','confirmed_by','table_session_id'))
     or (table_name = 'table_verification_sessions' and column_name = 'hold_orders'))
 order by 1, 2;

select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('open_table_session','stamp_guest_verification',
                     'confirm_table_orders','reject_table_orders')
 order by 1;

select count(*) as table_session_opens_exists
  from information_schema.tables
 where table_schema = 'public' and table_name = 'table_session_opens';

-- ---------------------------------------------------------------------------
-- Expected: four empty result sets (the three `select` result tables above show
-- nothing, and the last shows 0), plus one identity row, one counts row and one
-- booleans row that is TRUE throughout.
-- ============================================================================
