-- ============================================================================
-- AutoDine — migration 20261109000300: a pending online payment is a lock
--
-- WHY THIS EXISTS
--
-- The online payment path records a pending attempt before the guest pays.
-- Three other paths only looked at orders.payment_status, which stays
-- 'pending' until settlement, so they treated the order as untouched:
--
--   * cancel_order() allowed the guest to cancel while the payment was in
--     flight; settle_online_payment() then marked the cancelled order paid.
--   * set_order_line_quantities() allowed the guest to reprice the order
--     underneath the attempt; the provider captured the old amount.
--   * record_counter_payment() let the cashier collect the full balance in
--     cash while the online attempt was still pending, then the webhook
--     settled the online attempt too: a double collection.
--
-- Each function now refuses when a pending online attempt exists. The
-- cashier queue also shows the attempt (lib/db/cashier-screen.ts), but the
-- database is the authority. settle_online_payment() refuses a cancelled
-- order instead of marking it paid; the webhook retries, the payment row
-- stays pending, and staff can arrange a refund through the payment provider.
--
-- The bodies are the current versions with the guards added. No signature
-- changes, so existing callers keep working.
-- ============================================================================

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

  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.id is null then
    raise exception 'That order could not be found.' using errcode = 'P0001';
  end if;


  -- Who is asking. This comes first because it decides whether the caller is
  -- even allowed to know this order exists.
  if p_guest_token is not null then
    -- Wrong token and no such order give the same answer: never confirm which.
    if v_order.guest_token is distinct from p_guest_token then
      raise exception 'That order could not be found.' using errcode = 'P0001';
    end if;
  else
    select exists (
      select 1
        from public.memberships m
       where m.restaurant_id = v_order.restaurant_id
         and m.user_id = auth.uid()
         and m.role in ('owner', 'manager', 'cashier', 'kitchen')
    ) into v_staff;

    if not coalesce(v_staff, false) then
      raise exception 'You are not allowed to cancel this order.' using errcode = 'P0001';
    end if;
  end if;

  -- A pending online attempt is money in flight. Cancelling or repricing the
  -- order underneath it would leave the provider capturing an amount that no
  -- longer matches the bill, and there is no refund path in this build.
  if exists (
    select 1 from public.payments p
     where p.order_id = v_order.id
       and p.status = 'pending'
       and p.method = 'online'
  ) then
    raise exception 'An online payment is in progress for this order. Please wait for it to finish or ask staff.' using errcode = 'P0001';
  end if;

  -- Cancelling twice is not an error: two people can press the same button,
  -- and the second press should not raise "the kitchen has started" over a
  -- state that is already cancelled. This check has to come before the
  -- guests' "only while new" rule, or the second press of a button tells the
  -- guest something that is not true.
  if v_order.prep_status = 'cancelled' then
    return jsonb_build_object('status', 'cancelled', 'already', true);
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order has already been paid. A refund has to be handled at the counter.'
      using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'served' then
    raise exception 'This order has already been served.' using errcode = 'P0001';
  end if;

  -- A guest may only cancel before the kitchen starts, and only for ten
  -- minutes. Staff have no such limit: they are standing next to the guest.
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

create or replace function public.set_order_line_quantities(
  p_order_id uuid,
  p_lines jsonb,
  p_guest_token uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_staff boolean := false;
  v_rate int;
  v_taxable bigint;
  v_subtotal bigint := 0;
  v_tax bigint := 0;
  v_total bigint := 0;
  v_lines_left int := 0;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'That order could not be found.' using errcode = 'P0001';
  end if;


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
         and m.role in ('owner', 'manager', 'cashier', 'kitchen')
    ) into v_staff;

    if not coalesce(v_staff, false) then
      raise exception 'You are not allowed to change this order.' using errcode = 'P0001';
    end if;
  end if;

  -- A pending online attempt is money in flight. Cancelling or repricing the
  -- order underneath it would leave the provider capturing an amount that no
  -- longer matches the bill, and there is no refund path in this build.
  if exists (
    select 1 from public.payments p
     where p.order_id = v_order.id
       and p.status = 'pending'
       and p.method = 'online'
  ) then
    raise exception 'An online payment is in progress for this order. Please wait for it to finish or ask staff.' using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'cancelled' then
    raise exception 'This order has been cancelled.' using errcode = 'P0001';
  end if;

  if v_order.prep_status <> 'new' then
    raise exception 'The kitchen has already started this order. Please ask the staff to change it.'
      using errcode = 'P0001';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order has already been paid. Ask the counter to change it.'
      using errcode = 'P0001';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'There was nothing to change.' using errcode = 'P0001';
  end if;

  if jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'There was nothing to change.' using errcode = 'P0001';
  end if;

  with wanted as (
    select (entry->>'line_id')::uuid as line_id,
           greatest(0, least(99, coalesce((entry->>'qty')::int, 0))) as qty
      from jsonb_array_elements(p_lines) as entry
     where (entry->>'line_id') ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  )
  update public.order_items i
     set qty = w.qty
    from wanted w
   where i.id = w.line_id
     and i.order_id = v_order.id;

  -- A line taken to zero is removed, not kept at zero: a ticket that says
  -- "0 Butter Naan" is a ticket somebody has to read twice.
  delete from public.order_items i
   where i.order_id = v_order.id
     and i.qty <= 0;

  select count(*), coalesce(sum(unit_price_paise * qty), 0)
    into v_lines_left, v_subtotal
    from public.order_items
   where order_id = v_order.id;

  if v_lines_left = 0 then
    raise exception 'An order needs at least one dish. Cancel it instead.' using errcode = 'P0001';
  end if;

  -- The rate this order was priced at, falling back to the restaurant's
  -- current rate only for orders placed before the snapshot column existed.
  v_rate := coalesce(
    v_order.tax_rate_bps_snapshot,
    (select r.tax_rate_bps from public.restaurants r where r.id = v_order.restaurant_id),
    0
  );

  v_taxable := greatest(v_subtotal - v_order.discount_paise, 0);
  v_tax := round(v_taxable::numeric * v_rate / 10000.0)::bigint;
  v_total := v_taxable + v_tax;

  update public.orders
     set subtotal_paise = v_subtotal,
         tax_paise = v_tax,
         total_paise = v_total,
         updated_at = now()
   where id = v_order.id;

  return jsonb_build_object(
    'subtotal_paise', v_subtotal,
    'tax_paise', v_tax,
    'total_paise', v_total,
    'lines', v_lines_left
  );
