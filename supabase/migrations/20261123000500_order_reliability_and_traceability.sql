-- ============================================================================
-- Phase 1: Order Reliability, Idempotent Counter Entry, Attempt Recovery,
--          and Traceable Order Status Timeline
-- ============================================================================
-- 1. public.orders:
--    - counter_idempotency_key uuid + partial unique index (restaurant_id, counter_idempotency_key)
--      preventing duplicate counter/staff orders on double-tap or network retry.
-- 2. public.create_counter_order(..., p_idempotency_key uuid default null):
--    - Idempotent replay by p_idempotency_key, returning placed_at + deduplicated flag.
-- 3. public.recover_public_order_by_attempt(p_slug text, p_guest_token uuid):
--    - Allows a diner's browser to check whether a pending/dropped checkout
--      attempt was already accepted by the server, recovering without duplicates.
-- 4. public.order_status_events + immutable audit trigger on public.orders:
--    - Append-only status transition timeline for placed, confirmed, prep_changed,
--      cancelled, payment_changed, and kot_handoff events.
--    - RLS hides payment_changed events from kitchen/waiter roles while letting
--      all staff inspect kitchen & confirmation lifecycle events for their outlet.

alter table public.orders
  add column if not exists counter_idempotency_key uuid;

create unique index if not exists orders_counter_idempotency_unique
  on public.orders (restaurant_id, counter_idempotency_key)
  where counter_idempotency_key is not null;

-- Drop old 7-arg signature cleanly so callers with 7 or 8 args resolve to one function.
drop function if exists public.create_counter_order(uuid, text, uuid, jsonb, text, text, text);

create or replace function public.create_counter_order(
  p_restaurant_id uuid,
  p_channel text,
  p_table_id uuid default null,
  p_lines jsonb default '[]'::jsonb,
  p_note text default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_idempotency_key uuid default null
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
  v_existing record;
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
  v_placed_at timestamptz;
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

  -- Idempotent replay check before write-gate / line validation so a network
  -- retry of an already-committed order always recovers the exact original ticket.
  if p_idempotency_key is not null then
    select o.id, o.order_session_id, o.code, o.total_paise, o.placed_at
      into v_existing
      from public.orders o
     where o.restaurant_id = p_restaurant_id
       and o.counter_idempotency_key = p_idempotency_key
     limit 1;
    if found then
      return jsonb_build_object(
        'order_id', v_existing.id,
        'order_session_id', v_existing.order_session_id,
        'code', v_existing.code,
        'total_paise', v_existing.total_paise,
        'placed_at', v_existing.placed_at,
        'deduplicated', true
      );
    end if;
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
        gst_mode_snapshot, gst_config_version, tax_rate_bps_snapshot,
        counter_idempotency_key
      ) values (
        p_restaurant_id, p_table_id, v_session_id, p_channel,
        v_code, v_note, 'new', 'pending',
        v_subtotal, 0, v_tax, v_total,
        v_service, v_packaging, v_delivery, v_round_off,
        v_gst_mode, v_gst_version, v_tax_bps,
        p_idempotency_key
      )
      returning id, placed_at into v_order_id, v_placed_at;
      exit;
    exception when unique_violation then
      if p_idempotency_key is not null then
        select o.id, o.order_session_id, o.code, o.total_paise, o.placed_at
          into v_existing
          from public.orders o
         where o.restaurant_id = p_restaurant_id
           and o.counter_idempotency_key = p_idempotency_key
         limit 1;
        if found then
          return jsonb_build_object(
            'order_id', v_existing.id,
            'order_session_id', v_existing.order_session_id,
            'code', v_existing.code,
            'total_paise', v_existing.total_paise,
            'placed_at', v_existing.placed_at,
            'deduplicated', true
          );
        end if;
      end if;
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
    'total_paise', v_total,
    'placed_at', v_placed_at,
    'deduplicated', false
  );
end;
$$;

