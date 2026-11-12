-- Forward-only QR attempt repair. Older deployments used qr_verification_attempts
-- as an event table (id PK, repeated qr_code_id/ip_hash pairs, attempted_at).
-- 20261108000200 added state columns with CREATE TABLE IF NOT EXISTS and then
-- used ON CONFLICT (qr_code_id, ip_hash), which cannot work against that old
-- shape. Do not rewrite that applied migration or add a unique constraint to
-- historical rows whose pair uniqueness has not been established.
--
-- Keep the existing source table and all its rows. Copy its state into a
-- separate pair-keyed budget table, grouping duplicates. The new functions use
-- only this table for concurrency-safe reservation; clear-on-success retains
-- the established behavior of clearing that pair from both stores.
create table if not exists public.qr_verification_attempt_budgets (
  qr_code_id        uuid not null references public.table_qr_codes(id) on delete cascade,
  ip_hash           text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  attempt_count     integer not null default 0 check (attempt_count >= 0 and attempt_count <= 5),
  window_started_at timestamptz not null default statement_timestamp(),
  blocked_until     timestamptz,
  updated_at        timestamptz not null default statement_timestamp(),
  primary key (qr_code_id, ip_hash)
);

alter table public.qr_verification_attempt_budgets enable row level security;
revoke all on public.qr_verification_attempt_budgets from public, anon, authenticated;

-- Recognize only the two evidenced shapes. For the canonical state table,
-- aggregate duplicate pairs conservatively. For the legacy event table, count
-- every event in the active 15-minute window and cap at the existing limit of
-- five. Invalid/null identity keys fail closed rather than being dropped.
do $$
declare
  v_now timestamptz := statement_timestamp();
  v_state_columns integer;
  v_has_attempted_at boolean;
  v_key_columns integer;
  v_invalid boolean;
begin
  if to_regclass('public.qr_verification_attempts') is null then
    raise exception 'Expected public.qr_verification_attempts before the QR compatibility migration.';
  end if;

  select count(*) into v_key_columns
    from pg_catalog.pg_attribute
   where attrelid = 'public.qr_verification_attempts'::regclass
     and attnum > 0 and not attisdropped
     and attname in ('qr_code_id', 'ip_hash');
  if v_key_columns <> 2 then
    raise exception 'Unsupported qr_verification_attempts key shape; expected qr_code_id and ip_hash.';
  end if;

  select count(*) into v_state_columns
    from pg_catalog.pg_attribute
   where attrelid = 'public.qr_verification_attempts'::regclass
     and attnum > 0 and not attisdropped
     and attname in ('attempt_count', 'window_started_at', 'blocked_until', 'updated_at');

  select exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.qr_verification_attempts'::regclass
       and attnum > 0 and not attisdropped and attname = 'attempted_at'
  ) into v_has_attempted_at;

  if v_state_columns = 4 then
    execute $check$
      select exists (
        select 1
          from public.qr_verification_attempts a
         where a.qr_code_id is null
            or a.ip_hash is null
            or a.ip_hash !~ '^[0-9a-f]{64}$'
            or a.attempt_count is null
            or a.attempt_count < 0
            or a.attempt_count > 5
            or a.window_started_at is null
            or a.updated_at is null
            or not exists (select 1 from public.table_qr_codes q where q.id = a.qr_code_id)
      )
    $check$ into v_invalid;
    if v_invalid then
      raise exception 'Invalid identity or rate-limit state in qr_verification_attempts; refusing to discard it.';
    end if;

    execute $copy$
      insert into public.qr_verification_attempt_budgets as b (
        qr_code_id, ip_hash, attempt_count, window_started_at, blocked_until, updated_at
      )
      select a.qr_code_id,
             a.ip_hash,
             least(5::bigint, coalesce(sum(a.attempt_count) filter (
               where a.window_started_at > $1 - interval '15 minutes'
             ), 0))::integer,
             coalesce(min(a.window_started_at) filter (
               where a.window_started_at > $1 - interval '15 minutes'
             ), $1 - interval '16 minutes'),
             max(a.blocked_until),
             $1
        from public.qr_verification_attempts a
       where a.window_started_at > $1 - interval '15 minutes'
          or a.blocked_until > $1
       group by a.qr_code_id, a.ip_hash
      on conflict (qr_code_id, ip_hash) do nothing
    $copy$ using v_now;
  elsif v_state_columns = 0 and v_has_attempted_at then
    execute $check$
      select exists (
        select 1
          from public.qr_verification_attempts a
         where a.qr_code_id is null
            or a.ip_hash is null
            or a.ip_hash !~ '^[0-9a-f]{64}$'
            or a.attempted_at is null
            or not exists (select 1 from public.table_qr_codes q where q.id = a.qr_code_id)
      )
    $check$ into v_invalid;
    if v_invalid then
      raise exception 'Invalid identity or timestamp in legacy qr_verification_attempts; refusing to discard it.';
    end if;

    execute $copy$
      insert into public.qr_verification_attempt_budgets as b (
        qr_code_id, ip_hash, attempt_count, window_started_at, blocked_until, updated_at
      )
      select a.qr_code_id,
             a.ip_hash,
             least(5::bigint, count(*) filter (
               where a.attempted_at > $1 - interval '15 minutes'
             ))::integer,
             coalesce(min(a.attempted_at) filter (
               where a.attempted_at > $1 - interval '15 minutes'
             ), $1 - interval '16 minutes'),
             null,
             $1
        from public.qr_verification_attempts a
       where a.attempted_at > $1 - interval '15 minutes'
       group by a.qr_code_id, a.ip_hash
      on conflict (qr_code_id, ip_hash) do nothing
    $copy$ using v_now;
  else
    raise exception 'Unsupported partial qr_verification_attempts state shape (% state columns, attempted_at=%).',
      v_state_columns, v_has_attempted_at;
  end if;
