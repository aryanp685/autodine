-- ============================================================================
-- AutoDine — trial renewal for "The King" restaurant
-- ============================================================================
--
-- WHY THIS SCRIPT EXISTS
--
-- The trial clock is `restaurants.trial_started_at + interval '7 days'`,
-- compared against `now()` in the database. When the trial ends and there
-- is no subscription, `restaurant_can_write()` returns false and every
-- write path is blocked.
--
-- This script resets `trial_started_at` to `now()` for "The King",
-- starting a fresh 7-day trial from the moment it runs.
--
-- WHO MAY RUN THIS
--
-- Server-side only. The `protect_restaurant_plan()` trigger in migration
-- 20261026001100 preserves plan columns when `auth.uid()` is not null
-- (i.e. when a signed-in user writes). This script must be run with the
-- service role or directly in the Supabase SQL editor, where `auth.uid()`
-- is null.
--
-- WHAT IT DOES
--
-- Sets `trial_started_at` to `now()` for the restaurant whose name is
-- "The King". This starts a fresh 7-day trial. The plan columns
-- (plan, plan_status, plan_started_at, plan_expires_at) are untouched.
--
-- WHAT IT DOES NOT DO
--
-- It does not charge anybody. It does not change the plan. It does not
-- delete data. It only moves the trial clock forward.
--
-- USAGE
--
-- Run this in the Supabase SQL editor, or via:
--   psql "postgres://..." -f supabase/migrations/20261028000100_renew_the_king_trial.sql
--
-- VERIFY BEFORE AND AFTER
--
-- Before:
--   SELECT id, name, trial_started_at, trial_started_at + interval '7 days' AS trial_ends
--   FROM public.restaurants
--   WHERE name ILIKE 'The King';
--
-- After:
--   SELECT id, name, trial_started_at, trial_started_at + interval '7 days' AS trial_ends
--   FROM public.restaurants
--   WHERE name ILIKE 'The King';
--
-- The trial_started_at should be the current time, and trial_ends should
-- be 7 days from now.
-- ============================================================================

-- Find the restaurant by name. Use ILIKE for case-insensitive matching.
-- If "The King" is the exact name, this will match exactly one row.
DO $$
DECLARE
  v_restaurant_id uuid;
  v_restaurant_name text;
  v_trial_started_at timestamptz;
  v_trial_ends_at timestamptz;
  v_row_count int;
BEGIN
  -- Find the restaurant
  SELECT id, name, trial_started_at
    INTO v_restaurant_id, v_restaurant_name, v_trial_started_at
    FROM public.restaurants
   WHERE name ILIKE 'The King'
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE NOTICE 'No restaurant found with name "The King". Nothing was changed.';
    RETURN;
  END IF;

  -- Check if the trial is already active (not expired)
  v_trial_ends_at := v_trial_started_at + interval '7 days';
  IF v_trial_ends_at > now() THEN
    RAISE NOTICE 'Restaurant "%" already has an active trial (ends at %). Nothing was changed.',
      v_restaurant_name, v_trial_ends_at;
    RETURN;
  END IF;

  -- Log the old state
  RAISE NOTICE 'Renewing trial for restaurant "%" (id: %). Old trial ended at %.',
    v_restaurant_name, v_restaurant_id, v_trial_ends_at;

  -- Update trial_started_at to now()
  UPDATE public.restaurants
     SET trial_started_at = now()
   WHERE id = v_restaurant_id;

  -- Get the new state
  SELECT trial_started_at INTO v_trial_started_at
    FROM public.restaurants
   WHERE id = v_restaurant_id;

  v_trial_ends_at := v_trial_started_at + interval '7 days';

  RAISE NOTICE 'Trial renewed for "%". New trial ends at % (7 days from now).',
    v_restaurant_name, v_trial_ends_at;
END $$;

-- Final verification: show the updated state
SELECT
  r.id,
  r.name,
  r.trial_started_at,
  r.trial_started_at + interval '7 days' AS trial_ends_at,
  r.plan,
  r.plan_status,
  public.restaurant_can_write(r.id) AS can_write
FROM public.restaurants r
WHERE r.name ILIKE 'The King';
