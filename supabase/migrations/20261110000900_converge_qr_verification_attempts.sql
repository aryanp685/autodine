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
--   canonical shape present   -> keep it; import any preserved active state
--   table absent              -> created in the canonical shape
--   any other shape           -> the existing table is RENAMED to
--                                qr_verification_attempts_legacy_<timestamp>,
--                                together with its indexes, constraints and
--                                sequence, and the canonical table is created
--                                in its place. Nothing is dropped.
--
-- The following state-transfer block recognizes only the evidenced event-log
-- and pair-keyed-counter shapes. Active attempts/blocks are copied into the
-- canonical counter before its functions are replaced; the source archives
-- remain intact. Unknown shapes fail the migration rather than silently
-- resetting a guest's attempt budget. If the earlier branch-only
-- qr_verification_attempt_budgets table exists, its live state is treated as
-- authoritative and copied as well.
--
-- After a rename the two functions that touch the table are re-declared from
-- the repository definitions in 20261108000200 because a PL/pgSQL plan can
-- retain the old table OID; renaming alone does not re-point those plans. The
-- reservation function also re-arms an expired block instead of reusing its
-- stale timestamp.
--
-- UNRESOLVED, and deliberately not guessed: the shape in hosted staging and in
-- production. If either is not canonical, this migration recognizes only the
-- two documented legacy shapes above. Any other shape is preserved by the
-- enclosing migration transaction and causes the migration to fail for review.
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
     and c.relkind in ('r', 'p');

  if v_oid is null then
    return;  -- absent: the DDL below creates the canonical table.
  end if;

  select
        -- exactly the six columns and their expected PostgreSQL types
        (select count(*) = 6
           from information_schema.columns
          where table_schema = 'public'
            and table_name = 'qr_verification_attempts'
            and ((column_name = 'qr_code_id' and udt_name = 'uuid' and is_nullable = 'NO')
              or (column_name = 'ip_hash' and udt_name = 'text' and is_nullable = 'NO')
              or (column_name = 'attempt_count' and udt_name = 'int4' and is_nullable = 'NO')
              or (column_name in ('window_started_at', 'updated_at')
                  and udt_name = 'timestamptz' and is_nullable = 'NO')
              or (column_name = 'blocked_until' and udt_name = 'timestamptz' and is_nullable = 'YES')))
        -- and nothing extra: an event log carries id / attempted_at
    and (select count(*) = 0
           from information_schema.columns
          where table_schema = 'public'
            and table_name = 'qr_verification_attempts'
            and column_name not in ('qr_code_id', 'ip_hash', 'attempt_count',
                                    'window_started_at', 'blocked_until', 'updated_at'))
        -- and the exact pair primary key the ON CONFLICT clause depends on
    and exists (select 1
                  from pg_constraint c
                 where c.conrelid = v_oid
                   and c.contype = 'p'
                   and (select array_agg(a.attname::text order by k.ordinality)
                          from unnest(c.conkey) with ordinality k(attnum, ordinality)
                          join pg_attribute a
                            on a.attrelid = c.conrelid and a.attnum = k.attnum)
                       = array['qr_code_id', 'ip_hash']::text[])
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

-- Transfer live state before replacing reservation/clear functions. Only the
-- documented event-log and pair-keyed-state layouts are understood. A budget
-- row from the branch compatibility design is authoritative for its pair, so
-- the archived copy of the same pre-migration attempts is not charged twice.
do $$
declare
  v_now timestamptz := statement_timestamp();
  v_rel record;
  v_column_count integer;
  v_key_columns integer;
  v_state_columns integer;
  v_has_attempted_at boolean;
  v_has_id boolean;
  v_invalid boolean;
  v_has_budgets boolean := false;
  v_exclude_budget text := '';
