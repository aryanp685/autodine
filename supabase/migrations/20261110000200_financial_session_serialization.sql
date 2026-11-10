-- Phase 1: serialize financial/source RPCs against checkout at the sitting.
-- No data rewrite, new entrypoints or permission changes. Existing validation,
-- provider amount checks and idempotency remain in the replacement bodies.

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
           and m.user_id=auth.uid() and m.role in ('owner','manager','cashier','kitchen'))))
   for update of s;

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
  -- Serialize source mutations with checkout before locking the ticket.
  perform s.id from public.order_sessions s
    join public.orders o on o.order_session_id = s.id
   where o.id = p_order_id and s.restaurant_id = o.restaurant_id
     and ((p_guest_token is not null and o.guest_token = p_guest_token)
       or (p_guest_token is null and exists (
         select 1 from public.memberships m where m.restaurant_id=o.restaurant_id
           and m.user_id=auth.uid() and m.role in ('owner','manager','cashier','kitchen'))))
   for update of s;

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

  -- Validate the whole payload before changing any row. No silent unknown IDs,
  -- duplicate source rows, truncated decimals, or non-numeric quantities.
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(e->>'line_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(e->>'qty', '') !~ '^[0-9]{1,2}$'
  ) then
    raise exception 'Each change needs a valid line and a whole quantity from 0 to 99.' using errcode = '22023';
  end if;
  if (select count(distinct e->>'line_id') from jsonb_array_elements(p_lines) e) <> jsonb_array_length(p_lines)
     or exists (select 1 from jsonb_array_elements(p_lines) e
                where not exists (select 1 from public.order_items i
                                  where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id)) then
    raise exception 'One of those lines does not belong to this order, or was submitted twice.' using errcode = '22023';
  end if;

  -- Delete zero-quantity lines FIRST: writing qty=0 then deleting violates
  -- the order_items qty > 0 constraint before the DELETE can run.
  delete from public.order_items i using jsonb_array_elements(p_lines) e
   where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id and (e->>'qty')::int = 0;
  update public.order_items i set qty = (e->>'qty')::int
    from jsonb_array_elements(p_lines) e
   where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id and (e->>'qty')::int > 0;

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

  -- Lock first, then prove the credential. Two statements on purpose: the
  -- lock has to be taken before the balance is computed, and it is taken on
  -- the row the token resolves to, so a wrong token locks nothing it should
  -- not.
  perform s.id from public.order_sessions s
    join public.orders o on o.order_session_id=s.id
    join public.restaurants r on r.id=o.restaurant_id
   where o.id=p_order_id and o.guest_token=p_guest_token and r.slug=p_slug
     and s.restaurant_id=o.restaurant_id
   for update of s;

  select o.id into v_order.id
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
   where o.id = p_order_id
     and o.guest_token = p_guest_token
     and r.slug = p_slug
   for update of o;

  if v_order.id is null then
    raise exception 'This order cannot be paid from here.' using errcode = '42501';
  end if;

  select o.* into v_order
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
   where o.id = p_order_id
     and o.guest_token = p_guest_token
     and r.slug = p_slug;

  if not found then
    raise exception 'This order cannot be paid from here.' using errcode = '42501';
  end if;

  select coalesce(r.online_payments_enabled, false)
    into v_enabled
    from public.restaurants r
   where r.id = v_order.restaurant_id;

  if not coalesce(v_enabled, false) then
    raise exception 'Online payment is not switched on for this restaurant.'
      using errcode = 'P0001';
  end if;

  if not public.restaurant_can_write(v_order.restaurant_id) then
    raise exception 'This restaurant is not taking payments right now.' using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'cancelled' then
    raise exception 'This order was cancelled.' using errcode = 'P0001';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order is already settled.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'recorded';

  v_due := greatest(v_order.total_paise - v_paid, 0);

  if v_due <= 0 then
    raise exception 'This order has no outstanding balance.' using errcode = 'P0001';
  end if;

  if p_amount_paise is null or p_amount_paise <> v_due then
    raise exception 'The amount offered does not match what this order owes.'
      using errcode = 'P0001';
  end if;

  -- Idempotent on the provider's order id: a retried request attaches to the
  -- attempt already recorded instead of creating a second one.
  v_key := 'online-intent:' || p_provider || ':' || p_provider_order_ref;

  select * into v_row from public.payments p where p.idempotency_key = v_key;
  if found then
    if v_row.order_id <> v_order.id or v_row.amount_paise <> v_due then
      raise exception 'That payment attempt belongs to a different order.'
        using errcode = 'P0001';
    end if;
    return v_row.id;
  end if;

  insert into public.payments (
    order_id, restaurant_id, method, amount_paise, status,
    provider, provider_ref, idempotency_key
  ) values (
    v_order.id, v_order.restaurant_id, 'online', v_due, 'pending',
    p_provider, p_provider_order_ref, v_key
  )
  returning id into v_id;

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
  v_row   public.payments%rowtype;
  v_order public.orders%rowtype;
begin
  if p_provider is null or p_provider_order_ref is null or p_provider_payment_ref is null then
    raise exception 'A provider order and payment id are both required.' using errcode = '22023';
  end if;

  -- Resolve the immutable attempt-to-order reference without a row lock,
  -- then take session/order before locking and re-reading the payment below.
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
