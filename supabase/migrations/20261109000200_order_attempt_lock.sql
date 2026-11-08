-- Preserve the latest session attachment and retry logic; serialize guest-token replays.
-- ============================================================================
-- Restore the P3 durable order-session attachment in the latest public-order
-- wrapper. The order-code reliability migration replaced this wrapper from an
-- older body and accidentally omitted the open-or-join step introduced by
-- 20261108000200. The core order write and checkout flow are unchanged.
-- ============================================================================

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
      FROM public.hit_rate_limit('po:i:' || btrim(p_ip_hash), 60, 600) a;
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

GRANT EXECUTE ON FUNCTION public.place_public_order(text, jsonb, text, text, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.place_public_order(text, jsonb, text, text, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.place_public_order(text, jsonb, text, text, uuid, text) IS
  'Guest order placement: server-priced, idempotent on p_guest_token, rate limited, collision-retried, and attached to the table''s open order session.';
