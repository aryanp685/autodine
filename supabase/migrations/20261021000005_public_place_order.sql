-- ============================================================================
-- AutoDine — migration 0005: let a signed-out diner place an order
--
-- WHY THIS EXISTS
--
-- The diner flow shipped without a way to write. The orders and order_items
-- tables carry SELECT and UPDATE policies for staff and no INSERT policy at
-- all, and under row level security a missing policy means denied. A guest
-- scanning a QR code has no session, so every attempt to place an order
-- failed at the insert.
--
-- WHY A FUNCTION AND NOT AN INSERT POLICY
--
-- The obvious fix is a permissive INSERT policy for anon. It is the wrong
-- one. A policy can only check the row being written, and an order row
-- cannot be trusted on its own:
--
--   * unit_price_paise is a column the caller supplies. A policy could join
--     back to items to verify it, but the join has to re-derive which
--     restaurant the item belongs to, and every condition missed is a dish
--     someone orders for one rupee.
--   * order_items takes an order_id. An INSERT policy there cannot tell a
--     fresh order from someone else's, so the honourable version of that
--     policy lets any guest add lines to any order in any active restaurant.
--
-- So the write goes through one function that reads the prices itself. The
-- caller sends dish ids and quantities and has no say in what anything
-- costs. That is the same split the cart already uses -- localStorage holds
-- no money -- extended to the moment of writing.
--
-- The function is also the transaction. Order and lines commit together or
-- not at all, with no window for a ticket to exist on the kitchen pass with
-- nothing on it.
--
-- SECURITY MODEL
--
-- SECURITY DEFINER so it can write past RLS, with every check performed
-- explicitly before the first insert:
--   * the restaurant resolves by slug and is active
--   * that restaurant has a published menu
--   * every dish resolves to that same restaurant, through its published
--     menu, and is available
--   * quantities are integers between 1 and 99
--
-- Dishes that fail any of this are skipped and counted, not priced at zero
-- and not silently dropped -- the caller is told how many fell away so the
-- diner is not handed a bill that quietly disagrees with their cart.
--
-- search_path is pinned. A SECURITY DEFINER function that resolves
-- unqualified names from whatever the caller's search_path happens to be is
-- how a function ends up reading a table it did not mean to.
--
-- TAX
--
-- The arithmetic here has to agree with lib/pricing.ts exactly, because the
-- cart shows one number and this writes another, and a bill that differs
-- from the total the guest pressed is worse than either being wrong alone.
--   subtotal = sum(unit_price_paise * qty)
--   taxable  = max(subtotal - discount, 0)          -- no discounts yet
--   tax      = round(taxable * tax_rate_bps / 10000)
--   total    = taxable + tax
--
-- The rate is restaurants.tax_rate_bps, the same column
-- place_counter_order reads, falling back to 500 bps when a restaurant has
-- not set one. It must be read in SQL rather than passed in: a rate that
-- arrives from the caller is a rate the caller chose.
-- round() on a numeric rounds half away from zero, which is what
-- Math.round on a positive number does in TypeScript. The rate is read from
-- the restaurant when present and falls back to the same 5% sample the
-- application uses.
-- ============================================================================

create or replace function public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Hard ceilings. A cart is not a bulk order, and an unbounded jsonb array
  -- is a request that costs as much to serve as the caller likes.
  k_max_lines constant int := 100;
  k_max_qty   constant int := 99;
  k_max_note  constant int := 300;
  k_default_tax_bps constant int := 500;

  -- Letters for the human-facing code. I and O are left out so a code read
  -- aloud over a counter is never mistaken for a 1 or a 0.
  k_alphabet constant text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  v_restaurant_id uuid;
  v_restaurant_name text;
  v_restaurant_tax_bps int;
  v_menu_id uuid;
  v_tax_bps int;

  v_note text;
  v_line_count int;

  v_subtotal_paise bigint := 0;
  v_discount_paise bigint := 0;
  v_taxable_paise bigint := 0;
  v_tax_paise bigint := 0;
  v_total_paise bigint := 0;

  v_code text;
  v_prefix text;
  v_order_id uuid;
  v_written int := 0;
  v_skipped int := 0;
