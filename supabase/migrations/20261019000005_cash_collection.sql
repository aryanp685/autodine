-- ============================================================================
-- AutoDine — migration 0005: verified counter cash collection
--
-- Cash is recorded only through record_cash_payment(). The function checks
-- restaurant membership/role, trial entitlement, order ownership/status and
-- the exact outstanding balance under a row lock. It writes one payment,
-- marks the order paid, and appends an immutable audit event in one transaction.
-- Online payments remain a separate verified-provider flow.
-- ============================================================================

alter table public.payments
  add column if not exists recorded_by uuid references public.profiles(id) on delete set null;

comment on column public.payments.recorded_by is
  'Authenticated staff user who recorded an in-person payment; null for non-staff gateway events.';

create table if not exists public.payment_audit_events (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  order_id       uuid not null references public.orders(id) on delete restrict,
  payment_id     uuid not null references public.payments(id) on delete restrict,
  actor_id       uuid not null,
  event_type     text not null check (event_type in ('cash_collected')),
  method         text not null check (method = 'cash'),
  amount_paise   bigint not null check (amount_paise > 0),
  created_at     timestamptz not null default now(),
  unique (payment_id, event_type)
);

create index if not exists payment_audit_events_restaurant_created_idx
  on public.payment_audit_events(restaurant_id, created_at desc);

alter table public.payment_audit_events enable row level security;
revoke all on public.payment_audit_events from public, anon, authenticated;
grant select on public.payment_audit_events to authenticated;
grant all on public.payment_audit_events to service_role;

create policy payment_audit_events_read on public.payment_audit_events
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));

-- Staff JWTs cannot write payment rows or order payment state directly.
-- Authorized database functions are the controlled mutation path.
drop policy if exists payments_staff_insert on public.payments;
drop policy if exists payments_staff_update on public.payments;
drop policy if exists payments_staff_delete on public.payments;
revoke insert, update, delete on table public.payments from public, anon, authenticated;
grant all on table public.payments to service_role;

revoke update on table public.orders from public, anon, authenticated;
grant update (prep_status) on table public.orders to authenticated;

create or replace function public.record_cash_payment(
  p_restaurant_slug text,
  p_order_id        uuid,
  p_amount_paise    bigint,
  p_idempotency_key uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant   public.restaurants%rowtype;
  v_role         public.member_role;
  v_order        public.orders%rowtype;
  v_existing     public.payments%rowtype;
  v_paid_paise   bigint := 0;
  v_due_paise    bigint := 0;
  v_payment_id   uuid;
  v_key          text;
  v_actor_id     uuid;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'Sign in with an authorized restaurant account to record cash.'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'A payment request key is required.' using errcode = 'P0002';
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

  -- The order row serializes concurrent attempts for the same bill. Every
  -- retry of one key sees the committed payment and returns it rather than
  -- writing a duplicate or a second audit event.
  select * into v_order
  from public.orders o
  where o.id = p_order_id
    and o.restaurant_id = v_restaurant.id
  for update;

  if not found then
    raise exception 'Order not found for this restaurant.' using errcode = 'P0002';
  end if;

  v_key := 'cash:' || v_restaurant.id::text || ':' || v_order.id::text || ':' || p_idempotency_key::text;

  select * into v_existing
  from public.payments p
  where p.idempotency_key = v_key;

  if found then
    if v_existing.order_id = v_order.id
       and v_existing.amount_paise = p_amount_paise
       and v_existing.method = 'cash'
       and v_existing.status = 'recorded' then
      return v_existing.id;
    end if;
    raise exception 'This payment request key was already used with different details.'
      using errcode = 'P0001';
  end if;

  -- A retry of an already-committed payment is read-only: return its result
  -- even if the restaurant's trial has since expired. New cash writes remain
  -- blocked by the entitlement check below.
  if not public.restaurant_can_write(v_restaurant.id) then
    raise exception 'This restaurant is in read-only mode. Restore access before collecting payments.'
      using errcode = 'P0001';
  end if;

  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = 'P0002';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'Only unpaid pending orders can be settled with cash.' using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'cancelled' then
    raise exception 'Cancelled orders cannot be settled.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint into v_paid_paise
  from public.payments p
  where p.order_id = v_order.id
    and p.status = 'recorded';

  v_due_paise := v_order.total_paise - v_paid_paise;
  if v_due_paise <= 0 then
    raise exception 'This order has no outstanding balance.' using errcode = 'P0001';
  end if;

  if p_amount_paise <> v_due_paise then
    raise exception 'Cash amount must exactly match the outstanding balance.'
      using errcode = 'P0001';
  end if;

  insert into public.payments (
    order_id, restaurant_id, method, amount_paise, status,
    provider, recorded_by, idempotency_key
  ) values (
    v_order.id, v_restaurant.id, 'cash', v_due_paise, 'recorded',
    'counter', v_actor_id, v_key
  )
  returning id into v_payment_id;

  update public.orders
  set payment_status = 'paid', updated_at = statement_timestamp()
  where id = v_order.id;

  insert into public.payment_audit_events (
    restaurant_id, order_id, payment_id, actor_id,
    event_type, method, amount_paise
  ) values (
    v_restaurant.id, v_order.id, v_payment_id, v_actor_id,
    'cash_collected', 'cash', v_due_paise
  );

  return v_payment_id;
end;
$$;

revoke all on function public.record_cash_payment(text, uuid, bigint, uuid) from public, anon;
grant execute on function public.record_cash_payment(text, uuid, bigint, uuid)
  to authenticated, service_role;
