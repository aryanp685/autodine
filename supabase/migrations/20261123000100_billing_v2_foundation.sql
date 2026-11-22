-- 20261123000100 — Billing Spec v2.0 foundation:
--   1. Restaurants: FSSAI number, bill footer note, optional default charges & round-off flag.
--   2. Orders & Sessions: dine_in/takeaway/delivery channel, discounts, complimentary flag,
--      service/packaging/delivery charges, round-off, mode-aware orders_math_check,
--      extended orders_finance projection, and operational order_channel grant.
--   3. Counter Order Entry (create_counter_order) for walk-in dine-in / takeaway / delivery.
--   4. Role-gated Billing Adjustments (apply_order_billing_adjustment) with document-level
--      GST extraction after discount & charges.
--   5. Split & Partial Counter Payments (record_split_counter_payments) + Audited Refunds
--      (record_counter_refund) preserving immutable original payment rows.
--   6. Invoice Reprint Audit (restaurant_invoice_reprints + record_invoice_reprint) with
--      append-only immutability and ORIGINAL vs DUPLICATE copy tracking.
--   7. Updated issue_closed_session_receipt(uuid, jsonb) supporting FSSAI, bill footer,
--      audited discounts, charges, round-off, and complimentary tickets.
--   8. Owner Billing & Day-End Closing Reports (report_billing_summary, report_day_end_closing).

-- ========================================================= 1. restaurants

alter table public.restaurants
  add column if not exists fssai_number text
    check (fssai_number is null or fssai_number ~ '^[0-9]{14}$'),
  add column if not exists bill_footer_note text
    check (bill_footer_note is null or char_length(bill_footer_note) <= 240),
  add column if not exists default_service_charge_bps integer not null default 0
    check (default_service_charge_bps >= 0 and default_service_charge_bps <= 2000),
  add column if not exists default_packaging_charge_paise bigint not null default 0
    check (default_packaging_charge_paise >= 0 and default_packaging_charge_paise <= 50000),
  add column if not exists default_delivery_charge_paise bigint not null default 0
    check (default_delivery_charge_paise >= 0 and default_delivery_charge_paise <= 100000),
  add column if not exists round_off_enabled boolean not null default false;

comment on column public.restaurants.fssai_number is
  '14-digit FSSAI license number printed on customer bills and tax invoices when set.';
comment on column public.restaurants.bill_footer_note is
  'Short owner-configured thank-you or statutory note printed at the bottom of customer bills.';

create or replace function public.guard_restaurant_billing_configuration()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.tax_rate_bps is distinct from old.tax_rate_bps
     or new.gstin is distinct from old.gstin
     or new.default_service_charge_bps is distinct from old.default_service_charge_bps
     or new.default_packaging_charge_paise is distinct from old.default_packaging_charge_paise
     or new.default_delivery_charge_paise is distinct from old.default_delivery_charge_paise
     or new.round_off_enabled is distinct from old.round_off_enabled then
    if v_actor is null or not public.has_restaurant_role(new.id, array['owner']) then
      raise exception 'Only the restaurant owner can change billing or tax configuration.'
        using errcode = '42501';
    end if;
  end if;

  if new.tax_rate_bps is distinct from old.tax_rate_bps
     and (new.tax_rate_bps is null or new.tax_rate_bps < 0 or new.tax_rate_bps > 3000) then
    raise exception 'Enter a valid tax rate between 0 and 30 percent.'
      using errcode = '23514';
  end if;

  if new.gstin is distinct from old.gstin
     and new.gstin is not null
     and new.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'Enter a GSTIN in the 15-character format or leave it blank.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_restaurant_billing_configuration() from public, anon, authenticated, service_role;

drop trigger if exists restaurants_billing_configuration_guard on public.restaurants;
create trigger restaurants_billing_configuration_guard
  before update of tax_rate_bps, gstin, default_service_charge_bps, default_packaging_charge_paise, default_delivery_charge_paise, round_off_enabled
  on public.restaurants
  for each row execute function public.guard_restaurant_billing_configuration();

-- ============================================== 2. order_sessions & orders

alter table public.order_sessions alter column table_id drop not null;
alter table public.order_sessions
  add column if not exists order_channel text not null default 'dine_in'
    check (order_channel in ('dine_in', 'takeaway', 'delivery')),
  add column if not exists customer_name text,
  add column if not exists customer_phone text;

alter table public.orders
  add column if not exists order_channel text not null default 'dine_in'
    check (order_channel in ('dine_in', 'takeaway', 'delivery')),
  add column if not exists discount_reason text,
  add column if not exists discount_by uuid references public.profiles(id) on delete set null,
  add column if not exists is_complimentary boolean not null default false,
  add column if not exists complimentary_reason text,
  add column if not exists service_charge_paise bigint not null default 0 check (service_charge_paise >= 0),
  add column if not exists packaging_charge_paise bigint not null default 0 check (packaging_charge_paise >= 0),
  add column if not exists delivery_charge_paise bigint not null default 0 check (delivery_charge_paise >= 0),
  add column if not exists round_off_paise bigint not null default 0 check (round_off_paise between -50 and 50);

alter table public.orders drop constraint if exists orders_math_check;
alter table public.orders add constraint orders_math_check check (
  case
    when is_complimentary then
      total_paise = 0 and tax_paise = 0 and discount_paise = subtotal_paise
      and service_charge_paise = 0 and packaging_charge_paise = 0 and delivery_charge_paise = 0
      and round_off_paise = 0
    when gst_mode_snapshot = 'regular' then
      total_paise = greatest(subtotal_paise - discount_paise, 0)
        + service_charge_paise + packaging_charge_paise + delivery_charge_paise + round_off_paise
    else
      total_paise = greatest(subtotal_paise - discount_paise, 0)
        + service_charge_paise + packaging_charge_paise + delivery_charge_paise + tax_paise + round_off_paise
  end
);

grant select (order_channel) on table public.orders to authenticated;

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
  o.round_off_paise
from public.orders o
where public.has_restaurant_role(
  o.restaurant_id,
  array['owner', 'manager', 'cashier']
);

-- ========================================================= 3. payments ledger

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'card', 'upi', 'online', 'manual', 'other'));

