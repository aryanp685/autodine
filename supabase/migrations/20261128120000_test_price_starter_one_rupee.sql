-- ---------------------------------------------------------------------------
-- TEMPORARY test price: Starter at 1 rupee a month.
--
-- This is not a commercial decision. The owner asked for one real live payment
-- through Cashfree to prove subscription activation end to end, and a rupee is
-- the smallest amount a card/UPI payment can carry. The amount guard in
-- record_subscription_payment() compares the provider's amount to this
-- function, so the test price has to live here as well as in lib/plans.ts.
--
-- REVERT: restore the approved prices (999 / 1999 / 3699) with the follow-up
-- migration that ships with the revert commit, before Starter is sold again.
-- ---------------------------------------------------------------------------
create or replace function public.plan_price_paise(p_plan text)
returns bigint
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select case p_plan
           when 'starter'      then (1 * 100)::bigint
           when 'professional' then (1999 * 100)::bigint
           when 'business'     then (3699 * 100)::bigint
           else null
         end;
$$;

comment on function public.plan_price_paise(text) is
  'The approved monthly price of a plan, in paise. NULL for a plan that is not for sale (trial). TEMPORARY: Starter is 1 rupee (100 paise) for a live payment test; see the revert migration.';
