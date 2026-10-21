-- ============================================================================
-- AutoDine — migration 0008: a chosen portion is the price that gets charged
--
-- WHY THIS EXISTS
--
-- The dish sheet offered "Half Rs 250" and "Full Rs 469", let the guest pick
-- one, and charged the menu price either way. Underneath it a sentence said
-- so: "Portions and add-ons you pick here are not charged yet."
--
-- Read that from the guest's side. They are shown two prices, they choose
-- the cheaper one, they are charged the dearer one, and the screen tells
-- them that is what will happen. Nothing is hidden, so nothing here is fraud
-- -- but it is a till dispute on every dish with portions, and the person
-- who has to settle it is the person already run off their feet.
--
-- And from the kitchen's side it is worse than a pricing bug. A half and a
-- full plate are different amounts of food. If the bill does not carry the
-- choice, the ticket does not either, so the pass says "Butter Chicken" and
-- the cook has to ask. The portion picker exists so nobody has to ask.
--
-- WHAT THIS DOES
--
-- place_public_order learns to read a variant_id on a cart line. It looks
-- the portion up on that same dish -- not on any dish -- and uses its price.
-- If the id does not resolve, the line is still written, priced at the dish's
-- menu price, with no portion recorded. That is the same choice the cart
-- makes in lib/cart-pricing.ts: a portion deleted out from under an open
-- cart should not empty the cart.
--
-- The price is read here, in SQL, from item_variants. It is never taken from
-- the caller. A price that arrives from a browser is a price the browser
-- chose, and this function's entire reason for existing is that the caller
-- has no say in what anything costs.
--
-- The portion's NAME is snapshotted onto order_items, not looked up later. A
-- ticket printed tonight must still say "Half" after someone edits the menu
-- tomorrow.
-- ============================================================================

