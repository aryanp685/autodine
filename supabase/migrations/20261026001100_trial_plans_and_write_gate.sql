-- ============================================================================
-- AutoDine — migration 20261026001100: the trial clock, and the gate that reads
-- it.
--
-- THREE THINGS, AND ONE OF THEM IS A BUG FIX
--
-- 1. `public.restaurant_can_write(uuid)` is called by eleven functions in this
--    repository (place_public_order, place_order, place_counter_order,
--    record_counter_payment, verify_table_qr, ensure_table_qr_code,
--    begin_online_payment, set_order_line_quantities, ...) and by the kitchen
--    board in lib/db/kitchen-screen.ts. It was NEVER DEFINED in any migration
--    in this repository. A fresh database created from these migrations applies
--    cleanly — plpgsql only resolves function calls when they run — and then
--    every one of those paths fails with
--    `function public.restaurant_can_write(uuid) does not exist`.
--
--    The deployment's database has a version of it. The repository does not,
--    which means the repository cannot rebuild the deployment. This migration
--    creates it, so the schema in git is the schema in production.
--
--    `has_restaurant_role(uuid, text[])` had the same problem: the app's code
--    comments describe order policies that call it, no migration ever created
--    it, and the policies that shipped in migration 0001 do not call it either
--    (they only check membership). Both are created here and the order policies
--    are rewritten to use them — see §3.
--
-- 2. The trial becomes a real, server-side fact. Until now `lib/trial.ts`
--    computed a state nobody read: TRIAL_DAYS was imported by tests only. A
--    trial that is never checked is copy, not a policy. The start timestamp is
--    now a column, the length is SEVEN days, and every write path already calls
--    restaurant_can_write — so gating that one function gates orders, menus,
--    tables and payments.
--
-- 3. The plan a restaurant is on becomes a column rather than a paragraph on a
--    pricing page. It does not change any behaviour by itself: see the
--    entitlement migration that follows, and note that the trial carries every
--    feature, which is what the pricing page says.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
--   * It does not charge anybody. There is no payment gateway in this
--     deployment and no plan can be bought.
--   * It does not delete anything on expiry. Read-only means writes are
--     refused and reads — menus, order history, reports — keep working. A
--     restaurant's records are not collateral for a subscription.
--   * It does not backdate trials for existing restaurants. Every existing row
--     starts its seven days when this migration runs (`default now()` on a new
--     column). Backdating would expire a working restaurant the moment the
--     migration landed.
--
-- UNVERIFIED ON A REAL DATABASE. The sandbox has no Postgres; `npm run
-- sql:check` parses only the ALTER TABLE statements. Run this against a
-- throwaway Supabase project first, and — before applying it to the shared
-- project — compare the deployment's existing function with
-- `select pg_get_functiondef('public.restaurant_can_write(uuid)'::regprocedure)`
-- so a stricter or looser definition there is not silently replaced.
-- ============================================================================

-- ------------------------------------------------------------ restaurants
alter table public.restaurants
  add column if not exists trial_started_at timestamptz not null default now(),
  add column if not exists plan text not null default 'trial',
  add column if not exists plan_status text not null default 'trialing',
  add column if not exists plan_started_at timestamptz,
  add column if not exists plan_expires_at timestamptz;

-- Constraints by name. Dropped and re-added rather than wrapped in a DO block:
-- the same result, one statement each, and `npm run sql:check` can still parse
-- the file around them (a DO block swallows the function that precedes it).
alter table public.restaurants drop constraint if exists restaurants_plan_check;
alter table public.restaurants
  add constraint restaurants_plan_check
  check (plan in ('trial', 'starter', 'professional', 'business'));

alter table public.restaurants drop constraint if exists restaurants_plan_status_check;
alter table public.restaurants
  add constraint restaurants_plan_status_check
  check (plan_status in ('trialing', 'active', 'expired', 'cancelled'));

comment on column public.restaurants.trial_started_at is
  'When the seven-day trial began. Written once, at row creation, and never moved by a client.';
comment on column public.restaurants.plan is
  'trial until a plan is bought. No plan is purchasable in this deployment.';
comment on column public.restaurants.plan_status is
  'trialing | active | expired | cancelled. Read by restaurant_can_write().';
comment on column public.restaurants.plan_expires_at is
  'End of a paid period. Null means no paid period has ever been set.';

-- ---------------------------------------------------------------------------
-- The trial start cannot be moved by the browser.
--
-- The owner is allowed to UPDATE its own restaurants row (Settings: name,
-- tax rate, address). Those writes arrive with the signed-in user's token, so
-- a column-level rule cannot tell "renaming the restaurant" from "restarting
-- the trial" — but this trigger can, because it sees the old row. A write that
-- arrives with a JWT (auth.uid() is not null) keeps the plan columns as they
-- were. Server-side code — the service role used by signup and, later, by a
-- billing webhook — arrives with auth.uid() null and may change them.
--
-- This is belt to RLS's braces: there is no billing UI to abuse yet, and this
-- keeps it that way when there is one.
-- ---------------------------------------------------------------------------
create or replace function public.protect_restaurant_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  new.trial_started_at := old.trial_started_at;
  new.plan             := old.plan;
  new.plan_status      := old.plan_status;
  new.plan_started_at  := old.plan_started_at;
  new.plan_expires_at  := old.plan_expires_at;
  return new;
