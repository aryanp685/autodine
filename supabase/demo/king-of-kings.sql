-- ============================================================================
-- AutoDine — demo restaurant: "King of Kings"
--
-- WHAT THIS IS
--
-- One paste, in the Supabase SQL editor, that gives you a restaurant you can
-- actually demo: a published menu with photographs, portions, add-ons, a
-- sold-out dish, six tables with real scannable codes, and Hindi spoken names
-- so the kitchen announcement sounds like a person rather than an app reading
-- English with an accent.
--
-- RUN THIS AFTER the three migrations (20261026001100, ..01200, ..01300).
-- Ordering fails without them: place_public_order() calls
-- restaurant_can_write(), which those migrations create.
--
-- IT IS SAFE TO RUN TWICE. Everything is keyed by slug or by the menu it
-- created. Running it again rebuilds the demo menu and leaves your other
-- menus, your orders and your tables alone.
--
-- IT DOES NOT TOUCH other restaurants. Every statement is scoped to the slug
-- at the top.
--
-- FIRST, find the slug of the restaurant your account already owns:
--
--     select slug, name, is_active,
--            (select count(*) from public.menus m  where m.restaurant_id = r.id and m.is_published) as menus,
--            (select count(*) from public.items i  where i.restaurant_id = r.id) as dishes
--       from public.restaurants r;
--
-- Then set `v_slug` below to that value.
--
-- THIS SCRIPT NO LONGER CREATES A RESTAURANT. If the slug does not exist it
-- stops with a message instead. The first version created one, and that is a
-- trap: a restaurant created here has no membership, so it never appears in
-- your dashboard and you end up editing a menu you cannot see.
--
-- WHAT IT WILL NOT DO: charge anybody, set a UPI handle (that is yours, in
-- Settings), or invent a tax rate beyond the 5% demo value in the comment.
-- ============================================================================

do $$
declare
  v_slug     text := 'kings-of-kings';  -- << the slug from the query above
  v_name     text := 'Kings of Kings';
  v_rid      uuid;
  v_menu     uuid;
  v_group    uuid;
  v_group_item uuid;
