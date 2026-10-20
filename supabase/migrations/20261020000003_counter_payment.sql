-- ============================================================================
-- AutoDine — migration 0003: atomic counter payment
--
-- WHY THIS EXISTS
--
-- Recording a counter payment touches two tables:
--
--   insert into payments (...)          -- the money that changed hands
--   update orders set payment_status    -- the bill is settled
--
-- Done as two separate calls from the application, either one can succeed
-- while the other fails, and both failure modes are bad in different ways:
--
--   * payment inserted, order not updated  -> the queue still shows the order
--     as unpaid, so the cashier takes the money a SECOND time.
--   * order updated, payment not inserted  -> the bill is marked paid but
--     there is no record of the cash, so the till cannot be reconciled at
--     the end of the shift.
--
-- supabase-js has no client-side transaction API, so the only way to make
-- these two writes all-or-nothing is to put them in one function. That is
-- what this does. It is the same reason place_order() exists.
--
-- SECURITY MODEL
--
-- SECURITY DEFINER, because the caller is a staff member who must be able to
-- settle a bill for their own restaurant and no other. The function does its
-- own authorisation FIRST, via public.current_restaurant_ids(), and raises if
-- the order belongs somewhere else. RLS is not relied on here: an explicit
-- check is auditable in one place, and a missing RLS policy cannot silently
-- turn into "any signed-in user can settle any bill".
--
-- Money arguments are PAISE, integers. The rupee-to-paise conversion happens
-- once in the application (lib/money.ts) before the call, never here and
-- never in SQL arithmetic on a float.
-- ============================================================================

create or replace function public.record_counter_payment(
  p_order_id        uuid,
  p_method          text,           -- 'cash' | 'card' | 'upi'
  p_amount_paise    bigint          -- what the guest handed over, in paise
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order     public.orders%rowtype;
  v_payment_id uuid;
begin
  -- 1. Authorisation: this staff member must belong to the order's restaurant.
  --    Checked before anything else, so an id belonging to another restaurant
  --    behaves exactly like one that does not exist.
  if not exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and o.restaurant_id in (select public.current_restaurant_ids())
  ) then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  -- 2. Method must be one the schema allows. The payments table has its own
  --    CHECK, but raising here gives the cashier a readable message instead of
  --    a constraint violation.
  if p_method not in ('cash', 'card', 'upi') then
    raise exception 'Unsupported payment method: %.', p_method using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;

  -- 3. Refuse to settle a bill that is already settled. Without this, two
  --    cashiers clicking at the same moment, or one double-clicking, would
  --    each insert a payment for the same order.
  if v_order.payment_status <> 'pending' then
    raise exception 'Order % is already % and cannot be paid again.',
      v_order.code, v_order.payment_status using errcode = 'P0004';
  end if;

  -- 4. The guest must have handed over at least the amount due.
  if p_amount_paise < v_order.total_paise then
    raise exception 'Amount received (% paise) is less than the total due (% paise).',
      p_amount_paise, v_order.total_paise using errcode = '22003';
  end if;

  -- 5. Both writes, one transaction. If either fails, neither is committed.
  insert into public.payments (
    order_id,
    restaurant_id,
    method,
    amount_paise,
    status,
    provider
  ) values (
    p_order_id,
    v_order.restaurant_id,
    p_method,
    p_amount_paise,
    'recorded',
    'counter'
  )
  returning id into v_payment_id;

  update public.orders
     set payment_status = 'paid',
         updated_at     = now()
   where id = p_order_id;

  -- v_payment_id is referenced so the compiler does not warn about it and so
  -- a future audit trigger has something to hang off.
  if v_payment_id is null then
    raise exception 'Payment was not recorded.' using errcode = 'P0001';
  end if;
end;
$$;

comment on function public.record_counter_payment(uuid, text, bigint) is
  'Atomically record a counter (cash/card/upi) payment and settle the order. '
  'Amount in paise. Raises if the order is already settled or the amount is short.';

-- SECURITY DEFINER functions are executable by PUBLIC by default. Revoke and
-- grant explicitly: only an authenticated user may call this, and the function
-- itself decides whether they may settle THIS order.
revoke all on function public.record_counter_payment(uuid, text, bigint) from public;
grant execute on function public.record_counter_payment(uuid, text, bigint) to authenticated;
