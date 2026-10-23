-- ============================================================================
-- AutoDine — run this BEFORE applying migrations 20261026001100..01300.
--
-- WHERE: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--        (Not the CLI. This is read-only.)
--
-- WHY: the repository was missing `restaurant_can_write()` and
--      `has_restaurant_role()` for its whole life, yet eleven functions call
--      them. The deployment may already define its own versions. If it does,
--      applying this branch replaces them -- and a replacement that is stricter
--      locks a working restaurant out of ordering, while one that is looser
--      opens a hole. Read what is there first.
--
-- WHAT TO DO WITH THE OUTPUT
--   * "no rows"                  -> the functions do not exist. Applying is a
--                                   fix, not a change. Safe.
--   * one or two rows            -> read them. If the body matches what
--                                   migration 01100 creates (active AND a
--                                   current plan OR a running trial), you can
--                                   apply. If it differs, send the definition
--                                   back before applying anything -- it may
--                                   encode a rule this repo does not know about.
--
-- Nothing here reads a restaurant's data. It reads function signatures and
-- column names, which are already visible to anyone with the project.
-- ============================================================================

-- 1. The two functions the code has always called --------------------------
select
  p.proname                                   as function_name,
  pg_get_function_identity_arguments(p.oid)   as arguments,
  pg_get_functiondef(p.oid)                   as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('restaurant_can_write', 'has_restaurant_role')
order by p.proname;

-- 2. Do the columns this branch adds already exist? ------------------------
--    All three should come back false on a database built from the previous
--    migrations. A true means somebody applied part of this branch already.
select
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'restaurants'
       and column_name = 'trial_started_at'
  ) as has_trial_started_at,
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'restaurants'
       and column_name = 'plan'
  ) as has_plan,
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'restaurants'
       and column_name = 'upi_id'
  ) as has_upi_id;

-- 3. Which policies are on public.orders right now? ------------------------
--    Migration 01100 replaces the UPDATE and INSERT policies so they require a
--    role, not merely membership. This shows what is being replaced.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'orders'
order by cmd, policyname;

-- 4. How many restaurants will start a seven-day clock when 01100 lands? ---
--    Every existing row gets trial_started_at = now(), so nothing that works
--    today expires. This is the count of rows that will be in that state.
select count(*) as restaurants_that_will_start_a_trial
from public.restaurants;
