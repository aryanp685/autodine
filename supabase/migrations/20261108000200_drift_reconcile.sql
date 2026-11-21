-- ============================================================================
-- AutoDine — migration 20261108000200: drift reconciliation
--
-- WHY THIS FILE EXISTS
--
-- The database and the repository ledger have been two parallel histories.
-- Changes made through the console landed in supabase_migrations under their
-- own names, while the repository recorded its own versions of the same work:
-- neither list contained the other. Two concrete holes came out of that:
--
--   1. 20261028000900_guest_scan_confirm.sql was never applied here. The
--      columns and functions it promises (table sessions minted by a scan,
--      held first tickets, table confirmation) were absent from the database,
--      and the kitchen board's own SELECT names columns that did not exist.
--   2. qr_verification_attempts, reserve_qr_verification_attempt and
--      clear_qr_verification_attempts exist in the database but in no
--      repository file — a fresh replay of the ledger could not reproduce the
--      verify path at all.
--
-- WHAT THIS FILE DOES
--
--   Part 1  captures the database-only objects verbatim (the verify budget).
--   Part 2  applies 20261028000900's DDL and functions verbatim; every
--           statement is if-not-exists or create-or-replace, so it is safe on
--           a database that already has some of it.
--   Part 3  re-declares place_public_order with the one line that migration
--           promised and never wrote: the call to stamp_guest_verification.
--           Until now hold_required and table_session_id were never set, and
--           the hold/confirm machinery was dead code.
--
-- Nothing here changes behaviour for a restaurant on 'code' verification:
-- stamp_guest_verification records the session id and leaves hold_required
-- false, which is exactly the pre-existing behaviour.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Part 1 — captured from the database (applied there before the ledger knew).
-- ---------------------------------------------------------------------------

-- qr_verification_attempts: the code-entry budget. Applied to the database
-- first (the verify path has called it since day one); captured here so the
-- repository ledger can be replayed onto an empty database.
create table if not exists public.qr_verification_attempts (
  qr_code_id      uuid not null references public.table_qr_codes(id) on delete cascade,
  ip_hash         text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  attempt_count   integer not null default 0 check (attempt_count >= 0 and attempt_count <= 5),
  window_started_at timestamptz not null default statement_timestamp(),
  blocked_until   timestamptz,
  updated_at      timestamptz not null default statement_timestamp(),
  primary key (qr_code_id, ip_hash)
);

alter table public.qr_verification_attempts enable row level security;
revoke all on public.qr_verification_attempts from anon;
revoke all on public.qr_verification_attempts from authenticated;

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

-- ---------------------------------------------------------------------------
-- Part 2 — 20261028000900_guest_scan_confirm.sql, applied at last.
-- ---------------------------------------------------------------------------

alter table public.restaurants
  add column if not exists guest_verification_mode text not null default 'code'
    check (guest_verification_mode in ('code', 'scan_confirm', 'scan'));

comment on column public.restaurants.guest_verification_mode is
  'How a guest proves they are at a table. code = rotating digits (default), '
  'scan_confirm = scan plus one staff tap per sitting, scan = scan only. '
  'Static QR codes cannot prove presence, so scan and scan_confirm must never '
  'be described as verified.';

-- ---------------------------------------------------------------------------
-- 2. The decision is snapshotted onto the order.
--
-- A setting changed at 20:05 must not retroactively release a ticket that was
-- held at 20:04, nor hold one that had already been accepted. hold_required is
-- therefore written once, when the order is created, and never recomputed.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists hold_required     boolean not null default false,
  add column if not exists confirmed_at      timestamptz,
  add column if not exists confirmed_by      uuid,
  add column if not exists table_session_id  uuid;

comment on column public.orders.hold_required is
  'Written when the order is created: it arrived under a scan mode and no '
  'human had vouched for this table session yet.';
comment on column public.orders.confirmed_at is
  'When staff accepted the held table. NULL means nobody has. Never set by the '
  'guest path.';
comment on column public.orders.table_session_id is
  'The table session the order was placed under, so the board can confirm a '
  'whole sitting in one statement and group a party''s orders.';

-- The board asks for held tickets constantly; the index is partial because
-- held, unconfirmed orders are a tiny fraction of the table.
create index if not exists orders_held_idx
  on public.orders (restaurant_id, placed_at)
  where hold_required and confirmed_at is null;

