-- OWNER-CORRECT OPERATOR STEP — deliberately not in supabase/migrations.
--
-- Run only while connected as `supabase_admin` (or after SET ROLE
-- supabase_admin) with the intended change approved. Production's `postgres`
-- role is neither a member of supabase_admin nor a superuser, so the normal
-- migration runner cannot alter this owner's default ACLs. Do not grant role
-- membership merely to make the standard migration work.
--
-- Normal SELECT/INSERT/UPDATE/DELETE table defaults remain unchanged for the
-- existing RLS-backed application. Client sequence grants are removed because
-- no current public sequence or application nextval() workflow was found.
do $$
declare
  v_relation text;
  v_sequence text;
  v_server_version integer := current_setting('server_version_num')::integer;
begin
  if current_user <> 'supabase_admin' then
    raise exception 'Run this owner-specific ACL step as supabase_admin; current_user is %.', current_user;
  end if;

  -- Revoke only the non-application privileges from current public tables and
  -- sequences too, so a relation created before this step does not retain a
  -- browser-role maintenance/bypass grant.
  for v_relation in
    select format('%I.%I', n.nspname, c.relname)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
  loop
    execute format(
      'revoke truncate, references, trigger on table %s from public, anon, authenticated',
      v_relation
    );
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
  loop
    execute format(
      'revoke usage, select, update on sequence %s from public, anon, authenticated',
      v_sequence
    );
  end loop;
end;
$$;

alter default privileges in schema public
  revoke truncate, references, trigger on tables from public, anon, authenticated;

do $$
begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'alter default privileges in schema public revoke maintain on tables from public, anon, authenticated';
  end if;
end;
$$;

alter default privileges in schema public
  revoke usage, select, update on sequences from public, anon, authenticated;
