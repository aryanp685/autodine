-- 20261123000200 — Waiter role, Coupons/Promo Codes engine, and Split Bill into Multiple Invoices.
--   1. Extend public.member_role with 'waiter' and allow waiters to take counter/table orders,
--      confirm held QR tables, and acknowledge/resolve table waiter calls.
--   2. Add restaurant_coupons + order coupon tracking + upsert/toggle/apply RPCs with atomic
--      pre-tax discount & GST/round-off recalculation.
--   3. Add order_sessions.split_from_session_id / split_label and split_order_session_for_billing RPC
--      to split orders or line-item quantities into independent billable sessions/invoices.

-- ========================================================= 1. waiter role

alter type public.member_role add value if not exists 'waiter';

create or replace function public.confirm_table_orders(
  p_table_session_id uuid
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant uuid;
  v_count      integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to confirm a table.' using errcode = 'P0001';
  end if;

  select s.restaurant_id into v_restaurant
    from public.table_verification_sessions s
   where s.id = p_table_session_id;

  if v_restaurant is null then
    raise exception 'That table is no longer on the board.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant
       and m.user_id = auth.uid()
       and m.role::text in ('owner', 'manager', 'kitchen', 'waiter')
  ) then
    raise exception 'Only an owner, manager, kitchen, or waiter login can confirm a table.'
      using errcode = 'P0001';
  end if;

  if not public.restaurant_can_write(v_restaurant) then
    raise exception 'This restaurant is read-only right now, so tickets cannot be confirmed.'
      using errcode = 'P0001';
  end if;

  update public.orders o
     set confirmed_at = statement_timestamp(),
         confirmed_by = auth.uid()
   where o.table_session_id = p_table_session_id
     and o.restaurant_id = v_restaurant
     and o.hold_required
     and o.confirmed_at is null
     and o.prep_status <> 'cancelled';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.confirm_table_orders(uuid) from public, anon, authenticated;
grant execute on function public.confirm_table_orders(uuid) to authenticated;

create or replace function public.claim_table_waiter_call_announcement(p_call_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
begin
  if v_actor is null then raise exception 'Sign in to announce a waiter call.' using errcode = '42501'; end if;
  select c.restaurant_id into v_restaurant_id
    from public.table_waiter_calls c
   where c.id = p_call_id and c.status = 'open'
     and (c.announcement_status = 'pending'
          or (c.announcement_status = 'claimed'
              and c.announcement_claimed_at < statement_timestamp() - interval '2 minutes'))
   for update;
  if not found then return false; end if;
  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = v_actor
       and m.role::text in ('owner', 'manager', 'kitchen', 'cashier', 'waiter')
  ) then raise exception 'You cannot access waiter calls for this restaurant.' using errcode = '42501'; end if;
  update public.table_waiter_calls
     set announcement_status = 'claimed', announcement_claimed_at = statement_timestamp()
   where id = p_call_id
     and (announcement_status = 'pending'
          or (announcement_status = 'claimed'
              and announcement_claimed_at < statement_timestamp() - interval '2 minutes'));
  return found;
end;
$$;

revoke all on function public.claim_table_waiter_call_announcement(uuid) from public, anon, authenticated;
grant execute on function public.claim_table_waiter_call_announcement(uuid) to authenticated;

create or replace function public.record_table_waiter_call_announcement(
  p_call_id uuid,
  p_status text,
  p_failure_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
  v_reason text := left(nullif(btrim(p_failure_reason), ''), 200);
begin
  if v_actor is null then raise exception 'Sign in to record a waiter-call announcement.' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('announced', 'failed') then raise exception 'That announcement result is not valid.' using errcode = '22023'; end if;
  if p_status = 'announced' then v_reason := null; elsif v_reason is null then v_reason := 'Speech did not complete.'; end if;
  select c.restaurant_id into v_restaurant_id
    from public.table_waiter_calls c
   where c.id = p_call_id and c.status = 'open';
  if not found then return false; end if;
  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = v_actor
       and m.role::text in ('owner', 'manager', 'kitchen', 'cashier', 'waiter')
  ) then raise exception 'You cannot access waiter calls for this restaurant.' using errcode = '42501'; end if;
  update public.table_waiter_calls
     set announcement_status = p_status,
         announcement_at = statement_timestamp(),
         announcement_error = v_reason
   where id = p_call_id and restaurant_id = v_restaurant_id and status = 'open';
  return found;
end;
$$;

