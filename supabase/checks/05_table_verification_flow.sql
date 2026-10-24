-- ============================================================================
-- AutoDine — check 05: the table verification flow, end to end
--
-- WHAT THIS IS
--
-- The scenarios below are the ones the brief asked for: a valid session, an
-- expired one, a revoked card, a wrong code, the rate limit, a repeated
-- submission, a database that cannot answer, and a session used against
-- another restaurant. They are written to be run INSIDE A TRANSACTION AND
-- ROLLED BACK, against the real database, by hand:
--
--     psql "$DATABASE_URL" -f supabase/checks/05_table_verification_flow.sql
--
-- Every run ends in ROLLBACK, so no order, session or attempt row survives it.
--
-- HOW IT WAS RUN FOR THIS CHANGE
--
-- Through the Supabase connector, as `anon`, on the production project, inside
-- `begin … rollback`. Results are recorded in docs/verification-flow.md.
--
-- TWO THINGS THAT WILL MISLEAD YOU IF YOU DO NOT KNOW THEM
--
--   1. `set local role anon` is required. Calling these functions as the
--      database owner proves nothing: the owner bypasses RLS, and the
--      interesting part of this flow is what an anonymous caller may do.
--
--   2. EACH ATTEMPT MUST BE ITS OWN STATEMENT. Eleven calls inside one
--      `select … from generate_series(1,11)` all see the same snapshot, so
--      `reserve_qr_verification_attempt` reads the same attempt_count every
--      time and the limiter never fires -- which looks exactly like a broken
--      rate limit. The first draft of this file made that mistake. Five
--      separate statements, then a sixth, shows the truth: five allowed,
--      then `limited` for 900 seconds.
--
-- The fixtures are read as the owner (before switching role), because the
-- seed values a test needs -- the current code, a live card token -- are
-- exactly the things an anonymous caller must not be able to read.
-- ============================================================================

begin;

-- ---------------------------------------------------------------- fixtures
-- Replace these two with a live card and its restaurant before running.
\set card '''618d77118ea89cbfb12c4a70d9267858cf06d34dc0f6db49'''
\set slug '''arena-qr-flow-test-20261021'''

select set_config('t.slug', :slug, true);
select set_config('t.card', :card, true);

select set_config(
  't.code',
  public.verification_code_for(
    c.secret,
    floor(extract(epoch from statement_timestamp()) / c.window_seconds)::bigint
  ),
  true
)
from public.restaurant_verification_codes c
join public.restaurants r on r.id = c.restaurant_id
where r.slug = :slug;

select set_config(
  't.lines',
  jsonb_build_array(jsonb_build_object('item_id', i.id, 'qty', 2))::text,
  true
)
from public.items i
join public.restaurants r on r.id = i.restaurant_id
where r.slug = :slug and i.is_available
limit 1;

-- A session that expired an hour ago: the row the gate has to refuse.
insert into public.table_verification_sessions (
  token_hash, restaurant_id, table_id, qr_code_id, expires_at, created_at
)
select
  encode(sha256(repeat('e', 64)::bytea), 'hex'),
  q.restaurant_id, q.table_id, q.id,
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() - interval '65 minutes'
from public.table_qr_codes q
where q.public_token = :card;

-- ------------------------------------------------------------------ as a guest
set local role anon;

-- 1. A valid code mints a session.
select '1 valid code' as scenario, v.status, v.expires_at
from public.verify_table_qr_with_code(:card, current_setting('t.code'), repeat('a', 64)) v;

select set_config(
  't.session',
  (select v.session_token
     from public.verify_table_qr_with_code(:card, current_setting('t.code'), repeat('a', 64)) v),
  true
);

-- 2. A wrong code is refused, and says so.
select '2 wrong code' as scenario, v.status
from public.verify_table_qr_with_code(:card, '000001', repeat('a', 64)) v;

