-- 20261112000500 — close the direct order/order-line finance and guest-token read.
--
-- Owner, Manager and Cashier retain the financial projections used by their
-- existing screens through narrowly scoped, read-only views. Kitchen and other
-- ordinary authenticated staff retain only the operational columns they need.
-- No staff projection contains guest_token. Anonymous callers get no direct
-- table/view SELECT. The trusted service_role ACL is intentionally unchanged.

-- Remove table-wide and any legacy column-level SELECT grants from API roles.
-- The second revocation matters because a table-level REVOKE does not remove
-- grants made separately on individual columns.
do $$
declare
  v_relation regclass;
  v_columns text;
begin
  foreach v_relation in array array[
    'public.orders'::regclass,
    'public.order_items'::regclass
  ] loop
    execute format(
      'revoke select on table %s from public, anon, authenticated',
      v_relation
    );

    select string_agg(format('%I', a.attname), ', ' order by a.attnum)
      into v_columns
      from pg_catalog.pg_attribute a
     where a.attrelid = v_relation
       and a.attnum > 0
       and not a.attisdropped;

    if v_columns is not null then
      execute format(
        'revoke select (%s) on table %s from public, anon, authenticated',
        v_columns,
        v_relation
      );
    end if;
  end loop;
end;
$$;

-- Shared authenticated role: only operational order facts and line snapshots.
-- RLS continues to scope these rows to restaurant members. Financial values,
-- payment state, internal cancellation reason and the bearer guest_token are
-- deliberately absent from these grants.
grant select (
  id,
  restaurant_id,
  table_id,
  code,
  customer_note,
  prep_status,
  placed_at,
  updated_at,
  hold_required,
  confirmed_at,
  table_session_id,
  kitchen_announcement_status,
  kitchen_announcement_at,
  kitchen_announcement_error
) on table public.orders to authenticated;

grant select (
  id,
  order_id,
  item_id,
  name_snapshot,
  qty,
  variant_snapshot,
  addons_snapshot,
  is_veg,
  sort_order
) on table public.order_items to authenticated;

-- Views execute with their owner privileges, so RLS on the base tables is not
-- relied on here. The explicit role predicate is the authorization boundary;
-- security_barrier prevents caller-supplied predicates from being pushed ahead
-- of it. Keep these views read-only and never add guest_token to their shape.
create view public.orders_finance
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
  o.kitchen_announcement_error
from public.orders o
where public.has_restaurant_role(
  o.restaurant_id,
  array['owner', 'manager', 'cashier']
);

create view public.order_items_finance
with (security_barrier = true)
as
select
  oi.id,
  oi.order_id,
  oi.item_id,
  oi.name_snapshot,
  oi.unit_price_paise,
  oi.qty,
  oi.variant_snapshot,
  oi.addons_snapshot,
  oi.is_veg,
  oi.sort_order
from public.order_items oi
join public.orders o on o.id = oi.order_id
where public.has_restaurant_role(
  o.restaurant_id,
  array['owner', 'manager', 'cashier']
);

-- Default privileges differ between a clean local database and hosted
-- Supabase. Set the view ACL explicitly in either case.
revoke all on table public.orders_finance, public.order_items_finance
  from public, anon, authenticated;
grant select on table public.orders_finance, public.order_items_finance
  to authenticated, service_role;

comment on view public.orders_finance is
  'Role-scoped order financial projection for Owner, Manager and Cashier. Does not expose guest_token. The role predicate is required because this owner-executed view bypasses base-table RLS.';
comment on view public.order_items_finance is
  'Role-scoped order-line price projection for Owner, Manager and Cashier. The role predicate is required because this owner-executed view bypasses base-table RLS.';

-- Orders and waiter calls previously appeared in Realtime with REPLICA
-- IDENTITY FULL, which serializes whole rows into WAL event payloads. RLS for
-- ordinary Postgres Changes subscriptions is not a narrow column projection,
-- and no client needs the row contents: the kitchen polls its role-scoped
-- reads every five seconds. Remove both tables from the publication rather
-- than relying on client filters as an authorization boundary.
do $$
declare
  v_table text;
