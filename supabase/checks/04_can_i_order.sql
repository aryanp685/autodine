-- ============================================================================
-- AutoDine — "Could not place that order." Why?
--
-- Run this in the Supabase SQL editor with the slug set below. It replays the
-- exact sequence a guest's phone triggers -- verify a table, then place an
-- order -- and reports the step that fails, in the database's own words.
--
-- IT ENDS BY RAISING AN ERROR, ON PURPOSE
--
--   The last thing it does is raise, with the whole verdict in the message.
--   That is the only reliable way to (a) get a multi-line answer out of the SQL
--   editor and (b) make sure nothing it did survives: the raise rolls the
--   transaction back, so the test order and the test table session are gone the
--   moment you read the message. A diagnostic that leaves a fake order on the
--   kitchen board is worse than no diagnostic.
--
--   So a red error at the end is the good outcome and it does NOT mean the
--   script is broken. Read the message.
--
-- WHAT IT CHECKS, IN THE ORDER THE GUEST HITS THEM
--
--   1. the ordering function exists (right overload, executable by a guest)
--   2. the write gate says this restaurant may take an order
--   3. a published menu with a dish in it exists
--   4. a live table card exists and its code verifies
--   5. place_public_order() accepts it
--
-- Nothing is written permanently. Nothing is charged.
-- ============================================================================

do $$
declare
  v_slug       text := 'kings-of-kings';   -- << your slug
  v_rid        uuid;
  v_token      text;
  v_code       text;
  v_session    text;
  v_item       uuid;
  v_lines      jsonb;
  v_order      text;
  v_report     text := '';
  v_gate       boolean;
  v_has_fn     boolean;
  v_guest_fn   boolean;
begin
  -- ------------------------------------------------------------- 1. plumbing
  select r.id into v_rid from public.restaurants r where r.slug = btrim(v_slug);
  if v_rid is null then
    raise exception 'RESULT: no restaurant with slug "%". Check the slug first.', v_slug;
  end if;

  -- The guest calls the five-argument form. If the migration that adds
  -- p_guest_token was never applied, PostgREST answers "function not found"
  -- and the app can only say "please try again", which cannot work.
  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'place_public_order'
      and p.pronargs = 5
  ) into v_has_fn;

  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'place_public_order_core'
  ) into v_guest_fn;

  v_report := v_report || format('1. place_public_order(5 args): %s | core: %s%s',
    case when v_has_fn then 'present' else 'MISSING -- apply migrations 20261023000900' end,
    case when v_guest_fn then 'present' else 'MISSING' end,
    chr(10));

  if not v_has_fn then
    raise exception 'RESULT:%', v_report;
  end if;

  -- ------------------------------------------------ 2. the restaurant's gate
  begin
    select public.restaurant_can_write(v_rid) into v_gate;
  exception when others then
    v_report := v_report || format('2. write gate: RAISED %s -- %s%s', sqlstate, sqlerrm, chr(10));
    raise exception 'RESULT:%', v_report;
  end;

  v_report := v_report || format('2. write gate for "%": %s%s',
    v_slug,
    case when v_gate then 'true -- may take orders'
         else 'FALSE -- the order is refused here. Trial expired, or plan_expires_at in the past. See the note at the bottom.' end,
    chr(10));

  -- ------------------------------------------------------ 3. a dish to order
  select i.id into v_item
    from public.items i
    join public.categories c on c.id = i.category_id
    join public.menus m on m.id = c.menu_id
   where i.restaurant_id = v_rid
     and m.is_published
     and i.is_available
   order by i.sort_order
   limit 1;

  v_report := v_report || format('3. first orderable dish: %s%s',
    coalesce(v_item::text, 'NONE -- no available dish in a published menu'),
    chr(10));

  if v_item is null then
    raise exception 'RESULT:%', v_report;
  end if;

  v_lines := jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1));

  -- --------------------------------------- 4. verify a live card, as a guest
  select q.public_token into v_token
    from public.table_qr_codes q
    join public.dining_tables t on t.id = q.table_id
   where t.restaurant_id = v_rid
     and q.revoked_at is null
   order by t.label
   limit 1;

  if v_token is null then
    v_report := v_report || format('4. table card: NONE live for this restaurant%s', chr(10));
    raise exception 'RESULT:%', v_report;
  end if;

  select public.verification_code_for(
           c.secret,
           floor(extract(epoch from statement_timestamp()) / c.window_seconds)::bigint
         )
    into v_code
    from public.restaurant_verification_codes c
   where c.restaurant_id = v_rid;

  if v_code is null then
    v_report := v_report || format('4. table card: no verification secret for this restaurant%s', chr(10));
    raise exception 'RESULT:%', v_report;
  end if;

  begin
    select s.session_token into v_session
      from public.verify_table_qr_with_code(v_token, v_code, 'diagnostic') s
     where s.status = 'ok';
  exception when others then
    v_report := v_report || format('4. verify_table_qr_with_code: RAISED %s -- %s%s',
      sqlstate, sqlerrm, chr(10));
    raise exception 'RESULT:%', v_report;
  end;

  v_report := v_report || format('4. table verify: %s%s',
    case when v_session is null then 'no session returned (wrong code, or the card was revoked between the two statements)'
         else 'ok' end,
    chr(10));

  if v_session is null then
    raise exception 'RESULT:%', v_report;
  end if;

  -- -------------------------------------------- 5. place the order, for real
  begin
    v_order := public.place_public_order(
      btrim(v_slug), v_lines, 'diagnostic probe', v_session, gen_random_uuid()
    );
    v_report := v_report || format('5. place_public_order: OK (%s) -- this is the step that fails on the phone%s',
      v_order, chr(10));
  exception when others then
    v_report := v_report || format('5. place_public_order: RAISED %s -- %s%s',
      sqlstate, sqlerrm, chr(10));
  end;

  raise exception 'RESULT:%', v_report;
end $$;

-- ============================================================================
-- READING THE ANSWER
-- ============================================================================
-- "5. place_public_order: OK"          -> the database is fine. The failure is
--                                          the app's connection to it: the keys
--                                          on the deployment, or a stale
--                                          PostgREST schema cache.
--
-- RAISED 42883 / PGRST202              -> the function is not in this database.
--                                          Apply 20261023000900.
--
-- RAISED 42501                         -> permission. The guest role cannot
--                                          execute the function; the grants at
--                                          the bottom of 20261023000900 need
--                                          re-running.
--
-- RAISED P0001 with a sentence         -> that sentence is what the guest
--                                          should have seen. If they saw
--                                          "please try again" instead, the app
--                                          is dropping the message.
--
-- "2. write gate: FALSE"               -> the trial ran out. Extend it:
--
--    update public.restaurants
--       set plan = 'professional', plan_status = 'active',
--           plan_started_at = now(),
--           plan_expires_at = now() + interval '1 year'
--     where slug = 'kings-of-kings';
-- ============================================================================
