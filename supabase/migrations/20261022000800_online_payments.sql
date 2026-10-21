-- ============================================================================
-- AutoDine — migration 20261022000800: take money online
--
-- WHY THIS EXISTS
--
-- Until now the payments table allowed method 'online', and nothing could
-- write it. Migration 0004 says so in its own header: a counter payment is
-- money a cashier watched arrive, an online payment is money a provider took
-- and told us about afterwards. Those are different paths and the second one
-- did not exist. A guest could place an order and then had to walk to the
-- counter.
--
-- THE ONE RULE THIS FILE IS BUILT AROUND
--
-- The only thing that may mark an order paid online is a verified payment
-- event from the provider: either the browser's checkout callback (signature
-- checked with the key secret) or the provider's webhook (signature checked
-- with the webhook secret). Neither the browser, nor a signed-out guest, nor
-- a signed-in cashier can reach these functions. They are granted to
-- service_role ONLY -- the role the server uses -- and every one of them
-- re-reads the amount from public.orders rather than believing a caller.
--
-- WHY A PENDING ROW BEFORE THE GUEST PAYS
--
-- The provider's own order id has to be mapped back to ours. If the browser
-- closes mid-payment, the webhook still arrives with that id, and there must
-- be a row that says which of our orders it belongs to. So:
--
--   begin_online_payment()   provider order created -> pending row, provider_ref
--   settle_online_payment()  payment captured       -> same row 'recorded'
--
-- A pending row is not money. Every total in the product sums status
-- 'recorded' only. An attempt that was abandoned stays visible as an attempt,
-- which is more honest than deleting it.
--
-- ON THE PER-RESTAURANT SWITCH
--
-- Online payments are OFF for every restaurant until its owner turns them on
-- in Settings. Somebody has to connect a merchant account and decide to take
-- card money; a product that starts accepting it because a deployment
-- acquired an API key would be taking a decision that is not its own. Both
-- the read and the write below check the switch.
-- ============================================================================

alter table public.restaurants
  add column if not exists online_payments_enabled boolean not null default false;

comment on column public.restaurants.online_payments_enabled is
  'Owner switched online (gateway) payments on for this outlet; false means pay at the counter.';

-- The provider's payment id, as distinct from its order id. Both are needed
-- for reconciliation: one identifies the attempt, the other the money.
alter table public.payments
  add column if not exists provider_payment_ref text;

create index if not exists payments_provider_ref_idx
  on public.payments(provider, provider_ref);

comment on column public.payments.provider_ref is
  'The provider''s id for the attempt (e.g. Razorpay order_...). Present while pending.';
comment on column public.payments.provider_payment_ref is
  'The provider''s id for the money (e.g. Razorpay pay_...). Written only on settlement.';

-- ============================================================================
-- What does this guest owe, and can they pay it online?
--
-- The guest credential is the order token, exactly as get_public_order()
-- uses it. No token, no answer: an order id alone is not a permission.
-- ============================================================================

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
     and r.slug = p_slug
     and r.is_active;

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

-- ============================================================================
-- Record the attempt, after the provider has created its order.
--
-- Called by the server straight after the provider returns an id. The amount
-- must equal the outstanding balance, computed here: a provider order created
-- for a stale amount cannot be attached to the order it was made for.
-- ============================================================================

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
     and r.is_active
   for update of o;

  if v_order.id is null then
    raise exception 'This order cannot be paid from here.' using errcode = '42501';
  end if;

  select o.* into v_order
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
   where o.id = p_order_id
     and o.guest_token = p_guest_token
     and r.slug = p_slug
     and r.is_active;

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

-- ============================================================================
-- Settle: the money is real. Called by the verify route AND the webhook.
--
-- Idempotent on the provider's order id, because both will usually fire for
-- the same payment -- the browser callback when the guest returns, the webhook
-- a second later. Whichever arrives first settles; the second returns the
-- same payment row and writes nothing.
-- ============================================================================

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

comment on function public.settle_online_payment(text, text, text, bigint) is
  'Mark a verified online payment as recorded and settle its order. Idempotent '
  'on the provider order id; safe for the browser callback and the webhook to '
  'call for the same payment. service_role only.';

-- ============================================================================
-- Grants
--
-- All three are service_role only. The browser reaches them through server
-- routes that verify signatures first; a guest reaching settle_online_payment
-- directly would be a guest marking their own order paid.
--
-- 'from anon' and 'from authenticated' are listed explicitly: Supabase grants
-- EXECUTE on new functions in public to those roles automatically, so
-- revoking from PUBLIC alone leaves them executable. That mistake was found
-- the hard way on record_counter_payment.
-- ============================================================================

revoke all on function public.public_online_due(text, text, uuid) from public;
revoke all on function public.public_online_due(text, text, uuid) from anon;
revoke all on function public.public_online_due(text, text, uuid) from authenticated;
grant execute on function public.public_online_due(text, text, uuid) to service_role;

revoke all on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) from public;
revoke all on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) from anon;
revoke all on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) from authenticated;
grant execute on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) to service_role;

revoke all on function public.settle_online_payment(text, text, text, bigint) from public;
revoke all on function public.settle_online_payment(text, text, text, bigint) from anon;
revoke all on function public.settle_online_payment(text, text, text, bigint) from authenticated;
grant execute on function public.settle_online_payment(text, text, text, bigint) to service_role;

-- ============================================================================
-- Switching it on is an ordinary UPDATE on public.restaurants.
--
-- No function is needed: the restaurants_update policy from migration 00500
-- already allows owner and manager, and only for a restaurant they belong to.
-- Adding a SECURITY DEFINER function here would have had to re-derive "which
-- restaurant" from the membership row, and the dashboard already knows that
-- from the outlet cookie -- the exact duplication that sent menu writes to the
-- wrong outlet in PR #41.
-- ============================================================================