revoke all on function public.record_table_waiter_call_announcement(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_table_waiter_call_announcement(uuid, text, text) to authenticated;

create or replace function public.resolve_table_waiter_call(p_call_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
begin
  if v_actor is null then raise exception 'Sign in to clear a waiter call.' using errcode = '42501'; end if;
  select c.restaurant_id into v_restaurant_id
    from public.table_waiter_calls c
   where c.id = p_call_id and c.status = 'open'
   for update;
  if not found then return false; end if;
  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = v_actor
       and m.role::text in ('owner', 'manager', 'kitchen', 'cashier', 'waiter')
  ) then raise exception 'You cannot clear waiter calls for this restaurant.' using errcode = '42501'; end if;
  update public.table_waiter_calls
     set status = 'resolved', resolved_at = statement_timestamp(), resolved_by = v_actor
   where id = p_call_id and status = 'open';
  return found;
end;
$$;

revoke all on function public.resolve_table_waiter_call(uuid) from public, anon, authenticated;
grant execute on function public.resolve_table_waiter_call(uuid) to authenticated;

create or replace function public.create_counter_order(
  p_restaurant_id uuid,
  p_channel text,
  p_table_id uuid default null,
  p_lines jsonb default '[]'::jsonb,
  p_note text default null,
  p_customer_name text default null,
  p_customer_phone text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k_alphabet constant text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  k_uuid_pattern constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_actor uuid := auth.uid();
  v_role public.member_role;
  v_restaurant public.restaurants%rowtype;
  v_table public.dining_tables%rowtype;
  v_session_id uuid;
  v_gst_mode text := 'off';
  v_gst_rate integer := 0;
  v_gst_version integer := 0;
  v_tax_bps integer := 0;
  v_subtotal bigint := 0;
  v_packaging bigint := 0;
  v_delivery bigint := 0;
  v_service bigint := 0;
  v_charges bigint := 0;
  v_taxable bigint := 0;
  v_tax bigint := 0;
  v_total bigint := 0;
  v_round_off bigint := 0;
  v_prefix text;
  v_code text;
  v_order_id uuid;
  v_note text;
  v_cname text;
  v_cphone text;
  v_try integer := 0;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized staff account to create an order.' using errcode = '42501';
  end if;

  if p_channel not in ('dine_in', 'takeaway', 'delivery') then
    raise exception 'Choose Dine-in, Takeaway, or Delivery.' using errcode = '22023';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = p_restaurant_id and m.user_id = v_actor;
  if not found or v_role::text not in ('owner', 'manager', 'cashier', 'kitchen', 'waiter') then
    raise exception 'You do not have permission to create counter orders.' using errcode = '42501';
  end if;

  if not public.restaurant_can_write(p_restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before creating orders.' using errcode = 'P0001';
  end if;

  select r.* into v_restaurant
    from public.restaurants r
   where r.id = p_restaurant_id and r.is_active;
  if not found then
    raise exception 'Restaurant not found or inactive.' using errcode = 'P0002';
  end if;

  if p_channel = 'dine_in' then
    if p_table_id is null then
      raise exception 'Choose a table for a dine-in counter order.' using errcode = '22023';
    end if;
    select t.* into v_table
      from public.dining_tables t
     where t.id = p_table_id and t.restaurant_id = p_restaurant_id and t.is_active;
    if not found then
      raise exception 'Table not found or inactive.' using errcode = 'P0002';
    end if;
  elsif p_table_id is not null then
    raise exception 'Takeaway and delivery orders cannot attach to a dining table.' using errcode = '22023';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'Add at least one dish to create an order.' using errcode = '22023';
  end if;

  create temp table if not exists tt_counter_lines (
    sort_order int primary key,
    item_id uuid,
    name_snapshot text,
    unit_price_paise bigint,
    qty int,
    is_veg boolean,
    variant_snapshot text,
    addons_snapshot text[]
  ) on commit drop;
  truncate table tt_counter_lines;

  insert into tt_counter_lines (
    sort_order, item_id, name_snapshot, unit_price_paise, qty, is_veg, variant_snapshot, addons_snapshot
  )
  select
    raw.ord::int,
    i.id,
    i.name,
    coalesce(v.price_paise, i.price_paise) + coalesce((
      select sum(a.price_paise)::bigint
        from public.item_addons a
        join public.item_addon_groups g on g.id = a.group_id and g.item_id = i.id
       where a.is_available
         and a.id = any(
           select (elem.val)::uuid
             from jsonb_array_elements_text(coalesce(raw.line->'addons', '[]'::jsonb)) as elem(val)
            where elem.val ~ k_uuid_pattern
         )
    ), 0),
    (raw.line->>'qty')::int,
    i.is_veg,
    v.name,
    coalesce((
      select array_agg(a.name order by a.sort_order, a.id)
        from public.item_addons a
        join public.item_addon_groups g on g.id = a.group_id and g.item_id = i.id
       where a.is_available
         and a.id = any(
           select (elem.val)::uuid
             from jsonb_array_elements_text(coalesce(raw.line->'addons', '[]'::jsonb)) as elem(val)
            where elem.val ~ k_uuid_pattern
         )
    ), array[]::text[])
  from jsonb_array_elements(p_lines) with ordinality as raw(line, ord)
  join public.items i
    on i.id = (raw.line->>'item_id')::uuid
   and i.restaurant_id = p_restaurant_id
   and i.is_available
  left join public.item_variants v
    on (raw.line->>'variant_id') ~ k_uuid_pattern
   and v.id = (raw.line->>'variant_id')::uuid
   and v.item_id = i.id
  where coalesce(raw.line->>'item_id', '') ~ k_uuid_pattern
    and coalesce(raw.line->>'qty', '') ~ '^[1-9][0-9]?$';

  if (select count(*) from tt_counter_lines) <> jsonb_array_length(p_lines) then
    raise exception 'One or more selected dishes are unavailable or invalid.' using errcode = 'P0001';
  end if;

  select coalesce(sum(unit_price_paise * qty), 0)::bigint into v_subtotal from tt_counter_lines;

  if p_channel in ('takeaway', 'delivery') then
    v_packaging := coalesce(v_restaurant.default_packaging_charge_paise, 0);
  end if;
  if p_channel = 'delivery' then
    v_delivery := coalesce(v_restaurant.default_delivery_charge_paise, 0);
  end if;
  if p_channel = 'dine_in' and coalesce(v_restaurant.default_service_charge_bps, 0) > 0 then
    v_service := round(v_subtotal::numeric * v_restaurant.default_service_charge_bps / 10000.0)::bigint;
  end if;
  v_charges := v_service + v_packaging + v_delivery;

  select p.mode, p.rate_bps, p.config_version
    into v_gst_mode, v_gst_rate, v_gst_version
    from public.gst_pricing(p_restaurant_id) p;

  if v_gst_mode = 'composition' then
    v_tax_bps := 0;
    v_tax := 0;
    v_total := v_subtotal + v_charges;
  elsif v_gst_mode = 'regular' then
    v_tax_bps := coalesce(v_gst_rate, 500);
    v_taxable := round((v_subtotal + v_charges)::numeric * 10000 / (10000 + v_tax_bps))::bigint;
    v_tax := (v_subtotal + v_charges) - v_taxable;
    v_total := v_subtotal + v_charges;
  else
    v_gst_mode := 'off';
    v_gst_version := coalesce(v_gst_version, 0);
    v_tax_bps := coalesce(v_restaurant.tax_rate_bps, 0);
    v_tax := round((v_subtotal + v_charges)::numeric * v_tax_bps / 10000.0)::bigint;
    v_total := v_subtotal + v_charges + v_tax;
  end if;

  if coalesce(v_restaurant.round_off_enabled, false) then
    v_round_off := (round(v_total::numeric / 100.0)::bigint * 100) - v_total;
    v_total := v_total + v_round_off;
  end if;

  v_note := nullif(left(btrim(coalesce(p_note, '')), 300), '');
  v_cname := nullif(left(btrim(coalesce(p_customer_name, '')), 80), '');
  v_cphone := nullif(left(btrim(coalesce(p_customer_phone, '')), 20), '');

  if p_channel = 'dine_in' then
    insert into public.order_sessions (restaurant_id, table_id, order_channel, customer_name, customer_phone)
    values (p_restaurant_id, p_table_id, 'dine_in', v_cname, v_cphone)
    on conflict (table_id) where status = 'open'
    do update set table_id = excluded.table_id
    returning id into v_session_id;
  else
    insert into public.order_sessions (restaurant_id, table_id, order_channel, customer_name, customer_phone)
    values (p_restaurant_id, null, p_channel, v_cname, v_cphone)
    returning id into v_session_id;
  end if;

  v_prefix := upper(left(regexp_replace(coalesce(v_restaurant.name, 'AU'), '[^a-zA-Z]', '', 'g'), 2));
  if char_length(v_prefix) < 2 then
    v_prefix := rpad(v_prefix, 2, 'X');
  end if;

  loop
    v_try := v_try + 1;
    v_code := v_prefix || '-' || (
      select string_agg(substr(k_alphabet, 1 + floor(random() * length(k_alphabet))::int, 1), '')
        from generate_series(1, 5)
    );
    begin
      insert into public.orders (
        restaurant_id, table_id, order_session_id, order_channel,
        code, customer_note, prep_status, payment_status,
        subtotal_paise, discount_paise, tax_paise, total_paise,
        service_charge_paise, packaging_charge_paise, delivery_charge_paise, round_off_paise,
        gst_mode_snapshot, gst_config_version, tax_rate_bps_snapshot
      ) values (
        p_restaurant_id, p_table_id, v_session_id, p_channel,
        v_code, v_note, 'new', 'pending',
        v_subtotal, 0, v_tax, v_total,
        v_service, v_packaging, v_delivery, v_round_off,
        v_gst_mode, v_gst_version, v_tax_bps
      )
      returning id into v_order_id;
      exit;
    exception when unique_violation then
      if v_try >= 8 then raise; end if;
    end;
  end loop;

  insert into public.order_items (
    order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_snapshot, addons_snapshot
  )
  select v_order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
         variant_snapshot, addons_snapshot
    from tt_counter_lines
   order by sort_order;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_session_id', v_session_id,
    'code', v_code,
    'total_paise', v_total
  );
end;
$$;

revoke all on function public.create_counter_order(uuid, text, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.create_counter_order(uuid, text, uuid, jsonb, text, text, text) to authenticated;

-- ======================================= 2. coupons / promo codes

create table if not exists public.restaurant_coupons (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_-]{3,24}$'),
  description text not null default '',
  discount_type text not null check (discount_type in ('percent', 'flat')),
  discount_value bigint not null check (discount_value > 0),
  min_order_paise bigint not null default 0 check (min_order_paise >= 0),
  max_discount_paise bigint check (max_discount_paise is null or max_discount_paise > 0),
  max_uses integer check (max_uses is null or max_uses > 0),
  uses_count integer not null default 0 check (uses_count >= 0),
  valid_from timestamptz,
  valid_until timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint restaurant_coupons_percent_cap check (
    discount_type <> 'percent' or discount_value <= 10000
  ),
  constraint restaurant_coupons_window_check check (
    valid_from is null or valid_until is null or valid_until >= valid_from
  ),
  constraint restaurant_coupons_restaurant_code_unique unique (restaurant_id, code)
);

create index if not exists restaurant_coupons_lookup_idx
  on public.restaurant_coupons (restaurant_id, is_active, code);

alter table public.restaurant_coupons enable row level security;
revoke all on public.restaurant_coupons from anon, authenticated, service_role;

drop policy if exists restaurant_coupons_member_read on public.restaurant_coupons;
create policy restaurant_coupons_member_read on public.restaurant_coupons
  for select to authenticated
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'cashier']));

