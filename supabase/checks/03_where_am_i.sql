-- ============================================================================
-- AutoDine — "I scanned the QR and no menu appeared." Start here.
--
-- ONE QUERY, ONE ANSWER. Paste the whole file into the Supabase SQL editor and
-- read the five result sets top to bottom. In the order they break a scan:
--
--   1. Which restaurants exist, and how big is each one?
--   2. Is anything published? A menu that is not published is invisible to a
--      guest even though it is full of dishes -- and the guest gets a 404,
--      not an explanation.
--   3. Which tables have a live card, and what does that card open?
--   4. What will the guest actually see for each card?
--   5. The recent orders, if any, so a "did my order reach the kitchen?"
--      question can be answered from the same page.
--
-- READ-ONLY. Nothing here writes.
-- ============================================================================

-- ---------------------------------------------------------------- 1. venues
-- published_menus = 0 is the most common cause of a blank menu page.
select
  r.slug,
  r.name,
  r.is_active,
  (select count(*) from public.menus m      where m.restaurant_id = r.id)                       as menus_total,
  (select count(*) from public.menus m      where m.restaurant_id = r.id and m.is_published)    as published_menus,
  (select count(*) from public.categories c where c.restaurant_id = r.id)                       as sections,
  (select count(*) from public.items i      where i.restaurant_id = r.id)                       as dishes,
  (select count(*) from public.items i      where i.restaurant_id = r.id and i.is_available)     as available,
  (select count(*) from public.dining_tables t where t.restaurant_id = r.id)                    as tables,
  r.created_at
from public.restaurants r
order by r.created_at desc;

-- ------------------------------------------------------------- 2. each menu
-- A menu with dishes but `published = false` shows nothing to a guest.
select
  r.slug,
  m.name          as menu,
  m.is_published  as published,
  (select count(*) from public.categories c where c.menu_id = m.id) as sections,
  (select count(*) from public.items i
    where i.category_id in (select id from public.categories c where c.menu_id = m.id)) as dishes_in_menu
from public.menus m
join public.restaurants r on r.id = m.restaurant_id
order by r.created_at desc, m.sort_order;

-- ------------------------------------------------------ 3. every live card
-- `opens` is exactly what the printed QR encodes. The guest's full link is
-- your site's origin plus this path.
select
  r.slug,
  t.label,
  t.is_active                                     as table_in_service,
  q.public_token,
  ('/t/' || q.public_token)                       as opens,
  q.created_at                                    as card_issued
from public.dining_tables t
join public.restaurants r on r.id = t.restaurant_id
left join public.table_qr_codes q
       on q.table_id = t.id and q.revoked_at is null
order by r.created_at desc, t.label;

-- ------------------------------------------- 4. what the guest will see
-- readout is the whole story for one card, in one word per column:
--
--   card        live        the token resolves and is not revoked
--   restaurant  open        is_active, so the guest read does not filter it out
--   menu        published   something exists for them to look at
--   dishes      > 0         the menu is not empty
--
-- A guest sees the menu only when all four are right.
select
  r.slug,
  t.label,
  case when q.id is null then 'REVOKED / NONE' else 'live' end        as card,
  case when r.is_active then 'open' else 'CLOSED' end                 as restaurant,
  case when exists (
    select 1 from public.menus m
     where m.restaurant_id = r.id and m.is_published
  ) then 'published' else 'NOT PUBLISHED' end                         as menu,
  (select count(*) from public.items i where i.restaurant_id = r.id)  as dishes
from public.dining_tables t
join public.restaurants r on r.id = t.restaurant_id
left join public.table_qr_codes q
       on q.table_id = t.id and q.revoked_at is null
order by r.created_at desc, t.label;

-- ------------------------------------------------------------ 5. last orders
select
  r.slug,
  o.code,
  o.prep_status,
  o.payment_status,
  o.total_paise / 100.0        as total_rupees,
  o.placed_at
from public.orders o
join public.restaurants r on r.id = o.restaurant_id
order by o.placed_at desc
limit 20;

-- ============================================================================
-- THE TWO FIXES THESE RESULTS USUALLY POINT AT
-- ============================================================================
-- A) "menu: NOT PUBLISHED" -> publish it. Replace the slug.
--
--    update public.menus
--       set is_published = true
--     where restaurant_id = (select id from public.restaurants where slug = 'kings-of-kings');
--
-- B) "dishes: 0" -> the menu is empty. Seed the demo menu with
--    supabase/demo/king-of-kings.sql after setting its v_slug to this slug.
--
-- Neither one is a QR problem. The QR only names the table; the menu behind it
-- is what these five queries describe.
-- ============================================================================