begin
  lock table public.qr_verification_attempts in access exclusive mode;

  if to_regclass('public.qr_verification_attempt_budgets') is not null then
    select c.relkind = 'r' into v_has_budgets
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'qr_verification_attempt_budgets';
    if not coalesce(v_has_budgets, false) then
      raise exception 'qr_verification_attempt_budgets exists but is not a regular table.';
    end if;

    lock table public.qr_verification_attempt_budgets in access exclusive mode;
    select count(*) into v_column_count
      from pg_catalog.pg_attribute
     where attrelid = 'public.qr_verification_attempt_budgets'::regclass
       and attnum > 0 and not attisdropped;
    select count(*) into v_state_columns
      from pg_catalog.pg_attribute
     where attrelid = 'public.qr_verification_attempt_budgets'::regclass
       and attnum > 0 and not attisdropped
       and attname in ('qr_code_id', 'ip_hash', 'attempt_count', 'window_started_at', 'blocked_until', 'updated_at');
    if v_column_count <> 6 or v_state_columns <> 6 then
      raise exception 'Unsupported qr_verification_attempt_budgets shape; refusing to ignore saved state.';
    end if;

    select exists (
      select 1
        from public.qr_verification_attempt_budgets a
       where a.qr_code_id is null
          or a.ip_hash is null
          or a.ip_hash !~ '^[0-9a-f]{64}$'
          or a.attempt_count is null
          or a.attempt_count < 0
          or a.attempt_count > 5
          or a.window_started_at is null
          or a.updated_at is null
    ) into v_invalid;
    if v_invalid then
      raise exception 'Invalid identity or rate-limit state in qr_verification_attempt_budgets; refusing to discard it.';
    end if;

    insert into public.qr_verification_attempts as current_state (
      qr_code_id, ip_hash, attempt_count, window_started_at, blocked_until, updated_at
    )
    select a.qr_code_id, a.ip_hash, a.attempt_count,
           a.window_started_at,
           case when a.blocked_until > v_now then a.blocked_until else null end,
           a.updated_at
      from public.qr_verification_attempt_budgets a
     where (a.window_started_at > v_now - interval '15 minutes' or a.blocked_until > v_now)
       and exists (select 1 from public.table_qr_codes q where q.id = a.qr_code_id)
    on conflict (qr_code_id, ip_hash) do update
      set attempt_count = case
            when current_state.window_started_at <= v_now - interval '15 minutes'
              then excluded.attempt_count
            when excluded.window_started_at <= v_now - interval '15 minutes'
              then current_state.attempt_count
            when current_state.window_started_at = excluded.window_started_at
              then greatest(current_state.attempt_count, excluded.attempt_count)
            when current_state.window_started_at > excluded.window_started_at
              then current_state.attempt_count
            else excluded.attempt_count
          end,
          window_started_at = greatest(current_state.window_started_at, excluded.window_started_at),
          blocked_until = greatest(
            case when current_state.blocked_until > v_now then current_state.blocked_until end,
            case when excluded.blocked_until > v_now then excluded.blocked_until end
          ),
          updated_at = greatest(current_state.updated_at, excluded.updated_at);

    v_exclude_budget := $filter$
      and not exists (
        select 1 from public.qr_verification_attempt_budgets b
         where b.qr_code_id = a.qr_code_id
           and b.ip_hash = a.ip_hash
           and (b.window_started_at > $1 - interval '15 minutes' or b.blocked_until > $1)
      )
    $filter$;
  end if;

  for v_rel in
    select c.relname
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relname like 'qr_verification_attempts_legacy_%'
     order by c.relname
  loop
    execute format('lock table public.%I in access exclusive mode', v_rel.relname);

    select count(*) into v_column_count
      from pg_catalog.pg_attribute
     where attrelid = format('public.%I', v_rel.relname)::regclass
       and attnum > 0 and not attisdropped;
    select count(*) into v_key_columns
      from pg_catalog.pg_attribute
     where attrelid = format('public.%I', v_rel.relname)::regclass
       and attnum > 0 and not attisdropped
       and attname in ('qr_code_id', 'ip_hash');
    select count(*) into v_state_columns
      from pg_catalog.pg_attribute
     where attrelid = format('public.%I', v_rel.relname)::regclass
       and attnum > 0 and not attisdropped
       and attname in ('attempt_count', 'window_started_at', 'blocked_until', 'updated_at');
    select exists (
      select 1 from pg_catalog.pg_attribute
       where attrelid = format('public.%I', v_rel.relname)::regclass
         and attnum > 0 and not attisdropped and attname = 'attempted_at'
    ) into v_has_attempted_at;
    select exists (
      select 1 from pg_catalog.pg_attribute
       where attrelid = format('public.%I', v_rel.relname)::regclass
         and attnum > 0 and not attisdropped and attname = 'id'
    ) into v_has_id;

    if v_key_columns <> 2 then
      raise exception 'Unsupported legacy QR-attempt archive public.%; expected qr_code_id and ip_hash.', v_rel.relname;
    end if;

    if v_column_count = 4 and v_state_columns = 0 and v_has_attempted_at and v_has_id then
      execute format($check$
        select exists (
          select 1 from public.%I a
           where a.qr_code_id is null
              or a.ip_hash is null
              or a.ip_hash !~ '^[0-9a-f]{64}$'
              or a.attempted_at is null
        )
      $check$, v_rel.relname) into v_invalid;
      if v_invalid then
        raise exception 'Invalid identity or timestamp in legacy QR-attempt archive public.%; refusing to ignore it.', v_rel.relname;
      end if;

      execute format($copy$
        insert into public.qr_verification_attempts as current_state (
          qr_code_id, ip_hash, attempt_count, window_started_at, blocked_until, updated_at
        )
        select a.qr_code_id,
               a.ip_hash,
               least(5::bigint, count(*)::bigint)::integer,
               max(a.attempted_at),
               null,
               $1
          from public.%I a
         where a.attempted_at > $1 - interval '15 minutes'
           and exists (select 1 from public.table_qr_codes q where q.id = a.qr_code_id)
           %s
         group by a.qr_code_id, a.ip_hash
        on conflict (qr_code_id, ip_hash) do update
          set attempt_count = case
                when current_state.window_started_at <= $1 - interval '15 minutes'
                  then excluded.attempt_count
                when excluded.window_started_at <= $1 - interval '15 minutes'
                  then current_state.attempt_count
                when current_state.window_started_at = excluded.window_started_at
                  then greatest(current_state.attempt_count, excluded.attempt_count)
                when current_state.window_started_at > excluded.window_started_at
                  then current_state.attempt_count
                else excluded.attempt_count
              end,
              window_started_at = greatest(current_state.window_started_at, excluded.window_started_at),
              blocked_until = greatest(
                case when current_state.blocked_until > $1 then current_state.blocked_until end,
                case when excluded.blocked_until > $1 then excluded.blocked_until end
              ),
              updated_at = greatest(current_state.updated_at, excluded.updated_at)
      $copy$, v_rel.relname, v_exclude_budget) using v_now;
    elsif v_column_count = 6 and v_state_columns = 4 and not v_has_attempted_at and not v_has_id then
      execute format($check$
        select exists (
          select 1 from public.%I a
           where a.qr_code_id is null
              or a.ip_hash is null
              or a.ip_hash !~ '^[0-9a-f]{64}$'
              or a.attempt_count is null
              or a.attempt_count < 0
              or a.attempt_count > 5
              or a.window_started_at is null
              or a.updated_at is null
        )
      $check$, v_rel.relname) into v_invalid;
      if v_invalid then
        raise exception 'Invalid identity or rate-limit state in legacy QR-attempt archive public.%; refusing to ignore it.', v_rel.relname;
      end if;

      execute format($copy$
        insert into public.qr_verification_attempts as current_state (
          qr_code_id, ip_hash, attempt_count, window_started_at, blocked_until, updated_at
        )
        select a.qr_code_id,
               a.ip_hash,
               least(5::bigint, coalesce(sum(a.attempt_count) filter (
                 where a.window_started_at > $1 - interval '15 minutes'
               ), 0))::integer,
               coalesce(max(a.window_started_at) filter (
                 where a.window_started_at > $1 - interval '15 minutes'
               ), $1 - interval '16 minutes'),
               case when max(a.blocked_until) > $1 then max(a.blocked_until) end,
               max(a.updated_at)
          from public.%I a
         where a.window_started_at > $1 - interval '15 minutes'
            or a.blocked_until > $1
         group by a.qr_code_id, a.ip_hash
         having exists (select 1 from public.table_qr_codes q where q.id = a.qr_code_id)
           %s
        on conflict (qr_code_id, ip_hash) do update
          set attempt_count = case
                when current_state.window_started_at <= $1 - interval '15 minutes'
                  then excluded.attempt_count
                when excluded.window_started_at <= $1 - interval '15 minutes'
                  then current_state.attempt_count
                when current_state.window_started_at = excluded.window_started_at
                  then greatest(current_state.attempt_count, excluded.attempt_count)
                when current_state.window_started_at > excluded.window_started_at
                  then current_state.attempt_count
                else excluded.attempt_count
              end,
              window_started_at = greatest(current_state.window_started_at, excluded.window_started_at),
              blocked_until = greatest(
                case when current_state.blocked_until > $1 then current_state.blocked_until end,
                case when excluded.blocked_until > $1 then excluded.blocked_until end
              ),
              updated_at = greatest(current_state.updated_at, excluded.updated_at)
      $copy$, v_rel.relname, v_exclude_budget) using v_now;
    else
      raise exception 'Unsupported legacy QR-attempt archive public.% (% columns, % state columns, attempted_at=%, id=%).',
        v_rel.relname, v_column_count, v_state_columns, v_has_attempted_at, v_has_id;
    end if;
  end loop;
end;
$$;

-- Re-declared from 20261108000200 so that, after a rename, the plans resolve
-- against the canonical table rather than the legacy OID. The expired-block
-- case is also re-armed, rather than retaining an already-expired timestamp.
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
      set blocked_until = case
            when blocked_until is null or blocked_until <= v_now
              then v_now + interval '15 minutes'
            else blocked_until
          end,
          updated_at = v_now
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
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.qr_verification_attempts
   where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash;
  if to_regclass('public.qr_verification_attempt_budgets') is not null then
    execute 'delete from public.qr_verification_attempt_budgets where qr_code_id = $1 and ip_hash = $2'
      using p_qr_code_id, p_ip_hash;
  end if;
end;
$$;

revoke all on function public.reserve_qr_verification_attempt(uuid, text) from public;
revoke all on function public.reserve_qr_verification_attempt(uuid, text) from anon;
revoke all on function public.reserve_qr_verification_attempt(uuid, text) from authenticated;
revoke all on function public.clear_qr_verification_attempts(uuid, text) from public;
revoke all on function public.clear_qr_verification_attempts(uuid, text) from anon;
revoke all on function public.clear_qr_verification_attempts(uuid, text) from authenticated;
