-- WHY A GUEST COULD NOT PLACE AN ORDER, AND WHY IT READ "Reference 21000"
--
-- Supabase preloads the `safeupdate` extension for the `authenticator` role:
--
--   pg_db_role_setting -> authenticator ->
--     session_preload_libraries=supautils, safeupdate
--
-- Every request PostgREST makes runs as `authenticator` (then SET ROLE
-- anon / authenticated), so that library is active for the app and for nothing
-- else. It refuses any UPDATE or DELETE without a WHERE clause, and it raises
-- that refusal with SQLSTATE 21000 -- the same class Postgres uses for a
-- cardinality violation. That is why the guest saw "21000" and why reading the
-- function could not explain it: the code was right, the guard was answering.
--
-- There is exactly one WHERE-less statement in the whole public schema, and it
-- is in this function: the line that folds add-on prices into the dish price on
-- the temporary order table. It had no WHERE because it means "every line".
--
-- The fix is not to silence the guard. It is to say what the statement means:
-- only the lines that HAVE add-ons need their price raised. Same arithmetic,
-- same totals (a line without add-ons was adding zero before), a real predicate
-- now, and one pass over the temp table instead of a correlated subquery per
-- row.
--
-- Nothing else in this function changes.

create or replace function public.place_public_order_core(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null
) returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  k_max_lines constant int := 100;
  k_max_qty   constant int := 99;
  k_max_note  constant int := 300;
  k_max_addons_per_line constant int := 20;
  k_default_tax_bps constant int := 500;
  k_alphabet constant text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  k_uuid_pattern constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

  v_session public.table_verification_sessions%rowtype;
  v_restaurant_id uuid;
  v_restaurant_name text;
  v_restaurant_tax_bps int;
  v_table_id uuid;
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

  if not exists (
    select 1
      from public.menus m
     where m.restaurant_id = v_restaurant_id
       and m.is_published = true
  ) then
    raise exception 'That restaurant has no published menu.' using errcode = 'P0001';
  end if;

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

  create temporary table if not exists tt_order_lines (
    item_id uuid not null,
    name_snapshot text not null,
    unit_price_paise bigint not null,
    qty int not null,
    is_veg boolean not null,
    sort_order int not null,
    variant_id uuid,
    variant_snapshot text,
    addon_ids uuid[] not null default '{}'
  ) on commit drop;

  create temporary table if not exists tt_line_addons (
    sort_order int not null,
    pick int not null,
    name text not null,
    price_paise bigint not null
  ) on commit drop;

  truncate tt_order_lines;
  truncate tt_line_addons;

  insert into tt_order_lines (
    item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_id, variant_snapshot, addon_ids
  )
  select
    i.id,
    i.name,
    coalesce(v.price_paise, i.price_paise),
    least(greatest((line->>'qty')::int, 1), k_max_qty),
    coalesce(i.is_veg, true),
    ord,
    v.id,
    v.name,
    coalesce((
      select array_agg(ids.v)
        from (
          select distinct t.v
            from jsonb_array_elements_text(
                   case
                     when jsonb_typeof(line->'addon_ids') = 'array' then line->'addon_ids'
                     when jsonb_typeof(line->'addonIds') = 'array' then line->'addonIds'
                     else '[]'::jsonb
                   end
                 ) as t(v)
           where t.v ~ k_uuid_pattern
           limit k_max_addons_per_line
        ) ids
    ), '{}')::uuid[]
  from jsonb_array_elements(p_lines) with ordinality as t(line, ord)
  join lateral (
    select i.id, i.name, i.price_paise, i.is_veg
      from public.items i
      join public.categories c on c.id = i.category_id
      join public.menus m
        on m.id = c.menu_id
       and m.restaurant_id = v_restaurant_id
       and m.is_published = true
     where i.id = nullif(coalesce(line->>'item_id', line->>'itemId'), '')::uuid
       and i.is_available = true
       and i.restaurant_id = v_restaurant_id
     limit 1
  ) i on true
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

  insert into tt_line_addons (sort_order, pick, name, price_paise)
  select line_ord, pick, name, price_paise
    from (
      select l.sort_order as line_ord,
             a.name,
             a.price_paise,
             row_number() over (partition by l.sort_order, g.id order by want.ord) as pick,
             g.max_select
        from tt_order_lines l
        cross join lateral unnest(l.addon_ids) with ordinality as want(id, ord)
        join public.item_addons a
          on a.id = want.id
         and a.is_available = true
        join public.item_addon_groups g
          on g.id = a.group_id
         and g.item_id = l.item_id
    ) picked
   where pick <= max_select
   order by line_ord, pick;

  -- THE FIX. This was `update tt_order_lines ... ;` with no predicate, which
  -- safeupdate refuses. A line with no add-ons was only ever having zero added
  -- to it, so restricting the update to the lines that do have add-ons is the
  -- same arithmetic with an honest predicate.
  update tt_order_lines l
     set unit_price_paise = l.unit_price_paise + priced.sum_paise
    from (
      select x.sort_order, sum(x.price_paise)::bigint as sum_paise
        from tt_line_addons x
       group by x.sort_order
    ) priced
   where priced.sort_order = l.sort_order;

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
    variant_snapshot,
    coalesce((
      select array_agg(x.name order by x.pick)
        from tt_line_addons x
       where x.sort_order = tt_order_lines.sort_order
    ), array[]::text[])
    from tt_order_lines
   order by sort_order;

  return v_code;
end;
$$;

revoke all on function public.place_public_order_core(text, jsonb, text, text) from public;
revoke all on function public.place_public_order_core(text, jsonb, text, text) from anon;
revoke all on function public.place_public_order_core(text, jsonb, text, text) from authenticated;
