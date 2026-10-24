-- ============================================================================
-- AutoDine — migration 20261027000900: one checkout attempt, one order
--
-- WHY THIS EXISTS
--
-- place_public_order wrote a new order on every call. The browser already
-- tries not to call it twice (the button goes busy on the first tap), but
-- that only covers a tap landing on one page: a phone re-sending a POST after
-- the connection dropped, a guest with the same cart open in two tabs, or an
-- impatient double-tap before the first response arrives all produce two
-- orders from one intention. Two tickets in the kitchen and a double bill at
-- the till for one plate of paneer.
--
-- WHAT CHANGES
--
-- orders.guest_token stops being merely a credential and becomes the identity
-- of the attempt:
--
--   * a partial unique index means two rows cannot claim one attempt;
--   * place_public_order returns the existing order's code, instead of
--     writing a second row, when it is handed a token it has already written.
--
-- WHY THE TOKEN AND NOT THE CART
--
-- Hashing the cart would make "the same two chais again" -- a completely
-- ordinary second round at a table -- look like a replay and silently drop it.
-- The attempt key belongs to one visit to the checkout page, is generated in
-- the browser, and is rotated when that page is restored from the back-forward
-- cache. See components/AttemptToken.tsx.
--
-- WHAT DOES NOT CHANGE
--
-- Without a token the function behaves exactly as before: it writes an order
-- and returns its code. Nothing about pricing, sessions, table checks or the
-- kitchen moves. A client that has not been redeployed keeps working.
--
-- APPLYING THIS
--
-- Additive and safe on the running app: a new index, and one function
-- replacement whose signature is unchanged. The app sends the attempt key
-- already; before this is applied it is simply an extra argument the function
-- stores, and the behaviour is the old one.
-- ============================================================================

-- One row per attempt. Partial, because staff counter orders carry no token
-- and must not collide with each other.
create unique index if not exists orders_guest_token_unique
  on public.orders (guest_token)
  where guest_token is not null;

create or replace function public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null,
  p_guest_token uuid default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code      text;
  v_restaurant_id uuid;
  v_existing  text;
begin
  -- A table session is still required, exactly as before. This guard is the
  -- one that keeps the guest path from ever writing an untabled order.
  if p_session_token is null or btrim(p_session_token) = '' then
    raise exception 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      using errcode = 'P0001';
  end if;

  select r.id into v_restaurant_id
    from public.restaurants r
   where r.slug = btrim(coalesce(p_slug, ''));

  -- ---------------------------------------------------------------- replay
  -- The same attempt key, twice. Return the order the first call wrote: the
  -- guest sees one confirmation, the kitchen sees one ticket, and the till
  -- charges once.
  if p_guest_token is not null and v_restaurant_id is not null then
    select o.code into v_existing
      from public.orders o
     where o.guest_token = p_guest_token
       and o.restaurant_id = v_restaurant_id
     limit 1;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_code := public.place_public_order_core(p_slug, p_lines, p_note, p_session_token);

  if p_guest_token is not null then
    -- Scoped by restaurant as well as code: order codes are not unique across
    -- restaurants, and updating the wrong venue's order would hand a stranger
    -- the credential for somebody else's bill.
    update public.orders o
       set guest_token = p_guest_token,
           tax_rate_bps_snapshot = coalesce(
             o.tax_rate_bps_snapshot,
             (select r.tax_rate_bps from public.restaurants r where r.id = o.restaurant_id)
           )
     where o.code = v_code
       and o.restaurant_id = v_restaurant_id;
  end if;

  return v_code;

exception
  -- Two requests with the same key, genuinely at the same time: the index
  -- refused the second write. The order that exists is the one to answer
  -- with -- it is the same intention, already recorded.
  when unique_violation then
    if p_guest_token is not null then
      select o.code into v_existing
        from public.orders o
       where o.guest_token = p_guest_token
         and (v_restaurant_id is null or o.restaurant_id = v_restaurant_id)
       limit 1;

      if v_existing is not null then
        return v_existing;
      end if;
    end if;
    raise;
end;
$$;

comment on function public.place_public_order(text, jsonb, text, text, uuid) is
  'Place an order as a signed-out diner. Requires a table session token from '
  'verify_table_qr_with_code: without one this raises, so the guest path never '
  'creates an untabled order. Prices are read from the database. Idempotent on '
  'p_guest_token: a replayed attempt returns the order it already wrote.';

revoke all on function public.place_public_order(text, jsonb, text, text, uuid) from public;
revoke all on function public.place_public_order(text, jsonb, text, text, uuid) from anon;
revoke all on function public.place_public_order(text, jsonb, text, text, uuid) from authenticated;
-- The guest path: a diner has no account. The session token is what
-- authorises the write, and it is checked inside place_public_order_core.
grant execute on function public.place_public_order(text, jsonb, text, text, uuid) to anon;
grant execute on function public.place_public_order(text, jsonb, text, text, uuid) to authenticated;