grant select on table public.restaurant_coupons to authenticated;

alter table public.orders
  add column if not exists coupon_id uuid references public.restaurant_coupons(id) on delete set null,
  add column if not exists coupon_code text;

create or replace view public.orders_finance
with (security_barrier = true)
as
select
  o.id,
  o.restaurant_id,
  o.table_id,
  o.code,
  o.customer_note,
  o.prep_status,
  o.payment_status,
  o.subtotal_paise,
  o.discount_paise,
  o.tax_paise,
  o.total_paise,
  o.placed_at,
  o.updated_at,
  o.tax_rate_bps_snapshot,
  o.hold_required,
  o.confirmed_at,
  o.table_session_id,
  o.order_session_id,
  o.kitchen_announcement_status,
  o.kitchen_announcement_at,
  o.kitchen_announcement_error,
  o.order_channel,
  o.discount_reason,
  o.is_complimentary,
  o.complimentary_reason,
  o.service_charge_paise,
  o.packaging_charge_paise,
  o.delivery_charge_paise,
  o.round_off_paise,
  o.coupon_code
from public.orders o
where public.has_restaurant_role(
  o.restaurant_id,
  array['owner', 'manager', 'cashier']
);

grant select on public.orders_finance to authenticated;

create or replace function public.upsert_restaurant_coupon(
  p_restaurant_id uuid,
  p_code text,
  p_discount_type text,
  p_discount_value bigint,
  p_min_order_paise bigint default 0,
  p_max_discount_paise bigint default null,
  p_max_uses integer default null,
  p_valid_from timestamptz default null,
  p_valid_until timestamptz default null,
  p_description text default '',
  p_is_active boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_desc text := left(btrim(coalesce(p_description, '')), 120);
  v_row public.restaurant_coupons%rowtype;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized account to manage promo codes.' using errcode = '42501';
  end if;
  if not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can create or edit promo codes.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(p_restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before managing promo codes.' using errcode = 'P0001';
  end if;
  if v_code !~ '^[A-Z0-9_-]{3,24}$' then
    raise exception 'Promo code must be 3 to 24 characters using letters, numbers, hyphens, or underscores.' using errcode = '22023';
  end if;
  if p_discount_type not in ('percent', 'flat') then
    raise exception 'Choose percentage or flat discount.' using errcode = '22023';
  end if;
  if p_discount_value is null or p_discount_value <= 0 then
    raise exception 'Discount value must be greater than zero.' using errcode = '22023';
  end if;
  if p_discount_type = 'percent' and p_discount_value > 10000 then
    raise exception 'Percentage discount cannot exceed 100%%.' using errcode = '22023';
  end if;
  if coalesce(p_min_order_paise, 0) < 0 then
    raise exception 'Minimum order amount cannot be negative.' using errcode = '22023';
  end if;
  if p_max_discount_paise is not null and p_max_discount_paise <= 0 then
    raise exception 'Maximum discount cap must be positive or left blank.' using errcode = '22023';
  end if;
  if p_max_uses is not null and p_max_uses <= 0 then
    raise exception 'Usage limit must be at least 1 or left blank.' using errcode = '22023';
  end if;
  if p_valid_from is not null and p_valid_until is not null and p_valid_until < p_valid_from then
    raise exception 'End date must be on or after the start date.' using errcode = '22023';
  end if;

  insert into public.restaurant_coupons (
    restaurant_id, code, description, discount_type, discount_value,
    min_order_paise, max_discount_paise, max_uses, valid_from, valid_until, is_active, updated_at
  ) values (
    p_restaurant_id, v_code, v_desc, p_discount_type, p_discount_value,
    coalesce(p_min_order_paise, 0), p_max_discount_paise, p_max_uses,
    p_valid_from, p_valid_until, coalesce(p_is_active, true), statement_timestamp()
  )
  on conflict (restaurant_id, code) do update set
    description = excluded.description,
    discount_type = excluded.discount_type,
    discount_value = excluded.discount_value,
    min_order_paise = excluded.min_order_paise,
    max_discount_paise = excluded.max_discount_paise,
    max_uses = excluded.max_uses,
    valid_from = excluded.valid_from,
    valid_until = excluded.valid_until,
    is_active = excluded.is_active,
    updated_at = statement_timestamp()
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'code', v_row.code,
    'is_active', v_row.is_active
  );
end;
$$;

revoke all on function public.upsert_restaurant_coupon(uuid, text, text, bigint, bigint, bigint, integer, timestamptz, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.upsert_restaurant_coupon(uuid, text, text, bigint, bigint, bigint, integer, timestamptz, timestamptz, text, boolean) to authenticated;

create or replace function public.toggle_restaurant_coupon(
  p_coupon_id uuid,
  p_is_active boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_coupon public.restaurant_coupons%rowtype;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized account to update promo codes.' using errcode = '42501';
  end if;

  select c.* into v_coupon from public.restaurant_coupons c where c.id = p_coupon_id for update;
  if not found then
    raise exception 'Promo code not found.' using errcode = 'P0002';
  end if;
  if not public.has_restaurant_role(v_coupon.restaurant_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can enable or pause promo codes.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_coupon.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before updating promo codes.' using errcode = 'P0001';
  end if;

  update public.restaurant_coupons
     set is_active = coalesce(p_is_active, false),
         updated_at = statement_timestamp()
   where id = v_coupon.id;

  return coalesce(p_is_active, false);
end;
$$;

revoke all on function public.toggle_restaurant_coupon(uuid, boolean) from public, anon, authenticated;
grant execute on function public.toggle_restaurant_coupon(uuid, boolean) to authenticated;

create or replace function public.apply_coupon_to_order(
  p_order_id uuid,
  p_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_session public.order_sessions%rowtype;
  v_order public.orders%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_coupon public.restaurant_coupons%rowtype;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_paid bigint := 0;
  v_discount bigint := 0;
  v_charges bigint := 0;
  v_mode text;
  v_rate integer;
  v_base bigint;
  v_tax bigint := 0;
  v_total bigint := 0;
  v_round bigint := 0;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized account to apply a promo code.' using errcode = '42501';
  end if;

  select o.order_session_id into v_session_id from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if v_session_id is not null then
    select s.* into v_session from public.order_sessions s where s.id = v_session_id for update;
    if found and v_session.status <> 'open' then
      raise exception 'This sitting is already closed; coupons cannot be changed.' using errcode = 'P0001';
    end if;
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if not public.has_restaurant_role(v_order.restaurant_id, array['owner', 'manager', 'cashier']) then
    raise exception 'You do not have permission to apply promo codes.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_order.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before editing bills.' using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'cancelled' then
    raise exception 'Cancelled orders cannot use promo codes.' using errcode = 'P0001';
  end if;
  if v_order.payment_status <> 'pending' then
    raise exception 'Paid orders cannot apply or remove promo codes.' using errcode = 'P0001';
  end if;
  if v_order.is_complimentary then
    raise exception 'Complimentary orders cannot use promo codes.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint into v_paid
    from public.payments p
   where p.order_id = v_order.id and p.status = 'recorded';
  if v_paid > 0 then
    raise exception 'Partial payments already exist on this order; apply promo codes before collecting payments.' using errcode = 'P0001';
  end if;

  select r.* into v_restaurant from public.restaurants r where r.id = v_order.restaurant_id;

  if v_code = '' then
    v_discount := 0;
  else
    select c.* into v_coupon
      from public.restaurant_coupons c
     where c.restaurant_id = v_order.restaurant_id
       and c.code = v_code
     for update;
    if not found then
      raise exception 'Promo code % was not found.', v_code using errcode = 'P0002';
    end if;
    if not v_coupon.is_active then
      raise exception 'Promo code % is paused.', v_code using errcode = 'P0001';
    end if;
    if v_coupon.valid_from is not null and statement_timestamp() < v_coupon.valid_from then
      raise exception 'Promo code % is not active yet.', v_code using errcode = 'P0001';
    end if;
    if v_coupon.valid_until is not null and statement_timestamp() > v_coupon.valid_until then
      raise exception 'Promo code % has expired.', v_code using errcode = 'P0001';
    end if;
    if v_order.subtotal_paise < v_coupon.min_order_paise then
      raise exception 'Order subtotal is below the minimum required for promo code %.', v_code using errcode = 'P0001';
    end if;
    if v_coupon.max_uses is not null
       and (v_order.coupon_id is distinct from v_coupon.id)
       and v_coupon.uses_count >= v_coupon.max_uses then
      raise exception 'Promo code % has reached its usage limit.', v_code using errcode = 'P0001';
    end if;

    if v_coupon.discount_type = 'percent' then
      v_discount := round(v_order.subtotal_paise::numeric * v_coupon.discount_value / 10000.0)::bigint;
    else
      v_discount := v_coupon.discount_value;
    end if;

    if v_coupon.max_discount_paise is not null and v_discount > v_coupon.max_discount_paise then
      v_discount := v_coupon.max_discount_paise;
    end if;
    if v_discount > v_order.subtotal_paise then
      v_discount := v_order.subtotal_paise;
    end if;

    if v_order.coupon_id is distinct from v_coupon.id then
      update public.restaurant_coupons
         set uses_count = uses_count + 1,
             updated_at = statement_timestamp()
       where id = v_coupon.id;
    end if;
  end if;

  v_charges := v_order.service_charge_paise + v_order.packaging_charge_paise + v_order.delivery_charge_paise;
  v_base := greatest(v_order.subtotal_paise - v_discount, 0) + v_charges;
  v_mode := coalesce(v_order.gst_mode_snapshot, 'off');
  v_rate := coalesce(v_order.tax_rate_bps_snapshot, 0);

  if v_mode = 'composition' then
    v_tax := 0;
    v_total := v_base;
  elsif v_mode = 'regular' then
    v_tax := v_base - round(v_base::numeric * 10000 / (10000 + greatest(v_rate, 0)))::bigint;
    v_total := v_base;
  else
    v_tax := round(v_base::numeric * greatest(v_rate, 0) / 10000.0)::bigint;
    v_total := v_base + v_tax;
  end if;

  if coalesce(v_restaurant.round_off_enabled, false) or v_order.round_off_paise <> 0 then
    v_round := (round(v_total::numeric / 100.0)::bigint * 100) - v_total;
    v_total := v_total + v_round;
  end if;

  update public.orders
     set coupon_id = case when v_code = '' then null else v_coupon.id end,
         coupon_code = case when v_code = '' then null else v_coupon.code end,
         discount_paise = v_discount,
         discount_reason = case when v_code = '' then null else 'Coupon ' || v_coupon.code end,
         discount_by = case when v_code = '' then null else v_actor end,
         tax_paise = v_tax,
         round_off_paise = v_round,
         total_paise = v_total,
         updated_at = statement_timestamp()
   where id = v_order.id;

  return jsonb_build_object(
    'order_id', v_order.id,
    'coupon_code', case when v_code = '' then null else v_coupon.code end,
    'discount_paise', v_discount,
    'tax_paise', v_tax,
    'round_off_paise', v_round,
    'total_paise', v_total
  );
end;
$$;

revoke all on function public.apply_coupon_to_order(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_coupon_to_order(uuid, text) to authenticated;

-- ======================================= 3. split bill into multiple invoices

alter table public.order_sessions
  add column if not exists split_from_session_id uuid references public.order_sessions(id) on delete set null,
  add column if not exists split_label text;

create or replace function public.split_order_session_for_billing(
  p_source_session_id uuid,
  p_order_ids uuid[] default null,
  p_item_splits jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k_alphabet constant text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  k_uuid_pattern constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_actor uuid := auth.uid();
  v_source public.order_sessions%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_table_label text;
  v_split_count integer;
  v_split_label text;
  v_new_session_id uuid;
  v_total_orders integer;
  v_move_count integer;
  v_paid bigint;
  v_source_order public.orders%rowtype;
  v_new_order_id uuid;
  v_prefix text;
  v_code text;
  v_try integer := 0;
  v_remaining_items integer;
  v_split_subtotal bigint := 0;
  v_source_subtotal bigint := 0;
  v_mode text;
  v_rate integer;
  v_charges bigint;
  v_base bigint;
  v_tax bigint;
  v_total bigint;
  v_round bigint;
  v_elem jsonb;
  v_item_id uuid;
  v_split_qty integer;
  v_oi public.order_items%rowtype;
  v_sort integer := 0;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized account to split bills.' using errcode = '42501';
  end if;

  select s.* into v_source
    from public.order_sessions s
   where s.id = p_source_session_id
   for update;
  if not found then
    raise exception 'Table session not found.' using errcode = 'P0002';
  end if;

  if not public.has_restaurant_role(v_source.restaurant_id, array['owner', 'manager', 'cashier']) then
    raise exception 'Only an owner, manager, or cashier can split a bill.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_source.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before splitting bills.' using errcode = 'P0001';
  end if;
  if v_source.status <> 'open' then
    raise exception 'Only open sittings can be split into separate bills.' using errcode = 'P0001';
  end if;

  select r.* into v_restaurant from public.restaurants r where r.id = v_source.restaurant_id;

  select t.label into v_table_label
    from public.dining_tables t
   where t.id = v_source.table_id and t.restaurant_id = v_source.restaurant_id;

  select count(*)::integer + 2 into v_split_count
    from public.order_sessions s
   where s.split_from_session_id = v_source.id;

  v_split_label := coalesce(
    v_table_label,
    v_source.split_label,
    case v_source.order_channel when 'delivery' then 'Delivery' when 'takeaway' then 'Takeaway' else 'Counter' end
  ) || ' · Split ' || v_split_count;

  -- Mode A: move entire unpaid orders from a multi-order sitting into a new billable session.
  if p_order_ids is not null and coalesce(array_length(p_order_ids, 1), 0) > 0 then
    perform 1
      from public.orders o
     where o.order_session_id = v_source.id
       and o.prep_status <> 'cancelled'
     for update;

    select count(*)::integer into v_total_orders
      from public.orders o
     where o.order_session_id = v_source.id
       and o.prep_status <> 'cancelled';

    select count(*)::integer into v_move_count
      from public.orders o
     where o.order_session_id = v_source.id
       and o.id = any(p_order_ids)
       and o.prep_status <> 'cancelled';

    if v_move_count = 0 or v_move_count <> array_length(p_order_ids, 1) then
      raise exception 'Choose valid active orders from this sitting to split.' using errcode = '22023';
    end if;
    if v_move_count >= v_total_orders then
      raise exception 'Keep at least one order on the original bill when splitting.' using errcode = 'P0001';
    end if;

    if exists (
      select 1 from public.orders o
       where o.id = any(p_order_ids) and o.payment_status <> 'pending'
    ) then
      raise exception 'Paid orders cannot be moved to another split bill.' using errcode = 'P0001';
    end if;

    select coalesce(sum(p.amount_paise), 0)::bigint into v_paid
      from public.payments p
     where p.order_id = any(p_order_ids) and p.status = 'recorded';
    if v_paid > 0 then
      raise exception 'Orders with partial payments cannot be moved to another split bill.' using errcode = 'P0001';
    end if;

    insert into public.order_sessions (
      restaurant_id, table_id, order_channel, customer_name, customer_phone, split_from_session_id, split_label
    ) values (
      v_source.restaurant_id, null, v_source.order_channel, v_source.customer_name, v_source.customer_phone,
      v_source.id, v_split_label
    ) returning id into v_new_session_id;

    update public.orders
       set order_session_id = v_new_session_id,
           updated_at = statement_timestamp()
     where id = any(p_order_ids)
       and order_session_id = v_source.id;

    return jsonb_build_object(
      'source_session_id', v_source.id,
      'new_session_id', v_new_session_id,
      'split_label', v_split_label,
      'moved_orders', v_move_count
    );
  end if;

  -- Mode B: split selected item quantities from an unpaid order into a new split order + session.
  if p_item_splits is null or jsonb_typeof(p_item_splits) <> 'array' or jsonb_array_length(p_item_splits) = 0 then
    raise exception 'Select at least one order or item quantity to split into a new bill.' using errcode = '22023';
  end if;

  select o.* into v_source_order
    from public.orders o
   where o.order_session_id = v_source.id
     and o.prep_status <> 'cancelled'
     and o.id in (
       select oi.order_id
         from public.order_items oi
        where oi.id = (
          select (e->>'order_item_id')::uuid
            from jsonb_array_elements(p_item_splits) e
           where (e->>'order_item_id') ~ k_uuid_pattern
           limit 1
        )
     )
   for update;

  if not found then
    raise exception 'Source order for item split was not found in this sitting.' using errcode = 'P0002';
  end if;
  if v_source_order.payment_status <> 'pending' then
    raise exception 'Paid orders cannot be split.' using errcode = 'P0001';
  end if;
  if v_source_order.is_complimentary or v_source_order.discount_paise > 0 then
    raise exception 'Clear discounts or coupons before splitting line items across bills.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint into v_paid
    from public.payments p
   where p.order_id = v_source_order.id and p.status = 'recorded';
  if v_paid > 0 then
    raise exception 'Partial payments already exist on this order; split bills before collecting payments.' using errcode = 'P0001';
  end if;

  insert into public.order_sessions (
    restaurant_id, table_id, order_channel, customer_name, customer_phone, split_from_session_id, split_label
  ) values (
    v_source.restaurant_id, null, v_source.order_channel, v_source.customer_name, v_source.customer_phone,
    v_source.id, v_split_label
  ) returning id into v_new_session_id;

  v_prefix := upper(left(regexp_replace(coalesce(v_restaurant.name, 'AU'), '[^a-zA-Z]', '', 'g'), 2));
  if char_length(v_prefix) < 2 then v_prefix := rpad(v_prefix, 2, 'X'); end if;

  loop
    v_try := v_try + 1;
    v_code := v_prefix || '-' || (
      select string_agg(substr(k_alphabet, 1 + floor(random() * length(k_alphabet))::int, 1), '')
        from generate_series(1, 5)
    );
    begin
      insert into public.orders (
        restaurant_id, table_id, order_session_id, order_channel,
        code, customer_note, prep_status, payment_status,
        subtotal_paise, discount_paise, tax_paise, total_paise,
        service_charge_paise, packaging_charge_paise, delivery_charge_paise, round_off_paise,
        gst_mode_snapshot, gst_config_version, tax_rate_bps_snapshot,
        hold_required, confirmed_at, confirmed_by
      ) values (
        v_source.restaurant_id, v_source.table_id, v_new_session_id, v_source.order_channel,
        v_code, v_source_order.customer_note, v_source_order.prep_status, 'pending',
        0, 0, 0, 0,
        0, 0, 0, 0,
        v_source_order.gst_mode_snapshot, v_source_order.gst_config_version, v_source_order.tax_rate_bps_snapshot,
        v_source_order.hold_required, v_source_order.confirmed_at, v_source_order.confirmed_by
      ) returning id into v_new_order_id;
      exit;
    exception when unique_violation then
      if v_try >= 8 then raise; end if;
    end;
  end loop;

  for v_elem in select * from jsonb_array_elements(p_item_splits) loop
    if coalesce(v_elem->>'order_item_id', '') !~ k_uuid_pattern then
      raise exception 'Invalid order item reference in bill split.' using errcode = '22023';
    end if;
    v_item_id := (v_elem->>'order_item_id')::uuid;
    v_split_qty := coalesce((v_elem->>'quantity')::int, 0);
    if v_split_qty <= 0 then
      raise exception 'Split quantity must be at least 1.' using errcode = '22023';
    end if;

    select oi.* into v_oi
      from public.order_items oi
     where oi.id = v_item_id and oi.order_id = v_source_order.id
     for update;
    if not found then
      raise exception 'All split items must belong to the same selected order.' using errcode = '22023';
    end if;
    if v_split_qty > v_oi.qty then
      raise exception 'Cannot split more quantity than ordered on %.', v_oi.name_snapshot using errcode = '22023';
    end if;

    v_sort := v_sort + 1;
    insert into public.order_items (
      order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
      variant_snapshot, addons_snapshot
    ) values (
      v_new_order_id, v_oi.item_id, v_oi.name_snapshot, v_oi.unit_price_paise, v_split_qty,
      v_oi.is_veg, v_sort, v_oi.variant_snapshot, v_oi.addons_snapshot
    );

    if v_split_qty = v_oi.qty then
      delete from public.order_items where id = v_oi.id;
    else
      update public.order_items set qty = qty - v_split_qty where id = v_oi.id;
    end if;
  end loop;

  select count(*)::integer into v_remaining_items
    from public.order_items oi
   where oi.order_id = v_source_order.id;
  if v_remaining_items = 0 then
    raise exception 'Keep at least one item on the original bill when splitting.' using errcode = 'P0001';
  end if;

  select coalesce(sum(oi.unit_price_paise * oi.qty), 0)::bigint into v_source_subtotal
    from public.order_items oi where oi.order_id = v_source_order.id;
  select coalesce(sum(oi.unit_price_paise * oi.qty), 0)::bigint into v_split_subtotal
    from public.order_items oi where oi.order_id = v_new_order_id;

  v_mode := coalesce(v_source_order.gst_mode_snapshot, 'off');
  v_rate := coalesce(v_source_order.tax_rate_bps_snapshot, 0);

  -- Recompute source order totals
  v_charges := v_source_order.service_charge_paise + v_source_order.packaging_charge_paise + v_source_order.delivery_charge_paise;
  v_base := v_source_subtotal + v_charges;
  if v_mode = 'composition' then
    v_tax := 0; v_total := v_base;
  elsif v_mode = 'regular' then
    v_tax := v_base - round(v_base::numeric * 10000 / (10000 + greatest(v_rate, 0)))::bigint;
    v_total := v_base;
  else
    v_tax := round(v_base::numeric * greatest(v_rate, 0) / 10000.0)::bigint;
    v_total := v_base + v_tax;
  end if;
  v_round := case when coalesce(v_restaurant.round_off_enabled, false) then (round(v_total::numeric / 100.0)::bigint * 100) - v_total else 0 end;
  update public.orders
     set subtotal_paise = v_source_subtotal,
         tax_paise = v_tax,
         round_off_paise = v_round,
         total_paise = v_total + v_round,
         updated_at = statement_timestamp()
   where id = v_source_order.id;

  -- Compute split order totals
  if v_mode = 'composition' then
    v_tax := 0; v_total := v_split_subtotal;
  elsif v_mode = 'regular' then
    v_tax := v_split_subtotal - round(v_split_subtotal::numeric * 10000 / (10000 + greatest(v_rate, 0)))::bigint;
    v_total := v_split_subtotal;
  else
    v_tax := round(v_split_subtotal::numeric * greatest(v_rate, 0) / 10000.0)::bigint;
    v_total := v_split_subtotal + v_tax;
  end if;
  v_round := case when coalesce(v_restaurant.round_off_enabled, false) then (round(v_total::numeric / 100.0)::bigint * 100) - v_total else 0 end;
  update public.orders
     set subtotal_paise = v_split_subtotal,
         tax_paise = v_tax,
         round_off_paise = v_round,
         total_paise = v_total + v_round,
         updated_at = statement_timestamp()
   where id = v_new_order_id;

  return jsonb_build_object(
    'source_session_id', v_source.id,
    'new_session_id', v_new_session_id,
    'new_order_id', v_new_order_id,
    'new_order_code', v_code,
    'split_label', v_split_label
  );
end;
$$;

revoke all on function public.split_order_session_for_billing(uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.split_order_session_for_billing(uuid, uuid[], jsonb) to authenticated;

create or replace function public.fill_split_invoice_table_label()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_split_label text;
begin
  if new.table_label_snapshot is null and new.order_session_id is not null then
    select s.split_label into v_split_label
      from public.order_sessions s
     where s.id = new.order_session_id;
    if v_split_label is not null then
      new.table_label_snapshot := v_split_label;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.fill_split_invoice_table_label() from public, anon, authenticated, service_role;

drop trigger if exists restaurant_invoices_fill_split_label on public.restaurant_invoices;
create trigger restaurant_invoices_fill_split_label
  before insert on public.restaurant_invoices
  for each row
  execute function public.fill_split_invoice_table_label();