create index if not exists orders_session_idx
  on public.orders (table_session_id)
  where table_session_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Rate limit for sessions minted by a scan.
--
-- Deliberately a separate table from qr_verification_attempts: that one counts
-- FAILED attempts at a code, this one counts SUCCESSFUL openings of a session.
-- Mixing them would make a busy table look like an attacker, and an attacker
-- look like a busy table.
-- ---------------------------------------------------------------------------
create table if not exists public.table_session_opens (
  id         uuid primary key default gen_random_uuid(),
  qr_code_id uuid not null references public.table_qr_codes(id) on delete cascade,
  ip_hash    text not null,
  opened_at  timestamptz not null default now()
);

create index if not exists table_session_opens_card_idx
  on public.table_session_opens (qr_code_id, opened_at desc);
create index if not exists table_session_opens_ip_idx
  on public.table_session_opens (ip_hash, opened_at desc);

-- No policies: only the security-definer function below touches this table.
alter table public.table_session_opens enable row level security;
revoke all on public.table_session_opens from anon;
revoke all on public.table_session_opens from authenticated;

create or replace function public.open_table_session(
  p_public_token text,
  p_ip_hash      text
) returns table (
  status          text,
  session_token   text,
  restaurant_slug text,
  table_label     text,
  expires_at      timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- The schema caps a session at one hour from creation; 59 minutes leaves the
  -- same minute of headroom the code path uses.
  k_session_minutes constant int := 59;
  k_opens_per_card  constant int := 10;
  k_opens_per_ip    constant int := 20;
  k_window          constant interval := interval '1 hour';

  v_qr        public.table_qr_codes%rowtype;
  v_table     public.dining_tables%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_mode      text;
  v_token     text;
  v_expires   timestamptz;
  v_count     int;
begin
  if p_public_token is null or btrim(p_public_token) !~ '^[A-Za-z0-9_-]{8,128}$' then
    return query select 'unreadable'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return query select 'unreadable'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select q.* into v_qr
    from public.table_qr_codes q
   where q.public_token = btrim(p_public_token)
     and q.revoked_at is null;

  if not found then
    return query select 'revoked'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select r.* into v_restaurant from public.restaurants r where r.id = v_qr.restaurant_id;
  v_mode := coalesce(v_restaurant.guest_verification_mode, 'code');

  -- The whole point of the setting: a restaurant on 'code' cannot be opened by
  -- a scan, no matter what the client asks for.
  if v_mode = 'code' then
    return query select 'code'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select t.* into v_table
    from public.dining_tables t
   where t.id = v_qr.table_id
     and t.restaurant_id = v_qr.restaurant_id
     and t.is_active = true;

  if not found then
    return query select 'revoked'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if not v_restaurant.is_active or not public.restaurant_can_write(v_restaurant.id) then
    return query select 'notserving'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1 from public.menus m
     where m.restaurant_id = v_restaurant.id and m.is_published = true
  ) then
    return query select 'nomenu'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- Two brakes, one per card and one per address. Counted before the insert so
  -- a refusal records nothing.
  select count(*) into v_count
    from public.table_session_opens o
   where o.qr_code_id = v_qr.id
     and o.opened_at > statement_timestamp() - k_window;
  if v_count >= k_opens_per_card then
    return query select 'limited'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select count(*) into v_count
    from public.table_session_opens o
   where o.ip_hash = p_ip_hash
     and o.opened_at > statement_timestamp() - k_window;
  if v_count >= k_opens_per_ip then
    return query select 'limited'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- 64 hex characters: two UUIDv4s with the dashes removed. Same shape and the
  -- same reasoning as verify_table_qr_with_code.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');
  v_expires := statement_timestamp() + make_interval(mins => k_session_minutes);

  insert into public.table_verification_sessions (
    token_hash, restaurant_id, table_id, qr_code_id, expires_at
  ) values (
    encode(sha256(v_token::bytea), 'hex'),
    v_restaurant.id,
    v_table.id,
    v_qr.id,
    v_expires
  );

  insert into public.table_session_opens (qr_code_id, ip_hash) values (v_qr.id, p_ip_hash);

  return query select 'opened'::text, v_token, v_restaurant.slug, v_table.label, v_expires;
