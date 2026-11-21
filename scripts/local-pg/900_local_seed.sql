-- LOCAL HARNESS ONLY — one restaurant, one table, one card, one order, so the
-- checks have something to look at. Never run against production.
do $$
declare
  v_rid uuid;
  v_tid uuid;
  v_qr  uuid;
  v_menu uuid;
begin
  insert into public.restaurants (slug, name, timezone, is_active, trial_started_at)
  values ('kings-of-kings', 'Kings of Kings', 'Asia/Kolkata', true, now())
  returning id into v_rid;

  insert into public.menus (restaurant_id, name, is_published)
  values (v_rid, 'Main menu', true) returning id into v_menu;

  insert into public.dining_tables (restaurant_id, label, is_active)
  values (v_rid, 'T1', true) returning id into v_tid;

  insert into public.table_qr_codes (restaurant_id, table_id, public_token)
  values (v_rid, v_tid, 'localcard0000000000000000000000000000000000000000000000000001')
  returning id into v_qr;

  insert into public.orders (restaurant_id, code, prep_status, payment_status,
                             hold_required, table_id, placed_at)
  values (v_rid, 'L-1001', 'new', 'pending', false, v_tid, now());

  raise notice 'seed: restaurant=% table=% card=%', v_rid, v_tid, v_qr;
end $$;
