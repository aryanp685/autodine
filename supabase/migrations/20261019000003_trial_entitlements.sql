-- ============================================================================
-- AutoDine — migration 0003: server-enforced trial and write entitlements
--
-- Product rules approved for this rollout:
--   * A 10-day trial is measured from a server-generated TIMESTAMPTZ.
--   * New workspaces start at creation. Existing rows start when this migration
--     is first applied (the ADD COLUMN default is evaluated by Postgres).
--   * On expiry without an active paid period, restaurant data remains
--     readable but all restaurant-data writes and new orders are denied.
--   * Profile/auth recovery and a future billing/reactivation flow are outside
--     this restaurant-data gate. No payment provider or webhook is selected.
--   * Plan limits are intentionally not stored or enforced in this migration.
--
-- Subscription records are provider-neutral. Only trusted server/webhook code
-- using the service role should create or update them. RLS is not a substitute
-- for safeguarding that key.
-- ============================================================================

-- A non-null server timestamp means every restaurant, including existing
-- records, receives a fresh 10-day trial when this migration is first applied.
alter table public.restaurants
  add column if not exists trial_started_at timestamptz not null default now();

comment on column public.restaurants.trial_started_at is
  'Server-generated start of the 10-day trial; never accept this from a browser.';

create table if not exists public.restaurant_subscriptions (
  restaurant_id     uuid primary key references public.restaurants(id) on delete cascade,
  plan_code         text not null check (plan_code in ('starter','professional','business')),
  status            text not null check (status in ('pending','active','past_due','canceled')),
  current_period_end timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint active_subscription_has_period_end
    check (status <> 'active' or current_period_end is not null)
);

comment on table public.restaurant_subscriptions is
  'Provider-neutral billing entitlement state. Trusted server writes only; provider integration is not implemented.';

alter table public.restaurant_subscriptions enable row level security;
revoke all on public.restaurant_subscriptions from public, anon, authenticated;
grant select on public.restaurant_subscriptions to authenticated;
grant all on public.restaurant_subscriptions to service_role;

create policy restaurant_subscriptions_read on public.restaurant_subscriptions
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));

-- A single database predicate is used by both RLS write policies and the
-- SECURITY DEFINER place_order() function. statement_timestamp() is server
-- time; client clocks are never consulted.
create or replace function public.restaurant_can_write(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
      -- Authenticated callers may inspect only a workspace they belong to.
      -- Null auth.uid() is reserved for the trusted guest-order RPC, which is
      -- SECURITY DEFINER and performs its own restaurant/token checks.
      and (
        auth.uid() is null
        or exists (
          select 1
          from public.memberships m
          where m.restaurant_id = r.id
            and m.user_id = auth.uid()
        )
      )
      and (
        r.trial_started_at + interval '10 days' > statement_timestamp()
        or exists (
          select 1
          from public.restaurant_subscriptions s
          where s.restaurant_id = r.id
            and s.status = 'active'
            and s.current_period_end > statement_timestamp()
        )
      )
  );
$$;

