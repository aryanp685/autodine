-- ============================================================================
-- AutoDine — migration 20261108000500: one table, one active order session
--
-- WHY THIS EXISTS
--
-- The redesign's core rule is "ONE TABLE = ONE ACTIVE ORDER SESSION = ONE
-- CONSOLIDATED BILL": from the first order until the restaurant closes the
-- tab at checkout, every ticket at that table joins one sitting.
--
-- The closest thing that existed -- orders.table_session_id -- is the
-- VERIFICATION session (table_verification_sessions), and that is the wrong
-- life cycle for a bill: it expires with the QR window (about an hour). A
-- two-hour lunch where guests re-verify once would split into two "sessions"
-- and two bills. The comment on that column always described the intent
-- ("group a party's orders"); this table gives the intent its own entity with
-- the right life: opened by the FIRST ORDER at the table, closed only by the
-- restaurant at checkout (Phase 8), immune to QR re-verifications.
--
-- WHAT THIS ADDS
--
--   1. order_sessions -- the sitting itself. One OPEN row per table, enforced
--      by a partial unique index, so concurrent first orders race safely:
--      the loser of the insert joins the winner's row via ON CONFLICT.
--   2. orders.order_session_id -- which sitting the ticket belongs to.
--      Nullable and ON DELETE SET NULL: order history survives anything that
--      happens to the grouping.
--   3. place_public_order attaches every new ticket to the table's open
--      session (or opens one). A CLOSED session is never joined: the next
--      order at that table opens a fresh sitting, which is exactly what
--      "the table becomes available for a new session" means. So a closed
--      session can no longer receive orders -- they land on the new one.
--
-- WHAT THIS DOES NOT DO
--
--   No UI yet: Phase 4 (dashboard cards) reads this and Phase 6 (the
--   consolidated invoice) bills it. No backfill: existing orders keep
--   order_session_id NULL and old bills are unaffected. The verification
--   session and its hold/confirm machinery are untouched -- stamping runs
--   exactly as before.
--
-- IDEMPOTENCY, AND WHY THE RACE BELOW IS SAFE
--
-- place_public_order is idempotent on p_guest_token (20261027000900): the
-- replay check returns the existing code before any of this runs. The
-- concurrency case -- two posts of one attempt landing together -- is
-- resolved by the unique index on orders.guest_token: the second writer
-- raises unique_violation, and the EXCEPTION block rolls the whole function
-- body back (plpgsql runs it in a subtransaction) before returning the first
-- writer's code. That is why the session attach below may freely UPDATE the
-- order after the insert: on the losing path there is no order left to
-- update. Do not "simplify" this by moving work outside the block or
-- committing mid-function -- that is the refactor that would leave ghost
-- duplicate orders behind.
--
-- APPLYING THIS
--
-- Additive: one table, one column, one index pair, one function
-- replacement (same signature). The running app notices nothing until the
-- phases that read the column ship.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The sitting.
-- ---------------------------------------------------------------------------
create table if not exists public.order_sessions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id      uuid not null references public.dining_tables(id) on delete cascade,
  opened_at     timestamptz not null default now(),
  -- Written by the checkout flow (Phase 8). Until then a sitting stays open.
  closed_at     timestamptz,
  closed_by     uuid references public.profiles(id),
  status        text not null default 'open'
                check (status in ('open', 'closed'))
);

-- One open sitting per table. This partial unique index is also the race
-- arbiter for the open-or-join upsert in place_public_order.
create unique index if not exists order_sessions_open_unique
  on public.order_sessions (table_id)
  where status = 'open';

create index if not exists order_sessions_restaurant_idx
  on public.order_sessions (restaurant_id, opened_at desc);

-- RLS: deny by default. Staff may read their own restaurant's sittings;
-- everything else goes through security-definer functions.
alter table public.order_sessions enable row level security;
revoke all on public.order_sessions from anon;
revoke all on public.order_sessions from authenticated;
revoke all on public.order_sessions from service_role;

drop policy if exists order_sessions_staff on public.order_sessions;
create policy order_sessions_staff on public.order_sessions
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
     where m.restaurant_id = order_sessions.restaurant_id
       and m.user_id = auth.uid()
  ));

-- Policies filter rows; they do not grant table privileges. Staff screens use
-- the user's authenticated client, so give it SELECT only (never write access).
grant select on public.order_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Which sitting a ticket joined.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists order_session_id uuid
    references public.order_sessions(id) on delete set null;

comment on column public.orders.order_session_id is
  'The sitting (order session) this ticket belongs to: one per table, opened by its first order and closed only at checkout. Distinct from table_session_id, which is the short-lived QR verification session.';

create index if not exists orders_order_session_idx
  on public.orders (order_session_id)
  where order_session_id is not null;

-- ---------------------------------------------------------------------------
-- 3. place_public_order: every new ticket joins the table's open sitting.
--
--    The body is the 20261108000200 version unchanged except for step 4.
--    Signatures and grants are exactly as they were: one function, no
--    unguarded overload, anon may call it and nothing else.
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
  v_table_id  uuid;
  v_order_session_id uuid;
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

  -- ----------------------------------------------------------- rate limit
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

  -- Stamp the verification sitting onto the order: session id always (scan or
  -- code), and hold_required for a scan_confirm sitting nobody has vouched
  -- for yet.
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

  -- 4. The sitting: one open order session per table. The upsert opens one
  --    for a table's first order and joins the existing one afterwards; a
  --    closed sitting is never joined, so the next order after checkout
  --    starts a fresh bill exactly as the flow promises.
  select o.table_id into v_table_id
    from public.orders o
   where o.code = v_code
     and o.restaurant_id = v_restaurant_id;

  if v_table_id is not null then
    insert into public.order_sessions (restaurant_id, table_id)
    values (v_restaurant_id, v_table_id)
    on conflict (table_id) where status = 'open'
    do update set table_id = excluded.table_id
    returning id into v_order_session_id;

    update public.orders o
       set order_session_id = v_order_session_id
     where o.code = v_code
       and o.restaurant_id = v_restaurant_id
       and o.order_session_id is null;
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

comment on function public.place_public_order(text, jsonb, text, text, uuid, text) is
  'Guest order placement: server-priced, idempotent on p_guest_token, rate '
  'limited per session / per table / per ip hash, and attached to the table''s '
  'open order session (one consolidated bill per sitting).';