end;
$$;

comment on function public.open_table_session(text, text) is
  'Mint a table session from a scanned card, for restaurants whose '
  'guest_verification_mode is scan_confirm or scan. Refuses in code mode. '
  'Rate limited per card and per address. Does not prove presence.';

revoke all on function public.open_table_session(text, text) from public;
revoke all on function public.open_table_session(text, text) from anon;
revoke all on function public.open_table_session(text, text) from authenticated;
grant execute on function public.open_table_session(text, text) to anon;
grant execute on function public.open_table_session(text, text) to authenticated;

create or replace function public.stamp_guest_verification(
  p_code          text,
  p_restaurant_id uuid,
  p_session_token text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session uuid;
  v_mode    text;
  v_held    boolean;
begin
  if p_session_token is null or btrim(p_session_token) = '' then
    return;
  end if;

  select s.id, r.guest_verification_mode
    into v_session, v_mode
    from public.table_verification_sessions s
    join public.restaurants r on r.id = s.restaurant_id
   where s.token_hash = encode(sha256(btrim(p_session_token)::bytea), 'hex')
     and s.expires_at > statement_timestamp()
     and s.restaurant_id = p_restaurant_id
   limit 1;

  if v_session is null then
    return;
  end if;

  -- Held = nothing in this sitting has been vouched for by a human yet. If the
  -- first ticket was confirmed, the second one is not held, which is what
  -- keeps a busy table to one tap; if the first one is still waiting, the
  -- second one waits with it rather than slipping past the check.
  if v_mode = 'scan_confirm' then
    select not exists (
      select 1 from public.orders o
       where o.table_session_id = v_session
         and o.confirmed_at is not null
    ) into v_held;
  else
    v_held := false;
  end if;

  update public.orders o
     set table_session_id = v_session,
         hold_required = v_held
   where o.code = p_code
     and o.restaurant_id = p_restaurant_id
     and o.table_session_id is null;
end;
$$;

revoke all on function public.stamp_guest_verification(text, uuid, text) from public;
revoke all on function public.stamp_guest_verification(text, uuid, text) from anon;
revoke all on function public.stamp_guest_verification(text, uuid, text) from authenticated;

create or replace function public.confirm_table_orders(
  p_table_session_id uuid
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant uuid;
  v_count      integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to confirm a table.' using errcode = 'P0001';
  end if;

  select s.restaurant_id into v_restaurant
    from public.table_verification_sessions s
   where s.id = p_table_session_id;

  if v_restaurant is null then
    raise exception 'That table is no longer on the board.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager', 'kitchen')
  ) then
    raise exception 'Only an owner, a manager or kitchen staff can confirm a table.'
      using errcode = 'P0001';
  end if;

  if not public.restaurant_can_write(v_restaurant) then
    raise exception 'This restaurant is read-only right now, so tickets cannot be confirmed.'
      using errcode = 'P0001';
  end if;

  update public.orders o
     set confirmed_at = statement_timestamp(),
         confirmed_by = auth.uid()
   where o.table_session_id = p_table_session_id
     and o.restaurant_id = v_restaurant
     and o.hold_required
     and o.confirmed_at is null
     and o.prep_status <> 'cancelled';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.reject_table_orders(
  p_table_session_id uuid,
  p_reason           text default null
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant uuid;
  v_count      integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to reject a table.' using errcode = 'P0001';
  end if;

  select s.restaurant_id into v_restaurant
    from public.table_verification_sessions s
   where s.id = p_table_session_id;

  if v_restaurant is null then
    raise exception 'That table is no longer on the board.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager', 'kitchen')
  ) then
    raise exception 'Only an owner, a manager or kitchen staff can reject a table.'
      using errcode = 'P0001';
  end if;

  if not public.restaurant_can_write(v_restaurant) then
    raise exception 'This restaurant is read-only right now, so tickets cannot be rejected.'
      using errcode = 'P0001';
  end if;

  -- Only held, unconfirmed, still-open tickets. A confirmed ticket has already
  -- been vouched for; cancelling it is cancel_order's job, with its own rules.
  update public.orders o
     set prep_status = 'cancelled',
         customer_note = case
           when p_reason is null or btrim(p_reason) = '' then o.customer_note
           else coalesce(o.customer_note || ' · ', '') || 'Not confirmed by staff: ' || btrim(p_reason)
         end
   where o.table_session_id = p_table_session_id
     and o.restaurant_id = v_restaurant
     and o.hold_required
     and o.confirmed_at is null
     and o.prep_status <> 'cancelled';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.confirm_table_orders(uuid) from public;
