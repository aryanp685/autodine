-- ============================================================================
-- AutoDine — branch-DB validation, step 5: the "after" record
--
-- This is review doc §4.2 as a runnable file. Read-only. Save the output next
-- to the "before" record; the pair is what proves the migration did what it
-- says and nothing else.
-- ============================================================================

select '--- 1. the added columns and their defaults ---' as section;
-- Expect: guest_verification_mode text NO 'code'::text
--         hold_required boolean NO false
--         confirmed_at / confirmed_by / table_session_id nullable
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'restaurants' and column_name = 'guest_verification_mode')
     or (table_name = 'orders' and column_name in
         ('hold_required','confirmed_at','confirmed_by','table_session_id')))
 order by 1, 2;

select '--- 2. four indexes (expect 4 rows) ---' as section;
select indexname
  from pg_indexes
 where schemaname = 'public'
   and indexname in ('orders_held_idx','orders_session_idx',
                     'table_session_opens_card_idx','table_session_opens_ip_idx')
 order by 1;

select '--- 3. the openers table is closed to clients (expect t, 0, 0 rows) ---' as section;
select relrowsecurity as rls_enabled
  from pg_class where oid = 'public.table_session_opens'::regclass;

select count(*) as policies_on_table_session_opens
  from pg_policies
 where schemaname = 'public' and tablename = 'table_session_opens';

select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'table_session_opens'
   and grantee in ('anon','authenticated');

select '--- 4. every function: definer, pinned path (expect security_definer = t, search_path=public) ---' as section;
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                               as security_definer,
       array_to_string(p.proconfig, ',')         as config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('open_table_session','stamp_guest_verification',
                     'confirm_table_orders','reject_table_orders',
                     'place_public_order','get_public_order')
 order by 1;

select '--- 5. grants (expect t, f, t) ---' as section;
select has_function_privilege('anon','public.open_table_session(text,text)','execute')          as anon_can_open,
       has_function_privilege('anon','public.confirm_table_orders(uuid)','execute')            as anon_can_confirm,
       has_function_privilege('authenticated','public.confirm_table_orders(uuid)','execute')   as staff_can_confirm,
       has_function_privilege('anon','public.stamp_guest_verification(text,uuid,text)','execute') as anon_can_stamp;

select '--- 6. nothing existing was rewritten (expect 0 held orders in this empty clone) ---' as section;
select count(*) as orders_total,
       count(*) filter (where hold_required) as orders_held,
       count(*) filter (where confirmed_at is not null) as orders_confirmed
  from public.orders;
