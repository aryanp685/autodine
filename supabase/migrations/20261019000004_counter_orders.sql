-- ============================================================================
-- AutoDine — migration 0004: authenticated counter-order RPC
--
-- Only owners, managers and cashiers may create a counter order. The RPC takes
-- a restaurant slug only as a selector, then independently verifies the
-- caller's membership and role. Kitchen users and guests cannot call it.
--
-- Prices, availability, variants, tenant ownership, order totals and payment
-- state all come from the database. New counter orders always begin unpaid;
-- cash collection is a separate RPC and never trusts a client payment status.
-- ============================================================================

create or replace function public.place_counter_order(
  p_restaurant_slug text,
  p_items           jsonb,          -- [{item_id, qty, variant_id, addons}]
  p_note            text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant   public.restaurants%rowtype;
  v_role         public.member_role;
  v_order_id     uuid;
  v_code         text;
  v_subtotal     bigint := 0;
  v_tax          bigint := 0;
  v_rate         integer;
  v_entry        jsonb;
  v_item         public.items%rowtype;
  v_variant      public.item_variants%rowtype;
  v_unit         bigint;
  v_qty          integer;
  v_variant_name text;
  v_addons       text[];
  v_lines        jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in with an authorized restaurant account to create a counter order.'
      using errcode = '42501';
  end if;

  select * into v_restaurant
  from public.restaurants r
  where r.slug = p_restaurant_slug and r.is_active;

  if not found then
    raise exception 'Restaurant not found or not accepting orders.' using errcode = 'P0002';
  end if;

  select m.role into v_role
  from public.memberships m
  where m.restaurant_id = v_restaurant.id
    and m.user_id = auth.uid();

  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to create counter orders for this restaurant.'
      using errcode = '42501';
  end if;

  if not public.restaurant_can_write(v_restaurant.id) then
    raise exception 'This restaurant is in read-only mode. Existing data is safe; restore access before taking new orders.'
      using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your order is empty.' using errcode = 'P0002';
  end if;

  v_lines := '[]'::jsonb;

  for v_entry in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_entry->>'qty')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity.' using errcode = 'P0002';
    end if;

    select * into v_item
    from public.items i
    where i.id = (v_entry->>'item_id')::uuid
      and i.restaurant_id = v_restaurant.id
      and i.is_available;

    if not found then
      raise exception 'An item in your order is no longer available.' using errcode = 'P0002';
    end if;

    if v_entry->>'variant_id' is not null then
      select * into v_variant
      from public.item_variants v
      where v.id = (v_entry->>'variant_id')::uuid
        and v.item_id = v_item.id;
      if not found then
        raise exception 'Invalid variant.' using errcode = 'P0002';
      end if;
      v_unit := v_variant.price_paise;
      v_variant_name := v_variant.name;
    else
      v_unit := v_item.price_paise;
      v_variant_name := null;
    end if;

    v_addons := coalesce(
      (select array_agg(a) from jsonb_array_elements_text(
         coalesce(v_entry->'addons', '[]'::jsonb)) a),
      '{}'::text[]);

    v_subtotal := v_subtotal + (v_unit * v_qty::bigint);
    v_lines := v_lines || jsonb_build_object(
      'item_id', v_item.id,
      'name',    v_item.name,
      'unit',    v_unit,
      'qty',     v_qty,
      'variant', v_variant_name,
      'addons',  to_jsonb(v_addons),
      'veg',     v_item.is_veg
    );
  end loop;

  v_rate := coalesce(v_restaurant.tax_rate_bps, 500);
  v_tax  := round(v_subtotal::numeric * v_rate / 10000.0)::bigint;
  v_code := 'C-' || upper(substr(md5(random()::text), 1, 3));

  insert into public.orders(
    restaurant_id, table_id, code, customer_note,
    prep_status, payment_status,
    subtotal_paise, discount_paise, tax_paise, total_paise
  ) values (
    v_restaurant.id, null, v_code, p_note,
    'new', 'pending',
    v_subtotal, 0, v_tax, v_subtotal + v_tax
  )
  returning id into v_order_id;

  insert into public.order_items(
    order_id, item_id, name_snapshot, unit_price_paise, qty,
    variant_snapshot, addons_snapshot, is_veg, sort_order
  )
  select
    v_order_id,
    (l->>'item_id')::uuid,
    l->>'name',
    (l->>'unit')::bigint,
    (l->>'qty')::integer,
    l->>'variant',
    coalesce(
      (select array_agg(a) from jsonb_array_elements_text(
         coalesce(l->'addons', '[]'::jsonb)) a),
      '{}'::text[]),
    (l->>'veg')::boolean,
    t.ord::integer
  from jsonb_array_elements(v_lines) with ordinality as t(l, ord);

  return v_order_id;
end;
$$;

revoke all on function public.place_counter_order(text, jsonb, text) from public, anon;
grant execute on function public.place_counter_order(text, jsonb, text)
  to authenticated, service_role;