alter table public.payment_audit_events drop constraint if exists payment_audit_events_method_check;
alter table public.payment_audit_events add constraint payment_audit_events_method_check
  check (method in ('cash', 'card', 'upi', 'online', 'manual', 'other'));

alter table public.payment_audit_events drop constraint if exists payment_audit_events_event_type_check;
alter table public.payment_audit_events add constraint payment_audit_events_event_type_check
  check (event_type in (
    'cash_collected',
    'card_collected',
    'upi_collected',
    'online_collected',
    'manual_marked_paid',
    'counter_split_recorded',
    'counter_refund_recorded'
  ));

alter table public.payments
  add column if not exists refund_of_payment_id uuid references public.payments(id) on delete restrict,
  add column if not exists refund_reason text,
  add column if not exists split_label text;

create index if not exists payments_refund_of_idx
  on public.payments (refund_of_payment_id)
  where refund_of_payment_id is not null;

-- ========================================== 4. invoice reprint audit table

create table if not exists public.restaurant_invoice_reprints (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.restaurant_invoices(id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  reprinted_by uuid references public.profiles(id) on delete set null,
  format text not null check (format in ('58mm', '80mm', 'a4', 'pdf', 'escpos')),
  copy_number integer not null check (copy_number >= 1),
  reprinted_at timestamptz not null default statement_timestamp(),
  constraint restaurant_invoice_reprints_copy_unique unique (invoice_id, copy_number)
);

create index if not exists restaurant_invoice_reprints_invoice_idx
  on public.restaurant_invoice_reprints (invoice_id, copy_number desc);

alter table public.restaurant_invoice_reprints enable row level security;
revoke all on public.restaurant_invoice_reprints from public, anon, authenticated, service_role;
grant select on public.restaurant_invoice_reprints to authenticated, service_role;

drop policy if exists restaurant_invoice_reprints_finance_read on public.restaurant_invoice_reprints;
create policy restaurant_invoice_reprints_finance_read on public.restaurant_invoice_reprints
  for select to authenticated
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'cashier']));

create or replace function public.restaurant_invoice_reprints_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Invoice reprint audit records are immutable.' using errcode = '42501';
end;
$$;

revoke all on function public.restaurant_invoice_reprints_immutable() from public, anon, authenticated, service_role;

drop trigger if exists restaurant_invoice_reprints_immutable on public.restaurant_invoice_reprints;
create trigger restaurant_invoice_reprints_immutable
  before update or delete on public.restaurant_invoice_reprints
  for each row execute function public.restaurant_invoice_reprints_immutable();

