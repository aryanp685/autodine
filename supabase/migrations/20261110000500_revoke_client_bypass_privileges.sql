-- RLS does not apply to TRUNCATE. REFERENCES and TRIGGER are not needed by
-- browser-facing roles, and PostgreSQL 17's MAINTAIN is maintenance authority,
-- not an application permission. Keep those privileges off client roles.
--
-- The ordinary table DML/SELECT defaults are intentionally preserved: this
-- repository relies on Supabase's table grants together with RLS and explicit
-- column grants. This migration does not disable RLS or alter those workflows.
--
-- Public sequences are different: no public sequence exists in the inspected
-- Production catalog, application ids are UUID-based, and no client nextval()
-- call exists in source. Remove client sequence access now and by default;
-- any future client-facing sequence use must receive an explicit narrow grant.
-- The trusted service_role and table owner ACLs are unchanged.
do $$
declare
  v_relation text;
  v_sequence text;
  v_server_version integer := current_setting('server_version_num')::integer;
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

    -- PostgreSQL 17 introduced MAINTAIN. Keep this migration compatible with
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

  -- This migration is run as postgres in the inspected Supabase project.
  -- Revoke only objects owned by this execution role: postgres cannot safely
  -- alter ACLs on supabase_admin-owned relations. The separate owner operation
  -- handles that owner. These defaults affect only new objects owned here.
  execute 'alter default privileges in schema public revoke truncate, references, trigger on tables from public, anon, authenticated';
  if v_server_version >= 170000 then
    execute 'alter default privileges in schema public revoke maintain on tables from public, anon, authenticated';
  end if;
  execute 'alter default privileges in schema public revoke usage, select, update on sequences from public, anon, authenticated';
end;
$$;
