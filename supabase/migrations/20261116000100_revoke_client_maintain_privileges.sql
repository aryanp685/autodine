-- Scoped production revision of 20261110001220_revoke_client_bypass_privileges.
--
-- WHY THIS FILE EXISTS (probed 2026-11-16, production bdbaqpevwmgdvghszjno)
--
-- The 01220 version was never applied to production. Its effect is only
-- PARTIAL there: TRUNCATE/REFERENCES/TRIGGER are already revoked on tables,
-- but MAINTAIN (PostgreSQL 17) is still granted to anon and authenticated on
-- 17 postgres-owned public tables, and the postgres default ACLs still grant
-- MAINTAIN on future tables. This forward file completes exactly that scope
-- for the production-shaped catalog. It does not edit or replace 01220 in
-- the chain (local/staging replays keep both; every statement below is
-- idempotent against 01220's effects).
--
-- SEQUENCES (the one place 01220 needed production evidence)
--
-- Production has two public sequences (restaurant_invoice_share_audit_id_seq,
-- subscription_receipt_seq) holding USAGE/SELECT/UPDATE for anon and
-- authenticated. Verified in source: both are consumed only inside
-- SECURITY DEFINER functions running as the table owner
-- (subscription receipt numbering in 20261110001100/20261112000600;
-- share-audit inserts in 20261108010000, whose audit table itself is
-- `revoke all ... from public, anon, authenticated, service_role`).
-- No client-side nextval() call exists in application source. Client
-- sequence privileges are therefore revoked here exactly as 01220 intended;
-- definer-path numbering is unaffected.
--
-- GRANTOR BOUNDARY (unchanged from 01220)
--
-- Only relations owned by the executing role (postgres in the hosted
-- project) are touched, and only postgres default privileges are altered.
-- supabase_admin-owned objects and defaults remain the separate manual
-- owner operation (supabase/owner-operations/
-- 20261110000501_revoke_supabase_admin_client_defaults.sql) — never
-- automatic, not duplicated here.
--
-- FAIL-CLOSED VERIFICATION
--
-- The final block raises (rolling the migration back) if any client
-- maintenance/bypass privilege survives on a postgres-owned public table,
-- so an applied ledger entry always means the probed end-state holds.
do $$
declare
  v_relation text;
  v_sequence text;
  v_server_version integer := current_setting('server_version_num')::integer;
  v_remaining integer;
begin
  for v_relation in
    select format('%I.%I', n.nspname, c.relname)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relowner = (select oid from pg_catalog.pg_roles where rolname = current_user)
  loop
    execute format(
      'revoke truncate, references, trigger on table %s from public, anon, authenticated',
      v_relation
    );

    -- PostgreSQL 17 introduced MAINTAIN. Keep this file compatible with
    -- older local/hosted majors which do not recognize the privilege keyword.
    if v_server_version >= 170000 then
      execute format(
        'revoke maintain on table %s from public, anon, authenticated',
        v_relation
      );
    end if;
  end loop;

  for v_sequence in
    select format('%I.%I', n.nspname, c.relname)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'S'
       and c.relowner = (select oid from pg_catalog.pg_roles where rolname = current_user)
  loop
    execute format(
      'revoke usage, select, update on sequence %s from public, anon, authenticated',
      v_sequence
    );
  end loop;

  -- Defaults affect only new objects owned by this execution role.
  execute 'alter default privileges in schema public revoke truncate, references, trigger on tables from public, anon, authenticated';
  if v_server_version >= 170000 then
    execute 'alter default privileges in schema public revoke maintain on tables from public, anon, authenticated';
  end if;
  execute 'alter default privileges in schema public revoke usage, select, update on sequences from public, anon, authenticated';

  -- Fail closed: no client MAINTAIN/TRUNCATE/REFERENCES/TRIGGER may remain
  -- on any public table owned by this role after the revokes above.
  select count(*) into v_remaining
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, '{}'::aclitem[])) as acl
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and c.relowner = (select oid from pg_catalog.pg_roles where rolname = current_user)
     and acl.privilege_type in ('MAINTAIN', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
     and (acl.grantee = 0
          or acl.grantee in (select oid from pg_catalog.pg_roles
                              where rolname in ('anon', 'authenticated')));

  if v_remaining > 0 then
    raise exception 'Client maintenance/bypass privileges remain on % grant rows after revoke; refusing to record this migration as applied.', v_remaining;
  end if;
end;
$$;
