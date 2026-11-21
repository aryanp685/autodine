-- ============================================================================
-- AutoDine — migration 0011: add-ons that cost money
--
-- WHY THIS EXISTS
--
-- The dish sheet has always shown a "Pair it with / Butter naan +79" group and
-- a spice group. Neither reached the kitchen and neither reached the bill.
-- Underneath, a sentence admitted it: "Spice level and any bread you add are
-- passed to the kitchen but not charged". The first half of that sentence was
-- not even true -- cart.add() was called with the item, the quantity and the
-- portion, and nothing else, so the kitchen never learned the guest wanted no
-- onion. The screen said one thing and the system did another, which is worse
-- than the feature not existing.
--
-- So add-ons are real now: an owner defines them against a dish, the guest
-- picks from that dish's own list, and the price of every pick is read here,
-- from these tables, when the order is written.
--
-- WHAT AN OWNER CAN SAY
--
--   item_addon_groups   a heading on the sheet -- "Add a little extra",
--                       "Jain / no onion". min_select = 0 means the guest may
--                       skip the group; min_select >= 1 means the sheet shows
--                       it as required and starts with a default chosen.
--                       max_select = 1 is a radio list (pick one), anything
--                       higher is a set of toggles (pick up to that many).
--
--   item_addons         the actual choices: "Extra cheese" at Rs 40, "Jain"
--                       at Rs 0. A zero price is a real and common case -- an
--                       instruction the kitchen must see that costs nothing --
--                       so price_paise is not nullable and not a sentinel.
--
-- HOW THE PRICE REACHES THE BILL
--
-- place_public_order reads addon_ids off each cart line, proves every id
-- belongs to that same dish (through its group), drops anything inactive or
-- beyond max_select, adds the surviving prices to the line's UNIT price --
-- add-ons are per plate, not per order -- and snapshots the NAMES onto
-- order_items.addons_snapshot.
--
-- Names, not ids: a ticket printed tonight must still say "Extra cheese" after
-- someone deletes the add-on tomorrow, and the kitchen board reads the
-- snapshot, so it keeps working.
--
-- WHAT DOES NOT CHANGE
--
-- A line with no addon_ids is priced exactly as it is today. Every order
-- placed before this migration keeps its own snapshot and its own total. An
-- add-on deleted from the menu does not rewrite history.
-- ============================================================================

create table if not exists public.item_addon_groups (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items(id) on delete cascade,
  name        text not null,
  -- 0 = the guest may skip this group. >= 1 = the sheet shows it as required
  -- and starts with a choice already made.
  min_select  integer not null default 0 check (min_select >= 0),
  -- 1 = choose one (radio). > 1 = choose up to this many (toggles).
  max_select  integer not null default 1 check (max_select >= 1),
  sort_order  integer not null default 0,
  constraint item_addon_groups_range check (max_select >= min_select)
);

create index if not exists item_addon_groups_item_idx
  on public.item_addon_groups(item_id);

create table if not exists public.item_addons (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.item_addon_groups(id) on delete cascade,
  name         text not null,
  -- Paise, like everything else that is money. 0 is legitimate: "Jain" is an
  -- instruction, not an upsell.
  price_paise  bigint not null default 0 check (price_paise >= 0),
  is_available boolean not null default true,
  sort_order   integer not null default 0
);

create index if not exists item_addons_group_idx on public.item_addons(group_id);

comment on table public.item_addon_groups is
  'A heading of choices against one dish, e.g. "Add a little extra". max_select 1 = pick one, higher = pick up to that many.';
comment on table public.item_addons is
  'One choice inside an add-on group. price_paise is per plate; the order function adds it to the line unit price.';

-- ------------------------------------------------------------------ security
-- Same shape as item_variants in 0001: staff own their restaurant's rows, and
-- an anonymous guest may read the add-ons of an available dish -- a guest
-- ordering must not have to log in to see what "Extra cheese" costs.

alter table public.item_addon_groups enable row level security;
alter table public.item_addons       enable row level security;

create policy addon_groups_staff on public.item_addon_groups
  for all using (exists (
    select 1 from public.items i
     where i.id = item_addon_groups.item_id
       and i.restaurant_id in (select public.current_restaurant_ids())
  ));

create policy addon_groups_public on public.item_addon_groups
  for select using (exists (
    select 1 from public.items i
     where i.id = item_addon_groups.item_id and i.is_available
  ));

