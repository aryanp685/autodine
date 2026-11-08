-- ---------------------------------------------------------------------------
-- Small reliability fixes: collision-safe public order codes and one
-- cross-device kitchen announcement winner per order.
-- ---------------------------------------------------------------------------

-- The code generator already emits a random five-character suffix. The
-- database must still be the final authority: a collision should be retried,
-- never allowed to create two guest-visible tickets with the same code.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.orders
     GROUP BY restaurant_id, code
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate order codes exist within a restaurant; resolve them before adding orders_restaurant_code_unique.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS orders_restaurant_code_unique
  ON public.orders (restaurant_id, code);

CREATE OR REPLACE FUNCTION public.place_public_order_core_with_code_retry(
  p_slug text,
  p_lines jsonb,
  p_note text,
  p_session_token text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
  v_constraint_name text;
  v_attempt integer := 0;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    BEGIN
      v_code := public.place_public_order_core(p_slug, p_lines, p_note, p_session_token);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
      IF v_constraint_name IS DISTINCT FROM 'orders_restaurant_code_unique' THEN
        RAISE;
      END IF;
      IF v_attempt >= 8 THEN
        RAISE EXCEPTION 'Could not allocate a unique order code after % attempts.', v_attempt
          USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.place_public_order_core_with_code_retry(text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.place_public_order_core_with_code_retry(text, jsonb, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.place_public_order_core_with_code_retry(text, jsonb, text, text) FROM authenticated;

-- Keep the existing rate limiting, guest-token idempotency, session stamping,
-- and tax snapshot behavior. Only the core call changes: unique-code
-- collisions are retried inside a savepoint, while unrelated unique errors
-- continue to reach the existing idempotency handler below.
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
BEGIN
  IF p_session_token IS NULL OR btrim(p_session_token) = '' THEN
    RAISE EXCEPTION 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.id INTO v_restaurant_id
    FROM public.restaurants r
   WHERE r.slug = btrim(coalesce(p_slug, ''));

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

  RETURN v_code;

EXCEPTION
  WHEN unique_violation THEN
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

-- Web Locks elect one tab only. This private claim elects one device too.
-- The caller cannot read or mutate the table directly; the SECURITY DEFINER
-- RPC verifies both the order state and the kitchen-role membership.
CREATE TABLE IF NOT EXISTS public.kitchen_announcement_claims (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  claimed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE INDEX IF NOT EXISTS kitchen_announcement_claims_restaurant_idx
  ON public.kitchen_announcement_claims (restaurant_id, claimed_at DESC);

ALTER TABLE public.kitchen_announcement_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitchen_announcement_claims FROM PUBLIC;
REVOKE ALL ON public.kitchen_announcement_claims FROM anon;
REVOKE ALL ON public.kitchen_announcement_claims FROM authenticated;

CREATE OR REPLACE FUNCTION public.claim_kitchen_order_announcement(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
  v_rows bigint := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to claim a kitchen announcement.' USING ERRCODE = '42501';
  END IF;

  SELECT o.restaurant_id INTO v_restaurant_id
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.prep_status = 'new'
     AND NOT (o.hold_required AND o.confirmed_at IS NULL)
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.memberships m
     WHERE m.restaurant_id = v_restaurant_id
       AND m.user_id = v_actor
       AND m.role IN ('owner', 'manager', 'kitchen')
  ) THEN
    RAISE EXCEPTION 'Only kitchen staff may claim an announcement.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.kitchen_announcement_claims (order_id, restaurant_id, claimed_by)
  VALUES (p_order_id, v_restaurant_id, v_actor)
  ON CONFLICT (order_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_kitchen_order_announcement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_kitchen_order_announcement(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_kitchen_order_announcement(uuid) TO authenticated;
