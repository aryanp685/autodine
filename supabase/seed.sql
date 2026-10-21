-- Fictional sample data for local development only. Safe to rerun.

insert into public.restaurants (id, slug, name, tagline, address, phone, gstin, timezone, tax_rate_bps)
values ('00000000-0000-4000-8000-000000000001', 'saffron-smoke', 'Saffron & Smoke', 'Sample restaurant · India', 'Demo location', null, null, 'Asia/Kolkata', 0)
on conflict (id) do update set name = excluded.name;

insert into public.menus (id, restaurant_id, name, is_published) values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Main menu', true) on conflict (id) do nothing;

insert into public.categories (id, restaurant_id, menu_id, name, sort_order) values
  ('5e0a1b3c-6944-4674-b68b-4b305e4480f0', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Starters', 0),
  ('965dc707-9cba-418c-adfe-dc517b8c499e', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Tandoor & Grills', 1),
  ('c578bcef-9609-4280-97cb-64e5fe0246ce', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Curries & Mains', 2),
  ('b1ad2b82-b822-44c7-99a2-3b08ce0ca1c5', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Biryani & Rice', 3),
  ('af803823-d594-4ac7-a1bb-a3534f91cb27', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Breads', 4),
  ('f7b6ec37-de18-4bd5-8a1f-097bf37b412d', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Desserts', 5),
  ('91353887-6ae9-45af-a2ec-c673def88e3b', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Beverages', 6)
on conflict (id) do nothing;

insert into public.items (id, restaurant_id, category_id, name, description, price_paise, is_veg, is_available, image_url, sort_order) values
  ('3f26d487-bb32-47b4-b524-4ebd6856edc2', '00000000-0000-4000-8000-000000000001', '5e0a1b3c-6944-4674-b68b-4b305e4480f0', 'Paneer Tikka', 'Charred cottage cheese, ajwain marinade, bell pepper, red onion', 34900, true, true, '/img/dish-paneer-tikka.jpg', 0),
  ('4c7f1af4-e49f-4047-86e6-495e3f807859', '00000000-0000-4000-8000-000000000001', '5e0a1b3c-6944-4674-b68b-4b305e4480f0', 'Hara Bhara Kebab', 'Spinach, green pea and potato patty, toasted cashew centre', 29900, true, true, null, 1),
  ('f00441bf-2373-4d89-aa02-135ff4bc1935', '00000000-0000-4000-8000-000000000001', '5e0a1b3c-6944-4674-b68b-4b305e4480f0', 'Chicken Malai Tikka', 'Cream, cheddar and cardamom marinade, finished in the tandoor', 42900, false, true, '/img/dish-butter-chicken.jpg', 2),
  ('47165d7d-5f16-424a-9508-ea2b0b2e5b50', '00000000-0000-4000-8000-000000000001', '965dc707-9cba-418c-adfe-dc517b8c499e', 'Tandoori Chicken', 'Kashmiri chilli and yoghurt marinade, served with mint chutney', 34900, false, true, null, 3),
  ('3856ef49-7557-42df-9375-4169e2a1bd53', '00000000-0000-4000-8000-000000000001', '965dc707-9cba-418c-adfe-dc517b8c499e', 'Seekh Kebab', 'Hand-minced lamb, green chilli and warm spices, iron skewer', 45900, false, true, null, 4),
  ('add53403-7be7-4f1e-8cda-93a924baa62c', '00000000-0000-4000-8000-000000000001', 'c578bcef-9609-4280-97cb-64e5fe0246ce', 'Butter Chicken', 'Tandoor-cooked chicken in a tomato, cashew and butter gravy', 46900, false, true, '/img/dish-butter-chicken.jpg', 5),
  ('114a5555-4461-41e5-a3c1-5df5edf634a5', '00000000-0000-4000-8000-000000000001', 'c578bcef-9609-4280-97cb-64e5fe0246ce', 'Dal Bukhara', 'Black urad slow-cooked 18 hours, tomato, ghee, kasuri methi', 38900, true, true, null, 6),
  ('986ba22f-ef60-4675-882c-4f93217a4f9d', '00000000-0000-4000-8000-000000000001', 'c578bcef-9609-4280-97cb-64e5fe0246ce', 'Paneer Butter Masala', 'Fresh paneer in a fenugreek-scented tomato and cashew gravy', 39900, true, true, null, 7),
  ('80558ba6-f0b6-4ede-8923-77f6fb9e3796', '00000000-0000-4000-8000-000000000001', 'c578bcef-9609-4280-97cb-64e5fe0246ce', 'Laal Maas', 'Mathania chilli lamb curry, smoked ghee', 54900, false, false, null, 8),
  ('c5209a05-a1c0-4139-9123-9db532ce7671', '00000000-0000-4000-8000-000000000001', 'b1ad2b82-b822-44c7-99a2-3b08ce0ca1c5', 'Hyderabadi Chicken Biryani', 'Kacchi-style dum biryani, saffron, fried onion, served with salan', 49900, false, true, null, 9),
  ('1e0723fc-bf6c-4542-98ec-92b4609d93fe', '00000000-0000-4000-8000-000000000001', 'b1ad2b82-b822-44c7-99a2-3b08ce0ca1c5', 'Subz Dum Biryani', 'Seasonal vegetables, saffron rice, dum-sealed handi', 37900, true, true, null, 10),
  ('2e074a2c-c262-46be-aff5-05ac28b452fa', '00000000-0000-4000-8000-000000000001', 'b1ad2b82-b822-44c7-99a2-3b08ce0ca1c5', 'Masala Dosa', 'Crisp fermented crepe, potato masala, coconut chutney, sambar', 24900, true, true, '/img/dish-masala-dosa.jpg', 11),
  ('5dccd841-0706-41a6-939d-b3f7c34ebd9c', '00000000-0000-4000-8000-000000000001', 'af803823-d594-4ac7-a1bb-a3534f91cb27', 'Butter Naan', 'Tandoor-baked, brushed with butter', 7900, true, true, null, 12),
  ('2d081d32-7f11-4aa8-bdac-4bc629d853c8', '00000000-0000-4000-8000-000000000001', 'af803823-d594-4ac7-a1bb-a3534f91cb27', 'Garlic Naan', 'Fresh garlic and coriander', 9900, true, true, null, 13),
  ('3c4254d7-56ce-4a90-a417-7ee9ba413bca', '00000000-0000-4000-8000-000000000001', 'af803823-d594-4ac7-a1bb-a3534f91cb27', 'Tandoori Roti', 'Whole wheat, tandoor-fired', 5900, true, true, null, 14),
  ('49e1daa4-f25b-4d96-a141-55ec8014e7b2', '00000000-0000-4000-8000-000000000001', 'af803823-d594-4ac7-a1bb-a3534f91cb27', 'Laccha Paratha', 'Layered, flaky, brushed with ghee', 8900, true, true, null, 15),
  ('78f9f806-2576-4762-8e97-e75a6c13fcee', '00000000-0000-4000-8000-000000000001', 'f7b6ec37-de18-4bd5-8a1f-097bf37b412d', 'Gulab Jamun', 'Two warm dumplings, cardamom syrup', 14900, true, true, null, 16),
  ('d8678751-cd4b-4db6-b60b-a12386ca9488', '00000000-0000-4000-8000-000000000001', 'f7b6ec37-de18-4bd5-8a1f-097bf37b412d', 'Rasmalai', 'Chhena discs in saffron-scented milk', 17900, true, true, null, 17),
  ('89c8e702-0462-46e7-aa8a-5dacb7705db9', '00000000-0000-4000-8000-000000000001', '91353887-6ae9-45af-a2ec-c673def88e3b', 'Masala Chai', 'Assam leaf, ginger, cardamom, single estate', 9900, true, true, null, 18),
  ('111234ed-c30b-430f-b67f-48d52e7909eb', '00000000-0000-4000-8000-000000000001', '91353887-6ae9-45af-a2ec-c673def88e3b', 'Mango Lassi', 'Alphonso pulp, hung curd, lightly sweetened', 14900, true, true, null, 19),
  ('0a6094e6-a7b9-4ce7-8485-6354933d4e65', '00000000-0000-4000-8000-000000000001', '91353887-6ae9-45af-a2ec-c673def88e3b', 'Fresh Lime Soda', 'Sweet or salted, soda, mint', 11900, true, true, null, 20),
  ('ec65e133-d1e1-4d96-86bb-5f715389fc4c', '00000000-0000-4000-8000-000000000001', '91353887-6ae9-45af-a2ec-c673def88e3b', 'Filter Coffee', 'Degree coffee decoction, froth-pulled, served in a dabarah', 10900, true, true, null, 21)
on conflict (id) do nothing;

insert into public.item_variants (id, item_id, name, price_paise, sort_order) values
  ('9d7d6ecd-5d2e-4081-a7c8-7c25526c0101', '3f26d487-bb32-47b4-b524-4ebd6856edc2', 'Regular · 6 pcs', 34900, 0),
  ('f8e98a00-eb69-40ec-a61b-73b069214484', '3f26d487-bb32-47b4-b524-4ebd6856edc2', 'Sharing · 12 pcs', 62900, 1),
  ('b80250ae-2793-41b7-a0bf-59147dd1faed', '47165d7d-5f16-424a-9508-ea2b0b2e5b50', 'Half · 4 pcs', 34900, 0),
  ('7f474ce6-9d93-431b-88a0-91e476790e19', '47165d7d-5f16-424a-9508-ea2b0b2e5b50', 'Full · 8 pcs', 64900, 1),
  ('dbc9b4a1-18db-4f9b-81d0-b4695221b7e7', 'add53403-7be7-4f1e-8cda-93a924baa62c', 'Regular · 4 pcs', 46900, 0),
  ('0d6452dc-33d1-4742-8e16-4a8cbdcb16ae', 'add53403-7be7-4f1e-8cda-93a924baa62c', 'Sharing · 8 pcs', 84900, 1),
  ('fa8d94a9-8a6d-4ba2-9fce-d8ffc309f568', '986ba22f-ef60-4675-882c-4f93217a4f9d', 'Regular', 39900, 0),
  ('540ae574-3791-49fb-a859-9b1a0f234039', '986ba22f-ef60-4675-882c-4f93217a4f9d', 'Sharing', 72900, 1),
  ('1f993848-54ce-4bee-af8a-e8ac0c91150e', 'ec65e133-d1e1-4d96-86bb-5f715389fc4c', 'Regular', 10900, 0),
  ('04292280-1a62-477a-8e0b-bdb83807483e', 'ec65e133-d1e1-4d96-86bb-5f715389fc4c', 'Large', 14900, 1)
on conflict (id) do nothing;

-- Twelve tables and a stable printed table QR for each. The QR identifies a
-- table; scanning the QR starts a one-hour guest ordering session.
insert into public.dining_tables (restaurant_id, label, seats)
select '00000000-0000-4000-8000-000000000001', 'T' || n, 4 from generate_series(1, 12) n on conflict do nothing;

insert into public.table_qr_codes (restaurant_id, table_id, public_token)
select '00000000-0000-4000-8000-000000000001', t.id, encode(gen_random_bytes(24), 'hex')
from public.dining_tables t
where t.restaurant_id = '00000000-0000-4000-8000-000000000001'
  and t.is_active
  and not exists (
    select 1 from public.table_qr_codes q
    where q.table_id = t.id and q.revoked_at is null
  );