end;
$$;

create or replace function public.reserve_qr_verification_attempt(
  p_qr_code_id uuid,
  p_ip_hash text
) returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.qr_verification_attempt_budgets%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit fingerprint.' using errcode = '22023';
  end if;

  insert into public.qr_verification_attempt_budgets(qr_code_id, ip_hash)
  values (p_qr_code_id, p_ip_hash)
  on conflict (qr_code_id, ip_hash) do nothing;

  select * into v_row
    from public.qr_verification_attempt_budgets b
   where b.qr_code_id = p_qr_code_id
     and b.ip_hash = p_ip_hash
   for update;

  if not found then
    raise exception 'Unknown table QR code.' using errcode = 'P0002';
  end if;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return query select false, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;

  if v_row.window_started_at <= v_now - interval '15 minutes' then
    update public.qr_verification_attempt_budgets
       set attempt_count = 1,
           window_started_at = v_now,
           blocked_until = null,
           updated_at = v_now
     where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash;
    return query select true, 0;
    return;
  end if;

  if v_row.attempt_count >= 5 then
    update public.qr_verification_attempt_budgets
       set blocked_until = coalesce(blocked_until, v_now + interval '15 minutes'),
           updated_at = v_now
     where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash
     returning public.qr_verification_attempt_budgets.blocked_until into v_row.blocked_until;
    return query select false, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;

  update public.qr_verification_attempt_budgets
     set attempt_count = attempt_count + 1,
         updated_at = v_now
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
  delete from public.qr_verification_attempt_budgets
   where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash;
  delete from public.qr_verification_attempts
   where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash;
end;
$$;

revoke all on function public.reserve_qr_verification_attempt(uuid, text) from public;
revoke all on function public.reserve_qr_verification_attempt(uuid, text) from anon;
revoke all on function public.reserve_qr_verification_attempt(uuid, text) from authenticated;
revoke all on function public.clear_qr_verification_attempts(uuid, text) from public;
revoke all on function public.clear_qr_verification_attempts(uuid, text) from anon;
revoke all on function public.clear_qr_verification_attempts(uuid, text) from authenticated;

comment on table public.qr_verification_attempt_budgets is
  'Concurrency-safe per-QR/per-IP attempt state. Historical attempts remain in qr_verification_attempts; this table owns the active budget after the forward compatibility migration.';
