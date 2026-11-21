-- ============================================================================
-- AutoDine — demo menu for "kings of kings"
--
-- WHAT THIS FIXES
--
-- A scanned card opened the right restaurant and the right table, and showed
-- "0 dishes": the restaurant exists, the menu is published, and nobody has put
-- a dish in it. This fills that menu in.
--
-- It does NOT create a menu. The signup flow already created one and published
-- it, with the preset categories in it. A second menu here would give the guest
-- a tab bar and a 50% chance of landing on the empty one -- so the dishes go
-- into the menu the guest is already looking at.
--
-- RUN IT IN THE SUPABASE SQL EDITOR. It is one DO block plus two read-only
-- checks. Safe to run twice: it deletes only the demo dishes by name before
-- re-inserting them, so a dish you typed yourself is never touched.
-- ============================================================================

do $$
declare
  v_slug   text := 'kings-of-kings';   -- << your slug; see the query below
  v_rid    uuid;
  v_menu   uuid;
  v_group  uuid;
  v_item   uuid;
begin
  -- ---------------------------------------------------------------- restaurant
  -- Found, never created. A restaurant inserted here has no membership row and
  -- never appears in the dashboard, which is how the first version of this
  -- script sent somebody editing a menu they could not open.
  select r.id into v_rid
    from public.restaurants r
   where r.slug = btrim(v_slug);

  if v_rid is null then
    raise exception
      'No restaurant with slug "%". Run: select slug, name from public.restaurants; then set v_slug at the top of this script.',
      v_slug
      using errcode = 'P0001';
  end if;

  -- Open for business. is_active is what the guest read filters on; a closed
  -- restaurant answers a scanned card with "not available".
  --
  -- Deliberately NOT touching `accent`: the guest flow is one design for every
  -- customer now and reads no per-restaurant colour, so writing one here would
  -- be setting a value nothing renders.
  update public.restaurants set is_active = true where id = v_rid;

  -- --------------------------------------------------------------------- menu
  -- The published menu the guest already lands on: lowest sort_order, oldest
  -- first, exactly the order lib/db/menu.ts picks with.
  select m.id into v_menu
    from public.menus m
   where m.restaurant_id = v_rid
     and m.is_published
   order by m.sort_order asc, m.created_at asc
   limit 1;

  if v_menu is null then
    select m.id into v_menu
      from public.menus m
     where m.restaurant_id = v_rid
     order by m.sort_order asc, m.created_at asc
     limit 1;

    if v_menu is null then
      insert into public.menus (restaurant_id, name, is_published, sort_order)
      values (v_rid, 'Menu', true, 0)
      returning id into v_menu;
    else
      update public.menus set is_published = true where id = v_menu;
    end if;
  end if;

  -- --------------------------------------------------------------- categories
  -- The product's own preset names, so the chips match everything else in the
  -- app. Existing ones are reused; only the missing ones are created.
  insert into public.categories (restaurant_id, menu_id, name, sort_order)
  select v_rid, v_menu, c.name, c.ord
    from (values
      ('Starters', 1), ('Main Course', 2), ('Breads', 3),
      ('Rice & Biryani', 4), ('Beverages', 5), ('Desserts', 6)
    ) as c(name, ord)
   where not exists (
     select 1 from public.categories x
      where x.menu_id = v_menu and lower(btrim(x.name)) = lower(c.name)
   );

  -- -------------------------------------------------------------------- reset
  -- Only the dishes this script inserts. item_variants and item_addon_groups
  -- cascade off the item, so re-running cannot leave a dish with two sets of
  -- portions. An owner's own dishes are not in this list and are not touched.
  delete from public.items
   where restaurant_id = v_rid
     and name in (
       'Paneer Tikka', 'Hara Bhara Kebab', 'Chicken Malai Tikka', 'Seekh Kebab',
       'Butter Chicken', 'Paneer Butter Masala', 'Dal Bukhara', 'Tandoori Chicken',
       'Hyderabadi Chicken Biryani', 'Subz Dum Biryani',
       'Butter Naan', 'Garlic Naan', 'Laccha Paratha', 'Tandoori Roti',
       'Masala Chai', 'Filter Coffee', 'Fresh Lime Soda', 'Mango Lassi',
       'Gulab Jamun', 'Rasmalai'
     );

  -- ------------------------------------------------------------------ dishes
  -- price is PAISE (32000 = ₹320). spoken_name is what the kitchen board says
  -- out loud: Devanagari, so the Hindi voice reads the dish instead of sounding
  -- out an English name syllable by syllable.
  insert into public.items (
    restaurant_id, category_id, name, description, price_paise,
    is_veg, is_available, image_url, sort_order, spoken_name
  )
  select
    v_rid, c.id, d.name, d.description, d.price, d.veg, d.available, d.img, d.ord, d.spoken
  from (values
    ('Starters', 'Paneer Tikka', 'Charred cottage cheese, mint chutney', 32000::bigint, true, true,
     '/img/dishes/paneer-tikka.jpg'::text, 1, 'पनीर टिक्का'),
    ('Starters', 'Hara Bhara Kebab', 'Spinach and green pea patties', 28000, true, false,
     '/img/dishes/hara-bhara-kebab.jpg', 2, 'हरा भरा कबाब'),
    ('Starters', 'Chicken Malai Tikka', 'Cream marinade, gentle heat', 38000, false, true,
     '/img/dishes/chicken-malai-tikka.jpg', 3, 'चिकन मलाई टिक्का'),
    ('Starters', 'Seekh Kebab', 'Minced mutton, charcoal grilled', 36000, false, true,
     '/img/dishes/seekh-kebab.jpg', 4, 'सीख कबाब'),

    ('Main Course', 'Tandoori Chicken', 'Half bird, hung curd, smoked', 42000, false, true,
     '/img/dishes/tandoori-chicken.jpg', 1, 'तंदूरी चिकन'),
    ('Main Course', 'Butter Chicken', 'Tomato, cream, fenugreek', 46900, false, true,
     '/img/dishes/butter-chicken.jpg', 2, 'बटर चिकन'),
    ('Main Course', 'Paneer Butter Masala', 'The same gravy, with paneer', 38900, true, true,
     '/img/dishes/paneer-butter-masala.jpg', 3, 'पनीर बटर मसाला'),
    ('Main Course', 'Dal Bukhara', 'Black lentils, cooked overnight', 34000, true, true,
     '/img/dishes/dal-bukhara.jpg', 4, 'दाल बुखारा'),

    ('Rice & Biryani', 'Hyderabadi Chicken Biryani', 'Dum cooked, served with raita', 34900, false, true,
     '/img/dishes/hyderabadi-chicken-biryani.jpg', 1, 'हैदराबादी चिकन बिरयानी'),
    ('Rice & Biryani', 'Subz Dum Biryani', 'Seasonal vegetables, saffron', 29900, true, true,
     '/img/dishes/subz-dum-biryani.jpg', 2, 'सब्ज़ दम बिरयानी'),

    ('Breads', 'Butter Naan', 'Tandoor, brushed with butter', 6500, true, true,
     '/img/dishes/butter-naan.jpg', 1, 'बटर नान'),
    ('Breads', 'Garlic Naan', 'Garlic and coriander', 8500, true, true,
     '/img/dishes/garlic-naan.jpg', 2, 'गार्लिक नान'),
    ('Breads', 'Laccha Paratha', 'Layered and flaky', 7000, true, true,
     '/img/dishes/laccha-paratha.jpg', 3, 'लच्छा पराठा'),
    ('Breads', 'Tandoori Roti', 'Whole wheat, plain', 4000, true, true,
     '/img/dishes/tandoori-roti.jpg', 4, 'तंदूरी रोटी'),

    ('Beverages', 'Masala Chai', 'Ginger and cardamom', 6000, true, true,
     '/img/dishes/masala-chai.jpg', 1, 'मसाला चाय'),
    ('Beverages', 'Filter Coffee', 'South Indian, strong', 8000, true, true,
     '/img/dishes/filter-coffee.jpg', 2, 'फिल्टर कॉफ़ी'),
    ('Beverages', 'Fresh Lime Soda', 'Sweet or salted', 9000, true, true,
     '/img/dishes/fresh-lime-soda.jpg', 3, 'नींबू सोडा'),
    ('Beverages', 'Mango Lassi', 'Thick and cold', 12000, true, true,
     '/img/dishes/mango-lassi.jpg', 4, 'आम की लस्सी'),

    ('Desserts', 'Gulab Jamun', 'Two, warm, in syrup', 12000, true, true,
     '/img/dishes/gulab-jamun.jpg', 1, 'गुलाब जामुन'),
    ('Desserts', 'Rasmalai', 'Two, cardamom milk', 14000, true, true,
     '/img/dishes/rasmalai.jpg', 2, 'रसमलाई')
  ) as d(cat, name, description, price, veg, available, img, ord, spoken)
  join public.categories c
    on c.menu_id = v_menu
   and lower(btrim(c.name)) = lower(d.cat);

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

  -- ----------------------------------------------------------------- add-ons
  select i.id into v_item from public.items i
   where i.restaurant_id = v_rid and i.name = 'Hyderabadi Chicken Biryani' limit 1;

  if v_item is not null then
    insert into public.item_addon_groups (item_id, name, min_select, max_select, sort_order)
    values (v_item, 'Serve it with', 0, 2, 1)
    returning id into v_group;

    insert into public.item_addons (group_id, name, price_paise, sort_order)
    values (v_group, 'Extra raita', 4000, 1),
           (v_group, 'Mirchi ka salan', 6000, 2),
           (v_group, 'Extra gravy', 5000, 3);
  end if;

  select i.id into v_item from public.items i
   where i.restaurant_id = v_rid and i.name = 'Butter Naan' limit 1;

  if v_item is not null then
    insert into public.item_addon_groups (item_id, name, min_select, max_select, sort_order)
    values (v_item, 'Make it richer', 0, 1, 1)
    returning id into v_group;

    insert into public.item_addons (group_id, name, price_paise, sort_order)
    values (v_group, 'Extra butter', 1000, 1),
           (v_group, 'Cheese stuffed', 4000, 2);
  end if;

  -- ------------------------------------------------------------------ tables
  -- The trigger on dining_tables issues a scannable code per row.
  insert into public.dining_tables (restaurant_id, label, seats)
  values (v_rid, 'T1', 2), (v_rid, 'T2', 2), (v_rid, 'T3', 4),
         (v_rid, 'T4', 4), (v_rid, 'T5', 6), (v_rid, 'T6', 8)
  on conflict (restaurant_id, label) do nothing;

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

  -- The six-digit on-site code is derived from this row.
  insert into public.restaurant_verification_codes (restaurant_id, secret)
  values (v_rid, public.new_verification_secret())
  on conflict (restaurant_id) do nothing;