create or replace function public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k_max_lines constant int := 100;
  k_max_qty   constant int := 99;
  k_max_note  constant int := 300;
  k_default_tax_bps constant int := 500;
  k_alphabet constant text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  v_session public.table_verification_sessions%rowtype;
  v_restaurant_id uuid;
  v_restaurant_name text;
  v_restaurant_tax_bps int;
  v_table_id uuid;
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
begin
  -- ---------------------------------------------------------------- session
  if p_session_token is not null then
    if p_session_token !~ '^[A-Fa-f0-9]{64}$' then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select s.* into v_session
      from public.table_verification_sessions s
     where s.token_hash = encode(sha256(p_session_token::bytea), 'hex')
       and s.expires_at > statement_timestamp()
       and s.revoked_at is null;

    if not found then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from public.table_qr_codes q
       where q.id = v_session.qr_code_id
         and q.revoked_at is null
         and q.table_id = v_session.table_id
         and q.restaurant_id = v_session.restaurant_id
    ) then
      raise exception 'Your table verification is no longer valid. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select r.id, r.name, r.tax_rate_bps
      into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
      from public.restaurants r
     where r.id = v_session.restaurant_id
       and r.is_active = true;

    if v_restaurant_id is null then
      raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
    end if;

    select t.id into v_table_id
      from public.dining_tables t
     where t.id = v_session.table_id
       and t.restaurant_id = v_restaurant_id
       and t.is_active = true;

    if v_table_id is null then
      raise exception 'This table is not taking orders right now. Please ask staff.'
        using errcode = 'P0001';
    end if;

    if p_slug is not null and btrim(p_slug) <> '' then
      if not exists (
        select 1 from public.restaurants r
         where r.id = v_restaurant_id and r.slug = btrim(p_slug)
      ) then
        raise exception 'This order is for a different restaurant. Please open the menu again.'
          using errcode = 'P0001';
      end if;
    end if;
  else
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

    v_table_id := null;
  end if;

  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
  end if;

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

  -- ------------------------------------------------------------------- input
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

  -- ----------------------------------------------------------------- pricing
  create temporary table if not exists tt_order_lines (
    item_id uuid not null,
    name_snapshot text not null,
    unit_price_paise bigint not null,
    qty int not null,
    is_veg boolean not null,
    sort_order int not null,
    variant_id uuid,
    variant_snapshot text
  ) on commit drop;

  insert into tt_order_lines (
    item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_id, variant_snapshot
  )
  select
    i.id,
    i.name,
    -- The portion's price when one was chosen and it resolves; otherwise the
    -- dish's own. coalesce down to the dish price rather than failing the
    -- line: a portion removed from the menu while a cart sat open is not a
    -- reason to lose the order.
    coalesce(v.price_paise, i.price_paise),
    least(greatest((line->>'qty')::int, 1), k_max_qty),
    coalesce(i.is_veg, true),
    ord,
    v.id,
    v.name
  from jsonb_array_elements(p_lines) with ordinality as t(line, ord)
  join lateral (
    select i.id, i.name, i.price_paise, i.is_veg
      from public.items i
      join public.categories c on c.id = i.category_id
     where i.id = nullif(coalesce(line->>'item_id', line->>'itemId'), '')::uuid
       and i.is_available = true
       and i.restaurant_id = v_restaurant_id
       and c.menu_id = v_menu_id
     limit 1
  ) i on true
  -- LEFT, and scoped to this dish. A variant id is only a portion if it
  -- belongs to the item on the same line -- without v.item_id = i.id a
  -- hand-edited cart could name another dish's portion and be charged that
  -- dish's price for this dish. Not scoped to the restaurant separately:
  -- item_variants has no restaurant_id column, and the parent item has
  -- already been proven to belong to this restaurant through the published
  -- menu above.
  left join public.item_variants v
    on v.id = nullif(coalesce(line->>'variant_id', line->>'variantId'), '')::uuid
   and v.item_id = i.id
  where jsonb_typeof(line) = 'object'
    and (line->>'qty') ~ '^[0-9]+$'
    and (line->>'qty')::int > 0;

  select count(*) into v_written from tt_order_lines;

  if v_written = 0 then
    raise exception 'None of those dishes are available right now.' using errcode = 'P0001';
  end if;

  select coalesce(sum(unit_price_paise * qty), 0)::bigint
    into v_subtotal_paise
    from tt_order_lines;

  v_tax_bps := coalesce(v_restaurant_tax_bps, k_default_tax_bps);

  v_discount_paise := 0;
  v_taxable_paise := greatest(v_subtotal_paise - v_discount_paise, 0);
  v_tax_paise := round(v_taxable_paise::numeric * v_tax_bps / 10000.0)::bigint;
  v_total_paise := v_taxable_paise + v_tax_paise;

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

  -- -------------------------------------------------------------------- write
  insert into public.orders (
    restaurant_id,
    table_id,
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
    v_table_id,
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
    order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_snapshot, addons_snapshot
  )
  select
    v_order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    -- Snapshotted, not joined at read time. A ticket printed tonight has to
    -- go on saying "Half" after someone rewrites the menu tomorrow.
    variant_snapshot,
    -- Add-ons are not built yet. Written as an empty array rather than
    -- omitted because the column is NOT NULL, and because an empty array
    -- means "none were chosen" -- which is true -- where NULL would mean
    -- "unknown", which is a different and less useful answer.
    array[]::text[]
    from tt_order_lines
   order by sort_order;

  return v_code;
end;
$$;

comment on function public.place_public_order(text, jsonb, text, text) is
  'Place an order as a signed-out diner. Takes a restaurant slug and an array '
  'of {item_id, qty, variant_id?}; prices and portion prices are read from the '
  'database, never from the caller. Migration 0008 adds variant_id.';

-- Signature unchanged, so the grants from 0005 still stand and are not
-- repeated here. Re-running this migration is therefore idempotent, and it
-- cannot accidentally widen who may call the function.