begin
  -- ---------------------------------------------------------------- restaurant
  -- Found, never created. A restaurant inserted here would have no membership
  -- row, so it would not appear in the dashboard at all -- and the owner would
  -- be looking at an empty menu for a restaurant they cannot open.
  select r.id into v_rid
    from public.restaurants r
   where r.slug = btrim(v_slug);

  if v_rid is null then
    raise exception
      'No restaurant with slug "%". Run: select slug, name from public.restaurants order by created_at desc;  then set v_slug on line 43 of this file.',
      v_slug
      using errcode = 'P0001';
  end if;

  -- Open for business. is_active is what the guest read filters on, and a
  -- restaurant that is closed answers a scanned card with "not available".
  update public.restaurants
     set is_active = true
   where id = v_rid;

  -- ---------------------------------------------------------------- menu
  select m.id into v_menu
    from public.menus m
   where m.restaurant_id = v_rid
     and m.name = 'Demo menu'
   limit 1;

  if v_menu is null then
    insert into public.menus (restaurant_id, name, is_published, sort_order)
    values (v_rid, 'Demo menu', true, 0)
    returning id into v_menu;
  else
    -- Rebuild: items first (items.category_id is ON DELETE SET NULL, so
    -- deleting categories would leave orphaned dishes on the menu).
    delete from public.items
     where restaurant_id = v_rid
       and category_id in (select id from public.categories where menu_id = v_menu);
    delete from public.categories where menu_id = v_menu;
    update public.menus set is_published = true where id = v_menu;
  end if;

  -- ---------------------------------------------------------------- categories
  insert into public.categories (restaurant_id, menu_id, name, sort_order)
  values
    (v_rid, v_menu, 'Starters',        1),
    (v_rid, v_menu, 'From the tandoor', 2),
    (v_rid, v_menu, 'Biryani & rice',  3),
    (v_rid, v_menu, 'Breads',          4),
    (v_rid, v_menu, 'Desserts',        5),
    (v_rid, v_menu, 'Drinks',          6);

  -- ---------------------------------------------------------------- dishes
  -- price is PAISE. 32000 = ₹320. spoken_name is what the kitchen board says
  -- out loud: Devanagari, so the Hindi voice reads it naturally instead of
  -- spelling an English dish name in a Hindi accent.
  insert into public.items (
    restaurant_id, category_id, name, description, price_paise,
    is_veg, is_available, image_url, sort_order, spoken_name
  )
  select
    v_rid, c.id, d.name, d.description, d.price, d.veg, d.available, d.img, d.ord, d.spoken
  from (values
    -- Starters -------------------------------------------------------------
    ('Starters', 'Paneer Tikka', 'Charred cottage cheese, mint chutney', 32000::bigint, true, true,
     '/img/dishes/paneer-tikka.jpg'::text, 1, 'पनीर टिक्का'),
    ('Starters', 'Hara Bhara Kebab', 'Spinach and green pea patties', 28000, true, false,
     '/img/dishes/hara-bhara-kebab.jpg', 2, 'हरा भरा कबाब'),
    ('Starters', 'Chicken Malai Tikka', 'Cream marinade, gentle heat', 38000, false, true,
     '/img/dishes/chicken-malai-tikka.jpg', 3, 'चिकन मलाई टिक्का'),
    ('Starters', 'Seekh Kebab', 'Minced mutton, charcoal grilled', 36000, false, true,
     '/img/dishes/seekh-kebab.jpg', 4, 'सीख कबाब'),

    -- From the tandoor -----------------------------------------------------
    ('From the tandoor', 'Tandoori Chicken', 'Half bird, hung curd, smoked', 42000, false, true,
     '/img/dishes/tandoori-chicken.jpg', 1, 'तंदूरी चिकन'),
    ('From the tandoor', 'Butter Chicken', 'Tomato, cream, fenugreek', 46900, false, true,
     '/img/dishes/butter-chicken.jpg', 2, 'बटर चिकन'),
    ('From the tandoor', 'Paneer Butter Masala', 'The same gravy, with paneer', 38900, true, true,
     '/img/dishes/paneer-butter-masala.jpg', 3, 'पनीर बटर मसाला'),
    ('From the tandoor', 'Dal Bukhara', 'Black lentils, overnight', 34000, true, true,
     '/img/dishes/dal-bukhara.jpg', 4, 'दाल बुखारा'),

    -- Biryani & rice -------------------------------------------------------
    ('Biryani & rice', 'Hyderabadi Chicken Biryani', 'Dum cooked, with raita', 34900, false, true,
     '/img/dishes/hyderabadi-chicken-biryani.jpg', 1, 'हैदराबादी चिकन बिरयानी'),
    ('Biryani & rice', 'Subz Dum Biryani', 'Seasonal vegetables, saffron', 29900, true, true,
     '/img/dishes/subz-dum-biryani.jpg', 2, 'सब्ज़ दम बिरयानी'),

    -- Breads ---------------------------------------------------------------
    ('Breads', 'Butter Naan', 'Tandoor, brushed with butter', 6500, true, true,
     '/img/dishes/butter-naan.jpg', 1, 'बटर नान'),
    ('Breads', 'Garlic Naan', 'Garlic and coriander', 8500, true, true,
     '/img/dishes/garlic-naan.jpg', 2, 'गार्लिक नान'),
    ('Breads', 'Laccha Paratha', 'Layered, flaky', 7000, true, true,
     '/img/dishes/laccha-paratha.jpg', 3, 'लच्छा पराठा'),
    ('Breads', 'Tandoori Roti', 'Whole wheat, plain', 4000, true, true,
     '/img/dishes/tandoori-roti.jpg', 4, 'तंदूरी रोटी'),

    -- Desserts -------------------------------------------------------------
    ('Desserts', 'Gulab Jamun', 'Two, warm, with syrup', 12000, true, true,
     '/img/dishes/gulab-jamun.jpg', 1, 'गुलाब जामुन'),
    ('Desserts', 'Rasmalai', 'Two, cardamom milk', 14000, true, true,
     '/img/dishes/rasmalai.jpg', 2, 'रसमलाई'),

    -- Drinks ---------------------------------------------------------------
    ('Drinks', 'Masala Chai', 'Ginger, cardamom', 6000, true, true,
     '/img/dishes/masala-chai.jpg', 1, 'मसाला चाय'),
    ('Drinks', 'Filter Coffee', 'South Indian, strong', 8000, true, true,
     '/img/dishes/filter-coffee.jpg', 2, 'फिल्टर कॉफ़ी'),
    ('Drinks', 'Fresh Lime Soda', 'Sweet or salted', 9000, true, true,
     '/img/dishes/fresh-lime-soda.jpg', 3, 'नींबू सोडा'),
    ('Drinks', 'Mango Lassi', 'Thick, cold', 12000, true, true,
     '/img/dishes/mango-lassi.jpg', 4, 'आम की लस्सी')
  ) as d(cat, name, description, price, veg, available, img, ord, spoken)
  join public.categories c on c.menu_id = v_menu and c.name = d.cat;

  -- ---------------------------------------------------------------- portions
  -- Absolute prices, not a surcharge: a Half plate has its own price.
  insert into public.item_variants (item_id, name, price_paise, sort_order)
  select i.id, v.name, v.price, v.ord
  from (values
    ('Hyderabadi Chicken Biryani', 'Half', 24900::bigint, 1),
    ('Hyderabadi Chicken Biryani', 'Full', 34900::bigint, 2),
    ('Subz Dum Biryani',           'Half', 21900::bigint, 1),
    ('Subz Dum Biryani',           'Full', 29900::bigint, 2)
  ) as v(item, name, price, ord)
  join public.items i on i.restaurant_id = v_rid and i.name = v.item;

  -- ---------------------------------------------------------------- add-ons
  -- One required-feeling choice on the biryani, one cheap extra on the naan:
  -- enough to show the sheet without turning the demo into data entry.
  select i.id into v_group_item from public.items i
   where i.restaurant_id = v_rid and i.name = 'Hyderabadi Chicken Biryani' limit 1;

  if v_group_item is not null then
    insert into public.item_addon_groups (item_id, name, min_select, max_select, sort_order)
    values (v_group_item, 'Serve it with', 0, 2, 1)
    returning id into v_group;

    insert into public.item_addons (group_id, name, price_paise, sort_order)
    values
      (v_group, 'Extra raita', 4000, 1),
      (v_group, 'Mirchi ka salan', 6000, 2),
      (v_group, 'Extra gravy', 5000, 3);
  end if;

  select i.id into v_group_item from public.items i
   where i.restaurant_id = v_rid and i.name = 'Butter Naan' limit 1;

  if v_group_item is not null then
    insert into public.item_addon_groups (item_id, name, min_select, max_select, sort_order)
    values (v_group_item, 'Make it richer', 0, 1, 1)
    returning id into v_group;

    insert into public.item_addons (group_id, name, price_paise, sort_order)
    values
      (v_group, 'Extra butter', 1000, 1),
      (v_group, 'Cheese stuffed', 4000, 2);
  end if;

  -- ---------------------------------------------------------------- tables
  -- The trigger on dining_tables issues a scannable code per row, so nothing
  -- here has to know how codes work.
  insert into public.dining_tables (restaurant_id, label, seats)
  values
    (v_rid, 'T1', 2),
    (v_rid, 'T2', 2),
    (v_rid, 'T3', 4),
    (v_rid, 'T4', 4),
    (v_rid, 'T5', 6),
    (v_rid, 'T6', 8)
  on conflict (restaurant_id, label) do nothing;

  -- A table that predates the trigger, or whose code was revoked, gets one
  -- back. Same INSERT the trigger performs.
  --
  -- Guarded: `table_qr_codes` is created outside this repository's migrations
  -- (the deployment has it; the repo references it 27 times and never creates
  -- it). If it is missing here too, the trigger above already failed and this
  -- line never runs -- but the guard keeps the script readable either way.
  if to_regclass('public.table_qr_codes') is not null then
    insert into public.table_qr_codes (restaurant_id, table_id, public_token)
    select t.restaurant_id, t.id, public.new_qr_public_token()
      from public.dining_tables t
     where t.restaurant_id = v_rid
       and not exists (
         select 1 from public.table_qr_codes q
          where q.table_id = t.id and q.revoked_at is null
       );
  end if;

  -- The six-digit on-site code is derived from this row. The Tables screen
  -- creates it on first read; creating it here means the demo works even if
  -- nobody has opened that screen yet.
  insert into public.restaurant_verification_codes (restaurant_id, secret)
  values (v_rid, public.new_verification_secret())
  on conflict (restaurant_id) do nothing;