end $$;

-- ============================================================================
-- Check 1 — did the menu fill in? Expect dishes = 20, sold_out = 1,
-- hindi_names = 20, categories between 6 and 8 (yours are reused).
-- ============================================================================
select
  r.slug,
  r.is_active,
  (select count(*) from public.items i where i.restaurant_id = r.id)                            as dishes,
  (select count(*) from public.items i where i.restaurant_id = r.id and not i.is_available)     as sold_out,
  (select count(*) from public.items i where i.restaurant_id = r.id and i.spoken_name is not null) as hindi_names,
  (select count(*) from public.categories c where c.restaurant_id = r.id)                       as categories,
  (select count(*) from public.dining_tables t where t.restaurant_id = r.id)                    as tables
from public.restaurants r
where r.slug = 'kings-of-kings';

-- ============================================================================
-- Check 2 — the dishes, by section, as the guest will see them.
-- ============================================================================
select c.name as section, c.sort_order, i.name as dish,
       i.price_paise / 100.0 as rupees, i.is_veg, i.is_available, i.spoken_name
from public.items i
join public.categories c on c.id = i.category_id
join public.restaurants r on r.id = i.restaurant_id
where r.slug = 'kings-of-kings'
order by c.sort_order, i.sort_order;

-- ============================================================================
-- Check 3 — what to scan, and the code to type.
-- ============================================================================
select
  t.label,
  '/t/' || q.public_token as scan_path,
  public.verification_code_for(
    c.secret,
    floor(extract(epoch from statement_timestamp()) / c.window_seconds)::bigint
  ) as current_code
from public.dining_tables t
join public.table_qr_codes q on q.table_id = t.id and q.revoked_at is null
join public.restaurants r on r.id = t.restaurant_id
join public.restaurant_verification_codes c on c.restaurant_id = r.id
where r.slug = 'kings-of-kings'
order by t.label;
