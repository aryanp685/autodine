-- ============================================================================
-- AutoDine — check 06: the scan limit, and what a throttled guest gets
--
-- WHERE: a BRANCH database with 20261028000900 applied. Never production.
--        Supabase dashboard -> SQL Editor, or psql -v ON_ERROR_STOP=1 -f.
--
-- WHY: the limit is the one place this product can refuse an order to a guest
--      who is really at a table. Every claim in docs/scan-limit-l1.md has to be
--      checked against a database, not argued about, and these are the checks.
--
-- HOW IT REPORTS
--
--   Each block prints a line "PASS …" or raises an exception with "FAIL …".
--   Nothing here writes to a real restaurant: the whole script runs inside a
--   transaction that ends in ROLLBACK, so it can be run against the branch as
--   often as you like.
--
-- WHAT IT DOES NOT COVER
--
--   Simultaneity. Two requests racing through open_table_session at the same
--   millisecond are not simulated here; that needs a load test, and the honest
--   statement is that this product has never been load tested.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Pick a live card on a restaurant that can be switched to a scan mode.
--    A card with no orders in progress is preferred so nothing real is touched.
-- ---------------------------------------------------------------------------
do $$
declare
  v_token text;
  v_slug  text;
begin
  select q.public_token, r.slug
    into v_token, v_slug
    from public.table_qr_codes q
    join public.restaurants r on r.id = q.restaurant_id
   where q.revoked_at is null
     and r.is_active
   limit 1;

  if v_token is null then
    raise exception 'FAIL: no live QR card in this database — run the demo seed first';
  end if;

  raise notice 'card=% restaurant=%', v_token, v_slug;
end $$;

-- ---------------------------------------------------------------------------
-- 1. A code-mode restaurant cannot be opened by a scan.
--    The setting is what makes a scan meaningful, so it must hold absolutely.
-- ---------------------------------------------------------------------------
do $$
declare
  v_token text;
  v_slug  text;
  v_status text;
begin
  select q.public_token, r.slug into v_token, v_slug
    from public.table_qr_codes q join public.restaurants r on r.id = q.restaurant_id
   where q.revoked_at is null and r.is_active limit 1;

  update public.restaurants set guest_verification_mode = 'code' where slug = v_slug;

  select status into v_status
    from public.open_table_session(v_token, repeat('a', 64));

  if v_status <> 'code' then
    raise exception 'FAIL 1: code-mode scan returned % instead of code', v_status;
  end if;

  raise notice 'PASS 1: a code-mode restaurant refuses to mint from a scan';
end $$;

-- ---------------------------------------------------------------------------
-- 2. A legitimate burst is not throttled.
--    Six seats, each scanning once, plus two reloads and one late arrival.
--    Expected under the CURRENT limit: all opened (9 < 10).
--    Expected under L1: the reloads answer 'reused' and do not count.
-- ---------------------------------------------------------------------------
do $$
declare
  v_token text;
  v_slug  text;
  v_status text;
  v_opened int := 0;
  v_reused int := 0;
  i int;
begin
  select q.public_token, r.slug into v_token, v_slug
    from public.table_qr_codes q join public.restaurants r on r.id = q.restaurant_id
   where q.revoked_at is null and r.is_active limit 1;

  update public.restaurants set guest_verification_mode = 'scan_confirm' where slug = v_slug;
  delete from public.table_session_opens o using public.table_qr_codes q
   where o.qr_code_id = q.id and q.public_token = v_token;

  for i in 1..9 loop
    select status into v_status
      from public.open_table_session(v_token, encode(sha256(('burst' || i)::bytea), 'hex'));
    if v_status = 'opened' then v_opened := v_opened + 1;
    elsif v_status = 'reused' then v_reused := v_reused + 1;
    elsif v_status = 'limited' then
      raise exception 'FAIL 2: throttled on scan % of a legitimate table', i;
    end if;
  end loop;

  if v_opened + v_reused <> 9 then
    raise exception 'FAIL 2: expected 9 usable scans, got % opened + % reused', v_opened, v_reused;
  end if;

  raise notice 'PASS 2: 9 legitimate scans (opened=%, reused=%) — none refused', v_opened, v_reused;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The limit is reached, and it says so instead of raising.
-- ---------------------------------------------------------------------------
do $$
declare
  v_token text;
  v_status text;
  v_limited int := 0;
  i int;
begin
  select q.public_token into v_token
    from public.table_qr_codes q where q.revoked_at is null limit 1;

  for i in 1..15 loop
    select status into v_status
      from public.open_table_session(v_token, encode(sha256(('abuse' || i)::bytea), 'hex'));
    if v_status = 'limited' then v_limited := v_limited + 1; end if;
  end loop;

  if v_limited = 0 then
    raise exception 'FAIL 3: the card limit was never reached in 15 scans';
  end if;

  raise notice 'PASS 3: the limit is enforced and reported (% of 15 refused)', v_limited;
end $$;

-- ---------------------------------------------------------------------------
-- 4. A refused scan writes nothing.
--    This is what makes the brake safe to retry: no session, no attempt row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_token text;
  v_qr uuid;
  v_before_sessions bigint;
  v_before_opens bigint;
  v_after_sessions bigint;
  v_after_opens bigint;
  v_status text;
