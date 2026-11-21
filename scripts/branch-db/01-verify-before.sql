-- ============================================================================
-- AutoDine — branch-DB validation, step 1: the formal "before" record
--
-- This is review doc §4.1 as a runnable file, kept separate so its output can be
-- saved and diffed against the "after" record. Read-only.
-- ============================================================================

-- Must return ZERO rows: none of the migration's columns exist yet.
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'restaurants' and column_name = 'guest_verification_mode')
     or (table_name = 'orders' and column_name in
         ('hold_required','confirmed_at','confirmed_by','table_session_id')))
 order by 1, 2;

-- Must return ZERO rows: none of the four new functions exist yet.
select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('open_table_session','stamp_guest_verification',
                     'confirm_table_orders','reject_table_orders')
 order by 1;

-- Must return ZERO rows: the new table does not exist yet.
select table_name
  from information_schema.tables
 where table_schema = 'public' and table_name = 'table_session_opens';

-- For the record: how many orders/money rows exist in this database. On a
-- schema-only clone both are 0, which is also what makes the rollback trivial.
select (select count(*) from public.orders) as orders,
       (select count(*) from public.restaurants) as restaurants;