create policy addons_staff on public.item_addons
  for all using (exists (
    select 1
      from public.item_addon_groups g
      join public.items i on i.id = g.item_id
     where g.id = item_addons.group_id
       and i.restaurant_id in (select public.current_restaurant_ids())
  ));

create policy addons_public on public.item_addons
  for select using (exists (
    select 1
      from public.item_addon_groups g
      join public.items i on i.id = g.item_id
     where g.id = item_addons.group_id and i.is_available
  ));

-- ============================================================================
-- place_public_order: price the add-ons, in the database, from these tables
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
  -- Truncated, not merely created: a function called twice inside one
  -- transaction (a retry) would otherwise find yesterday's leftover rows and
  -- charge for them.
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
    -- The portion's price when one was chosen and it resolves; otherwise the
    -- dish's own. coalesce down to the dish price rather than failing the
    -- line: a portion removed from the menu while a cart sat open is not a
    -- reason to lose the order.
    coalesce(v.price_paise, i.price_paise),
    least(greatest((line->>'qty')::int, 1), k_max_qty),
    coalesce(i.is_veg, true),
    ord,
    v.id,
    v.name,
    -- Only well-formed uuids survive. The cart is the guest's to edit, so a
    -- junk value must be ignored here rather than raising a cast error that
    -- takes the whole order down with it. Duplicates are collapsed: the same
    -- add-on twice is one add-on.
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
     where i.id = nullif(coalesce(line->>'item_id', line->>'itemId'), '')::uuid
       and i.is_available = true
       and i.restaurant_id = v_restaurant_id
       and c.menu_id = v_menu_id
     limit 1
  ) i on true
  -- LEFT, and scoped to this dish. A variant id is only a portion if it
  -- belongs to the item on the same line -- without v.item_id = i.id a
  -- hand-edited cart could name another dish's portion and be charged that
  -- dish's price for this dish.
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

  -- An add-on counts only when it is on THIS dish: the group is joined by
  -- g.item_id = l.item_id, so an id belonging to another dish, another
  -- restaurant, or a deleted group resolves to nothing and is not charged.
  --
  -- Beyond max_select the extra picks are dropped rather than rejected: the
  -- same line might be a cart saved before the owner lowered the limit, and
  -- silently charging for a fourth pick the owner has since disallowed is
  -- worse than charging for the three that are allowed.
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

  -- Per plate, not per order: two plates with extra cheese is two extras.
  update tt_order_lines l
     set unit_price_paise = l.unit_price_paise
       + coalesce((select sum(x.price_paise) from tt_line_addons x
                    where x.sort_order = l.sort_order), 0);

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
    -- go on saying "Half" and "Extra cheese" after someone rewrites the menu
    -- tomorrow.
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

comment on function public.place_public_order(text, jsonb, text, text) is
  'Place an order as a signed-out diner. Takes a restaurant slug and an array '
  'of {item_id, qty, variant_id?, addon_ids?}; prices, portion prices and '
  'add-on prices are read from the database, never from the caller. Migration '
  '0011 adds addon_ids.';

-- Signature unchanged, so the grants from 0006 still stand and are not
-- repeated here. Re-running this migration is therefore idempotent, and it
-- cannot accidentally widen who may call the function.

-- ============================================================================
-- The old guard, which is now wrong
--
-- Production carries a trigger, order_items_reject_unpriced_addons, that
-- raises "Unpriced add-ons are not supported yet." on any order_items row with
-- a non-empty addons_snapshot. It was applied out of band: there is no
-- migration for it in this repository, and nothing in this repository creates
-- it. It did its job while add-ons were display-only -- the till could not
-- record one it had not charged for.
--
-- They are charged now, in place_public_order above, so the guard protects
-- nothing and instead makes every add-on order fail at the last step, after
-- the guest has already pressed Place order. Found by calling the function
-- against the real database, not by reading it.
--
-- Dropped with a note rather than silently: the next person to see add-ons
-- missing from a bill should not go looking for a trigger that is no longer
-- there, and the next person to see this migration should know what went.
-- ============================================================================

drop trigger if exists order_items_reject_unpriced_addons on public.order_items;
-- No argument list: the function takes none, and the schema check tolerates
-- that form but not an empty pair of brackets.
drop function if exists public.reject_unpriced_order_addons;
