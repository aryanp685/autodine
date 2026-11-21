-- ============================================================================
-- AutoDine — migration 20261026001300: the restaurant's own UPI QR.
--
-- THE PROBLEM THIS SOLVES
--
-- The gateway is off (no keys, no KYC), so a guest's only way to pay is to walk
-- to the counter. Every Indian restaurant already has a UPI ID printed on a
-- standee. Showing that standee's QR on the guest's phone, with the exact
-- amount filled in, is not a payment integration — it is a convenience — and
-- it is honest as long as nobody pretends the money was verified.
--
-- WHAT IS AND IS NOT CLAIMED
--
-- Displaying a UPI QR does not prove payment. The guest's UPI app completes the
-- transfer and tells the guest; it tells us nothing. So:
--
--   * The payee is the RESTAURANT's own UPI ID, configured by its owner. Never
--     a platform-wide account: routing one restaurant's money to another's
--     account is not a bug, it is theft.
--   * Tapping "I have paid" writes a PENDING row, not a recorded one. Pending
--     rows are excluded from every total in the product (see migration 0004 and
--     public_online_due). It is a claim a cashier can see, not money received.
--   * Only a cashier or owner recording the collection moves money to
--     'recorded' — the same path that already exists for cash.
--
-- The claim row is idempotent: one pending claim per order, enforced by a
-- unique idempotency key, so a guest tapping twice or refreshing cannot fill
-- the counter's screen with duplicates.
--
-- VALIDATION
--
-- A UPI ID looks like `name@bank`. The check below is deliberately loose — it
-- rejects spaces, `upi:` schemes and the empty string, and accepts anything
-- with one `@` and a plausible local part and handle. A stricter pattern would
-- reject real handles with dots and hyphens, and the receiving app rejects
-- truly invalid ones anyway. The QR is also only shown when the column is
-- non-empty, so a restaurant that never configured one shows no QR at all
-- instead of a broken code pointing at nothing.
--
-- UNVERIFIED ON A REAL DATABASE. See the notes in migration 20261026001100.
-- ============================================================================

-- ------------------------------------------------------------ restaurants
alter table public.restaurants
  add column if not exists upi_id text,
  add column if not exists upi_payee_name text;

-- Dropped and re-added rather than wrapped in a DO block, for the same reason
-- as the plan constraints: one statement each, and the syntax check can parse
-- everything around them.
alter table public.restaurants drop constraint if exists restaurants_upi_id_check;
alter table public.restaurants
  add constraint restaurants_upi_id_check
  check (
    upi_id is null
    or upi_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,255}@[A-Za-z][A-Za-z0-9]{1,63}$'
  );

comment on column public.restaurants.upi_id is
  'The restaurant''s own UPI ID for guest payments (e.g. name@okhdfcbank). Null means no UPI QR is shown.';
comment on column public.restaurants.upi_payee_name is
  'Name shown in the guest''s UPI app. Never a platform name.';

