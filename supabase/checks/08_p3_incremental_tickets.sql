-- LOCAL / DISPOSABLE DATABASE REGRESSION CHECK ONLY.
-- Places two intentional tickets at one verified table, replays the second
-- idempotency token, and verifies one open session, two tickets, one replay.
-- All synthetic order/session rows are rolled back. Never run on production.

begin;

do $$
declare
  v_slug text;
  v_card text;
  v_ip text := repeat('a', 64);
  v_item_id uuid;
  v_open_status text;
  v_session_token text;
  v_guest_one uuid := gen_random_uuid();
  v_guest_two uuid := gen_random_uuid();
  v_first_code text;
  v_second_code text;
  v_retry_code text;
  v_session_id uuid;
  v_ticket_count integer;
  v_open_session_count integer;
begin
  select r.slug, q.public_token into strict v_slug, v_card
    from public.restaurants r
    join public.dining_tables t on t.restaurant_id = r.id and t.label = 'T1'
    join public.table_qr_codes q on q.table_id = t.id and q.restaurant_id = r.id
   where r.slug = 'kings-of-kings' and q.revoked_at is null
   limit 1;
  select id into strict v_item_id
    from public.items
   where restaurant_id = (select id from public.restaurants where slug = v_slug)
     and name = 'Local E2E dish'
   limit 1;

  select s.status, s.session_token into strict v_open_status, v_session_token
    from public.open_table_session(v_card, v_ip) s;
  if v_open_status <> 'opened' or v_session_token is null then
    raise exception 'P3 regression: verified card did not open a table session (%).', v_open_status;
  end if;

  v_first_code := public.place_public_order(
    v_slug, jsonb_build_array(jsonb_build_object('itemId', v_item_id, 'qty', 1)),
    'P3 synthetic ticket one', v_session_token, v_guest_one, v_ip
  );
  v_second_code := public.place_public_order(
    v_slug, jsonb_build_array(jsonb_build_object('itemId', v_item_id, 'qty', 1)),
    'P3 synthetic ticket two', v_session_token, v_guest_two, v_ip
  );
  v_retry_code := public.place_public_order(
    v_slug, jsonb_build_array(jsonb_build_object('itemId', v_item_id, 'qty', 1)),
    'P3 synthetic ticket two', v_session_token, v_guest_two, v_ip
  );

  if v_first_code = v_second_code or v_second_code <> v_retry_code then
    raise exception 'P3 regression: intentional repeat or idempotent replay returned the wrong ticket codes';
  end if;

  select o.order_session_id into strict v_session_id
    from public.orders o
   where o.restaurant_id = (select id from public.restaurants where slug = v_slug)
     and o.guest_token = v_guest_one;
  if not exists (
    select 1 from public.orders o
     where o.restaurant_id = (select id from public.restaurants where slug = v_slug)
       and o.guest_token = v_guest_two
       and o.order_session_id = v_session_id
  ) then
    raise exception 'P3 regression: second ticket did not join the first ticket session';
  end if;

  select count(*)::integer into v_ticket_count
    from public.orders o
   where o.order_session_id = v_session_id
     and o.guest_token in (v_guest_one, v_guest_two);
  select count(*)::integer into v_open_session_count
    from public.order_sessions s
   where s.table_id = (select id from public.dining_tables where label = 'T1'
                        and restaurant_id = (select id from public.restaurants where slug = v_slug))
     and s.status = 'open';
  if v_ticket_count <> 2 or v_open_session_count <> 1 then
    raise exception 'P3 regression: expected two tickets in one active session; got tickets %, open sessions %',
      v_ticket_count, v_open_session_count;
  end if;
  raise notice 'PASS P3: intentional repeat created a new ticket; replay returned the existing code; both tickets share one open session';
end
$$;

rollback;