revoke all on function public.restaurant_can_write(uuid) from public, anon;
grant execute on function public.restaurant_can_write(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- orders
-- Public guests can only create a new order through place_order(), which is
-- SECURITY DEFINER and performs its own checks. Direct restaurant writes are
-- RLS-gated; reads remain available even after trial expiry.

create or replace function public.place_order(
  p_restaurant_slug text,
  p_table_token     text,
  p_items           jsonb,
  p_note            text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant  public.restaurants%rowtype;
  v_table       public.dining_tables%rowtype;
  v_order_id    uuid;
  v_code        text;
  v_subtotal    bigint := 0;
  v_tax         bigint := 0;
  v_rate        integer;
  v_entry       jsonb;
  v_item        public.items%rowtype;
  v_variant     public.item_variants%rowtype;
  v_unit        bigint;
  v_qty         integer;
  v_variant_name text;
  v_addons      text[];
  v_lines       jsonb;
begin
  select * into v_restaurant
  from public.restaurants r
  where r.slug = p_restaurant_slug and r.is_active;

  if not found then
    raise exception 'Restaurant not found or not accepting orders.' using errcode = 'P0002';
  end if;

  if not public.restaurant_can_write(v_restaurant.id) then
    raise exception 'This restaurant is in read-only mode. Existing data is safe; contact the restaurant to restore ordering.'
      using errcode = 'P0001';
  end if;

  select t.* into v_table
  from public.qr_tokens qt
  join public.dining_tables t on t.id = qt.table_id
  where qt.token = p_table_token
    and qt.expires_at > now()
    and t.restaurant_id = v_restaurant.id
    and t.is_active;

  if not found then
    raise exception 'This table code has expired. Please ask staff for a new one.'
      using errcode = 'P0002';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
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
  v_code := upper(substr(md5(random()::text), 1, 3));

  insert into public.orders(
    restaurant_id, table_id, code, customer_note,
    prep_status, payment_status,
    subtotal_paise, discount_paise, tax_paise, total_paise
  ) values (
    v_restaurant.id, v_table.id, v_code, p_note,
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

-- ---------------------------------------------------------------- RLS writes
-- Separate read policies from write policies so expired accounts retain all
-- their existing reads while restaurant-data mutations are denied.

-- Restaurants: retain restaurants_read; gate only settings updates.
drop policy if exists restaurants_update on public.restaurants;
create policy restaurants_update on public.restaurants
  for update to authenticated
  using (
    id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(id)
  )
  with check (
    id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(id)
  );

-- Menus
 drop policy if exists menus_staff on public.menus;
create policy menus_staff_read on public.menus
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));
create policy menus_staff_insert on public.menus
  for insert to authenticated
  with check (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
create policy menus_staff_update on public.menus
  for update to authenticated
  using (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
create policy menus_staff_delete on public.menus
  for delete to authenticated
  using (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );

-- Categories
 drop policy if exists categories_staff on public.categories;
create policy categories_staff_read on public.categories
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));
create policy categories_staff_insert on public.categories
  for insert to authenticated
  with check (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
create policy categories_staff_update on public.categories
  for update to authenticated
  using (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
create policy categories_staff_delete on public.categories
  for delete to authenticated
  using (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );

-- Items
 drop policy if exists items_staff on public.items;
create policy items_staff_read on public.items
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));
create policy items_staff_insert on public.items
  for insert to authenticated
  with check (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
create policy items_staff_update on public.items
  for update to authenticated
  using (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
create policy items_staff_delete on public.items
  for delete to authenticated
  using (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );

-- Item variants
 drop policy if exists variants_staff on public.item_variants;
create policy variants_staff_read on public.item_variants
  for select to authenticated
  using (exists (
    select 1 from public.items i
    where i.id = item_variants.item_id
      and i.restaurant_id in (select public.current_restaurant_ids())
  ));
create policy variants_staff_insert on public.item_variants
  for insert to authenticated
  with check (exists (
    select 1 from public.items i
    where i.id = item_variants.item_id
      and i.restaurant_id in (select public.current_restaurant_ids())
      and public.restaurant_can_write(i.restaurant_id)
  ));
create policy variants_staff_update on public.item_variants
  for update to authenticated
  using (exists (
    select 1 from public.items i
    where i.id = item_variants.item_id
      and i.restaurant_id in (select public.current_restaurant_ids())
      and public.restaurant_can_write(i.restaurant_id)
  ))
  with check (exists (
    select 1 from public.items i
    where i.id = item_variants.item_id
      and i.restaurant_id in (select public.current_restaurant_ids())
      and public.restaurant_can_write(i.restaurant_id)
  ));
create policy variants_staff_delete on public.item_variants
  for delete to authenticated
  using (exists (
    select 1 from public.items i
    where i.id = item_variants.item_id
      and i.restaurant_id in (select public.current_restaurant_ids())
      and public.restaurant_can_write(i.restaurant_id)
  ));

-- Dining tables and QR tokens
 drop policy if exists tables_staff on public.dining_tables;
create policy tables_staff_read on public.dining_tables
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));
create policy tables_staff_insert on public.dining_tables
  for insert to authenticated
  with check (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
create policy tables_staff_update on public.dining_tables
  for update to authenticated
  using (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
create policy tables_staff_delete on public.dining_tables
  for delete to authenticated
  using (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );

drop policy if exists qr_tokens_staff on public.qr_tokens;
create policy qr_tokens_staff_read on public.qr_tokens
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));
create policy qr_tokens_staff_insert on public.qr_tokens
  for insert to authenticated
  with check (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
create policy qr_tokens_staff_update on public.qr_tokens
  for update to authenticated
  using (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
create policy qr_tokens_staff_delete on public.qr_tokens
  for delete to authenticated
  using (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );

-- Orders remain readable and staff updates are gated. Remove direct staff
-- INSERT access: it bypassed database pricing/quantity/availability checks.
-- Order creation must go through a trusted server function. Guest ordering is
-- currently the only implemented path; counter/cashier creation stays disabled
-- until its dedicated server-side RPC is implemented and tested.
drop policy if exists orders_staff_update on public.orders;
create policy orders_staff_update on public.orders
  for update to authenticated
  using (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
drop policy if exists orders_staff_insert on public.orders;
revoke insert on table public.orders from public, anon, authenticated;
grant insert on table public.orders to service_role;

-- order_items are immutable snapshots written by place_order(). Direct staff
-- INSERT access is removed so snapshots cannot be forged or appended.
drop policy if exists order_items_insert on public.order_items;
revoke insert on table public.order_items from public, anon, authenticated;
grant insert on table public.order_items to service_role;

drop policy if exists payments_staff on public.payments;
create policy payments_staff_read on public.payments
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));
create policy payments_staff_insert on public.payments
  for insert to authenticated
  with check (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
create policy payments_staff_update on public.payments
  for update to authenticated
  using (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
create policy payments_staff_delete on public.payments
  for delete to authenticated
  using (
    restaurant_id in (select public.current_restaurant_ids())
    and public.restaurant_can_write(restaurant_id)
  );