-- ---------------------------------------------------------------------------
-- What may a guest see, and only with the right credentials?
--
-- The guest token is the same credential get_public_order uses: an order code
-- alone is guessable and must never reveal a payment handle. Amount comes from
-- orders.total_paise minus recorded payments — read here, never passed in.
-- ---------------------------------------------------------------------------
create or replace function public.public_upi_details(
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
  v_order       public.orders%rowtype;
  v_upi_id      text;
  v_payee       text;
  v_restaurant  text;
  v_paid        bigint := 0;
  v_claim       timestamptz;
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

  select r.upi_id, r.upi_payee_name, r.name
    into v_upi_id, v_payee, v_restaurant
    from public.restaurants r
   where r.id = v_order.restaurant_id;

  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'recorded';

  select max(p.created_at) into v_claim
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'pending'
     and p.provider = 'upi-claim';

  return jsonb_build_object(
    'upi_id',        v_upi_id,
    'payee_name',    coalesce(nullif(btrim(v_payee), ''), v_restaurant),
    'restaurant_name', v_restaurant,
    'code',          v_order.code,
    'payment_status', v_order.payment_status,
    'due_paise',     greatest(v_order.total_paise - v_paid, 0),
    'claimed_at',    v_claim
  );
end;
$$;

comment on function public.public_upi_details(text, text, uuid) is
  'The restaurant''s own UPI details for one order, to a caller holding that order''s guest token.';

-- ---------------------------------------------------------------------------
-- "I have paid." A claim, not a receipt.
-- ---------------------------------------------------------------------------
create or replace function public.claim_upi_payment(
  p_slug  text,
  p_code  text,
  p_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   public.orders%rowtype;
  v_upi_id  text;
  v_paid    bigint := 0;
  v_due     bigint;
  v_key     text;
  v_existing uuid;
begin
  if p_token is null or p_token = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'This order could not be found.' using errcode = 'P0001';
  end if;

  select o.* into v_order
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
   where o.code = p_code
     and o.guest_token = p_token
     and r.slug = p_slug
     and r.is_active;

  if not found then
    raise exception 'This order could not be found.' using errcode = 'P0001';
  end if;

  if v_order.payment_status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true);
  end if;

  select r.upi_id into v_upi_id
    from public.restaurants r
   where r.id = v_order.restaurant_id;

  if v_upi_id is null or btrim(v_upi_id) = '' then
    raise exception 'This restaurant has not set up UPI payments.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'recorded';

  v_due := greatest(v_order.total_paise - v_paid, 0);

  if v_due = 0 then
    return jsonb_build_object('ok', true, 'already_paid', true);
  end if;

  v_key := 'upi-claim:' || v_order.id::text;

  select p.id into v_existing
    from public.payments p
   where p.idempotency_key = v_key;

  if v_existing is not null then
    return jsonb_build_object('ok', true, 'already_claimed', true);
  end if;

  insert into public.payments(
    order_id, restaurant_id, method, amount_paise, status, provider, idempotency_key
  ) values (
    v_order.id, v_order.restaurant_id, 'upi', v_due, 'pending', 'upi-claim', v_key
  );

  -- A claim is a fact worth showing at the counter, so the order carries it.
  -- payment_status stays 'pending': only recorded money changes that.
  update public.orders
     set payment_status = 'pending'
   where id = v_order.id
     and payment_status <> 'paid';

  return jsonb_build_object('ok', true, 'claim_recorded', true, 'due_paise', v_due);
end;
$$;

comment on function public.claim_upi_payment(text, text, uuid) is
  'Records the guest''s "I have paid" as a PENDING row (provider upi-claim). Never marks an order paid.';

-- The claim is anonymous (the guest has no login): it is reachable from the
-- guest order page, which calls it with the order token. It can only ever
-- insert a pending row for the order whose token was presented.
revoke all on function public.claim_upi_payment(text, text, uuid) from public;
grant execute on function public.claim_upi_payment(text, text, uuid) to anon, authenticated;
grant execute on function public.public_upi_details(text, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The counter's view of a claim.
--
-- The queue itself is read from orders with the cashier's own session (RLS).
-- Claims are keyed by order id, so the screen can mark a ticket "guest says
-- paid by UPI" without a second interpretation of what that means.
-- ---------------------------------------------------------------------------
create or replace function public.counter_claims(p_restaurant_id uuid)
returns table (order_id uuid, claimed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.order_id, max(p.created_at) as claimed_at
    from public.payments p
   where p.restaurant_id = p_restaurant_id
     and p.status = 'pending'
     and p.provider = 'upi-claim'
     and public.has_restaurant_role(
           p_restaurant_id, array['owner', 'manager', 'cashier'])
   group by p.order_id;
$$;

comment on function public.counter_claims(uuid) is
  'Orders where the guest has claimed a UPI payment and nobody has recorded it yet.';

grant execute on function public.counter_claims(uuid) to authenticated;
