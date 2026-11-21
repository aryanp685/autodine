-- ============================================================================
-- AutoDine — run this AFTER applying migrations 20261026001100 .. 01300.
--
-- WHERE: Supabase dashboard -> SQL Editor.
--
-- Every check below prints PASS or FAIL in the first column. A FAIL is not a
-- suggestion: the app will misbehave in a specific, documented way, and the
-- message says which.
--
-- This is the same set /api/health answers from the app side; this file is the
-- ground truth, because it asks Postgres rather than a PostgREST cache.
-- ============================================================================

with checks as (

  select 'restaurant_can_write() exists' as check,
         count(*) = 1 as pass
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'restaurant_can_write'

  union all

  select 'has_restaurant_role() exists',
         count(*) = 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'has_restaurant_role'

  union all

  select 'plan_features() exists',
         count(*) = 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'plan_features'

  union all

  select 'restaurant_access() exists',
         count(*) = 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'restaurant_access'

  union all

  select 'restaurants.trial_started_at exists',
         count(*) = 1
    from information_schema.columns
   where table_schema = 'public' and table_name = 'restaurants'
     and column_name = 'trial_started_at'

  union all

  select 'restaurants.plan / plan_status exist',
         count(*) = 2
    from information_schema.columns
   where table_schema = 'public' and table_name = 'restaurants'
     and column_name in ('plan', 'plan_status')

  union all

  select 'restaurants.upi_id exists',
         count(*) = 1
    from information_schema.columns
   where table_schema = 'public' and table_name = 'restaurants'
     and column_name = 'upi_id'

  union all

  -- The trigger is the only thing stopping a signed-in owner from moving their
  -- own trial start date with a crafted UPDATE.
  select 'plan guard trigger is attached',
         count(*) = 1
    from pg_trigger
   where tgrelid = 'public.restaurants'::regclass
     and tgname = 'restaurants_plan_guard'
     and not tgisinternal

  union all

  -- Without this, any member could move any ticket.
  select 'orders UPDATE policy mentions roles',
         count(*) = 1
    from pg_policies
   where schemaname = 'public' and tablename = 'orders' and cmd = 'UPDATE'
     and coalesce(with_check, '') || coalesce(qual, '') ilike '%has_restaurant_role%'

  union all

  -- Migration 01100 must not have left the old membership-only policy behind.
  select 'no membership-only orders policy remains',
         count(*) = 0
    from pg_policies
   where schemaname = 'public' and tablename = 'orders' and cmd = 'UPDATE'
     and coalesce(qual, '') ilike '%current_restaurant_ids%'
     and coalesce(qual, '') not ilike '%has_restaurant_role%'

)
select check, case when pass then 'PASS' else 'FAIL' end as result
from checks
order by pass, check;

-- ---------------------------------------------------------------------------
-- What each restaurant's gate says right now.
--
-- Every row should be writable today: existing restaurants start a fresh
-- seven-day trial when 01100 lands, so nothing that works stops working.
-- `read_only = true` means that restaurant will refuse orders -- check
-- trial_started_at before assuming a bug.
-- ---------------------------------------------------------------------------
select
  r.slug,
  r.plan,
  r.plan_status,
  r.trial_started_at,
  r.trial_started_at + interval '7 days' as trial_ends_at,
  public.restaurant_can_write(r.id)          as can_write,
  (public.restaurant_access(r.id) ->> 'days_remaining') as days_remaining,
  coalesce(r.upi_id, '(none)')               as upi_id
from public.restaurants r
order by r.created_at desc;

-- ---------------------------------------------------------------------------
-- The entitlement matrix, as the database will enforce it.
-- ---------------------------------------------------------------------------
select plan, public.plan_features(plan) as features
from unnest(array['trial', 'starter', 'professional', 'business']) as plan;

-- ---------------------------------------------------------------------------
-- Expected, for comparison:
--
--   trial        menus qr ordering kitchen cashier reports roles import outlets support
--   starter      menus qr ordering kitchen cashier reports
--   professional ... plus roles, import
--   business     ... plus outlets, support
--
-- If `trial` is missing a feature, a first-week restaurant is being charged for
-- a week it cannot use. If `starter` has `import`, hiding the button is the
-- only thing standing between a Starter account and a Professional feature.
-- ---------------------------------------------------------------------------
