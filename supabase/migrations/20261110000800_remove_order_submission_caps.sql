-- Remove throttling from guest ORDER SUBMISSION (forward migration).
--
-- The rule this restores, and which the repository now states canonically in
-- AGENTS.md:
--
--     A legitimate guest order submission is never throttled.
--
-- What was wrong. Migrations 20261110000300 and 20261110000400 put three
-- budgets in front of `place_public_order` and two more in front of
-- `place_public_order_attempt`:
--
--     po:s:<session>                30 / 600 s   (000300)
--     po:t:<restaurant>             60 / 600 s   (000300)
--     po:i:<restaurant>:<ip_hash>   60 / 600 s   (000300)
--     po:attempt:s:<session>        60 / 600 s   (000400)
--     po:attempt:t:<restaurant>    120 / 600 s   (000400)
--
-- Every one of them counts ATTEMPTS, not placed orders. A table of six on a
-- shared Wi-Fi address uses them up with retries, validation failures and the
-- kitchen's own rejections, and the honest guests at the end of that queue are
-- refused the food they came for. The IP budget is worse than useless on the
-- network this product is sold for: a restaurant hands every guest the same
-- NAT address, so the cap punishes the room for being busy.
--
-- What is deliberately KEPT:
--   * the session/tenant check at the head of the attempt wrapper (a guest may
--     only order into a sitting they scanned);
--   * QR validation and the code-entry budget (qr_verification_attempts,
--     migration 20261108000200) -- that endpoint IS the abuse surface: it is
--     free to call, it guesses a 6-digit code, and it is the only place a
--     stranger can brute-force anything;
--   * scan/session-open limits (migration 20261110000300);
--   * guest-token idempotency: the advisory lock, the "return the existing
--     order" replay path and the unique_violation race handler, all
--     unchanged. A double-tap still places exactly one order.
--   * the error envelope of the attempt wrapper: `{code, error:{code,message,
--     hint}}`, so the app's decode and retry logic is untouched.
--
-- What this migration does NOT do: it does not drop `hit_rate_limit`. Staff
-- invites, the ops alert endpoint and the kitchen voice budget still use it.
--
-- Forward-only: 20261110000300 and 20261110000400 are already in the ledger on
-- main, so both functions are re-declared here rather than edited there. The
-- bodies below are those two functions verbatim with the five budget blocks
-- deleted and nothing else changed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. place_public_order -- no attempt budgets, everything else identical.
-- ---------------------------------------------------------------------------
create or replace function public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null,
  p_guest_token uuid default null,
  p_ip_hash text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_restaurant_id uuid;
  v_existing text;
  v_table_id uuid;
  v_order_session_id uuid;
begin
  if p_guest_token is not null then
    perform pg_advisory_xact_lock(hashtext('guest:' || p_guest_token::text));
  end if;
  if p_session_token is null or btrim(p_session_token) = '' then
    raise exception 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      using errcode = 'P0001';
  end if;

  select r.id into v_restaurant_id
    from public.restaurants r
   where r.slug = btrim(coalesce(p_slug, ''));

  -- Replays return before any new ticket or session work.
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

  v_code := public.place_public_order_core_with_code_retry(p_slug, p_lines, p_note, p_session_token);
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

  -- Every guest ticket at a table belongs to the table's one open sitting.
  -- The partial unique index arbitrates concurrent first orders; an order for
  -- a closed sitting opens a fresh session instead of reusing history.
  select o.table_id into v_table_id
    from public.orders o
   where o.code = v_code
     and o.restaurant_id = v_restaurant_id;

  if v_table_id is not null then
    insert into public.order_sessions (restaurant_id, table_id)
    values (v_restaurant_id, v_table_id)
    on conflict (table_id) where status = 'open'
    do update set table_id = excluded.table_id
    returning id into v_order_session_id;

    update public.orders o
       set order_session_id = v_order_session_id
     where o.code = v_code
       and o.restaurant_id = v_restaurant_id
       and o.order_session_id is null;
  end if;

  return v_code;

exception
  when unique_violation then
    -- A concurrent replay may lose the guest-token unique-index race. The
    -- PL/pgSQL exception subtransaction rolls back its core order, line items,
    -- and session attachment before returning the winning order's code.
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

-- ---------------------------------------------------------------------------
-- 2. place_public_order_attempt -- the guest entrypoint. Same signature, same
--    envelope, no budgets.
-- ---------------------------------------------------------------------------
create or replace function public.place_public_order_attempt(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null,
  p_guest_token uuid default null,
  p_ip_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant uuid;
  v_code text;
  v_error text;
  v_state text;
  v_hint text;
begin
  -- The admission check that survives: the session must belong to the
  -- restaurant on the slug, which is what the QR code proved.
  select s.restaurant_id into v_restaurant
    from public.current_table_session(p_session_token) s
   where s.restaurant_slug = btrim(coalesce(p_slug, ''));

  if v_restaurant is null then
    return jsonb_build_object(
      'code', null,
      'error', jsonb_build_object(
        'code', 'P0001',
        'message', 'Scan your table QR code again before ordering.',
        'hint', ''
      )
    );
  end if;

  -- Idempotency: a replayed guest token returns the order that already exists
  -- and places nothing. Unchanged, and now also free of any budget cost.
  if p_guest_token is not null then
    perform pg_advisory_xact_lock(hashtext('guest:' || p_guest_token::text));
    select o.code into v_code
      from public.orders o
     where o.restaurant_id = v_restaurant
       and o.guest_token = p_guest_token
     limit 1;
    if v_code is not null then
      return jsonb_build_object('code', v_code, 'error', null);
    end if;
  end if;

  begin
    v_code := public.place_public_order(p_slug, p_lines, p_note, p_session_token, p_guest_token, p_ip_hash);
    return jsonb_build_object('code', v_code, 'error', null);
  exception when others then
    get stacked diagnostics v_error = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE, v_hint = PG_EXCEPTION_HINT;
    return jsonb_build_object(
      'code', null,
      'error', jsonb_build_object('code', v_state, 'message', v_error, 'hint', v_hint)
    );
  end;
end;
$$;

comment on function public.place_public_order_attempt(text, jsonb, text, text, uuid, text) is
  'Guest order submission. Validates the sitting, replays a known guest token, and returns {code,error}. Deliberately unthrottled: a legitimate guest order is never refused for counting.';

-- The privilege contract of 20261110000400 is unchanged: guests may only reach
-- ordering through the versioned attempt wrapper.
revoke all on function public.place_public_order(text, jsonb, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.place_public_order_attempt(text, jsonb, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.place_public_order_attempt(text, jsonb, text, text, uuid, text) to anon, authenticated;
grant execute on function public.place_public_order(text, jsonb, text, text, uuid, text) to service_role;
grant execute on function public.place_public_order_attempt(text, jsonb, text, text, uuid, text) to service_role;

-- Housekeeping: budgets that only ever counted order submissions are dropped,
-- so a stale counter row can never be mistaken for live state. Nothing reads
-- these keys any more.
delete from public.rate_limit_hits
 where key like 'po:s:%'
    or key like 'po:t:%'
    or key like 'po:i:%'
    or key like 'po:attempt:s:%'
    or key like 'po:attempt:t:%';
