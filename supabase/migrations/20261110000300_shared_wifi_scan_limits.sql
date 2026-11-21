-- Phase 2: bounded shared-Wi-Fi fix; no order throughput thresholds changed.
-- Serialize scan admission per existing QR row. Keep card limits; avoid a
-- shared IP consuming access for unrelated tables/restaurants.

create or replace function public.open_table_session(
  p_public_token text,
  p_ip_hash      text
) returns table (
  status          text,
  session_token   text,
  restaurant_slug text,
  table_label     text,
  expires_at      timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- The schema caps a session at one hour from creation; 59 minutes leaves the
  -- same minute of headroom the code path uses.
  k_session_minutes constant int := 59;
  k_opens_per_card  constant int := 10;
  k_opens_per_ip    constant int := 20;
  k_window          constant interval := interval '1 hour';

  v_qr        public.table_qr_codes%rowtype;
  v_table     public.dining_tables%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_mode      text;
  v_token     text;
  v_expires   timestamptz;
  v_count     int;
begin
  if p_public_token is null or btrim(p_public_token) !~ '^[A-Za-z0-9_-]{8,128}$' then
    return query select 'unreadable'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return query select 'unreadable'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select q.* into v_qr
    from public.table_qr_codes q
   where q.public_token = btrim(p_public_token)
     and q.revoked_at is null
   for update;

  if not found then
    return query select 'revoked'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select r.* into v_restaurant from public.restaurants r where r.id = v_qr.restaurant_id;
  v_mode := coalesce(v_restaurant.guest_verification_mode, 'code');

  -- The whole point of the setting: a restaurant on 'code' cannot be opened by
  -- a scan, no matter what the client asks for.
  if v_mode = 'code' then
    return query select 'code'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select t.* into v_table
    from public.dining_tables t
   where t.id = v_qr.table_id
     and t.restaurant_id = v_qr.restaurant_id
     and t.is_active = true;

  if not found then
    return query select 'revoked'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if not v_restaurant.is_active or not public.restaurant_can_write(v_restaurant.id) then
    return query select 'notserving'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1 from public.menus m
     where m.restaurant_id = v_restaurant.id and m.is_published = true
  ) then
    return query select 'nomenu'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- The QR row is locked above: count + mint + open log are atomic per card.
  -- A public IP can represent an entire restaurant Wi-Fi or carrier NAT.
  -- Scope its supplementary budget to this card, never unrelated tables or
  -- tenants. Keep the existing 10/card/hour and 20/card-IP/hour thresholds.
  -- IP hashes are caller-supplied hints, not authenticated identities.
  -- Refusals mint no session and insert no open log.
  select count(*) into v_count
    from public.table_session_opens o
   where o.qr_code_id = v_qr.id
     and o.opened_at > statement_timestamp() - k_window;
  if v_count >= k_opens_per_card then
    return query select 'limited'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select count(*) into v_count
    from public.table_session_opens o
   where o.qr_code_id = v_qr.id
     and o.ip_hash = p_ip_hash
     and o.opened_at > statement_timestamp() - k_window;
  if v_count >= k_opens_per_ip then
    return query select 'limited'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- 64 hex characters: two UUIDv4s with the dashes removed. Same shape and the
  -- same reasoning as verify_table_qr_with_code.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');
  v_expires := statement_timestamp() + make_interval(mins => k_session_minutes);

  insert into public.table_verification_sessions (
    token_hash, restaurant_id, table_id, qr_code_id, expires_at
  ) values (
    encode(sha256(v_token::bytea), 'hex'),
    v_restaurant.id,
    v_table.id,
    v_qr.id,
    v_expires
  );

  insert into public.table_session_opens (qr_code_id, ip_hash) values (v_qr.id, p_ip_hash);

  return query select 'opened'::text, v_token, v_restaurant.slug, v_table.label, v_expires;
end;
$$;

-- Preserve 30/session and 60/restaurant per ten minutes. An optional,
-- caller-supplied IP hash must not create cross-tenant quota coupling.
CREATE OR REPLACE FUNCTION public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text DEFAULT NULL,
  p_session_token text DEFAULT NULL,
  p_guest_token uuid DEFAULT NULL,
  p_ip_hash text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
  v_restaurant_id uuid;
  v_existing text;
  v_allowed boolean;
  v_retry integer;
  v_table_id uuid;
  v_order_session_id uuid;
