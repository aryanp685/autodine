-- AutoDine catalog probe.
--
-- READ-ONLY. It selects from PostgreSQL system catalogs only -- never from an
-- application table -- and returns no tenant data, no row counts and no
-- secrets. The result is one row with one jsonb column:
--
--   { "<section> <object>": "<md5 of that object's definition>", ... }
--
-- scripts/reconcile/reconcile-migrations.mjs runs this exact file against its
-- disposable local database to learn what each migration changes. Running the
-- same file once against a hosted database (only when separately authorised)
-- and saving the jsonb lets `reconcile-migrations.mjs classify --probe=<file>`
-- say, per migration, whether its effects are present, absent or drifted --
-- without assuming anything from the migration ledger.
select jsonb_object_agg(section || ' ' || object_key, md5(definition)) as catalog
from (
  select 'function' as section,
         p.oid::regprocedure::text as object_key,
         concat_ws('|', md5(p.prosrc), p.prosecdef::text,
                   has_function_privilege('anon', p.oid, 'execute')::text,
                   has_function_privilege('authenticated', p.oid, 'execute')::text) as definition
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
  union all
  select 'policy', tablename || '/' || policyname,
         concat_ws('|', cmd, array_to_string(roles, ','), coalesce(qual, ''), coalesce(with_check, ''))
    from pg_catalog.pg_policies
   where schemaname = 'public'
  union all
  select 'column', c.table_name || '.' || c.column_name, concat_ws('|', c.udt_name, c.is_nullable)
    from information_schema.columns c
   where c.table_schema = 'public'
  union all
  select 'relation', c.relname::text,
         concat_ws('|', c.relkind::text, c.relrowsecurity::text,
                   has_table_privilege('anon', c.oid, 'select')::text,
                   has_table_privilege('anon', c.oid, 'insert')::text,
                   has_table_privilege('anon', c.oid, 'update')::text,
                   has_table_privilege('anon', c.oid, 'delete')::text,
                   has_table_privilege('authenticated', c.oid, 'insert')::text,
                   has_table_privilege('authenticated', c.oid, 'update')::text,
                   has_any_column_privilege('authenticated', c.oid, 'update')::text,
                   has_table_privilege('authenticated', c.oid, 'delete')::text)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'trigger', c.relname || '/' || t.tgname, pg_catalog.pg_get_triggerdef(t.oid)
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname = 'public'
  union all
  select 'index', indexname::text, indexdef
    from pg_catalog.pg_indexes
   where schemaname = 'public'
  union all
  select 'constraint', c.relname || '/' || k.conname, pg_catalog.pg_get_constraintdef(k.oid)
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class c on c.oid = k.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
) catalog_objects;
