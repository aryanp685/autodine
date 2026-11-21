-- ============================================================================
-- AutoDine — migration 20261028000900: guest verification without a code
--
-- WHAT THIS ADDS
--
-- A third way for a guest to prove they are at a table, chosen per restaurant:
--
--   code          today's behaviour. Six rotating digits, entered once per
--                 sitting. The default, and unchanged for every existing row.
--   scan_confirm  a scan mints the table session. The FIRST order of a table
--                 sitting is held for one tap from staff on the kitchen board;
--                 once a human has vouched for the table, later orders in the
--                 same session go straight through.
--   scan          a scan mints the session and nothing is held. Fastest, and
--                 the setting says so in the owner's own words.
--
-- WHAT THIS DOES NOT DO
--
-- It does not weaken any existing guard. The session token is still the only
-- credential the guest order path accepts, sessions still expire after 59
-- minutes, prices are still recomputed server-side, tenant isolation and every
-- RLS policy are untouched, and a restaurant on 'code' behaves exactly as it
-- did before this file.
--
-- It is additive: new columns with defaults, two new functions, one replaced
-- function, one repaired read function. Nothing is dropped, no type changes,
-- no data is rewritten. Every existing order keeps hold_required = false,
-- which is "not held".
--
-- THE HONEST LIMIT
--
-- A static printed QR can be photographed. In a scan mode the on-site secret is
-- gone, and what remains is either a human assertion (scan_confirm) or nothing
-- (scan). No claim of "verified presence" may be made for those two modes, in
-- copy or in code comments.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The restaurant's choice.
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

-- ---------------------------------------------------------------------------
-- 4. open_table_session — the only new way a session can exist.
--
-- This is the exact place where verification is relaxed, so it is written to
-- be boring and paranoid: it refuses in 'code' mode, refuses for a dead card,
-- a closed table, a paused restaurant, a read-only restaurant, and a venue
-- with nothing published; it rate-limits per card and per address; and it
-- mints the same hashed, 59-minute session the code path mints, through the
-- same table with the same columns.
--
-- A reused session is NOT returned because only its hash is stored; the guest
-- gets a fresh token on every scan and the old one stays valid until it
-- expires. That is the same behaviour re-scanning a card has today.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. Stamping the decision onto a new order.
--
-- Called by place_public_order after the order exists, because the order id is
-- what place_public_order_core returns. A restaurant on 'code' gets the
-- session id recorded and nothing else; hold_required stays false, which is
-- today's behaviour.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 6. place_public_order — unchanged rules, one extra line.
--
-- The whole body is the 20261027000900 version, verbatim, so this migration is
-- a single readable replacement rather than a patch nobody can diff. The only
-- addition is the call to stamp_guest_verification after the order is written.
-- ---------------------------------------------------------------------------
create or replace function public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null,
  p_guest_token uuid default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code      text;
  v_restaurant_id uuid;
  v_existing  text;
begin
  if p_session_token is null or btrim(p_session_token) = '' then
    raise exception 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      using errcode = 'P0001';
  end if;

  select r.id into v_restaurant_id
    from public.restaurants r
   where r.slug = btrim(coalesce(p_slug, ''));

  -- ---------------------------------------------------------------- replay
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

  v_code := public.place_public_order_core(p_slug, p_lines, p_note, p_session_token);

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

  -- NEW: record which sitting this belongs to, and whether it is held. The
  -- session was already validated by place_public_order_core; this only reads
  -- the restaurant's mode and writes two columns.
  if v_restaurant_id is not null then
    perform public.stamp_guest_verification(v_code, v_restaurant_id, p_session_token);
  end if;

  return v_code;

exception
  when unique_violation then
    -- Two requests with the same attempt key, genuinely at the same time: the
    -- index fired before the read above could see the other row. Return the
    -- winner's code so both callers show one order.
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

-- ---------------------------------------------------------------------------
-- 7. Confirming and rejecting a table's held tickets.
--
-- Both are security definer with their own membership check, because they take
-- a session id rather than a row the caller owns. The guard is the UPDATE's
-- own predicate: `confirmed_at is null` means a second tap, from a second
-- tablet, matches zero rows and says so. Nothing here reads a client-supplied
-- count, role or state.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 8. get_public_order — two more keys, so the guest can be told the truth.
--
-- The guest's status page must not say "in the kitchen" for a ticket nobody has
-- accepted. It reads hold_required and confirmed_at from here.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_order(
  p_slug text,
  p_code text,
  p_token uuid
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'code', o.code,
    'prep_status', o.prep_status,
    'payment_status', o.payment_status,
    'subtotal_paise', o.subtotal_paise,
    'tax_paise', o.tax_paise,
    'total_paise', o.total_paise,
    'customer_note', o.customer_note,
    'placed_at', o.placed_at,
    'hold_required', o.hold_required,
    'confirmed_at', o.confirmed_at,
    'table_label', t.label,
    'lines', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'name', i.name_snapshot,
                 'qty', i.qty,
                 'unit_price_paise', i.unit_price_paise,
                 'is_veg', i.is_veg,
                 'variant', i.variant_snapshot,
                 'addons', i.addons_snapshot
               )
               order by i.sort_order
             )
        from public.order_items i
       where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.dining_tables t on t.id = o.table_id
  where r.slug = p_slug
    and r.is_active
    and o.code = p_code
    and p_token is not null
    and o.guest_token = p_token
  limit 1;
$$;

revoke all on function public.get_public_order(text, text, uuid) from public;
revoke all on function public.get_public_order(text, text, uuid) from anon;
revoke all on function public.get_public_order(text, text, uuid) from authenticated;
grant execute on function public.get_public_order(text, text, uuid) to anon;
grant execute on function public.get_public_order(text, text, uuid) to authenticated;