end;
$$;

create or replace function public.record_counter_payment(
  p_restaurant_slug  text,
  p_order_id         uuid,
  p_method           text,            -- 'cash' | 'card' | 'upi'
  p_amount_paise     bigint,          -- must equal the outstanding balance
  p_idempotency_key  uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant  public.restaurants%rowtype;
  v_role        public.member_role;
  v_order       public.orders%rowtype;
  v_existing    public.payments%rowtype;
  v_paid_paise  bigint := 0;
  v_due_paise   bigint := 0;
  v_payment_id  uuid;
  v_key         text;
  v_actor_id    uuid;
  v_event       text;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'Sign in with an authorized restaurant account to record a payment.'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'A payment request key is required.' using errcode = 'P0002';
  end if;

  -- Only methods a counter can actually take. 'online' is excluded on
  -- purpose: see the header comment.
  if p_method not in ('cash', 'card', 'upi') then
    raise exception 'Unsupported counter payment method: %.', p_method
      using errcode = '22023';
  end if;

  select * into v_restaurant
  from public.restaurants r
  where r.slug = p_restaurant_slug and r.is_active;

  if not found then
    raise exception 'Restaurant not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
  from public.memberships m
  where m.restaurant_id = v_restaurant.id
    and m.user_id = v_actor_id;

  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to collect payments for this restaurant.'
      using errcode = '42501';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
    and o.restaurant_id = v_restaurant.id
  for update;

  if not found then
    raise exception 'Order not found for this restaurant.' using errcode = 'P0002';
  end if;

  -- Do not take cash while an online attempt is still pending. The counter
  -- queue shows the attempt, but the database is the authority: a cashier
  -- who has not seen the badge must not be able to collect twice.
  if exists (
    select 1 from public.payments p
     where p.order_id = v_order.id
       and p.status = 'pending'
       and p.method = 'online'
  ) then
    raise exception 'An online payment is in progress for this order. Do not take cash until it settles.' using errcode = 'P0001';
  end if;

  -- The method is part of the key. Without it, a cash attempt and a card
  -- attempt on the same order that reused a UUID would collide and one would
  -- be silently answered with the other's payment.
  v_key := p_method || ':' || v_restaurant.id::text || ':' || v_order.id::text
           || ':' || p_idempotency_key::text;

  select * into v_existing
  from public.payments p
  where p.idempotency_key = v_key;

  if found then
    if v_existing.order_id = v_order.id
       and v_existing.amount_paise = p_amount_paise
       and v_existing.method = p_method
       and v_existing.status = 'recorded' then
      return v_existing.id;
    end if;
    raise exception 'This payment request key was already used with different details.'
      using errcode = 'P0001';
  end if;

  if not public.restaurant_can_write(v_restaurant.id) then
    raise exception 'This restaurant is in read-only mode. Restore access before collecting payments.'
      using errcode = 'P0001';
  end if;

  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = 'P0002';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'Only unpaid pending orders can be settled at the counter.'
      using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'cancelled' then
    raise exception 'Cancelled orders cannot be settled.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint into v_paid_paise
  from public.payments p
  where p.order_id = v_order.id and p.status = 'recorded';

  v_due_paise := v_order.total_paise - v_paid_paise;

  if v_due_paise <= 0 then
    raise exception 'This order has no outstanding balance.' using errcode = 'P0001';
  end if;

  if p_amount_paise <> v_due_paise then
    raise exception 'Amount must exactly match the outstanding balance of % paise.', v_due_paise
      using errcode = 'P0001';
  end if;

  insert into public.payments (
    order_id, restaurant_id, method, amount_paise, status,
    provider, recorded_by, idempotency_key
  ) values (
    v_order.id, v_restaurant.id, p_method, v_due_paise, 'recorded',
    'counter', v_actor_id, v_key
  )
  returning id into v_payment_id;

  update public.orders
     set payment_status = 'paid',
         updated_at     = statement_timestamp()
   where id = v_order.id;

  -- Distinct event types per method so the audit log can be filtered by how
  -- the money actually moved, not just that it moved.
  v_event := p_method || '_collected';

  insert into public.payment_audit_events (
    restaurant_id, order_id, payment_id, actor_id,
    event_type, method, amount_paise
  ) values (
    v_restaurant.id, v_order.id, v_payment_id, v_actor_id,
    v_event, p_method, v_due_paise
  );

  if v_payment_id is null then
    raise exception 'Payment was not recorded.' using errcode = 'P0001';
  end if;

  return v_payment_id;
end;
$$;

create or replace function public.settle_online_payment(
  p_provider              text,
  p_provider_order_ref    text,
  p_provider_payment_ref  text,
  p_amount_paise          bigint default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row   public.payments%rowtype;
  v_order public.orders%rowtype;
begin
  if p_provider is null or p_provider_order_ref is null or p_provider_payment_ref is null then
    raise exception 'A provider order and payment id are both required.' using errcode = '22023';
  end if;

  select * into v_row
    from public.payments p
   where p.provider = p_provider
     and p.provider_ref = p_provider_order_ref
   for update;

  if not found then
    -- Money we cannot account for is not something to guess at. The provider
    -- will retry the webhook; the server log says what arrived.
    raise exception 'No payment attempt matches that reference.' using errcode = 'P0002';
  end if;

  if v_row.status = 'recorded' then
    return v_row.id;
  end if;

  if v_row.status = 'refunded' then
    raise exception 'That payment was refunded.' using errcode = 'P0001';
  end if;

  -- The webhook states the amount and is held to it. The browser callback does
  -- not carry one, and a null means "the attempt's own amount" -- which was
  -- computed from public.orders when the attempt began, not by the caller.
  if p_amount_paise is not null and p_amount_paise <> v_row.amount_paise then
    raise exception 'The settled amount does not match the attempt (expected %, got %).',
      v_row.amount_paise, p_amount_paise
      using errcode = 'P0001';
  end if;

  select * into v_order from public.orders o where o.id = v_row.order_id for update;

  if v_order.prep_status = 'cancelled' then
    raise exception 'This order was cancelled. The payment cannot be settled automatically; arrange a refund through the payment provider.' using errcode = 'P0001';
  end if;

  update public.payments
     set status = 'recorded',
         provider_payment_ref = p_provider_payment_ref
   where id = v_row.id;

  update public.orders
     set payment_status = 'paid',
         updated_at = statement_timestamp()
   where id = v_row.order_id
     and payment_status <> 'paid';

  select * into v_order from public.orders o where o.id = v_row.order_id;

  -- The same audit table counter payments write to, with its own event type,
  -- so "how was this order paid" is answerable for both paths.
  insert into public.payment_audit_events (
    restaurant_id, order_id, payment_id, actor_id,
    event_type, method, amount_paise
  ) values (
    v_row.restaurant_id, v_row.order_id, v_row.id, null,
    'online_collected', 'online', v_row.amount_paise
  );

  return v_row.id;
end;
$$;

revoke all on function public.cancel_order(uuid, uuid, text) from public;
revoke all on function public.cancel_order(uuid, uuid, text) from anon;
revoke all on function public.cancel_order(uuid, uuid, text) from authenticated;
grant execute on function public.cancel_order(uuid, uuid, text) to anon;
grant execute on function public.cancel_order(uuid, uuid, text) to authenticated;

revoke all on function public.set_order_line_quantities(uuid, jsonb, uuid) from public;
revoke all on function public.set_order_line_quantities(uuid, jsonb, uuid) from anon;
revoke all on function public.set_order_line_quantities(uuid, jsonb, uuid) from authenticated;
grant execute on function public.set_order_line_quantities(uuid, jsonb, uuid) to anon;
grant execute on function public.set_order_line_quantities(uuid, jsonb, uuid) to authenticated;

revoke all on function public.record_counter_payment(text, uuid, text, bigint, uuid) from public;
revoke all on function public.record_counter_payment(text, uuid, text, bigint, uuid) from anon;
revoke all on function public.record_counter_payment(text, uuid, text, bigint, uuid) from authenticated;
grant execute on function public.record_counter_payment(text, uuid, text, bigint, uuid) to authenticated;

revoke all on function public.settle_online_payment(text, text, text, bigint) from public;
revoke all on function public.settle_online_payment(text, text, text, bigint) from anon;
revoke all on function public.settle_online_payment(text, text, text, bigint) from authenticated;
grant execute on function public.settle_online_payment(text, text, text, bigint) to service_role;
