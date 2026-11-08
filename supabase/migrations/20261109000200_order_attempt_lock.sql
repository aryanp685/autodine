-- ============================================================================
-- AutoDine — migration 20261109000200: one attempt, one order, even concurrently
--
-- WHY THIS EXISTS
--
-- place_public_order is idempotent on p_guest_token, but the check is a
-- read followed by a write. Two requests with the same attempt key can both
-- pass the read, both write an order, and then one update hits
-- orders_guest_token_unique. The exception handler returns the existing code,
-- but the second order row is already in the table: a duplicate kitchen
-- ticket and a double bill for one intention.
--
-- This takes a transaction-scoped advisory lock on the guest token before
-- the replay check, so the second request waits for the first to finish and
-- then sees the order it wrote. The lock is released at commit/rollback and
-- is only taken when a token is present; the no-token path is unchanged.
--
-- The body is the 20261108000200_drift_reconcile version, with the lock added.
-- ============================================================================

create or replace function public.place_public_order(
  p_slug          text,
  p_lines         jsonb,
  p_note          text default null,
  p_session_token text default null,
  p_guest_token   uuid default null,
  p_ip_hash       text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code      text;
  v_restaurant_id uuid;
  v_existing  text;
  v_allowed   boolean;
  v_retry     integer;
begin
  if p_session_token is null or btrim(p_session_token) = '' then
    raise exception 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      using errcode = 'P0001';
  end if;

  if p_guest_token is not null then
    perform pg_advisory_xact_lock(hashtext('guest:' || p_guest_token::text));
  end if;

  select r.id into v_restaurant_id
    from public.restaurants r
   where r.slug = btrim(coalesce(p_slug, ''));

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

  select a.allowed, a.retry_after_seconds
    into v_allowed, v_retry
    from public.hit_rate_limit(
      'po:s:' || encode(sha256(btrim(p_session_token)::bytea), 'hex'),
      30, 600
    ) a;

  if coalesce(v_allowed, true) then
    select a.allowed, a.retry_after_seconds
      into v_allowed, v_retry
      from public.hit_rate_limit(
        'po:t:' || coalesce(v_restaurant_id::text, 'unknown'),
        60, 600
      ) a;
  end if;

  if coalesce(v_allowed, true) and p_ip_hash is not null and btrim(p_ip_hash) <> '' then
    select a.allowed, a.retry_after_seconds
      into v_allowed, v_retry
      from public.hit_rate_limit('po:i:' || btrim(p_ip_hash), 60, 600) a;
  end if;

  if coalesce(v_allowed, true) is not true then
    raise exception 'Too many orders right now. Please wait % seconds and try again.',
      coalesce(v_retry, 60)
      using errcode = 'P0001', hint = 'rate-limited';
  end if;

  v_code := public.place_public_order_core(p_slug, p_lines, p_note, p_session_token);

  -- Stamp the sitting onto the order: session id always (scan or code), and
  -- hold_required for a scan_confirm sitting nobody has vouched for yet.
  -- This is the call 20261028000900 promised and its wrapper forgot; without
  -- it the hold/confirm machinery is dead code.
  perform public.stamp_guest_verification(v_code, v_restaurant_id, btrim(p_session_token));

  if p_guest_token is not null then
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

revoke all on function public.place_public_order(text, jsonb, text, text, uuid, text) from public;
revoke all on function public.place_public_order(text, jsonb, text, text, uuid, text) from anon;
revoke all on function public.place_public_order(text, jsonb, text, text, uuid, text) from authenticated;
grant execute on function public.place_public_order(text, jsonb, text, text, uuid, text) to anon;
grant execute on function public.place_public_order(text, jsonb, text, text, uuid, text) to authenticated;