BEGIN
  IF p_guest_token IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('guest:' || p_guest_token::text));
  END IF;
  IF p_session_token IS NULL OR btrim(p_session_token) = '' THEN
    RAISE EXCEPTION 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.id INTO v_restaurant_id
    FROM public.restaurants r
   WHERE r.slug = btrim(coalesce(p_slug, ''));

  -- Replays return before rate counting or any new ticket/session work.
  IF p_guest_token IS NOT NULL AND v_restaurant_id IS NOT NULL THEN
    SELECT o.code INTO v_existing
      FROM public.orders o
     WHERE o.guest_token = p_guest_token
       AND o.restaurant_id = v_restaurant_id
     LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT a.allowed, a.retry_after_seconds
    INTO v_allowed, v_retry
    FROM public.hit_rate_limit(
      'po:s:' || encode(sha256(btrim(p_session_token)::bytea), 'hex'),
      30, 600
    ) a;

  IF coalesce(v_allowed, true) THEN
    SELECT a.allowed, a.retry_after_seconds
      INTO v_allowed, v_retry
      FROM public.hit_rate_limit(
        'po:t:' || coalesce(v_restaurant_id::text, 'unknown'),
        60, 600
      ) a;
  END IF;

  IF coalesce(v_allowed, true) AND p_ip_hash IS NOT NULL AND btrim(p_ip_hash) <> '' THEN
    SELECT a.allowed, a.retry_after_seconds
      INTO v_allowed, v_retry
      FROM public.hit_rate_limit('po:i:' || v_restaurant_id::text || ':' || btrim(p_ip_hash), 60, 600) a;
  END IF;

  IF coalesce(v_allowed, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Too many orders right now. Please wait % seconds and try again.',
      coalesce(v_retry, 60)
      USING ERRCODE = 'P0001', HINT = 'rate-limited';
  END IF;

  v_code := public.place_public_order_core_with_code_retry(p_slug, p_lines, p_note, p_session_token);
  PERFORM public.stamp_guest_verification(v_code, v_restaurant_id, btrim(p_session_token));

  IF p_guest_token IS NOT NULL THEN
    UPDATE public.orders o
       SET guest_token = p_guest_token,
           tax_rate_bps_snapshot = coalesce(
             o.tax_rate_bps_snapshot,
             (SELECT r.tax_rate_bps FROM public.restaurants r WHERE r.id = o.restaurant_id)
           )
     WHERE o.code = v_code
       AND o.restaurant_id = v_restaurant_id;
  END IF;

  -- Every guest ticket at a table belongs to the table's one open sitting.
  -- The partial unique index arbitrates concurrent first orders; an order for
  -- a closed sitting opens a fresh session instead of reusing history.
  SELECT o.table_id INTO v_table_id
    FROM public.orders o
   WHERE o.code = v_code
     AND o.restaurant_id = v_restaurant_id;

  IF v_table_id IS NOT NULL THEN
    INSERT INTO public.order_sessions (restaurant_id, table_id)
    VALUES (v_restaurant_id, v_table_id)
    ON CONFLICT (table_id) WHERE status = 'open'
    DO UPDATE SET table_id = excluded.table_id
    RETURNING id INTO v_order_session_id;

    UPDATE public.orders o
       SET order_session_id = v_order_session_id
     WHERE o.code = v_code
       AND o.restaurant_id = v_restaurant_id
       AND o.order_session_id IS NULL;
  END IF;

  RETURN v_code;

EXCEPTION
  WHEN unique_violation THEN
    -- A concurrent replay may lose the guest-token unique-index race. The
    -- PL/pgSQL exception subtransaction rolls back its core order, line items,
    -- and session attachment before returning the winning order's code.
    IF p_guest_token IS NOT NULL THEN
      SELECT o.code INTO v_existing
        FROM public.orders o
       WHERE o.guest_token = p_guest_token
         AND (v_restaurant_id IS NULL OR o.restaurant_id = v_restaurant_id)
       LIMIT 1;

      IF v_existing IS NOT NULL THEN
        RETURN v_existing;
      END IF;
    END IF;
    RAISE;
END;
$$;