end $$;

-- ============================================================================
-- Check 1 — did it land?
--
-- The two queries below name the slug literally. If you changed v_slug above,
-- change it in these two WHERE clauses too.
-- ============================================================================
select
  r.name,
  r.slug,
  r.is_active,
  (select count(*) from public.menus m      where m.restaurant_id = r.id and m.is_published) as published_menus,
  (select count(*) from public.categories c where c.restaurant_id = r.id)                       as categories,
  (select count(*) from public.items i      where i.restaurant_id = r.id)                       as dishes,
  (select count(*) from public.items i      where i.restaurant_id = r.id and not i.is_available) as sold_out,
  (select count(*) from public.items i      where i.restaurant_id = r.id and i.spoken_name is not null) as hindi_names,
  (select count(*) from public.dining_tables t where t.restaurant_id = r.id)                    as tables
from public.restaurants r
where r.slug = 'kings-of-kings';

-- ============================================================================
-- Check 2 — what to scan, and the code to type on the phone
--
-- `scan_path` is the path the QR encodes. The full URL is your site's origin
-- plus that path (the Tables screen draws it with the right origin for you).
--
-- If this errors with `relation "public.table_qr_codes" does not exist`, stop
-- and tell me: that table is created outside this repository's migrations, and
-- the repo needs a migration that creates it.
--
-- `current_code` is the six-digit code the guest types after scanning. It
-- changes every `code_window_minutes` — the Tables screen shows the live one,
-- so read it there when you demo rather than from this result.
-- ============================================================================
select
  t.label,
  '/t/' || q.public_token as scan_path,
  public.verification_code_for(
    c.secret,
    floor(extract(epoch from statement_timestamp()) / c.window_seconds)::bigint
  ) as current_code,
  (c.window_seconds / 60) as code_window_minutes,
  t.seats