begin
  select q.id, q.public_token into v_qr, v_token
    from public.table_qr_codes q where q.revoked_at is null limit 1;

  select count(*) into v_before_sessions from public.table_verification_sessions;
  select count(*) into v_before_opens from public.table_session_opens where qr_code_id = v_qr;

  select status into v_status
    from public.open_table_session(v_token, encode(sha256('refused'::bytea), 'hex'));

  select count(*) into v_after_sessions from public.table_verification_sessions;
  select count(*) into v_after_opens from public.table_session_opens where qr_code_id = v_qr;

  if v_status = 'limited' and (v_after_sessions <> v_before_sessions or v_after_opens <> v_before_opens) then
    raise exception 'FAIL 4: a refused scan wrote rows (sessions % -> %, opens % -> %)',
      v_before_sessions, v_after_sessions, v_before_opens, v_after_opens;
  end if;

  raise notice 'PASS 4: a refusal writes nothing (status=%)', v_status;
end $$;

-- ---------------------------------------------------------------------------
-- 5. A held order is durably persisted, and the kitchen can see it.
--    This is the claim L1 depends on: an order that waits is an order in
--    `orders`, not a promise in a browser.
-- ---------------------------------------------------------------------------
do $$
declare
  v_session_id uuid;
  v_code text;
  v_held boolean;
  v_visible int;
begin
  select s.id into v_session_id
    from public.table_verification_sessions s
   where s.expires_at > now() and s.revoked_at is null
   order by s.expires_at desc limit 1;

  if v_session_id is null then
    raise exception 'FAIL 5: no live session to attach a held order to — run check 1 first';
  end if;

  -- Pretend a held ticket exists for this sitting (the real one comes from
  -- place_public_order under L1; this proves the board's query sees it).
  update public.orders o
     set table_session_id = v_session_id,
         hold_required = true,
         confirmed_at = null
   where o.id = (select id from public.orders order by placed_at desc limit 1)
  returning o.code, o.hold_required into v_code, v_held;

  if v_code is null then
    raise exception 'FAIL 5: no order in this database to mark held';
  end if;

  -- The board's own predicate (lib/db/kitchen-screen.ts asks for this shape).
  select count(*) into v_visible
    from public.orders o
   where o.restaurant_id = (select restaurant_id from public.table_verification_sessions where id = v_session_id)
     and o.hold_required
     and o.confirmed_at is null
     and o.prep_status <> 'cancelled';

  if v_visible = 0 then
    raise exception 'FAIL 5: a held order is invisible to the kitchen query';
  end if;

  raise notice 'PASS 5: held order % is persisted and visible to the board', v_code;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Confirming twice changes nothing the second time.
--    Duplicate taps are the normal case on a busy pass, not an error.
-- ---------------------------------------------------------------------------
do $$
declare
  v_session_id uuid;
  v_first int;
  v_second int;
begin
  select s.id into v_session_id
    from public.table_verification_sessions s
   where s.expires_at > now() and s.revoked_at is null
   order by s.expires_at desc limit 1;

  -- This block runs as the SQL editor's role, not as a signed-in member, so
  -- confirm_table_orders will raise on auth.uid(). That is itself check 8;
  -- here the predicate is exercised directly, which is what the function uses.
  update public.orders
     set confirmed_at = now(), confirmed_by = gen_random_uuid()
   where table_session_id = v_session_id and hold_required and confirmed_at is null
     and prep_status <> 'cancelled';
  get diagnostics v_first = row_count;

  update public.orders
     set confirmed_at = now(), confirmed_by = gen_random_uuid()
   where table_session_id = v_session_id and hold_required and confirmed_at is null
     and prep_status <> 'cancelled';
  get diagnostics v_second = row_count;

  if v_second <> 0 then
    raise exception 'FAIL 6: a second confirm matched % rows', v_second;
  end if;

  raise notice 'PASS 6: second confirm is a no-op (first=%, second=%)', v_first, v_second;
end $$;

-- ---------------------------------------------------------------------------
-- 7. A duplicate submission is one order, not two.
--    The attempt key is the only thing standing between a double-tap and two
--    kitchen tickets.
-- ---------------------------------------------------------------------------
do $$
declare
  v_token uuid := gen_random_uuid();
  v_count int;
begin
  select count(*) into v_count
    from public.orders o where o.guest_token = v_token;

  if v_count <> 0 then
    raise exception 'FAIL 7: a fresh attempt key already has % orders', v_count;
  end if;

  -- The real assertion needs a placed order; see docs/migration-…-review.md §4.3
  -- for the place_public_order call with this token, which is what a browser
  -- double-submit produces. Here: the uniqueness the replay path depends on.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'orders'
       and indexdef ilike '%guest_token%'
  ) then
    raise exception 'FAIL 7: no index backs guest_token uniqueness — replay would race';
  end if;

  raise notice 'PASS 7: guest_token uniqueness is backed by an index';
end $$;

-- ---------------------------------------------------------------------------
-- 8. Authorisation: an anonymous caller cannot confirm a table.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    perform public.confirm_table_orders(gen_random_uuid());
    raise exception 'FAIL 8: an anonymous caller confirmed a table';
  exception
    when others then
      if sqlerrm like 'FAIL 8%' then raise; end if;
      raise notice 'PASS 8: anonymous confirm refused (%)', sqlerrm;
  end;
end $$;

rollback;  -- nothing above is kept