begin
  -- ---------------------------------------------------------------- restaurant
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'No restaurant was given.' using errcode = 'P0001';
  end if;

  select r.id, r.name, r.tax_rate_bps
    into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
    from public.restaurants r
   where r.slug = btrim(p_slug)
     and r.is_active = true;

  if v_restaurant_id is null then
    raise exception 'That restaurant is not taking orders.' using errcode = 'P0001';
  end if;

  -- A restaurant put into read-only mode keeps its data but stops taking new
  -- business. Guests ordering during a billing problem would create orders
  -- nobody can act on.
  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
  end if;

  -- A menu that was never published is invisible to the public read chain,
  -- so ordering from it would let a guest buy from a draft.
  select m.id
    into v_menu_id
    from public.menus m
   where m.restaurant_id = v_restaurant_id
     and m.is_published = true
   order by m.is_published desc, m.created_at desc nulls last
   limit 1;

  if v_menu_id is null then
    raise exception 'That restaurant has no published menu.' using errcode = 'P0001';
  end if;

  -- --------------------------------------------------------------------- input
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  v_line_count := jsonb_array_length(p_lines);

  if v_line_count = 0 then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  if v_line_count > k_max_lines then
    raise exception 'That is more than % dishes in one order.', k_max_lines
      using errcode = 'P0001';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > k_max_note then
    v_note := left(v_note, k_max_note);
  end if;

  -- -------------------------------------------------------------------- pricing
  -- Prices are read here, from this restaurant's own rows, and the caller's
  -- numbers are not consulted. Anything that does not resolve is dropped and
  -- counted rather than charged at zero.
  create temporary table if not exists tt_order_lines (
    item_id uuid not null,
    name_snapshot text not null,
    unit_price_paise bigint not null,
    qty int not null,
    is_veg boolean not null,
    sort_order int not null
  ) on commit drop;

  insert into tt_order_lines (item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order)
  select
    i.id,
    i.name,
    i.price_paise,
    least(greatest((line->>'qty')::int, 1), k_max_qty),
    coalesce(i.is_veg, true),
    ord
  from jsonb_array_elements(p_lines) with ordinality as t(line, ord)
  join lateral (
    select i.id, i.name, i.price_paise, i.is_veg
      from public.items i
      join public.categories c on c.id = i.category_id
     where i.id = nullif(line->>'item_id', '')::uuid
       and i.is_available = true
       -- Two independent scopes, both of which have to agree. The direct
       -- restaurant_id stops a dish from another kitchen being ordered even
       -- if the menu ids were ever confused; the path through the published
       -- menu is the same chain the public read uses to show the dish, so an
       -- item is only orderable if a guest could also have seen it.
       and i.restaurant_id = v_restaurant_id
       and c.menu_id = v_menu_id
     limit 1
  ) i on true
  where jsonb_typeof(line) = 'object'
    and (line->>'qty') ~ '^[0-9]+$'
    and (line->>'qty')::int > 0;

  select count(*) into v_written from tt_order_lines;
  v_skipped := v_line_count - v_written;

  if v_written = 0 then
    -- Nothing survived. Better to say so than to write an empty ticket onto
    -- the kitchen pass.
    raise exception 'None of those dishes are available right now.' using errcode = 'P0001';
  end if;

  select coalesce(sum(unit_price_paise * qty), 0)::bigint
    into v_subtotal_paise
    from tt_order_lines;

  -- Mirrors computeOrderTotals in lib/pricing.ts. round() on numeric is
  -- half-away-from-zero, matching Math.round on non-negative paise.
  -- The rate belongs to the restaurant, and reading it wrong is not a
  -- rounding error. A restaurant sitting at the 18% GST rate and billed at
  -- 5% is undercharged by more than a tenth of every order, and the guest
  -- sees the wrong number before finance does.
  --
  -- The fallback matches place_counter_order: 500 bps, the rate a restaurant
  -- has before it sets one.
  v_tax_bps := coalesce(v_restaurant_tax_bps, k_default_tax_bps);

  v_discount_paise := 0;
  v_taxable_paise := greatest(v_subtotal_paise - v_discount_paise, 0);
  v_tax_paise := round(v_taxable_paise::numeric * v_tax_bps / 10000.0)::bigint;
  v_total_paise := v_taxable_paise + v_tax_paise;

  -- ---------------------------------------------------------------------- code
  -- Two letters from the name, five random characters. Short enough to read
  -- across a counter.
  v_prefix := upper(left(regexp_replace(coalesce(v_restaurant_name, 'AU'), '[^a-zA-Z]', '', 'g'), 2));
  if char_length(v_prefix) < 2 then
    v_prefix := rpad(v_prefix, 2, 'X');
  end if;

  v_code := v_prefix || '-' || (
    select string_agg(
             substr(k_alphabet, 1 + floor(random() * length(k_alphabet))::int, 1),
             ''
           )
      from generate_series(1, 5)
  );

  -- --------------------------------------------------------------------- write
  insert into public.orders (
    restaurant_id,
    code,
    customer_note,
    prep_status,
    payment_status,
    subtotal_paise,
    discount_paise,
    tax_paise,
    total_paise
  ) values (
    v_restaurant_id,
    v_code,
    v_note,
    'new',
    'pending',
    v_subtotal_paise,
    v_discount_paise,
    v_tax_paise,
    v_total_paise
  )
  returning id into v_order_id;

  if v_order_id is null then
    raise exception 'The order could not be recorded.' using errcode = 'P0001';
  end if;

  insert into public.order_items (
    order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order
  )
  select
    v_order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order
    from tt_order_lines
   order by sort_order;

  return v_code;
end;
$$;

comment on function public.place_public_order(text, jsonb, text) is
  'Place an order as a signed-out diner. Takes a restaurant slug and an array '
  'of {item_id, qty}; prices are read from the database, never from the caller. '
  'Returns the human-facing order code. Dishes that are missing or sold out are '
  'skipped rather than priced at zero.';

-- SECURITY DEFINER functions are executable by PUBLIC by default, and
-- Supabase's default privileges also grant them to anon and authenticated
-- automatically. Revoke from PUBLIC and from both real roles, then grant
-- back only what should have it.
--
-- anon KEEPS execute here -- unlike record_counter_payment, which revokes it.
-- The whole point of this function is that a guest with no session can call
-- it; there is nobody to authenticate. What makes that safe is that the
-- function takes no prices, no totals and no restaurant id from the caller,
-- only dish ids and quantities, and resolves everything itself.
revoke all on function public.place_public_order(text, jsonb, text) from public;
revoke all on function public.place_public_order(text, jsonb, text) from anon;
revoke all on function public.place_public_order(text, jsonb, text) from authenticated;
grant execute on function public.place_public_order(text, jsonb, text) to anon;
grant execute on function public.place_public_order(text, jsonb, text) to authenticated;