begin
  if exists (
    select 1
      from pg_catalog.pg_publication p
     where p.pubname = 'supabase_realtime'
       and p.puballtables
  ) then
    raise exception 'supabase_realtime publishes all tables; disable FOR ALL TABLES or narrow the publication before applying this boundary';
  end if;

  foreach v_table in array array['orders', 'table_waiter_calls'] loop
    if exists (
      select 1
        from pg_catalog.pg_publication_tables p
       where p.pubname = 'supabase_realtime'
         and p.schemaname = 'public'
         and p.tablename = v_table
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', v_table);
    end if;
  end loop;
end;
$$;

alter table public.orders replica identity default;
alter table public.table_waiter_calls replica identity default;
comment on table public.orders is
  'Order and payment source of truth. Staff base-table SELECT is limited to operational columns; Owner/Manager/Cashier financial reads use public.orders_finance. Never publish this table to Supabase Realtime: it contains the guest bearer credential and financial state.';
comment on table public.table_waiter_calls is
  'Waiter-call source of truth. Staff access is tenant-scoped by RLS; read it through the Kitchen loader and do not publish raw rows through Supabase Realtime.';

-- Kitchen staff may prepare or reject unconfirmed orders, but cancellation of
-- an ordinary order depends on payment state. Allowing that action to kitchen
-- would disclose paid/unpaid status through its success/error path. Financial
-- roles keep the existing cancellation flow; held-table rejection remains a
-- separate nonfinancial operation.
create or replace function public.cancel_order(
  p_order_id uuid,
  p_guest_token uuid default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k_guest_window constant interval := interval '10 minutes';
  v_order public.orders%rowtype;
  v_staff boolean := false;
  v_reason text;
begin
  if p_order_id is null then
    raise exception 'That order could not be found.' using errcode = 'P0001';
  end if;

  -- Serialize source mutations with checkout before locking the ticket.
  perform s.id from public.order_sessions s
    join public.orders o on o.order_session_id = s.id
   where o.id = p_order_id and s.restaurant_id = o.restaurant_id
     and ((p_guest_token is not null and o.guest_token = p_guest_token)
       or (p_guest_token is null and exists (
         select 1 from public.memberships m where m.restaurant_id=o.restaurant_id
           and m.user_id=auth.uid() and m.role in ('owner','manager','cashier'))))
   for update of s;

  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.id is null then
    raise exception 'That order could not be found.' using errcode = 'P0001';
  end if;

  -- A staff cancellation can reveal whether a bill is settled, because paid
  -- orders must not be cancelled without a refund path. Keep that operation
  -- with the finance roles; Kitchen receives one generic authorization error.
  if p_guest_token is not null then
    if v_order.guest_token is distinct from p_guest_token then
      raise exception 'That order could not be found.' using errcode = 'P0001';
    end if;
  else
    select exists (
      select 1
        from public.memberships m
       where m.restaurant_id = v_order.restaurant_id
         and m.user_id = auth.uid()
         and m.role in ('owner', 'manager', 'cashier')
    ) into v_staff;

    if not coalesce(v_staff, false) then
      raise exception 'You are not allowed to cancel this order.' using errcode = '42501';
    end if;
  end if;

  -- A pending online attempt is money in flight. Cancelling or repricing the
  -- order underneath it would leave the provider capturing a stale amount.
  if exists (
    select 1 from public.payments p
     where p.order_id = v_order.id
       and p.status = 'pending'
       and p.method = 'online'
  ) then
    raise exception 'An online payment is in progress for this order. Please wait for it to finish or ask staff.' using errcode = 'P0001';
  end if;

  -- Cancelling twice is not an error; preserve the established idempotency.
  if v_order.prep_status = 'cancelled' then
    return jsonb_build_object('status', 'cancelled', 'already', true);
  end if;

  -- Security-definer RPCs bypass the ordinary write policies, so preserve the
  -- subscription read-only gate explicitly for both guest and staff callers.
  -- Check it only after authenticating the caller; the denial is independent of
  -- settlement state and does not reveal whether the order is paid. An already
  -- cancelled retry above remains a no-op/idempotent success.
  if not public.restaurant_can_write(v_order.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before cancelling orders.'
      using errcode = 'P0001';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order has already been paid. A refund has to be handled at the counter.'
      using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'served' then
    raise exception 'This order has already been served.' using errcode = 'P0001';
  end if;

  if p_guest_token is not null then
    if v_order.prep_status <> 'new' then
      raise exception 'The kitchen has already started this order. Please ask the staff.'
        using errcode = 'P0001';
    end if;

    if v_order.placed_at < statement_timestamp() - k_guest_window then
      raise exception 'This order is more than ten minutes old. Please ask the staff to cancel it.'
        using errcode = 'P0001';
    end if;
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    v_reason := case when p_guest_token is not null then 'guest' else 'staff' end;
  end if;

  update public.orders
     set prep_status = 'cancelled',
         cancel_reason = left(v_reason, 120),
         updated_at = now()
   where id = v_order.id;

  return jsonb_build_object('status', 'cancelled', 'already', false);
end;
$$;

revoke all on function public.cancel_order(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_order(uuid, uuid, text) to anon, authenticated;
comment on function public.cancel_order(uuid, uuid, text) is
  'Guest-token cancellation or Owner/Manager/Cashier staff cancellation. Kitchen cannot cancel ordinary orders because the guard depends on payment state; held-table rejection remains separately authorized.';
