-- ============================================================================
-- AutoDine — migration 20261026001200: what each plan actually includes.
--
-- WHY A FUNCTION AND NOT A TABLE
--
-- The plan matrix is six lines long, it changes with a deploy, and it must
-- never disagree between the pricing page, the server action that refuses a
-- request, and the database function that refuses a write. A table would need
-- a migration for every copy edit and would let the repo and the project drift
-- — which is exactly what happened to restaurant_can_write (see the previous
-- migration). Six lines of `case` in one function is the version that cannot
-- drift.
--
-- THE MATRIX, copied from lib/plans.ts (which the pricing page renders):
--
--   feature     | trial | starter | professional | business
--   ------------+-------+---------+--------------+---------
--   menus       |   ✓   |    ✓    |      ✓       |    ✓
--   qr          |   ✓   |    ✓    |      ✓       |    ✓
--   ordering    |   ✓   |    ✓    |      ✓       |    ✓
--   kitchen     |   ✓   |    ✓    |      ✓       |    ✓
--   cashier     |   ✓   |    ✓    |      ✓       |    ✓
--   reports     |   ✓   |    ✓    |      ✓       |    ✓
--   roles       |   ✓   |    —    |      ✓       |    ✓
--   import      |   ✓   |    —    |      ✓       |    ✓
--   outlets     |   ✓   |    —    |      —       |    ✓
--   support     |   ✓   |    —    |      —       |    ✓
--
-- Trial is the whole product on purpose: `lib/plans.ts` says so, the pricing
-- page says so, and a first-week restaurant that cannot import its menu is
-- not evaluating the product.
--
-- DEFAULTS ARE DENY. An unknown plan gets nothing. An unknown feature is not
-- in anybody's list. Both are the safe direction, and both are tested in
-- lib/plans.test.ts.
--
-- WHAT THIS DOES NOT DO
--
-- It does not sell anything. No plan is purchasable in this deployment; every
-- restaurant is on `trial`, so every restaurant has every feature. The gate
-- exists so that the day a plan is sold, the refusal happens on the server and
-- not in a hidden button.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The list, for one plan.
-- ---------------------------------------------------------------------------
create or replace function public.plan_features(p_plan text)
returns text[]
language sql
immutable
as $$
  select case p_plan
    when 'business' then array[
      'menus', 'qr', 'ordering', 'kitchen', 'cashier', 'reports',
      'roles', 'import', 'outlets', 'support'
    ]
    when 'professional' then array[
      'menus', 'qr', 'ordering', 'kitchen', 'cashier', 'reports',
      'roles', 'import'
    ]
    when 'starter' then array[
      'menus', 'qr', 'ordering', 'kitchen', 'cashier', 'reports'
    ]
    -- A trial carries the whole product, and so does a row whose plan value
    -- this function does not recognise? No: unknown gets nothing. The trial
    -- row says 'trial' explicitly.
    when 'trial' then array[
      'menus', 'qr', 'ordering', 'kitchen', 'cashier', 'reports',
      'roles', 'import', 'outlets', 'support'
    ]
    else array[]::text[]
  end;
$$;

comment on function public.plan_features(text) is
  'The entitlement matrix. Unknown plan -> empty. Mirrors lib/plans.ts.';

-- ---------------------------------------------------------------------------
-- The list for one restaurant, as it stands right now.
--
-- An expired workspace keeps every capability it can still use read-only; what
-- it loses is the write gate, which is restaurant_can_write()'s job and not
-- this function's. A caller asking "may I import a menu" must ask both.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_features(p_restaurant_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.plan_features(coalesce(r.plan, 'starter'))
       from public.restaurants r
      where r.id = p_restaurant_id),
    array[]::text[]
  );
$$;

create or replace function public.restaurant_has_feature(
  p_restaurant_id uuid,
  p_feature text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_feature = any (public.restaurant_features(p_restaurant_id));
$$;

comment on function public.restaurant_has_feature(uuid, text) is
  'Deny-by-default entitlements check. Does NOT include the trial/expiry write gate.';

-- ---------------------------------------------------------------------------
-- One jsonb that the dashboard, Settings and the pricing-adjacent screens can
-- read: plan, trial clock, gate, features. restaurant_access() was created in
-- the previous migration; this replaces it with the feature list included, so
-- a screen needs one round trip rather than two.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_access(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan        text;
  v_status      text;
  v_started     timestamptz;
  v_expires     timestamptz;
  v_can_write   boolean;
  v_now         timestamptz := now();
begin
  select r.plan, r.plan_status, r.trial_started_at, r.plan_expires_at
    into v_plan, v_status, v_started, v_expires
    from public.restaurants r
   where r.id = p_restaurant_id;

  if not found then
    return null;
  end if;

  v_can_write := public.restaurant_can_write(p_restaurant_id);

  return jsonb_build_object(
    'plan',        v_plan,
    'status',      v_status,
    'started_at',  v_started,
    'trial_ends_at', v_started + interval '7 days',
    'plan_expires_at', v_expires,
    'days_remaining',
      case
        when v_can_write and v_plan not in ('starter', 'professional', 'business')
          then greatest(
                 ceil(extract(epoch from (v_started + interval '7 days' - v_now)) / 86400.0),
                 0)::int
        else 0
      end,
    'can_write',   v_can_write,
    'read_only',   not v_can_write,
    'features',    to_jsonb(public.restaurant_features(p_restaurant_id))
  );
end;
$$;

grant execute on function public.plan_features(text) to authenticated, anon;
grant execute on function public.restaurant_features(uuid) to authenticated;
grant execute on function public.restaurant_has_feature(uuid, text) to authenticated;
