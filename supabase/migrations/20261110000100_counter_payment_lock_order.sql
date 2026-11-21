-- Phase 1, first bounded fix: align counter collection with session settlement.
-- Additive replacement; preserves signature, permissions, idempotency, amounts,
-- role/read-only checks and receipt/audit behavior. No data rewrite.
-- Other financial entrypoints still require the separate Phase 1 audit.

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

  -- Acquire the sitting before the order. Session settlement and checkout
  -- already use this order; the receipt trigger reacquires this same lock.
  -- Without this, counter payment holds the order while waiting for checkout's
  -- session lock, and checkout can wait for that order (40P01).
  -- Membership was checked above. Scope the lookup to the authorized tenant.
  perform s.id
    from public.order_sessions s
    join public.orders o on o.order_session_id = s.id
   where o.id = p_order_id
     and o.restaurant_id = v_restaurant.id
     and s.restaurant_id = v_restaurant.id
   for update of s;

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