revoke all on function public.create_counter_order(uuid, text, uuid, jsonb, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_counter_order(uuid, text, uuid, jsonb, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Guest attempt recovery lookup: safely checks whether a browser's attempt UUID
-- was already written as a server order, without guessing short order codes.
-- ---------------------------------------------------------------------------
create or replace function public.recover_public_order_by_attempt(
  p_slug text,
  p_guest_token uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text := btrim(coalesce(p_slug, ''));
  v_row record;
begin
  if v_slug = '' or p_guest_token is null then
    return jsonb_build_object('found', false);
  end if;

  select
    o.id,
    o.code,
    o.placed_at,
    o.prep_status,
    (o.hold_required is true and o.confirmed_at is null) as awaiting_confirmation,
    t.label as table_label
    into v_row
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    left join public.dining_tables t on t.id = o.table_id
   where r.slug = v_slug
     and o.guest_token = p_guest_token
   limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'order_id', v_row.id,
    'code', v_row.code,
    'placed_at', v_row.placed_at,
    'prep_status', v_row.prep_status,
    'awaiting_confirmation', v_row.awaiting_confirmation,
    'table_label', v_row.table_label
  );
end;
$$;

revoke all on function public.recover_public_order_by_attempt(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.recover_public_order_by_attempt(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Traceable order status timeline (append-only event log)
-- ---------------------------------------------------------------------------
create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  event_type text not null check (
    event_type in ('placed', 'confirmed', 'prep_changed', 'cancelled', 'payment_changed', 'kot_handoff')
  ),
  from_status text,
  to_status text not null,
  actor_id uuid,
  actor_role text,
  source text not null default 'db_trigger',
  detail text,
  created_at timestamptz not null default statement_timestamp()
);

create index if not exists order_status_events_order_idx
  on public.order_status_events (order_id, created_at asc);

create index if not exists order_status_events_restaurant_idx
  on public.order_status_events (restaurant_id, created_at desc);

alter table public.order_status_events enable row level security;
revoke all on public.order_status_events from anon, authenticated, service_role;

drop policy if exists order_status_events_staff_read on public.order_status_events;
create policy order_status_events_staff_read on public.order_status_events
  for select to authenticated
  using (
    public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'cashier', 'kitchen', 'waiter'])
    and (
      event_type <> 'payment_changed'
      or public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'cashier'])
    )
  );

grant select on table public.order_status_events to authenticated;

create or replace function public.prevent_order_status_events_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Auth check present for security-definer audit hygiene; rows are strictly append-only.
  if auth.uid() is null and current_user <> 'postgres' then
    raise exception 'Order status history is append-only.' using errcode = '42501';
  end if;
  raise exception 'Order status history is immutable and cannot be modified or deleted.' using errcode = '42501';
end;
$$;

revoke all on function public.prevent_order_status_events_mutation() from public, anon, authenticated, service_role;

drop trigger if exists order_status_events_immutable on public.order_status_events;
create trigger order_status_events_immutable
  before update or delete on public.order_status_events
  for each row execute function public.prevent_order_status_events_mutation();

create or replace function public.record_order_status_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
begin
  if v_actor is not null then
    select m.role::text into v_actor_role
      from public.memberships m
     where m.restaurant_id = new.restaurant_id
       and m.user_id = v_actor
     limit 1;
  end if;
  if v_actor_role is null then
    v_actor_role := case
      when new.guest_token is not null and v_actor is null then 'guest'
      else 'system'
    end;
  end if;

  if tg_op = 'INSERT' then
    insert into public.order_status_events (
      order_id, restaurant_id, event_type, from_status, to_status,
      actor_id, actor_role, source, detail
    ) values (
      new.id,
      new.restaurant_id,
      'placed',
      null,
      new.prep_status,
      v_actor,
      v_actor_role,
      case when new.guest_token is not null then 'guest_order' else 'staff_counter' end,
      case
        when new.hold_required and new.confirmed_at is null then 'awaiting_table_confirmation'
        else 'accepted'
      end
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.confirmed_at is null and new.confirmed_at is not null then
      insert into public.order_status_events (
        order_id, restaurant_id, event_type, from_status, to_status,
        actor_id, actor_role, source, detail
      ) values (
        new.id, new.restaurant_id, 'confirmed', 'awaiting_confirmation', 'confirmed',
        v_actor, v_actor_role, 'staff_confirm', null
      );
    end if;

    if old.prep_status is distinct from new.prep_status then
      insert into public.order_status_events (
        order_id, restaurant_id, event_type, from_status, to_status,
        actor_id, actor_role, source, detail
      ) values (
        new.id,
        new.restaurant_id,
        case when new.prep_status = 'cancelled' then 'cancelled' else 'prep_changed' end,
        old.prep_status,
        new.prep_status,
        v_actor,
        v_actor_role,
        case when new.prep_status = 'cancelled' then 'cancel_order' else 'kitchen_board' end,
        case when new.prep_status = 'cancelled' then new.cancel_reason else null end
      );
    end if;

    if old.payment_status is distinct from new.payment_status then
      insert into public.order_status_events (
        order_id, restaurant_id, event_type, from_status, to_status,
        actor_id, actor_role, source, detail
      ) values (
        new.id, new.restaurant_id, 'payment_changed', old.payment_status, new.payment_status,
        v_actor, v_actor_role, 'payment', null
      );
    end if;

    if old.kot_handoff_status is distinct from new.kot_handoff_status then
      insert into public.order_status_events (
        order_id, restaurant_id, event_type, from_status, to_status,
        actor_id, actor_role, source, detail
      ) values (
        new.id, new.restaurant_id, 'kot_handoff', old.kot_handoff_status, new.kot_handoff_status,
        v_actor, v_actor_role, 'kot_handoff', new.kot_handoff_ref
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.record_order_status_event_trigger() from public, anon, authenticated, service_role;

drop trigger if exists trg_orders_record_status_event on public.orders;
create trigger trg_orders_record_status_event
  after insert or update on public.orders
  for each row execute function public.record_order_status_event_trigger();
