-- Serialize online intents per order and refuse stale duplicate captures.
-- Every live order is resolved under the session-then-order lock used by the
-- other financial RPCs. The provider stays disabled until its external flow is
-- independently configured and verified; this is a database fail-closed guard.
create or replace function public.begin_online_payment(
  p_provider            text,
  p_provider_order_ref  text,
  p_slug                text,
  p_order_id            uuid,
  p_guest_token         uuid,
  p_amount_paise        bigint
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   public.orders%rowtype;
  v_enabled boolean;
  v_paid    bigint := 0;
  v_due     bigint := 0;
  v_key     text;
  v_row     public.payments%rowtype;
  v_id      uuid;
begin
  if p_provider is null or btrim(p_provider) = '' then
    raise exception 'No payment provider was named.' using errcode = '22023';
  end if;

  if p_provider_order_ref is null or btrim(p_provider_order_ref) = '' then
    raise exception 'The provider did not return an order id.' using errcode = '22023';
  end if;

  if p_guest_token is null then
    raise exception 'This order cannot be paid from here.' using errcode = '42501';
  end if;

  -- Lock session, then order; this serializes intent admission against
  -- counter collection, checkout, order edits, and provider settlement.
  perform s.id from public.order_sessions s
    join public.orders o on o.order_session_id=s.id
    join public.restaurants r on r.id=o.restaurant_id
   where o.id=p_order_id and o.guest_token=p_guest_token and r.slug=p_slug
     and s.restaurant_id=o.restaurant_id
   for update of s;

  select o.id into v_order.id
    from public.orders o
    join public.restaurants r on r.id=o.restaurant_id
   where o.id=p_order_id and o.guest_token=p_guest_token and r.slug=p_slug
   for update of o;

  if v_order.id is null then
    raise exception 'This order cannot be paid from here.' using errcode = '42501';
  end if;

  select o.* into v_order
    from public.orders o
    join public.restaurants r on r.id=o.restaurant_id
   where o.id=p_order_id and o.guest_token=p_guest_token and r.slug=p_slug;
  if not found then
    raise exception 'This order cannot be paid from here.' using errcode = '42501';
  end if;

  select coalesce(r.online_payments_enabled,false)
    into v_enabled
    from public.restaurants r
   where r.id=v_order.restaurant_id;
  if not coalesce(v_enabled,false) then
    raise exception 'Online payment is not switched on for this restaurant.' using errcode = 'P0001';
  end if;
  if not public.restaurant_can_write(v_order.restaurant_id) then
    raise exception 'This restaurant is not taking payments right now.' using errcode = 'P0001';
  end if;
  if v_order.prep_status='cancelled' then
    raise exception 'This order was cancelled.' using errcode = 'P0001';
  end if;
  if v_order.payment_status <> 'pending' then
    raise exception 'This order is already settled.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise),0)::bigint into v_paid
    from public.payments p
   where p.order_id=v_order.id and p.restaurant_id=v_order.restaurant_id
     and p.status='recorded';
  v_due:=greatest(v_order.total_paise-v_paid,0);
  if v_due <= 0 then
    raise exception 'This order has no outstanding balance.' using errcode = 'P0001';
  end if;
  if p_amount_paise is null or p_amount_paise <> v_due then
    raise exception 'The amount offered does not match what this order owes.' using errcode = 'P0001';
  end if;

  -- Idempotency is checked before the per-order pending guard so a retry of
  -- the same provider order reuses its row, while a different intent cannot
  -- create a second independently settleable balance.
  v_key:='online-intent:' || p_provider || ':' || p_provider_order_ref;
  select * into v_row from public.payments p where p.idempotency_key=v_key for update;
  if found then
    if v_row.order_id <> v_order.id or v_row.restaurant_id <> v_order.restaurant_id
       or v_row.amount_paise <> v_due or v_row.method <> 'online' then
      raise exception 'That payment attempt belongs to a different order or amount.' using errcode = 'P0001';
    end if;
    return v_row.id;
  end if;

  if exists (
    select 1 from public.payments p
     where p.order_id=v_order.id and p.restaurant_id=v_order.restaurant_id
       and p.method='online' and p.status='pending'
  ) then
    raise exception 'An online payment is already in progress for this order. Reuse that attempt or wait for it to finish.'
      using errcode = 'P0001';
  end if;

  insert into public.payments (
    order_id, restaurant_id, method, amount_paise, status,
    provider, provider_ref, idempotency_key
  ) values (
    v_order.id, v_order.restaurant_id, 'online', v_due, 'pending',
    p_provider, p_provider_order_ref, v_key
  ) returning id into v_id;
  return v_id;
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
  v_row          public.payments%rowtype;
  v_order        public.orders%rowtype;
  v_paid_paise   bigint := 0;
  v_due_paise    bigint := 0;
begin
  if p_provider is null or p_provider_order_ref is null or p_provider_payment_ref is null then
    raise exception 'A provider order and payment id are both required.' using errcode = '22023';
  end if;

  -- Resolve the attempt under the same session -> order -> payment lock order
  -- as begin-online and counter collection, then read its authoritative row.
  perform s.id from public.order_sessions s
    join public.orders o on o.order_session_id=s.id
    join public.payments p on p.order_id=o.id and p.restaurant_id=o.restaurant_id
   where p.provider=p_provider and p.provider_ref=p_provider_order_ref
     and s.restaurant_id=o.restaurant_id
   for update of s;
  perform o.id from public.orders o
    join public.payments p on p.order_id=o.id and p.restaurant_id=o.restaurant_id
   where p.provider=p_provider and p.provider_ref=p_provider_order_ref
   for update of o;

  select * into v_row from public.payments p
   where p.provider=p_provider and p.provider_ref=p_provider_order_ref
   for update;
  if not found then
    raise exception 'No payment attempt matches that reference.' using errcode = 'P0002';
  end if;
  if v_row.status='recorded' then
    return v_row.id;
  end if;
  if v_row.status='refunded' then
    raise exception 'That payment was refunded.' using errcode = 'P0001';
  end if;
  if p_amount_paise is not null and p_amount_paise <> v_row.amount_paise then
    raise exception 'The settled amount does not match the attempt (expected %, got %).',
      v_row.amount_paise,p_amount_paise using errcode = 'P0001';
  end if;

  select * into v_order from public.orders o where o.id=v_row.order_id for update;
  if not found or v_order.restaurant_id <> v_row.restaurant_id then
    raise exception 'No matching order exists for that payment attempt.' using errcode = 'P0002';
  end if;
  if v_order.prep_status='cancelled' then
    raise exception 'This order was cancelled. The payment cannot be settled automatically; arrange a refund through the payment provider.' using errcode = 'P0001';
  end if;
  if v_order.payment_status <> 'pending' then
    raise exception 'This order has already been settled by another payment attempt; reconcile the provider event.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise),0)::bigint into v_paid_paise
    from public.payments p
   where p.order_id=v_order.id and p.restaurant_id=v_order.restaurant_id
     and p.status='recorded';
  v_due_paise:=greatest(v_order.total_paise-v_paid_paise,0);
  if v_due_paise <= 0 or v_row.amount_paise <> v_due_paise then
    raise exception 'This payment attempt no longer matches the outstanding balance; leave it pending and reconcile the provider event.'
      using errcode = 'P0001';
  end if;

  update public.payments
     set status='recorded',provider_payment_ref=p_provider_payment_ref
   where id=v_row.id;
  update public.orders
     set payment_status='paid',updated_at=statement_timestamp()
   where id=v_row.order_id and restaurant_id=v_row.restaurant_id;

  insert into public.payment_audit_events (
    restaurant_id,order_id,payment_id,actor_id,event_type,method,amount_paise
  ) values (
    v_row.restaurant_id,v_row.order_id,v_row.id,null,'online_collected','online',v_row.amount_paise
  );
  return v_row.id;
end;
$$;

comment on function public.begin_online_payment(text,text,text,uuid,uuid,bigint) is
  'Creates one pending online intent per order. Same provider-order retries are idempotent; a distinct in-flight intent is refused.';
comment on function public.settle_online_payment(text,text,text,bigint) is
  'Records only a provider attempt that still exactly matches the order balance. Same-attempt webhook retries are idempotent; a stale second capture is rejected for reconciliation.';