end;
$$;

drop trigger if exists restaurants_plan_guard on public.restaurants;
create trigger restaurants_plan_guard
  before update on public.restaurants
  for each row execute function public.protect_restaurant_plan();

-- ---------------------------------------------------------------------------
-- The trial clock, in one place.
--
-- Read from restaurants.trial_started_at, compared against the DATABASE's
-- now(). The browser's clock is never consulted for this and neither is the
-- application server's: a laptop with the wrong date must not decide whether a
-- restaurant can take orders.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_trial_ends_at(p_restaurant_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select r.trial_started_at + interval '7 days'
    from public.restaurants r
   where r.id = p_restaurant_id;
$$;

comment on function public.restaurant_trial_ends_at(uuid) is
  'Seven days after the row was created. Null for a restaurant that does not exist.';

-- ---------------------------------------------------------------------------
-- Who may act, and on what.
-- ---------------------------------------------------------------------------
create or replace function public.has_restaurant_role(
  p_restaurant_id uuid,
  p_roles text[]
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.memberships m
     where m.restaurant_id = p_restaurant_id
       and m.user_id = auth.uid()
       and m.role::text = any (p_roles)
  );
$$;

comment on function public.has_restaurant_role(uuid, text[]) is
  'True when the signed-in user holds one of the given roles at this restaurant. Anon is always false.';

-- ---------------------------------------------------------------------------
-- THE GATE.
--
-- Every order, menu, table and payment write in the product goes through this
-- function (directly in SQL, or in an RLS policy). Its whole meaning is:
--
--   the restaurant is open for business
--   AND either a paid plan is current, or the seven-day trial has not ended.
--
-- A paid plan with plan_expires_at null is treated as current: that is what a
-- plan looks like before a billing provider is connected, and refusing it
-- would lock the very accounts this migration is meant to leave alone.
--
-- The interval is written here AND in restaurant_trial_ends_at. They must
-- agree; they are compared against each other in the app's tests by reading
-- the trial length from lib/trial.ts, which is 7.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_can_write(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select r.is_active
       and case
             when r.plan in ('starter', 'professional', 'business')
               then coalesce(r.plan_expires_at, 'infinity'::timestamptz) > now()
             else r.trial_started_at + interval '7 days' > now()
           end
      from public.restaurants r
     where r.id = p_restaurant_id
  ), false);
$$;

comment on function public.restaurant_can_write(uuid) is
  'The write gate: restaurant active, and a current paid period or a running seven-day trial. False for unknown ids.';

-- One jsonb for the app to render the plan line in the dashboard and Settings:
-- no second source of truth for "how long is left".
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
    -- Whole days, rounded up, and never negative. The app formats the copy.
    'days_remaining',
      case
        when v_can_write and v_plan not in ('starter', 'professional', 'business')
          then greatest(
                 ceil(extract(epoch from (v_started + interval '7 days' - v_now)) / 86400.0),
                 0)::int
        else 0
      end,
    'can_write',   v_can_write,
    'read_only',   not v_can_write
  );
end;
$$;

comment on function public.restaurant_access(uuid) is
  'Plan, trial end, days remaining and the write gate for one restaurant. Null for an unknown id.';

-- ---------------------------------------------------------------------------
-- §3. Order policies, rewritten to say what the app says.
--
-- Migration 0001 let ANY member update an order row and any member insert one.
-- The application checks roles before it acts, but a check in the application
-- is a courtesy; the database is the boundary. Those two policies now require
-- the same roles the app uses, and the same write gate every function uses.
--
-- Reads are untouched: a cashier, a cook and an owner can all see the board.
-- ---------------------------------------------------------------------------
drop policy if exists orders_staff_update on public.orders;
create policy orders_staff_update on public.orders
  for update
  using (
    public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'kitchen', 'cashier'])
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'kitchen', 'cashier'])
  );

drop policy if exists orders_staff_insert on public.orders;
create policy orders_staff_insert on public.orders
  for insert
  with check (
    public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'kitchen', 'cashier'])
    and public.restaurant_can_write(restaurant_id)
  );

-- The kitchen board reads the gate through an RPC, so it needs EXECUTE.
-- restaurant_trial_ends_at is only read by the same screens.
grant execute on function public.restaurant_can_write(uuid) to authenticated, anon;
grant execute on function public.has_restaurant_role(uuid, text[]) to authenticated;
grant execute on function public.restaurant_trial_ends_at(uuid) to authenticated;
grant execute on function public.restaurant_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: existing rows already defaulted trial_started_at to now(). Nothing
-- to update. Recorded here so a reader does not go looking for one.
-- ---------------------------------------------------------------------------