revoke all on function public.confirm_table_orders(uuid) from anon;
revoke all on function public.confirm_table_orders(uuid) from authenticated;
grant execute on function public.confirm_table_orders(uuid) to authenticated;

revoke all on function public.reject_table_orders(uuid, text) from public;
revoke all on function public.reject_table_orders(uuid, text) from anon;
revoke all on function public.reject_table_orders(uuid, text) from authenticated;
grant execute on function public.reject_table_orders(uuid, text) to authenticated;

-- get_public_order is deliberately NOT re-asserted here: the repository's
-- latest word on it is 20261107000000_storefront_settings.sql (the storefront
-- fix that removed the is_active filter), and the database already carries
-- that version. Copying the older 20261028000900 shape would quietly regress
-- it.

-- ---------------------------------------------------------------------------
-- Part 3 — place_public_order, with the stamp the original promised.
-- ---------------------------------------------------------------------------

create or replace function public.place_public_order(
  p_slug          text,
  p_lines         jsonb,
  p_note          text default null,
  p_session_token text default null,
  p_guest_token   uuid default null,
  p_ip_hash       text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code      text;
  v_restaurant_id uuid;
  v_existing  text;
  v_allowed   boolean;
  v_retry     integer;
begin
  if p_session_token is null or btrim(p_session_token) = '' then
    raise exception 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      using errcode = 'P0001';
  end if;

  select r.id into v_restaurant_id
    from public.restaurants r
   where r.slug = btrim(coalesce(p_slug, ''));

  if p_guest_token is not null and v_restaurant_id is not null then
    select o.code into v_existing
      from public.orders o
     where o.guest_token = p_guest_token
       and o.restaurant_id = v_restaurant_id
     limit 1;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  select a.allowed, a.retry_after_seconds
    into v_allowed, v_retry
    from public.hit_rate_limit(
      'po:s:' || encode(sha256(btrim(p_session_token)::bytea), 'hex'),
      30, 600
    ) a;

  if coalesce(v_allowed, true) then
    select a.allowed, a.retry_after_seconds
      into v_allowed, v_retry
      from public.hit_rate_limit(
        'po:t:' || coalesce(v_restaurant_id::text, 'unknown'),
        60, 600
      ) a;
  end if;

  if coalesce(v_allowed, true) and p_ip_hash is not null and btrim(p_ip_hash) <> '' then
    select a.allowed, a.retry_after_seconds
      into v_allowed, v_retry
      from public.hit_rate_limit('po:i:' || btrim(p_ip_hash), 60, 600) a;
  end if;

  if coalesce(v_allowed, true) is not true then
    raise exception 'Too many orders right now. Please wait % seconds and try again.',
      coalesce(v_retry, 60)
      using errcode = 'P0001', hint = 'rate-limited';
  end if;

  v_code := public.place_public_order_core(p_slug, p_lines, p_note, p_session_token);

  -- Stamp the sitting onto the order: session id always (scan or code), and
  -- hold_required for a scan_confirm sitting nobody has vouched for yet.
  -- This is the call 20261028000900 promised and its wrapper forgot; without
  -- it the hold/confirm machinery is dead code.
  perform public.stamp_guest_verification(v_code, v_restaurant_id, btrim(p_session_token));

  if p_guest_token is not null then
    update public.orders o
       set guest_token = p_guest_token,
           tax_rate_bps_snapshot = coalesce(
             o.tax_rate_bps_snapshot,
             (select r.tax_rate_bps from public.restaurants r where r.id = o.restaurant_id)
           )
     where o.code = v_code
       and o.restaurant_id = v_restaurant_id;
  end if;

  return v_code;

exception
  when unique_violation then
    if p_guest_token is not null then
      select o.code into v_existing
        from public.orders o
       where o.guest_token = p_guest_token
         and (v_restaurant_id is null or o.restaurant_id = v_restaurant_id)
       limit 1;

      if v_existing is not null then
        return v_existing;
      end if;
    end if;
    raise;
end;
$$;
