-- Pricing v2 and the Professional-shaped trial.
--
-- TWO CHANGES, ONE DECISION
--
--   1. The Professional price moves from 2,699 to 1,999 rupees a month.
--      Starter stays 999 and Business stays 3,699. This migration is now the
--      authority for plan_price_paise(); lib/plans.test.ts reads THIS file,
--      and lib/plans.ts carries the same three numbers.
--
--   2. The 21-day trial now carries the PROFESSIONAL feature set, not the
--      Business one. An owner spends the trial evaluating the plan they are
--      most likely to buy, Starter is a real step down and Business a real
--      step up, and 'support' (the one Business-only feature) is no longer
--      granted for free. plan_features() is re-declared here in full so the
--      trial and the paid tiers can never drift apart again.
--
-- Everything else -- trial length (21 days), outlet allowances (trial 5,
-- Starter 1, Professional 5, Business unlimited), the write gate, the billing
-- catalog shape -- is unchanged from migrations 20261110001000 and
-- 20261110001100, which this migration forward-replaces.

-- ---------------------------------------------------------------------------
-- 1. The feature matrix: trial = Professional.
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
      'roles', 'import', 'outlets'
    ]
    when 'starter' then array[
      'menus', 'qr', 'ordering', 'kitchen', 'cashier', 'reports'
    ]
    -- The trial IS Professional, free for 21 days: same features, same
    -- outlet allowance, no support. When the trial ends the account reads
    -- the choose-plan screen; it is never quietly downgraded.
    when 'trial' then array[
      'menus', 'qr', 'ordering', 'kitchen', 'cashier', 'reports',
      'roles', 'import', 'outlets'
    ]
    else array[]::text[]
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The catalog: Professional at 1,999.
-- ---------------------------------------------------------------------------
create or replace function public.plan_price_paise(p_plan text)
returns bigint
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select case p_plan
           -- Rupees times a hundred. The number written here is the one on the
           -- pricing page, so the two can be read against each other instead
           -- of one being a conversion nobody checks.
           when 'starter'      then (999 * 100)::bigint
           when 'professional' then (1999 * 100)::bigint
           when 'business'     then (3699 * 100)::bigint
           else null
         end;
$$;

comment on function public.plan_price_paise(text) is
  'The approved monthly price of a plan, in paise (999 / 1999 / 3699). Null for a plan that is not for sale (trial), so an unknown or unpaid plan cannot be priced at zero by accident.';

comment on function public.plan_features(text) is
  'The feature matrix (pricing v2): the 21-day trial carries the Professional set; support is Business-only.';
