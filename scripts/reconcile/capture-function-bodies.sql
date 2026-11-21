-- Read-only capture of every function body in a database.
--
-- WHY THIS EXISTS
--
-- Migration reconciliation keeps finding the same class of problem: a
-- function exists in a hosted database whose body matches NO state of the
-- repository. Five of them were found on 2026-11-10 (cancel_order,
-- open_table_session, record_counter_payment, set_order_line_quantities,
-- settle_online_payment). Replacing such a body is safe only if the body that
-- was actually there has been recorded first -- otherwise the only copy of a
-- production behaviour is deleted by `create or replace function`, and there
-- is no way to prove afterwards what it did.
--
-- HOW TO RUN IT
--
-- Read-only. It writes nothing, and the harness runs it inside a
-- `begin read only` transaction:
--
--     npm run db:reconcile -- capture --json=scripts/reconcile/evidence/<name>.json
--
-- which needs RECONCILE_PG_ADMIN_URL to point at a loopback database. Against
-- a hosted database, run this file by hand in a read-only psql session and
-- keep the output beside the probe in scripts/reconcile/evidence/. Do not
-- point the harness at a hosted database.
--
-- Take the capture BEFORE applying any migration that redefines a function,
-- and keep it next to the catalog probe from catalog-probe.sql: together they
-- say what the database WAS, which is the only thing that makes a later
-- "applied or not" verdict auditable.

select n.nspname                                  as schema_name,
       p.proname                                  as function_name,
       p.oid::regprocedure::text                  as signature,
       pg_get_functiondef(p.oid)                  as definition,
       pg_get_function_result(p.oid)              as result_type,
       pg_get_function_arguments(p.oid)           as arguments,
       p.prosecdef                                as security_definer,
       p.provolatile                              as volatility,
       coalesce(p.proconfig, '{}'::text[])        as runtime_config,
       pg_get_userbyid(p.proowner)                as owner,
       md5(p.prosrc)                              as body_md5,
       coalesce(obj_description(p.oid, 'pg_proc'), '') as comment,
       -- Who may call it. A definer function with EXECUTE granted to anon is
       -- the shape that matters most when a body is about to be replaced.
       coalesce((
         select string_agg(distinct grantee, ', ' order by grantee)
           from information_schema.role_routine_grants g
          where g.routine_schema = n.nspname
            and g.routine_name = p.proname
            and g.privilege_type = 'EXECUTE'
       ), '')                                     as execute_grantees
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'auth', 'storage')
 order by n.nspname, p.proname, p.oid::regprocedure::text;