from public.dining_tables t
join public.table_qr_codes q on q.table_id = t.id and q.revoked_at is null
join public.restaurants r on r.id = t.restaurant_id
join public.restaurant_verification_codes c on c.restaurant_id = r.id
where r.slug = 'kings-of-kings'
order by t.label;

-- ============================================================================
-- Menus are invisible until published. This is the other reason a scanned
-- card shows no menu, and it has nothing to do with the QR.
-- ============================================================================
-- select m.id, m.name, m.is_published,
--        (select count(*) from public.categories c where c.menu_id = m.id) as sections,
--        (select count(*) from public.items i where i.category_id in (select id from public.categories c where c.menu_id = m.id)) as dishes
--   from public.menus m
--  where m.restaurant_id = (select id from public.restaurants where slug = 'kings-of-kings');
--
-- update public.menus set is_published = true where restaurant_id = (select id from public.restaurants where slug = 'kings-of-kings');

-- ============================================================================
-- Undo, if you ever want the demo gone. Comments keep it from running by
-- accident. This deletes the DEMO MENU and its dishes only -- never the
-- restaurant, never an order, never a table with a session on it.
-- ============================================================================
-- delete from public.items
--  where restaurant_id = (select id from public.restaurants where slug = 'king-of-kings')
--    and category_id in (
--      select c.id from public.categories c
--       join public.menus m on m.id = c.menu_id
--       where m.name = 'Demo menu'
--    );
-- delete from public.categories
--  where menu_id in (
--    select id from public.menus
--     where name = 'Demo menu'
--       and restaurant_id = (select id from public.restaurants where slug = 'king-of-kings')
--  );
-- delete from public.menus
--  where name = 'Demo menu'
--    and restaurant_id = (select id from public.restaurants where slug = 'king-of-kings');
