-- LOCAL HARNESS ONLY. Deterministic guest-facing data for the throttle browser
-- E2E. The database is disposable and this file must never target production.

do $$
declare
  v_restaurant_id uuid;
  v_menu_id uuid;
  v_category_id uuid;
begin
  select id into strict v_restaurant_id
    from public.restaurants
   where slug = 'kings-of-kings';

  -- The browser spec scans this synthetic card in scan mode. No GST/tax policy
  -- is selected or inferred by this fixture; it never places an order.
  update public.restaurants
     set guest_verification_mode = 'scan'
   where id = v_restaurant_id;

  select id into strict v_menu_id
    from public.menus
   where restaurant_id = v_restaurant_id
     and is_published = true
   order by sort_order, created_at
   limit 1;

  select id into v_category_id
    from public.categories
   where restaurant_id = v_restaurant_id
     and menu_id = v_menu_id
     and name = 'Local E2E menu'
   limit 1;

  if v_category_id is null then
    insert into public.categories (restaurant_id, menu_id, name, sort_order)
    values (v_restaurant_id, v_menu_id, 'Local E2E menu', 0)
    returning id into v_category_id;
  end if;

  if not exists (
    select 1 from public.items
     where restaurant_id = v_restaurant_id
       and category_id = v_category_id
       and name = 'Local E2E dish'
  ) then
    insert into public.items (
      restaurant_id, category_id, name, description,
      price_paise, is_veg, is_available, sort_order
    ) values (
      v_restaurant_id, v_category_id, 'Local E2E dish',
      'Synthetic menu entry for isolated browser verification.',
      100, true, true, 0
    );
  end if;
end $$;
