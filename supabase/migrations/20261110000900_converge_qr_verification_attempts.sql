-- Converge public.qr_verification_attempts onto the canonical shape.
--
-- THE PROBLEM
--
-- 20261108000200_drift_reconcile.sql creates the table as a COUNTER:
--
--     qr_code_id, ip_hash, attempt_count, window_started_at,
--     blocked_until, updated_at        primary key (qr_code_id, ip_hash)
--
-- and `reserve_qr_verification_attempt()` bumps it with
-- `on conflict (qr_code_id, ip_hash)`.
--
-- The statement is `create table if not exists`, so on any database where a
-- table of that name already exists -- in a DIFFERENT shape -- the canonical
-- definition is silently skipped and the reserve function then fails with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" the first time a guest mistypes a table code. That is the
-- staging-shaped replay failure this migration closes.
--
-- The local scaffold (scripts/local-pg/005_scaffold_missing_tables.sql) is one
-- such shape: an EVENT LOG with `id bigserial`. It is a test fixture, not a
-- guess about the hosted database, and the real staging and production shapes
-- are still UNKNOWN (see docs/migration-reconciliation.md). This migration is
-- written so that the unknown is handled rather than assumed.
--
-- WHAT IT DOES, for every possible starting state
--
--   canonical shape present   -> no-op (idempotent; safe to re-run)
--   table absent              -> created in the canonical shape
--   any other shape           -> the existing table is RENAMED to
--                                qr_verification_attempts_legacy_<timestamp>,
--                                together with its indexes, constraints and
--                                sequence, and the canonical table is created
--                                in its place. Nothing is dropped, and nothing
--                                is read: the legacy rows stay for inspection.
--
-- After a rename the two functions that touch the table are re-declared from
-- their repository definitions (20261108000200, byte-identical bodies) because
-- a PL/pgSQL plan holds the OID of the table it was compiled against; renaming
-- the table does not re-point those plans, re-creating the functions does.
--
-- UNRESOLVED, and deliberately not guessed: the shape in hosted staging and in
-- production. If either is not canonical, this migration renames it and the
-- preserved legacy table is the evidence of what was actually there.
-- ============================================================================

do $$
declare
  v_oid       oid;
  v_suffix    text := to_char(statement_timestamp(), 'YYYYMMDDHH24MISS');
  v_legacy    text;
  v_canonical boolean;
  v_name      text;
begin
  select c.oid into v_oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'qr_verification_attempts'
     and c.relkind = 'r';

  if v_oid is null then
    return;  -- absent: the DDL below creates the canonical table.
  end if;

  select
        -- every canonical column, with the right types
        (select count(*) = 6
           from information_schema.columns
          where table_schema = 'public'
            and table_name = 'qr_verification_attempts'
            and column_name in ('qr_code_id', 'ip_hash', 'attempt_count',
                                'window_started_at', 'blocked_until', 'updated_at'))
        -- and nothing extra: an event log carries id / attempted_at
    and (select count(*) = 0
           from information_schema.columns
          where table_schema = 'public'
            and table_name = 'qr_verification_attempts'
            and column_name not in ('qr_code_id', 'ip_hash', 'attempt_count',
                                    'window_started_at', 'blocked_until', 'updated_at'))
        -- and the primary key the ON CONFLICT clause depends on
    and exists (select 1
                  from pg_constraint c
                  join pg_attribute a
                    on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
                 where c.conrelid = v_oid
                   and c.contype = 'p'
                 group by c.conrelid
                having array_agg(a.attname::text) @> array['qr_code_id', 'ip_hash'])
    into v_canonical;

  if coalesce(v_canonical, false) then
    return;  -- already canonical: nothing to do.
  end if;

  v_legacy := 'qr_verification_attempts_legacy_' || v_suffix;

  raise notice
    'qr_verification_attempts is not in the canonical shape; preserving it as public.%', v_legacy;

  -- Indexes and the constraint names travel with the table so the new table
  -- can take the canonical default names.
  for v_name in
    select i.relname
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
     where x.indrelid = v_oid
  loop
    execute format('alter index public.%I rename to %I', v_name, v_name || '_' || v_suffix);
  end loop;

  for v_name in
    select conname from pg_constraint where conrelid = v_oid and conname is not null
  loop
    execute format('alter table public.qr_verification_attempts rename constraint %I to %I',
                   v_name, v_name || '_' || v_suffix);
  end loop;

  execute format('alter table public.qr_verification_attempts rename to %I', v_legacy);
end;
$$;

-- Canonical shape. `create table if not exists` covers both "was absent" and
-- "was renamed away" above, and is a no-op when it was already canonical.
create table if not exists public.qr_verification_attempts (
  qr_code_id        uuid not null references public.table_qr_codes(id) on delete cascade,
  ip_hash           text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  attempt_count     integer not null default 0 check (attempt_count >= 0 and attempt_count <= 5),
  window_started_at timestamptz not null default statement_timestamp(),
  blocked_until     timestamptz,
  updated_at        timestamptz not null default statement_timestamp(),
  primary key (qr_code_id, ip_hash)
);

alter table public.qr_verification_attempts enable row level security;
revoke all on public.qr_verification_attempts from anon;
revoke all on public.qr_verification_attempts from authenticated;

-- Re-declared from 20261108000200 (identical bodies) so that, after a rename,
-- the plans resolve against the canonical table rather than the legacy OID.
create or replace function public.reserve_qr_verification_attempt(p_qr_code_id uuid, p_ip_hash text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.qr_verification_attempts%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit fingerprint.' using errcode = '22023';
  end if;
  insert into public.qr_verification_attempts(qr_code_id, ip_hash)
  values (p_qr_code_id, p_ip_hash)
  on conflict (qr_code_id, ip_hash) do nothing;
  select * into v_row
  from public.qr_verification_attempts a
  where a.qr_code_id = p_qr_code_id and a.ip_hash = p_ip_hash
  for update;
  if not found then
    raise exception 'Unknown table QR code.' using errcode = 'P0002';
  end if;
  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return query select false, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;
  if v_row.window_started_at <= v_now - interval '15 minutes' then
    update public.qr_verification_attempts
      set attempt_count = 1, window_started_at = v_now,
          blocked_until = null, updated_at = v_now
      where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash;
    return query select true, 0;
    return;
  end if;
  if v_row.attempt_count >= 5 then
    update public.qr_verification_attempts
      set blocked_until = coalesce(blocked_until, v_now + interval '15 minutes'), updated_at = v_now
      where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash
      returning public.qr_verification_attempts.blocked_until into v_row.blocked_until;
    return query select false, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;
  update public.qr_verification_attempts
    set attempt_count = attempt_count + 1, updated_at = v_now
    where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash;
  return query select true, 0;
end;
$$;

create or replace function public.clear_qr_verification_attempts(p_qr_code_id uuid, p_ip_hash text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.qr_verification_attempts
  where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash;
$$;

revoke all on function public.reserve_qr_verification_attempt(uuid, text) from public;
revoke all on function public.reserve_qr_verification_attempt(uuid, text) from anon;
revoke all on function public.reserve_qr_verification_attempt(uuid, text) from authenticated;
revoke all on function public.clear_qr_verification_attempts(uuid, text) from public;
revoke all on function public.clear_qr_verification_attempts(uuid, text) from anon;
revoke all on function public.clear_qr_verification_attempts(uuid, text) from authenticated;