create or replace function public.record_invoice_reprint(
  p_invoice_id uuid,
  p_format text default '80mm'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_invoice public.restaurant_invoices%rowtype;
  v_role public.member_role;
  v_copy integer;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized restaurant account to print this document.' using errcode = '42501';
  end if;
  if p_format not in ('58mm', '80mm', 'a4', 'pdf', 'escpos') then
    raise exception 'Unsupported print format.' using errcode = '22023';
  end if;

  select i.* into v_invoice
    from public.restaurant_invoices i
   where i.id = p_invoice_id
   for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_invoice.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to print this invoice.' using errcode = '42501';
  end if;

  select coalesce(max(r.copy_number), 0) + 1 into v_copy
    from public.restaurant_invoice_reprints r
   where r.invoice_id = v_invoice.id;

  insert into public.restaurant_invoice_reprints (
    invoice_id, restaurant_id, reprinted_by, format, copy_number
  ) values (
    v_invoice.id, v_invoice.restaurant_id, v_actor, p_format, v_copy
  );

  return jsonb_build_object(
    'invoice_id', v_invoice.id,
    'copy_number', v_copy,
    'is_duplicate', (v_copy > 1)
  );
end;
$$;

revoke all on function public.record_invoice_reprint(uuid, text) from public, anon, authenticated;
grant execute on function public.record_invoice_reprint(uuid, text) to authenticated;

-- ============================================== 5. counter order creation

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
  if not found or v_role not in ('owner', 'manager', 'cashier', 'kitchen') then
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

-- ======================================= 6. role-gated billing adjustments

create or replace function public.apply_order_billing_adjustment(
  p_order_id uuid,
  p_discount_paise bigint default 0,
  p_discount_reason text default null,
  p_service_charge_paise bigint default 0,
  p_packaging_charge_paise bigint default 0,
  p_delivery_charge_paise bigint default 0,
  p_round_off boolean default false,
  p_is_complimentary boolean default false,
  p_complimentary_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_order public.orders%rowtype;
  v_role public.member_role;
  v_session public.order_sessions%rowtype;
  v_paid bigint := 0;
  v_discount bigint := coalesce(p_discount_paise, 0);
  v_service bigint := coalesce(p_service_charge_paise, 0);
  v_packaging bigint := coalesce(p_packaging_charge_paise, 0);
  v_delivery bigint := coalesce(p_delivery_charge_paise, 0);
  v_charges bigint := 0;
  v_mode text;
  v_rate integer;
  v_base bigint;
  v_tax bigint := 0;
  v_total bigint := 0;
  v_round bigint := 0;
  v_reason text;
  v_comp_reason text;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized account to adjust billing.' using errcode = '42501';
  end if;

  select o.order_session_id into v_session_id from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if v_session_id is not null then
    select s.* into v_session from public.order_sessions s where s.id = v_session_id for update;
    if found and v_session.status <> 'open' then
      raise exception 'This sitting is already closed; void and reissue to make corrections.' using errcode = 'P0001';
    end if;
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_order.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to adjust this bill.' using errcode = '42501';
  end if;

  if not public.restaurant_can_write(v_order.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before editing bills.' using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'cancelled' then
    raise exception 'Cancelled orders cannot be adjusted.' using errcode = 'P0001';
  end if;
  if v_order.payment_status <> 'pending' then
    raise exception 'Paid orders cannot be discounted or adjusted.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint into v_paid
    from public.payments p
   where p.order_id = v_order.id and p.status = 'recorded';
  if v_paid > 0 then
    raise exception 'Partial payments already exist on this order; adjust before collecting payments.' using errcode = 'P0001';
  end if;

  if p_is_complimentary then
    if v_role not in ('owner', 'manager') then
      raise exception 'Only an owner or manager can mark an order complimentary.' using errcode = '42501';
    end if;
    v_comp_reason := nullif(btrim(coalesce(p_complimentary_reason, '')), '');
    if v_comp_reason is null or char_length(v_comp_reason) < 3 then
      raise exception 'Enter a short reason before marking an order complimentary.' using errcode = '22023';
    end if;

    update public.orders
       set is_complimentary = true,
           complimentary_reason = left(v_comp_reason, 160),
           discount_paise = subtotal_paise,
           discount_reason = 'Complimentary: ' || left(v_comp_reason, 120),
           discount_by = v_actor,
           service_charge_paise = 0,
           packaging_charge_paise = 0,
           delivery_charge_paise = 0,
           round_off_paise = 0,
           tax_paise = 0,
           total_paise = 0,
           updated_at = statement_timestamp()
     where id = v_order.id;

    return jsonb_build_object('order_id', v_order.id, 'total_paise', 0, 'tax_paise', 0, 'is_complimentary', true);
  end if;

  if v_discount < 0 or v_discount > v_order.subtotal_paise then
    raise exception 'Discount must be between ₹0 and the item subtotal.' using errcode = '22023';
  end if;
  if v_discount > 0 then
    if v_role = 'cashier' and v_discount * 100 > v_order.subtotal_paise * 20 then
      raise exception 'Cashiers can apply discounts up to 20%%. Ask a manager or owner for larger discounts.' using errcode = '42501';
    end if;
    v_reason := nullif(btrim(coalesce(p_discount_reason, '')), '');
    if v_reason is null or char_length(v_reason) < 3 then
      raise exception 'Enter a short discount reason (at least 3 characters).' using errcode = '22023';
    end if;
  else
    v_reason := null;
  end if;

  if v_service < 0 or v_packaging < 0 or v_delivery < 0 then
    raise exception 'Charges cannot be negative.' using errcode = '22023';
  end if;
  v_charges := v_service + v_packaging + v_delivery;

  v_mode := coalesce(v_order.gst_mode_snapshot, 'off');
  v_rate := coalesce(v_order.tax_rate_bps_snapshot, 0);
  v_base := greatest(v_order.subtotal_paise - v_discount, 0) + v_charges;

  if v_mode = 'composition' then
    v_tax := 0;
    v_total := v_base;
  elsif v_mode = 'regular' then
    v_tax := v_base - round(v_base::numeric * 10000 / (10000 + v_rate))::bigint;
    v_total := v_base;
  else
    v_tax := round(v_base::numeric * v_rate / 10000.0)::bigint;
    v_total := v_base + v_tax;
  end if;

  if coalesce(p_round_off, false) then
    v_round := (round(v_total::numeric / 100.0)::bigint * 100) - v_total;
    v_total := v_total + v_round;
  end if;

  update public.orders
     set is_complimentary = false,
         complimentary_reason = null,
         discount_paise = v_discount,
         discount_reason = case when v_reason is null then null else left(v_reason, 160) end,
         discount_by = case when v_discount > 0 then v_actor else null end,
         service_charge_paise = v_service,
         packaging_charge_paise = v_packaging,
         delivery_charge_paise = v_delivery,
         round_off_paise = v_round,
         tax_paise = v_tax,
         total_paise = v_total,
         updated_at = statement_timestamp()
   where id = v_order.id;

  return jsonb_build_object(
    'order_id', v_order.id,
    'discount_paise', v_discount,
    'charges_paise', v_charges,
    'round_off_paise', v_round,
    'tax_paise', v_tax,
    'total_paise', v_total,
    'is_complimentary', false
  );
end;
$$;

revoke all on function public.apply_order_billing_adjustment(uuid, bigint, text, bigint, bigint, bigint, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.apply_order_billing_adjustment(uuid, bigint, text, bigint, bigint, bigint, boolean, boolean, text) to authenticated;

-- ================================== 7. split / partial counter settlements

create or replace function public.record_split_counter_payments(
  p_order_id uuid,
  p_splits jsonb,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_order public.orders%rowtype;
  v_role public.member_role;
  v_paid_before bigint := 0;
  v_due bigint := 0;
  v_split_sum bigint := 0;
  v_elem jsonb;
  v_idx integer := 0;
  v_method text;
  v_amt bigint;
  v_label text;
  v_key text;
  v_pid uuid;
  v_payment_ids uuid[] := array[]::uuid[];
  v_paid_after bigint := 0;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized account to collect payment.' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'A payment request key is required.' using errcode = '22023';
  end if;
  if p_splits is null or jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 or jsonb_array_length(p_splits) > 10 then
    raise exception 'Provide between 1 and 10 split payment entries.' using errcode = '22023';
  end if;

  select o.order_session_id into v_session_id from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if v_session_id is not null then
    perform s.id from public.order_sessions s where s.id = v_session_id for update;
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_order.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to collect payments.' using errcode = '42501';
  end if;

  if not public.restaurant_can_write(v_order.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before collecting payments.' using errcode = 'P0001';
  end if;
  if v_order.prep_status = 'cancelled' then
    raise exception 'Cancelled orders cannot be settled.' using errcode = 'P0001';
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'This order is already fully paid.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint into v_paid_before
    from public.payments p
   where p.order_id = v_order.id and p.status = 'recorded';
  v_due := greatest(v_order.total_paise - v_paid_before, 0);

  if v_due = 0 and v_order.total_paise = 0 then
    update public.orders set payment_status = 'paid', updated_at = statement_timestamp() where id = v_order.id;
    return jsonb_build_object('order_id', v_order.id, 'paid_paise', 0, 'outstanding_paise', 0, 'payment_status', 'paid', 'payment_ids', '[]'::jsonb);
  end if;

  for v_elem in select * from jsonb_array_elements(p_splits) loop
    v_idx := v_idx + 1;
    v_method := coalesce(v_elem->>'method', '');
    if v_method not in ('cash', 'card', 'upi', 'other') then
      raise exception 'Split payment method must be cash, card, upi, or other.' using errcode = '22023';
    end if;
    v_amt := coalesce((v_elem->>'amount_paise')::bigint, 0);
    if v_amt <= 0 then
      raise exception 'Each split amount must be greater than zero.' using errcode = '22023';
    end if;
    v_split_sum := v_split_sum + v_amt;
    v_label := nullif(left(btrim(coalesce(v_elem->>'split_label', '')), 60), '');
    v_key := 'split:' || v_order.id::text || ':' || p_idempotency_key::text || ':' || v_idx::text;

    select p.id into v_pid from public.payments p where p.idempotency_key = v_key;
    if found then
      v_payment_ids := array_append(v_payment_ids, v_pid);
      continue;
    end if;

    if v_split_sum > v_due then
      raise exception 'Split payments (% paise) exceed the remaining balance (% paise).', v_split_sum, v_due using errcode = 'P0001';
    end if;

    insert into public.payments (
      order_id, restaurant_id, method, amount_paise, status,
      provider, recorded_by, idempotency_key, split_label
    ) values (
      v_order.id, v_order.restaurant_id, v_method, v_amt, 'recorded',
      'counter_split', v_actor, v_key, v_label
    ) returning id into v_pid;

    insert into public.payment_audit_events (
      restaurant_id, order_id, payment_id, actor_id,
      event_type, method, amount_paise
    ) values (
      v_order.restaurant_id, v_order.id, v_pid, v_actor,
      'counter_split_recorded', v_method, v_amt
    ) on conflict (payment_id, event_type) do nothing;

    v_payment_ids := array_append(v_payment_ids, v_pid);
  end loop;

  select coalesce(sum(p.amount_paise), 0)::bigint into v_paid_after
    from public.payments p
   where p.order_id = v_order.id and p.status = 'recorded';

  if v_paid_after >= v_order.total_paise then
    update public.orders
       set payment_status = 'paid',
           updated_at = statement_timestamp()
     where id = v_order.id;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id,
    'paid_paise', v_paid_after,
    'outstanding_paise', greatest(v_order.total_paise - v_paid_after, 0),
    'payment_status', case when v_paid_after >= v_order.total_paise then 'paid' else 'pending' end,
    'payment_ids', to_jsonb(v_payment_ids)
  );
end;
$$;

revoke all on function public.record_split_counter_payments(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_split_counter_payments(uuid, jsonb, uuid) to authenticated;

-- =============================================== 8. audited counter refunds

create or replace function public.record_counter_refund(
  p_payment_id uuid,
  p_amount_paise bigint,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_order_id uuid;
  v_session_id uuid;
  v_orig public.payments%rowtype;
  v_role public.member_role;
  v_already_refunded bigint := 0;
  v_key text;
  v_refund_id uuid;
  v_reason text;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized account to issue a refund.' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'A refund request key is required.' using errcode = '22023';
  end if;

  select p.order_id, o.order_session_id
    into v_order_id, v_session_id
    from public.payments p
    join public.orders o on o.id = p.order_id
   where p.id = p_payment_id;
  if not found then
    raise exception 'Original recorded payment not found.' using errcode = 'P0002';
  end if;

  if v_session_id is not null then
    perform s.id from public.order_sessions s where s.id = v_session_id for update;
  end if;
  perform o.id from public.orders o where o.id = v_order_id for update;

  select p.* into v_orig from public.payments p where p.id = p_payment_id for update;
  if not found or v_orig.status <> 'recorded' then
    raise exception 'Original recorded payment not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_orig.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can issue refunds.' using errcode = '42501';
  end if;

  if not public.restaurant_can_write(v_orig.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before recording refunds.' using errcode = 'P0001';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'Enter a refund reason (at least 3 characters).' using errcode = '22023';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Refund amount must be positive.' using errcode = '22023';
  end if;

  v_key := 'refund:' || v_orig.id::text || ':' || p_idempotency_key::text;
  select p.id into v_refund_id from public.payments p where p.idempotency_key = v_key;
  if found then
    return jsonb_build_object('refund_id', v_refund_id, 'amount_paise', p_amount_paise, 'already', true);
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint into v_already_refunded
    from public.payments p
   where p.refund_of_payment_id = v_orig.id and p.status = 'refunded';

  if v_already_refunded + p_amount_paise > v_orig.amount_paise then
    raise exception 'Refund exceeds the remaining refundable amount (% paise).',
      greatest(v_orig.amount_paise - v_already_refunded, 0)
      using errcode = 'P0001';
  end if;

  insert into public.payments (
    order_id, restaurant_id, method, amount_paise, status,
    provider, recorded_by, idempotency_key,
    refund_of_payment_id, refund_reason
  ) values (
    v_orig.order_id, v_orig.restaurant_id, v_orig.method, p_amount_paise, 'refunded',
    'counter_refund', v_actor, v_key,
    v_orig.id, left(v_reason, 160)
  ) returning id into v_refund_id;

  insert into public.payment_audit_events (
    restaurant_id, order_id, payment_id, actor_id,
    event_type, method, amount_paise
  ) values (
    v_orig.restaurant_id, v_orig.order_id, v_refund_id, v_actor,
    'counter_refund_recorded', v_orig.method, p_amount_paise
  ) on conflict (payment_id, event_type) do nothing;

  return jsonb_build_object('refund_id', v_refund_id, 'amount_paise', p_amount_paise, 'already', false);
end;
$$;

revoke all on function public.record_counter_refund(uuid, bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.record_counter_refund(uuid, bigint, text, uuid) to authenticated;

-- ======================= 9. issue_closed_session_receipt (Billing v2.0)

create or replace function public.issue_closed_session_receipt(
  p_order_session_id uuid,
  p_recipient jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.order_sessions%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_role public.member_role;
  v_existing public.restaurant_invoices%rowtype;
  v_previous public.restaurant_invoices%rowtype;
  v_issued_at timestamptz := statement_timestamp();
  v_local_date date;
  v_fy_start integer;
  v_fy text;
  v_sequence integer;
  v_invoice_number text;
  v_invoice_id uuid;
  v_seller jsonb;
  v_totals jsonb;
  v_payments jsonb;
  v_order_ids uuid[];
  v_order_count integer;
  v_gst public.restaurant_gst_config%rowtype;
  v_gst_doc_type text := 'receipt';
  v_rate_bps integer := 0;
  v_taxable bigint;
  v_cgst bigint := 0;
  v_sgst bigint := 0;
  v_igst bigint := 0;
  v_profile_notification text;
  v_gst_snapshot jsonb;
  v_irp_status text := 'not_required';
  v_subtotal bigint;
  v_discount bigint;
  v_service bigint;
  v_packaging bigint;
  v_delivery bigint;
  v_other_charges bigint;
  v_round_off bigint;
  v_tax bigint;
  v_total bigint;
  v_paid bigint;
  v_table_label text;
  v_item_count integer;
  v_r_name text;
  v_r_gstin text;
  v_r_state text;
  v_r_address text;
  v_r_email text;
  v_customer jsonb;
  v_alcoholic boolean;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized restaurant account to issue a receipt.'
      using errcode = '42501';
  end if;

  select s.* into v_session
    from public.order_sessions s
   where s.id = p_order_session_id
   for update;
  if not found then
    raise exception 'Table session not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_session.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to issue this receipt.' using errcode = '42501';
  end if;
  if v_session.status <> 'closed' or v_session.closed_at is null then
    raise exception 'Close the table session before issuing its final receipt.' using errcode = 'P0001';
  end if;

  select i.* into v_existing
    from public.restaurant_invoices i
   where i.order_session_id = v_session.id and i.status = 'issued';
  if found then
    return v_existing.id;
  end if;
  if not public.restaurant_can_write(v_session.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before issuing a receipt.'
      using errcode = 'P0001';
  end if;

  select r.* into v_restaurant
    from public.restaurants r
   where r.id = v_session.restaurant_id and r.is_active;
  if not found then
    raise exception 'Restaurant is not active.' using errcode = 'P0001';
  end if;

  select c.* into v_gst
    from public.restaurant_gst_config c
   where c.restaurant_id = v_session.restaurant_id;

  if v_gst.mode = 'regular' then
    if nullif(btrim(coalesce(v_gst.legal_name, '')), '') is null
       or nullif(btrim(coalesce(v_gst.address, '')), '') is null
       or v_gst.gstin is null
       or v_gst.state_code is null
       or v_gst.regular_profile is null
       or v_gst.registration_type <> 'regular' then
      raise exception 'Complete the GST settings before issuing a GST tax invoice: GSTIN, legal name, registered address, state code and the 5%% or 18%% profile.'
        using errcode = 'P0001';
    end if;
    v_gst_doc_type := 'gst_tax_invoice';
  elsif v_gst.mode = 'composition' then
    if nullif(btrim(coalesce(v_gst.legal_name, '')), '') is null
       or nullif(btrim(coalesce(v_gst.address, '')), '') is null
       or v_gst.gstin is null
       or v_gst.state_code is null
       or v_gst.registration_type <> 'composition'
       or not v_gst.composition_acknowledged then
      raise exception 'Complete the composition settings before issuing a Bill of Supply: GSTIN (registration type composition), legal name, registered address, state code and the ineligibility acknowledgment.'
        using errcode = 'P0001';
    end if;
    v_gst_doc_type := 'bill_of_supply';
  else
    if nullif(btrim(v_restaurant.name), '') is null
       or nullif(btrim(v_restaurant.address), '') is null then
      raise exception 'Add the restaurant name and address in Settings before issuing a receipt.'
        using errcode = 'P0001';
    end if;
  end if;

  select exists (
    select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      join public.items i on i.id = oi.item_id
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled'
       and i.is_alcoholic
  ) into v_alcoholic;
  if coalesce(v_gst.mode, 'off') <> 'off' and v_alcoholic then
    raise exception 'This bill contains alcoholic items, which GST cannot tax. Remove or void the alcohol lines (they can be billed outside this GST document) before issuing it.'
      using errcode = 'P0001';
  end if;

  if p_recipient is not null then
    if v_gst_doc_type <> 'gst_tax_invoice' then
      raise exception 'A buyer GSTIN can only be recorded on a GST tax invoice in Regular GST mode. Switch the billing mode to Regular GST, or remove the buyer details.'
        using errcode = 'P0001';
    end if;
    v_r_name := nullif(btrim(coalesce(p_recipient->>'name', '')), '');
    v_r_gstin := upper(nullif(btrim(coalesce(p_recipient->>'gstin', '')), ''));
    v_r_address := nullif(btrim(coalesce(p_recipient->>'address', '')), '');
    v_r_email := lower(nullif(btrim(coalesce(p_recipient->>'email', '')), ''));
    if v_r_name is null or char_length(v_r_name) < 2 then
      raise exception 'Enter the buyer legal name for the GST invoice.' using errcode = 'P0001';
    end if;
    if v_r_gstin is null then
      raise exception 'Enter the buyer GSTIN.' using errcode = 'P0001';
    end if;
    if v_r_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then
      raise exception 'The buyer GSTIN does not match the 2-digit state + PAN + entity + Z + checksum layout. It is not accepted.'
        using errcode = 'P0001';
    end if;
    v_r_state := substr(v_r_gstin, 1, 2);
    if v_r_state::integer < 1 or v_r_state::integer > 38 then
      raise exception 'The buyer GSTIN state code is not one of the GST states.' using errcode = 'P0001';
    end if;
    if v_r_address is not null and char_length(v_r_address) < 5 then
      raise exception 'The buyer billing address must be at least 5 characters, or omitted.' using errcode = 'P0001';
    end if;
    if v_r_email is not null and v_r_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
      raise exception 'The buyer email address does not look usable.' using errcode = 'P0001';
    end if;
    v_customer := jsonb_build_object(
      'name', v_r_name,
      'gstin', v_r_gstin,
      'state_code', v_r_state,
      'pan', substr(v_r_gstin, 3, 10),
      'address', v_r_address,
      'email', v_r_email
    );
  end if;

  select t.label into v_table_label
    from public.dining_tables t
   where t.id = v_session.table_id and t.restaurant_id = v_session.restaurant_id;

  select count(*)::integer,
         coalesce(sum(o.subtotal_paise), 0)::bigint,
         coalesce(sum(o.discount_paise), 0)::bigint,
         coalesce(sum(o.service_charge_paise), 0)::bigint,
         coalesce(sum(o.packaging_charge_paise), 0)::bigint,
         coalesce(sum(o.delivery_charge_paise), 0)::bigint,
         coalesce(sum(o.round_off_paise), 0)::bigint,
         coalesce(sum(o.tax_paise), 0)::bigint,
         coalesce(sum(o.total_paise), 0)::bigint,
         array_agg(o.id order by o.placed_at, o.id)
    into v_order_count, v_subtotal, v_discount, v_service, v_packaging, v_delivery, v_round_off, v_tax, v_total, v_order_ids
    from public.orders o
   where o.order_session_id = v_session.id
     and o.restaurant_id = v_session.restaurant_id
     and o.prep_status <> 'cancelled';
  if v_order_count = 0 then
    raise exception 'This table session has no non-cancelled tickets to bill.' using errcode = 'P0001';
  end if;
  v_other_charges := v_service + v_packaging + v_delivery;

  if coalesce(v_gst.mode, 'off') <> 'off' and exists (
    select 1 from public.orders o
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled'
       and coalesce(o.gst_mode_snapshot, 'off') <> v_gst.mode
  ) then
    raise exception 'This sitting contains tickets priced under a different GST configuration. Close them out, or switch the GST mode back, before issuing a document.'
      using errcode = 'P0001';
  end if;
  if v_gst.mode = 'composition' and exists (
    select 1 from public.orders o
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled'
       and o.tax_paise > 0
  ) then
    raise exception 'This sitting includes tickets that collected tax; a Bill of Supply cannot be issued over them. Void those tickets or switch to Regular GST first.'
      using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = any(v_order_ids) and p.status = 'recorded';

  select count(*)::integer into v_item_count
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where o.order_session_id = v_session.id
     and o.restaurant_id = v_session.restaurant_id
     and o.prep_status <> 'cancelled';
  if v_item_count = 0 then
    raise exception 'Ticket item details are unavailable; a receipt cannot be issued.' using errcode = 'P0001';
  end if;

  if v_gst_doc_type = 'gst_tax_invoice' then
    v_rate_bps := case v_gst.regular_profile when 'specified_premises' then 1800 else 500 end;
    v_taxable := greatest(v_subtotal - v_discount, 0) + v_other_charges - v_tax;
    v_cgst := round(v_tax::numeric / 2)::bigint;
    v_sgst := v_tax - v_cgst;
    v_profile_notification := case v_gst.regular_profile
      when 'specified_premises' then 'Notification No. 05/2025-CT(Rate), w.e.f. 2025-04-01'
      else 'Notification No. 11/2017-CT(Rate), Sl. 7(i), as amended' end;
    v_irp_status := 'not_required';
    if v_r_gstin is not null then
      if v_gst.preceding_fy_turnover_paise is null
         or v_gst.preceding_fy_turnover_paise > 5000000000 then
        v_irp_status := 'pending';
      end if;
    end if;
  elsif v_gst_doc_type = 'bill_of_supply' then
    v_taxable := greatest(v_subtotal - v_discount, 0) + v_other_charges - v_tax;
  else
    v_taxable := null;
  end if;

  begin
    v_local_date := (v_issued_at at time zone coalesce(nullif(v_restaurant.timezone, ''), 'Asia/Kolkata'))::date;
  exception when others then
    v_local_date := (v_issued_at at time zone 'Asia/Kolkata')::date;
  end;
  v_fy_start := extract(year from v_local_date)::integer;
  if extract(month from v_local_date) < 4 then
    v_fy_start := v_fy_start - 1;
  end if;
  v_fy := lpad((v_fy_start % 100)::text, 2, '0') || '-' || lpad(((v_fy_start + 1) % 100)::text, 2, '0');

  insert into public.restaurant_invoice_series (restaurant_id, financial_year, next_number)
  values (v_session.restaurant_id, v_fy, 1)
  on conflict (restaurant_id, financial_year) do nothing;

  select s.next_number into v_sequence
    from public.restaurant_invoice_series s
   where s.restaurant_id = v_session.restaurant_id and s.financial_year = v_fy
   for update;
  if v_sequence > 999999 then
    raise exception 'The invoice series for this financial year has reached its six-digit limit.'
      using errcode = '22003';
  end if;
  update public.restaurant_invoice_series
     set next_number = v_sequence + 1
   where restaurant_id = v_session.restaurant_id and financial_year = v_fy;

  v_invoice_number := 'INV/' || v_fy || '/' || lpad(v_sequence::text, 6, '0');
  if v_gst_doc_type = 'receipt' then
    v_seller := jsonb_build_object(
      'restaurant_id', v_restaurant.id,
      'name', btrim(v_restaurant.name),
      'address', btrim(v_restaurant.address),
      'phone', nullif(btrim(v_restaurant.phone), ''),
      'logo_path', nullif(btrim(v_restaurant.logo_path), ''),
      'fssai_number', nullif(btrim(coalesce(v_restaurant.fssai_number, '')), ''),
      'bill_footer_note', nullif(btrim(coalesce(v_restaurant.bill_footer_note, '')), ''),
      'order_channel', v_session.order_channel
    );
  else
    v_seller := jsonb_build_object(
      'restaurant_id', v_restaurant.id,
      'name', btrim(v_gst.legal_name),
      'legal_name', btrim(v_gst.legal_name),
      'trade_name', nullif(btrim(coalesce(v_gst.trade_name, '')), ''),
      'address', btrim(v_gst.address),
      'phone', nullif(btrim(v_restaurant.phone), ''),
      'logo_path', nullif(btrim(v_restaurant.logo_path), ''),
      'fssai_number', nullif(btrim(coalesce(v_restaurant.fssai_number, '')), ''),
      'bill_footer_note', nullif(btrim(coalesce(v_restaurant.bill_footer_note, '')), ''),
      'order_channel', v_session.order_channel,
      'gstin', v_gst.gstin,
      'pan', nullif(btrim(coalesce(v_gst.pan, '')), ''),
      'state_code', v_gst.state_code,
      'registration_type', v_gst.registration_type
    );
  end if;

  if v_gst_doc_type = 'gst_tax_invoice' or v_gst_doc_type = 'bill_of_supply' then
    v_gst_snapshot := jsonb_build_object(
      'mode', v_gst.mode,
      'regular_profile', v_gst.regular_profile,
      'profile_notification', v_profile_notification,
      'rate_bps', v_rate_bps,
      'cgst_bps', case when v_gst_doc_type = 'gst_tax_invoice' then v_rate_bps / 2 else 0 end,
      'sgst_bps', case when v_gst_doc_type = 'gst_tax_invoice' then v_rate_bps / 2 else 0 end,
      'taxable_paise', v_taxable,
      'cgst_paise', v_cgst,
      'sgst_paise', v_sgst,
      'igst_paise', v_igst,
      'place_of_supply_state_code', v_gst.state_code,
      'inter_state', false,
      'recipient_supplied', (v_r_gstin is not null),
      'config_version', v_gst.config_version,
      'notice', case when v_gst_doc_type = 'bill_of_supply'
        then 'Composition taxable person, not eligible to collect tax on supplies.'
        else null end
    );
  end if;

  v_totals := jsonb_build_object(
    'subtotal_paise', v_subtotal,
    'ticket_discount_paise', v_discount,
    'bill_discount_paise', 0,
    'service_charge_paise', v_service,
    'packaging_charge_paise', v_packaging,
    'delivery_charge_paise', v_delivery,
    'round_off_paise', v_round_off,
    'taxable_paise', v_taxable,
    'tax_paise', case when v_gst_doc_type = 'bill_of_supply' then 0 else v_tax end,
    'cgst_paise', v_cgst,
    'sgst_paise', v_sgst,
    'igst_paise', v_igst,
    'tax_rate_bps', v_rate_bps,
    'other_charges_paise', v_other_charges,
    'total_paise', v_total,
    'amount_paid_paise', v_paid,
    'outstanding_paise', greatest(v_total - v_paid, 0),
    'payment_status', case when v_paid >= v_total then 'paid' else 'unpaid' end
  );

  select coalesce(jsonb_agg(jsonb_build_object(
           'method', p.method,
           'amount_paise', p.amount_paise,
           'received_at', coalesce(p.recorded_at, p.created_at)
         ) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.payments p
   where p.order_id = any(v_order_ids) and p.status = 'recorded';

  select i.* into v_previous
    from public.restaurant_invoices i
   where i.order_session_id = v_session.id and i.status = 'voided'
   order by i.issued_at desc, i.id desc
   limit 1;

  insert into public.restaurant_invoices (
    restaurant_id, order_session_id, invoice_number, financial_year,
    sequence_number, document_type, issued_at, issued_by,
    table_label_snapshot, session_opened_at, session_closed_at,
    seller_snapshot, customer_snapshot, totals_snapshot, payment_snapshot,
    source_order_ids, supersedes_invoice_id,
    gst_snapshot, irp_status,
    recipient_name, recipient_gstin, recipient_state_code,
    recipient_address, recipient_email
  ) values (
    v_session.restaurant_id, v_session.id, v_invoice_number, v_fy,
    v_sequence, v_gst_doc_type, v_issued_at, v_actor,
    coalesce(v_table_label, case v_session.order_channel when 'takeaway' then 'Takeaway' when 'delivery' then 'Delivery' else null end),
    v_session.opened_at, v_session.closed_at,
    v_seller, v_customer, v_totals, v_payments,
    v_order_ids, v_previous.id,
    v_gst_snapshot, v_irp_status,
    v_r_name, v_r_gstin, v_r_state,
    v_r_address, v_r_email
  ) returning id into v_invoice_id;

  insert into public.restaurant_invoice_lines (
    invoice_id, restaurant_id, line_number, source_order_id,
    source_order_item_id, line_snapshot
  )
  select v_invoice_id,
         v_session.restaurant_id,
         row_number() over (order by o.placed_at, o.id, oi.sort_order, oi.id)::integer,
         o.id,
         oi.id,
         jsonb_build_object(
           'ticket_code', o.code,
           'item_name', oi.name_snapshot,
           'variant', oi.variant_snapshot,
           'addons', to_jsonb(oi.addons_snapshot),
           'quantity', oi.qty,
           'unit_price_paise', oi.unit_price_paise,
           'amount_paise', oi.unit_price_paise * oi.qty,
           'is_veg', oi.is_veg
         )
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where o.order_session_id = v_session.id
     and o.restaurant_id = v_session.restaurant_id
     and o.prep_status <> 'cancelled'
   order by o.placed_at, o.id, oi.sort_order, oi.id;

  return v_invoice_id;
end;
$$;

revoke all on function public.issue_closed_session_receipt(uuid, jsonb)
  from public, anon, authenticated, service_role;

-- ============================================ 10. owner billing & Z-reports

create or replace function public.report_billing_summary(
  p_restaurant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_timezone text default 'Asia/Kolkata'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
begin
  if not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    raise exception 'You do not manage this restaurant.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '400 days' then
    raise exception 'Invalid report window.' using errcode = '22023';
  end if;

  v_tz := coalesce(nullif(p_timezone, ''), 'Asia/Kolkata');
  if not exists (select 1 from pg_timezone_names n where n.name = v_tz) then
    v_tz := 'Asia/Kolkata';
  end if;

  return (
    with scoped_orders as (
      select o.* from public.orders o
       where o.restaurant_id = p_restaurant_id
         and o.placed_at >= p_from and o.placed_at < p_to
    ),
    live_orders as (
      select * from scoped_orders where prep_status <> 'cancelled'
    ),
    scoped_invoices as (
      select i.* from public.restaurant_invoices i
       where i.restaurant_id = p_restaurant_id
         and i.issued_at >= p_from and i.issued_at < p_to
    ),
    scoped_payments as (
      select p.* from public.payments p
       where p.restaurant_id = p_restaurant_id
         and p.created_at >= p_from and p.created_at < p_to
    ),
    gst_rows as (
      select
        coalesce(i.gst_snapshot->>'mode', case i.document_type when 'bill_of_supply' then 'composition' else 'normal' end) as mode,
        coalesce((i.gst_snapshot->>'rate_bps')::int, 0) as rate_bps,
        count(*)::int as bills,
        coalesce(sum(coalesce((i.totals_snapshot->>'taxable_paise')::bigint, (i.totals_snapshot->>'subtotal_paise')::bigint)), 0)::bigint as taxable_paise,
        coalesce(sum(coalesce((i.totals_snapshot->>'cgst_paise')::bigint, 0)), 0)::bigint as cgst_paise,
        coalesce(sum(coalesce((i.totals_snapshot->>'sgst_paise')::bigint, 0)), 0)::bigint as sgst_paise,
        coalesce(sum((i.totals_snapshot->>'total_paise')::bigint), 0)::bigint as total_paise
      from scoped_invoices i
      where i.status = 'issued'
      group by 1, 2
    ),
    channel_rows as (
      select o.order_channel as channel,
             count(*)::int as orders,
             coalesce(sum(o.total_paise), 0)::bigint as billed_paise
        from live_orders o
       group by 1
    ),
    reprint_totals as (
      select count(*) filter (where r.copy_number > 1)::int as duplicate_reprints
        from public.restaurant_invoice_reprints r
       where r.restaurant_id = p_restaurant_id
         and r.reprinted_at >= p_from and r.reprinted_at < p_to
    ),
    register_rows as (
      select i.id,
             i.invoice_number,
             i.document_type,
             i.status,
             i.issued_at,
             i.table_label_snapshot as table_label,
             (i.totals_snapshot->>'total_paise')::bigint as total_paise,
             coalesce((i.totals_snapshot->>'tax_paise')::bigint, 0) as tax_paise,
             coalesce((i.totals_snapshot->>'ticket_discount_paise')::bigint, 0) as discount_paise,
             (select count(*)::int from public.restaurant_invoice_reprints r where r.invoice_id = i.id) as print_count
        from scoped_invoices i
       order by i.issued_at desc
       limit 200
    )
    select jsonb_build_object(
      'gst_summary', coalesce((select jsonb_agg(to_jsonb(g) order by g.mode, g.rate_bps) from gst_rows g), '[]'::jsonb),
      'channels', coalesce((select jsonb_agg(to_jsonb(c) order by c.channel) from channel_rows c), '[]'::jsonb),
      'adjustments', jsonb_build_object(
        'discount_paise', coalesce((select sum(discount_paise) from live_orders), 0),
        'complimentary_count', coalesce((select count(*) filter (where is_complimentary) from live_orders), 0),
        'service_charge_paise', coalesce((select sum(service_charge_paise) from live_orders), 0),
        'packaging_charge_paise', coalesce((select sum(packaging_charge_paise) from live_orders), 0),
        'delivery_charge_paise', coalesce((select sum(delivery_charge_paise) from live_orders), 0),
        'round_off_paise', coalesce((select sum(round_off_paise) from live_orders), 0),
        'refunded_paise', coalesce((select sum(amount_paise) filter (where status = 'refunded') from scoped_payments), 0),
        'voided_invoices', coalesce((select count(*) filter (where status = 'voided') from scoped_invoices), 0),
        'duplicate_reprints', (select duplicate_reprints from reprint_totals)
      ),
      'bill_register', coalesce((select jsonb_agg(to_jsonb(r)) from register_rows r), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.report_billing_summary(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.report_billing_summary(uuid, timestamptz, timestamptz, text) to authenticated;

create or replace function public.report_day_end_closing(
  p_restaurant_id uuid,
  p_date date default current_date,
  p_timezone text default 'Asia/Kolkata'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
begin
  if not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    raise exception 'You do not manage this restaurant.' using errcode = '42501';
  end if;
  v_tz := coalesce(nullif(p_timezone, ''), 'Asia/Kolkata');
  if not exists (select 1 from pg_timezone_names n where n.name = v_tz) then
    v_tz := 'Asia/Kolkata';
  end if;

  v_from := (p_date::timestamp at time zone v_tz);
  v_to := ((p_date + 1)::timestamp at time zone v_tz);

  return (
    with day_orders as (
      select * from public.orders o
       where o.restaurant_id = p_restaurant_id
         and o.placed_at >= v_from and o.placed_at < v_to
    ),
    day_payments as (
      select * from public.payments p
       where p.restaurant_id = p_restaurant_id
         and p.created_at >= v_from and p.created_at < v_to
    ),
    day_invoices as (
      select * from public.restaurant_invoices i
       where i.restaurant_id = p_restaurant_id
         and i.issued_at >= v_from and i.issued_at < v_to
    )
    select jsonb_build_object(
      'business_date', p_date::text,
      'timezone', v_tz,
      'gross_sales_paise', coalesce((select sum(subtotal_paise) from day_orders where prep_status <> 'cancelled'), 0),
      'discount_paise', coalesce((select sum(discount_paise) from day_orders where prep_status <> 'cancelled'), 0),
      'charges_paise', coalesce((select sum(service_charge_paise + packaging_charge_paise + delivery_charge_paise) from day_orders where prep_status <> 'cancelled'), 0),
      'tax_paise', coalesce((select sum(tax_paise) from day_orders where prep_status <> 'cancelled'), 0),
      'net_billed_paise', coalesce((select sum(total_paise) from day_orders where prep_status <> 'cancelled'), 0),
      'cash_collected_paise', coalesce((select sum(amount_paise) filter (where status = 'recorded' and method in ('cash', 'manual')) from day_payments), 0),
      'upi_collected_paise', coalesce((select sum(amount_paise) filter (where status = 'recorded' and method = 'upi') from day_payments), 0),
      'card_collected_paise', coalesce((select sum(amount_paise) filter (where status = 'recorded' and method = 'card') from day_payments), 0),
      'other_collected_paise', coalesce((select sum(amount_paise) filter (where status = 'recorded' and method not in ('cash', 'manual', 'upi', 'card')) from day_payments), 0),
      'cash_refunded_paise', coalesce((select sum(amount_paise) filter (where status = 'refunded' and method in ('cash', 'manual')) from day_payments), 0),
      'total_refunded_paise', coalesce((select sum(amount_paise) filter (where status = 'refunded') from day_payments), 0),
      'expected_cash_drawer_paise',
        coalesce((select sum(amount_paise) filter (where status = 'recorded' and method in ('cash', 'manual')) from day_payments), 0)
        - coalesce((select sum(amount_paise) filter (where status = 'refunded' and method in ('cash', 'manual')) from day_payments), 0),
      'issued_invoices', coalesce((select count(*) filter (where status = 'issued') from day_invoices), 0),
      'voided_invoices', coalesce((select count(*) filter (where status = 'voided') from day_invoices), 0),
      'cancelled_orders', coalesce((select count(*) filter (where prep_status = 'cancelled') from day_orders), 0),
      'open_unpaid_orders', coalesce((select count(*) filter (where prep_status <> 'cancelled' and payment_status = 'pending') from day_orders), 0)
    )
  );
end;
$$;

revoke all on function public.report_day_end_closing(uuid, date, text) from public, anon, authenticated;
grant execute on function public.report_day_end_closing(uuid, date, text) to authenticated;
