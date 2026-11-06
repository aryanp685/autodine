-- ============================================================================
-- AutoDine — migration 20261108000000: guest endpoint attempt budgets
--
-- WHAT THIS ADDS
--
-- A shared, atomic rate-limit counter and an order-placement budget, closing
-- the gap the init migration named out loud: "No rate limiting on place_order.
-- An abusive client can spam orders." The six-digit code path already budgets
-- attempts (reserve_qr_verification_attempt: five per fifteen minutes, per QR
-- and per IP hash); this file gives place_public_order the same protection and
-- gives both a shared counter they can rely on across instances.
--
-- WHY A DATABASE COUNTER
--
-- The deployment runs on serverless instances: in-memory counters reset on
-- every cold start and never agree with each other. One upsert statement with
-- a windowed counter is atomic under concurrency (two callers cannot both read
-- the same count and land on twenty instead of twenty-one), shared by every
-- instance, and costs nothing beyond the database we already pay for.
--
-- WHERE THE GUARD SITS
--
-- Inside place_public_order itself, not in an app-layer wrapper. The function
-- is granted to anon, so a caller who skips our website and talks to PostgREST
-- directly must still pass the budget. It runs AFTER the idempotent-replay
-- check on purpose: a retry of the same guest token returns the order it
-- already made and is never counted as a new attempt.
--
-- THE KEYS (see the guard for thresholds and why)
--
--   po:s:<sha256(session token)>   per table session
--   po:t:<restaurant id>           per restaurant — protects the kitchen
--                                  regardless of which session presses the
--                                  button, and cannot be sidestepped by
--                                  minting fresh sessions
--   po:i:<ip hash>                 per client address, hash only — the raw
--                                  address is never stored here
--
-- THE HONEST LIMIT
--
-- p_ip_hash is optional: direct PostgREST callers do not have to supply one,
-- and the per-table budget is what still binds them. The threshold for that
-- case is the table budget.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The counter. One row per key; the window restarts by itself.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limit_hits (
  key               text primary key,
  window_started_at timestamptz not null,
  count             integer not null
);

alter table public.rate_limit_hits enable row level security;

-- Nothing reads or writes this table except hit_rate_limit() below, which is
-- SECURITY DEFINER. No grants, no policies: direct access is closed.
revoke all on public.rate_limit_hits from anon;
revoke all on public.rate_limit_hits from authenticated;
revoke all on public.rate_limit_hits from service_role;

-- For the purge inside hit_rate_limit(): expired rows are found by window.
create index if not exists rate_limit_hits_window_idx
  on public.rate_limit_hits (window_started_at);

-- ---------------------------------------------------------------------------
-- 2. One atomic bump. Returns whether this attempt is allowed and, when it is
--    not, how many seconds remain in the window.
--
--    language sql, one statement: the insert … on conflict upsert and the
--    decision are the same snapshot, so two simultaneous callers serialize on
--    the row lock and get consecutive counts, not one count twice.
-- ---------------------------------------------------------------------------
create or replace function public.hit_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
) returns table (allowed boolean, retry_after_seconds integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  with purged as (
    delete from public.rate_limit_hits
     where window_started_at < statement_timestamp() - interval '1 day'
    returning 1
  ),
  bumped as (
    insert into public.rate_limit_hits as h (key, window_started_at, count)
    values (p_key, statement_timestamp(), 1)
    on conflict (key) do update
       set window_started_at = case
             when h.window_started_at
                    + make_interval(secs => greatest(p_window_seconds, 1))
                  <= statement_timestamp()
               then statement_timestamp()
             else h.window_started_at
           end,
           count = case
             when h.window_started_at
                    + make_interval(secs => greatest(p_window_seconds, 1))
                  <= statement_timestamp()
               then 1
             else h.count + 1
           end
    returning h.window_started_at, h.count
  )
  select
    (b.count <= p_limit) as allowed,
    (case
       when b.count <= p_limit then 0
       else greatest(1, ceil(extract(epoch from (
              b.window_started_at
                + make_interval(secs => greatest(p_window_seconds, 1))
                - statement_timestamp()
            )))::integer)
     end) as retry_after_seconds
  from bumped b
$$;

revoke all on function public.hit_rate_limit(text, integer, integer) from anon;
revoke all on function public.hit_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. place_public_order, with the budget inside it.
--
--    The signature gains one optional argument (p_ip_hash) and the old
--    five-argument function is dropped, so there is exactly one function and
--    no unguarded overload a direct caller could find. Five-argument callers
--    keep working through the default.
--
--    Thresholds, chosen from what a real guest does, not from round numbers:
--
--      per session   30 per 10 minutes. A table orders a few times per
--                    sitting and a flaky connection retries a few times on
--                    top; thirty is an hour of headroom for a human and a
--                    ceiling for a script.
--      per table     60 per 10 minutes. The kitchen is what spam actually
--                    hurts; six tickets a minute already fills the pass.
--      per ip hash   60 per 10 minutes. One address can be a whole phone
--                    network behind NAT, so this budget is deliberately the
--                    loosest of the three; the table budget is the real wall.
--
--    The error is deliberately identical in shape to every other refusal in
--    this function: a guest-readable sentence, errcode P0001, and a
--    'rate-limited' hint the application can recognise without matching on
--    sentence text. The sentence carries the wait because the guest can act
--    on it.
-- ---------------------------------------------------------------------------
drop function if exists public.place_public_order(text, jsonb, text, text, uuid);

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
  -- After the replay block on purpose: an idempotent retry returns above and
  -- is never counted as a new attempt.
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

comment on function public.place_public_order(text, jsonb, text, text, uuid, text) is
  'Guest order placement: server-priced, idempotent on p_guest_token, and rate '
  'limited per session / per table / per ip hash (see hit_rate_limit). The '
  'rate-limited refusal carries hint ''rate-limited'' and the wait in seconds.';

grant execute on function public.place_public_order(text, jsonb, text, text, uuid, text) to anon;
grant execute on function public.place_public_order(text, jsonb, text, text, uuid, text) to authenticated;