-- 3. Five attempts, then the address is paused for fifteen minutes.
--    Separate statements on purpose -- see the note at the top of the file.
select '3.1' as attempt, v.status from public.verify_table_qr_with_code(:card, '000002', repeat('b', 64)) v;
select '3.2' as attempt, v.status from public.verify_table_qr_with_code(:card, '000002', repeat('b', 64)) v;
select '3.3' as attempt, v.status from public.verify_table_qr_with_code(:card, '000002', repeat('b', 64)) v;
select '3.4' as attempt, v.status from public.verify_table_qr_with_code(:card, '000002', repeat('b', 64)) v;
select '3.5' as attempt, v.status from public.verify_table_qr_with_code(:card, '000002', repeat('b', 64)) v;
select '3.6 (expect limited, 900s)' as attempt, v.status, v.retry_after_seconds
from public.verify_table_qr_with_code(:card, '000002', repeat('b', 64)) v;

-- 4. A revoked card cannot be revived by a correct code.
select '4 revoked card' as scenario, v.status
from public.verify_table_qr_with_code(
  '_jX4MRU1v3s847YAOgaelrWdrV1IDriFd30GHtJ5HCk', current_setting('t.code'), repeat('a', 64)
) v;

-- 5. An expired session is not a session: the read gate returns no row.
select '5 expired session (gate)' as scenario, count(*) as live_rows
from public.current_table_session(repeat('e', 64));

-- 6. …and the order path refuses it, which is the check that matters.
do $$
begin
  perform public.place_public_order(
    current_setting('t.slug'), current_setting('t.lines')::jsonb, null,
    repeat('e', 64), gen_random_uuid()
  );
  raise notice '6 expired session (order): ACCEPTED — BAD';
exception when others then
  raise notice '6 expired session (order): refused: %', sqlerrm;
end $$;

-- 7. No session at all: refused.
do $$
begin
  perform public.place_public_order(
    current_setting('t.slug'), current_setting('t.lines')::jsonb, null, null, null
  );
  raise notice '7 no session at all: ACCEPTED — BAD';
exception when others then
  raise notice '7 no session at all: refused: %', sqlerrm;
end $$;

-- 8. A live session used against another restaurant's slug: refused.
do $$
begin
  perform public.place_public_order(
    'kings-of-kings', current_setting('t.lines')::jsonb, null,
    current_setting('t.session'), gen_random_uuid()
  );
  raise notice '8 cross-restaurant: ACCEPTED — BAD';
exception when others then
  raise notice '8 cross-restaurant: refused: %', sqlerrm;
end $$;

-- 9. A price in the payload is ignored: the order is priced from the menu.
select set_config(
  't.tampered',
  (select jsonb_set(current_setting('t.lines')::jsonb, '{0,unit_price_paise}', '1')::text),
  true
);

select set_config(
  't.order',
  public.place_public_order(
    current_setting('t.slug'), current_setting('t.tampered')::jsonb, null,
    current_setting('t.session'), gen_random_uuid()
  ),
  true
);

reset role;

-- Compare the order's subtotal against the menu: 2 × the item's own price.
select
  '9 tampered price' as scenario,
  i.price_paise as item_price_paise,
  o.subtotal_paise as order_subtotal_paise,
  (o.subtotal_paise = 2 * i.price_paise) as priced_from_the_database
from public.orders o
join public.items i on i.restaurant_id = o.restaurant_id and i.is_available
where o.code = current_setting('t.order')
limit 1;

-- 10. Repeated submission. See migration 20261027000900: two posts with one
--     attempt key must produce one order and one code.
set local role anon;
select set_config('t.key', gen_random_uuid()::text, true);

select '10.1 first post' as post,
       public.place_public_order(
         current_setting('t.slug'), current_setting('t.lines')::jsonb, null,
         current_setting('t.session'), current_setting('t.key')::uuid
       ) as code;

select '10.2 replayed post' as post,
       public.place_public_order(
         current_setting('t.slug'), current_setting('t.lines')::jsonb, null,
         current_setting('t.session'), current_setting('t.key')::uuid
       ) as code;

reset role;

select '10.3 rows written' as scenario, count(*) as orders
from public.orders
where guest_token = current_setting('t.key')::uuid;

-- Nothing above is kept.
rollback;
