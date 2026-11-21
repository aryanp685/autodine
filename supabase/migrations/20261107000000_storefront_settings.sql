-- ============================================================================
-- Storefront settings: the announcement banner
--
-- WHAT THIS IS
--
-- The owner writes one line -- a festival note, an early close, a new outlet
-- -- and it appears at the top of the guest menu. Off by default: nothing is
-- shown until the owner writes something and turns it on.
--
-- WHAT THIS IS NOT
--
-- The open/closed decision is deliberately NOT here. `restaurants.is_active`
-- has always been the ordering status: the guest reads filter on it,
-- place_public_order refuses with "That restaurant is not taking orders." and
-- the table scan says "Not taking orders right now." The owner toggle writes
-- that existing column; adding a second flag would create two answers to one
-- question, and the day they disagree the guest gets one story and the
-- kitchen another.
-- ============================================================================

alter table public.restaurants
  add column if not exists announcement_text text,
  add column if not exists announcement_on   boolean not null default false;

alter table public.restaurants
  drop constraint if exists restaurants_announcement_text_len;
alter table public.restaurants
  add constraint restaurants_announcement_text_len
  check (announcement_text is null or char_length(announcement_text) <= 200);

comment on column public.restaurants.announcement_text is
  'One line the owner wants guests to read at the top of the menu. Shown only when announcement_on is true.';
comment on column public.restaurants.announcement_on is
  'Whether the announcement banner appears on the guest menu. Off by default.';

-- ============================================================================
-- What closing must NOT touch: an order already placed.
--
-- `is_active` off blocks NEW business -- place_public_order refuses it. But
-- three read/pay paths over an EXISTING order also carried the filter, so a
-- guest who ordered at 8:55 could no longer see, or pay for, their order the
-- moment the owner closed at 9:00. A placed order's status and payment belong
-- to that order, not to the storefront's hours. The same bodies, without the
-- filter. The real credential checks -- code plus guest token -- are all still
-- here and untouched.
--
-- settle_online_payment is deliberately not redefined: it never carried the
-- filter, so money in flight settles whether the shop is open or shut.
-- ============================================================================

create or replace function public.get_public_order(
  p_slug text,
  p_code text,
  p_token uuid
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'code', o.code,
    'prep_status', o.prep_status,
    'payment_status', o.payment_status,
    'subtotal_paise', o.subtotal_paise,
    'tax_paise', o.tax_paise,
    'total_paise', o.total_paise,
    'customer_note', o.customer_note,
    'placed_at', o.placed_at,
    'table_label', t.label,
    'lines', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'name', i.name_snapshot,
                 'qty', i.qty,
                 'unit_price_paise', i.unit_price_paise,
                 'is_veg', i.is_veg,
                 'variant', i.variant_snapshot,
                 'addons', i.addons_snapshot
               )
               order by i.sort_order
             )
        from public.order_items i
       where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.dining_tables t on t.id = o.table_id
  where r.slug = p_slug
    and o.code = p_code
    and p_token is not null
    and o.guest_token = p_token
  limit 1;
$$;

revoke all on function public.get_public_order(text, text, uuid) from public;
revoke all on function public.get_public_order(text, text, uuid) from anon;
revoke all on function public.get_public_order(text, text, uuid) from authenticated;
grant execute on function public.get_public_order(text, text, uuid) to anon;
grant execute on function public.get_public_order(text, text, uuid) to authenticated;

create or replace function public.public_online_due(
  p_slug  text,
  p_code  text,
  p_token uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   public.orders%rowtype;
  v_enabled boolean;
  v_name    text;
  v_paid    bigint := 0;
begin
  if p_token is null or p_token = '00000000-0000-0000-0000-000000000000'::uuid then
    return null;
  end if;

  select o.* into v_order
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
   where o.code = p_code
     and o.guest_token = p_token
     and r.slug = p_slug;

  if not found then
    return null;
  end if;

  select coalesce(r.online_payments_enabled, false), r.name
    into v_enabled, v_name
    from public.restaurants r
   where r.id = v_order.restaurant_id;

  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'recorded';

  return jsonb_build_object(
    'order_id',      v_order.id,
    'code',          v_order.code,
    'restaurant_name', v_name,
    'enabled',       coalesce(v_enabled, false),
    'payment_status', v_order.payment_status,
    'prep_status',   v_order.prep_status,
    'total_paise',   v_order.total_paise,
    'due_paise',     greatest(v_order.total_paise - v_paid, 0)
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

revoke all on function public.public_online_due(text, text, uuid) from public;
revoke all on function public.public_online_due(text, text, uuid) from anon;
revoke all on function public.public_online_due(text, text, uuid) from authenticated;
grant execute on function public.public_online_due(text, text, uuid) to service_role;

revoke all on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) from public;
revoke all on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) from anon;
revoke all on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) from authenticated;
grant execute on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) to service_role;
