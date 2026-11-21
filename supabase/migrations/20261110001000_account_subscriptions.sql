-- Commercial subscriptions: MODEL C.
--
-- One subscription per ACCOUNT, shared by every outlet that account owns.
-- A restaurant is an outlet; the account is what is billed, what trials, and
-- what goes read-only.
--
-- THE SPECIFICATION this implements (approved, and recorded canonically in
-- AGENTS.md):
--
--   * Trial                 21 days from activation.
--   * Starter               Rs 999 / month  -- 1 outlet.
--   * Professional          Rs 2,699 / month -- 5 outlets.
--   * Business              Rs 3,699 / month -- unlimited outlets.
--   * Trial activation      must work.
--   * Existing 7-day trials that are STILL RUNNING keep their original
--     activation date and run 21 days from it.
--   * Trials that have ALREADY EXPIRED stay expired. Nothing in this file
--     revives them; that is why the trial end is materialised per account
--     (`accounts.trial_ends_at`) instead of being derived from one interval
--     that a later change would silently rewrite.
--   * Downgrades preserve every outlet and every row of data. A plan sets how
--     many outlets may still be CREATED; it never removes one.
--   * An expired or unpaid subscription is READ-ONLY. Nothing is deleted.
--
-- WHY MATERIALISED trial_ends_at: the obvious implementation is
-- `trial_started_at + interval '21 days'` everywhere. Applied on top of an
-- estate that ran on 7 days, that single change would hand a fortnight of
-- extra access to every trial that expired between day 7 and day 21 -- a
-- silent mass reactivation. The end date is therefore a column, written once
-- per account by the backfill below, from the state each trial was actually
-- in at the moment this migration ran.
--
-- FORWARD-ONLY. This file supersedes the per-restaurant plan logic of
-- 20261026001100 and 20261026001200 without editing them. The legacy
-- `restaurants.plan*` columns keep their values and keep their guard trigger;
-- they are no longer the authority, and every read and write gate in the
-- product now resolves through `restaurants.account_id`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The account.
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid references public.profiles(id) on delete set null,
  plan             text not null default 'trial'
                     check (plan in ('trial', 'starter', 'professional', 'business')),
  plan_status      text not null default 'trialing'
                     check (plan_status in ('trialing', 'active', 'expired', 'cancelled')),
  -- When the trial was activated. Never moved once written.
  trial_started_at timestamptz not null default now(),
  -- When the trial ends. MATERIALISED: see the header. Null means
  -- "trial_started_at + 21 days", which is what a brand-new account gets.
  trial_ends_at    timestamptz,
  plan_started_at  timestamptz,
  plan_expires_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists accounts_owner_key
  on public.accounts (owner_id)
  where owner_id is not null;

comment on table public.accounts is
  'Model C: one subscription per account, shared by every restaurant (outlet) the account owns.';
comment on column public.accounts.trial_ends_at is
  'Materialised trial end. Written once by 20261110001000 from the state each trial was in; never recomputed from a bare interval.';

alter table public.accounts enable row level security;
revoke all on public.accounts from anon;
revoke all on public.accounts from authenticated;
-- A policy is not a privilege: restaurant_access() and restaurant_features()
-- run as the CALLER (20261110000600 made them SECURITY INVOKER), so staff need
-- SELECT on the table for the plan read to work at all. What they may see is
-- still decided by the policy below.
grant select on public.accounts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Link every restaurant to an account.
-- ---------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

create index if not exists restaurants_account_idx on public.restaurants (account_id);

comment on column public.restaurants.account_id is
  'The account that owns this outlet and pays for it. Model C: the subscription lives on the account, not here.';

-- An account is readable by any member of any restaurant it owns. There is no
-- write policy: subscription state changes only through
-- public.admin_set_subscription() (service role) or the service role itself.
-- (It is declared here rather than with the table because the policy
-- references restaurants.account_id, and PostgreSQL checks a policy
-- expression against the table when it is created.)
drop policy if exists accounts_read on public.accounts;
create policy accounts_read on public.accounts
  for select
  using (
    exists (
      select 1
        from public.restaurants r
        join public.memberships m on m.restaurant_id = r.id
       where r.account_id = public.accounts.id
         and m.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Backfill.
--
-- One account per owner. A restaurant joins the account of the earliest owner
-- it can find that already has one, so a person who owns three outlets keeps
-- them together. Restaurants with no membership at all still get an account of
-- their own rather than being left unowned by the write gate.
-- ---------------------------------------------------------------------------
do $$
declare
  r          record;
  v_owner    uuid;
  v_account  uuid;
begin
  for r in
    select rt.id,
           rt.created_at,
           coalesce(rt.trial_started_at, rt.created_at) as activation
      from public.restaurants rt
     where rt.account_id is null
     order by rt.created_at, rt.id
  loop
    select m.user_id into v_owner
      from public.memberships m
     where m.restaurant_id = r.id
     order by (m.role = 'owner') desc, m.created_at, m.user_id
     limit 1;

    v_account := null;
    if v_owner is not null then
      select a.id into v_account
        from public.accounts a
       where a.owner_id = v_owner
       order by a.created_at, a.id
       limit 1;
    end if;

    if v_account is null then
      insert into public.accounts (owner_id, plan, plan_status, trial_started_at, created_at)
      values (v_owner, 'trial', 'trialing', r.activation, coalesce(r.created_at, now()))
      returning id into v_account;
    end if;

    update public.restaurants set account_id = v_account where id = r.id;
  end loop;
end;
$$;

-- Subscription state per account, computed once from the restaurants attached
-- to it. This is where the "running trials extend, expired trials stay
-- expired" rule is applied.
update public.accounts a
   set trial_started_at = s.activation,
       trial_ends_at    = coalesce(s.trial_end, s.activation + interval '21 days'),
       plan             = case s.plan_rank
                            when 3 then 'business'
                            when 2 then 'professional'
                            when 1 then 'starter'
                            else 'trial'
                          end,
       plan_status      = case
                            when s.plan_rank > 0 then 'active'
                            when coalesce(s.trial_end, s.activation + interval '21 days') > now() then 'trialing'
                            else 'expired'
                          end,
       plan_started_at  = s.paid_started,
       plan_expires_at  = s.paid_expires,
       updated_at       = now()
  from (
    select r.account_id,
           min(r.trial_started_at) as activation,
           -- The strongest paid plan any outlet of the account was on.
           max(
             case
               when r.plan in ('starter', 'professional', 'business')
                and coalesce(r.plan_status, 'trialing') = 'active' then
                 case r.plan when 'business' then 3 when 'professional' then 2 else 1 end
               else 0
             end
           ) as plan_rank,
           max(
             case
               when r.plan in ('starter', 'professional', 'business')
                and coalesce(r.plan_status, 'trialing') = 'active'
               then r.plan_expires_at
             end
           ) as paid_expires,
           min(
             case
               when r.plan in ('starter', 'professional', 'business')
                and coalesce(r.plan_status, 'trialing') = 'active'
               then coalesce(r.plan_started_at, r.trial_started_at)
             end
           ) as paid_started,
           -- Per-restaurant trial end, decided by the state that trial was
           -- actually in when this migration ran:
           --   still running on the 7-day rule -> activation + 21 days
           --   already expired                 -> activation + 7 days (past)
           max(
             case
               when r.plan in ('starter', 'professional', 'business')
                and coalesce(r.plan_status, 'trialing') = 'active' then null
               when r.trial_started_at + interval '7 days' > now()
                 then r.trial_started_at + interval '21 days'
               else r.trial_started_at + interval '7 days'
             end
           ) as trial_end
      from public.restaurants r
     where r.account_id is not null
     group by r.account_id
  ) s
 where a.id = s.account_id;

-- ---------------------------------------------------------------------------
-- 4. Entitlement helpers.
-- ---------------------------------------------------------------------------
-- Outlets per plan. NULL means unlimited (Business).
create or replace function public.account_outlet_limit(p_plan text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case coalesce(p_plan, 'trial')
    when 'starter'      then 1
    when 'professional' then 5
    when 'business'     then null
    -- A trial shows the product at its best, but "add outlet" is still free
    -- and self-serve, so it keeps the stop that existed before Model C.
    else 5
  end;
$$;

create or replace function public.account_outlet_count(p_account_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select count(*)::integer from public.restaurants r where r.account_id = p_account_id;
$$;

create or replace function public.account_trial_ends_at(p_account_id uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days')
    from public.accounts a
   where a.id = p_account_id;
$$;

-- The write gate for an account.
create or replace function public.account_can_write(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
             when a.plan in ('starter', 'professional', 'business')
              and a.plan_status = 'active'
               then coalesce(a.plan_expires_at, 'infinity'::timestamptz) > now()
             else coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days') > now()
           end
      from public.accounts a
     where a.id = p_account_id
  ), false);
$$;

comment on function public.account_can_write(uuid) is
  'Model C write gate: an account may write while its trial is running or its paid plan has not expired. Expired means read-only, never deleted.';

-- ---------------------------------------------------------------------------
-- 5. The restaurant-facing gates, now resolved through the account.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_can_write(p_restaurant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_plan    text;
  v_status  text;
  v_started timestamptz;
  v_expires timestamptz;
begin
  select r.account_id, r.plan, r.plan_status, r.trial_started_at, r.plan_expires_at
    into v_account, v_plan, v_status, v_started, v_expires
    from public.restaurants r
   where r.id = p_restaurant_id;

  if not found then
    return false;
  end if;

  if v_account is not null then
    return public.account_can_write(v_account);
  end if;

  -- No account link (only possible if a restaurant was created outside every
  -- path this migration knows about). Fall back to the legacy per-outlet rule
  -- rather than locking a working restaurant out of its own data.
  return coalesce(
    (select r.is_active
       and case
             when r.plan in ('starter', 'professional', 'business')
               then coalesce(r.plan_expires_at, 'infinity'::timestamptz) > now()
             else r.trial_started_at + interval '21 days' > now()
           end
       from public.restaurants r
      where r.id = p_restaurant_id),
    false);
end;
$$;

-- SECURITY INVOKER, and it must stay that way: as DEFINER it answers with the
-- trial end date of ANY restaurant id a signed-in caller cares to name, which
-- is commercial information about a business they do not work for. Called from
-- a definer function (account_can_write, restaurant_can_write) it still sees
-- the whole row, because the definer's rights apply inside those.
create or replace function public.restaurant_trial_ends_at(p_restaurant_id uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    public.account_trial_ends_at(r.account_id),
    r.trial_started_at + interval '21 days'
  )
    from public.restaurants r
   where r.id = p_restaurant_id;
$$;

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
    when 'trial' then array[
      'menus', 'qr', 'ordering', 'kitchen', 'cashier', 'reports',
      'roles', 'import', 'outlets', 'support'
    ]
    else array[]::text[]
  end;
$$;

-- SECURITY INVOKER and revoked from anon, exactly as 20261110000600 left it:
-- plan and trial state is a staff read, not a guest one.
create or replace function public.restaurant_features(p_restaurant_id uuid)
returns text[]
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    (select public.plan_features(coalesce(a.plan, 'trial'))
       from public.restaurants r
       join public.accounts a on a.id = r.account_id
      where r.id = p_restaurant_id),
    (select public.plan_features(coalesce(r.plan, 'trial'))
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
security invoker
set search_path = public, pg_temp
as $$
  select p_feature = any (public.restaurant_features(p_restaurant_id));
$$;

create or replace function public.restaurant_access(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_account  uuid;
  v_plan     text;
  v_status   text;
  v_trial    timestamptz;
  v_expires  timestamptz;
  v_can      boolean;
  v_used     integer;
  v_limit    integer;
begin
  select r.account_id into v_account
    from public.restaurants r
   where r.id = p_restaurant_id;

  if not found then
    return null;
  end if;

  select a.plan, a.plan_status,
         public.account_trial_ends_at(a.id), a.plan_expires_at
    into v_plan, v_status, v_trial, v_expires
    from public.accounts a
   where a.id = v_account;

  if not found then
    -- Unlinked restaurant: describe it from its own row so a dashboard never
    -- renders "no plan" for a workspace that is actually running.
    select r.plan, coalesce(r.plan_status, 'trialing'),
           r.trial_started_at + interval '21 days', r.plan_expires_at
      into v_plan, v_status, v_trial, v_expires
      from public.restaurants r
     where r.id = p_restaurant_id;
  end if;

  v_can := public.restaurant_can_write(p_restaurant_id);
  v_used := case when v_account is null then 1 else public.account_outlet_count(v_account) end;
  v_limit := public.account_outlet_limit(v_plan);

  return jsonb_build_object(
    'plan',            v_plan,
    'status',          v_status,
    'account_id',      v_account,
    'trial_ends_at',   v_trial,
    'plan_expires_at', v_expires,
    'days_remaining',
      case
        when v_can and v_plan not in ('starter', 'professional', 'business')
          then greatest(ceil(extract(epoch from (v_trial - now())) / 86400.0), 0)::int
        else 0
      end,
    'can_write',       v_can,
    'read_only',       not v_can,
    'features',        to_jsonb(public.restaurant_features(p_restaurant_id)),
    'outlets', jsonb_build_object(
      'used',      v_used,
      'limit',     v_limit,
      'unlimited', v_limit is null,
      'remaining', case when v_limit is null then null else greatest(v_limit - v_used, 0) end
    )
  );
end;
$$;

-- The plan/trial readers stay staff-only, exactly as 20261110000600 set them.
-- A function is created with EXECUTE granted to PUBLIC, and granting it to
-- authenticated and service_role does not withdraw that: without these revokes
-- a guest can still CALL the function (they learn nothing from accounts, which
-- anon holds no privilege on, but "can call it" is not a boundary). Revoke
-- first, then grant, for the whole family.
revoke all on function public.restaurant_access(uuid) from public, anon;
revoke all on function public.restaurant_trial_ends_at(uuid) from public, anon;
revoke all on function public.restaurant_features(uuid) from public, anon;
revoke all on function public.restaurant_has_feature(uuid, text) from public, anon;
revoke all on function public.account_trial_ends_at(uuid) from public, anon;
revoke all on function public.account_outlet_count(uuid) from public, anon;
-- account_can_write() is SECURITY DEFINER, so it reads the subscription with
-- the definer's rights and answers for ANY account id a caller names: "can
-- this business write right now" is commercial state. No guest path needs it
-- directly -- restaurant_can_write() calls it from inside its own definer
-- body, where the privilege is not re-checked.
revoke all on function public.account_can_write(uuid) from public, anon;
grant execute on function public.restaurant_access(uuid) to authenticated, service_role;
grant execute on function public.restaurant_trial_ends_at(uuid) to authenticated, service_role;
grant execute on function public.restaurant_features(uuid) to authenticated, service_role;
grant execute on function public.restaurant_has_feature(uuid, text) to authenticated, service_role;
grant execute on function public.restaurant_can_write(uuid) to authenticated, service_role;
grant execute on function public.account_can_write(uuid) to authenticated, service_role;
grant execute on function public.account_trial_ends_at(uuid) to authenticated, service_role;
grant execute on function public.account_outlet_count(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Outlet creation: same account, plan limit, nothing deleted.
-- ---------------------------------------------------------------------------
create or replace function public.create_outlet(
  p_name text,
  p_slug text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_name    text := btrim(coalesce(p_name, ''));
  v_slug    text := lower(btrim(coalesce(p_slug, '')));
  v_account uuid;
  v_limit   integer;
  v_used    integer;
  v_id      uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = 'P0001';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'name_invalid' using errcode = 'P0001';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 60 then
    raise exception 'slug_invalid' using errcode = 'P0001';
  end if;

  -- The caller's account: the one that owns an outlet they already own.
  select r.account_id into v_account
    from public.restaurants r
    join public.memberships m on m.restaurant_id = r.id
   where m.user_id = v_user
     and m.role = 'owner'
     and r.account_id is not null
   order by r.created_at, r.id
   limit 1;

  if v_account is null then
    -- First outlet for this user. The account starts its own 21-day trial.
    insert into public.accounts (owner_id, plan, plan_status, trial_ends_at)
    values (v_user, 'trial', 'trialing', now() + interval '21 days')
    returning id into v_account;
  end if;

  -- The plan caps how many outlets may exist. Existing outlets are never
  -- removed for being over a limit: a downgrade stops NEW creation only.
  v_limit := public.account_outlet_limit(
    (select a.plan from public.accounts a where a.id = v_account));
  v_used := public.account_outlet_count(v_account);

  if v_limit is not null and v_used >= v_limit then
    raise exception 'outlet_limit' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.restaurants where slug = v_slug) then
    raise exception 'slug_taken' using errcode = 'P0001';
  end if;

  insert into public.restaurants (slug, name, account_id)
  values (v_slug, v_name, v_account)
  returning id into v_id;

  insert into public.memberships (restaurant_id, user_id, role)
  values (v_id, v_user, 'owner');

  insert into public.menus (restaurant_id, name, is_published)
  values (v_id, 'Main menu', true);

  return v_id;
end;
$$;

revoke all on function public.create_outlet(text, text) from public, anon;
grant execute on function public.create_outlet(text, text) to authenticated, service_role;

-- Signup path: account + first outlet + owner membership + starter menu, in
-- one transaction. The service role is the only caller; a guest must not be
-- able to mint a subscription by calling this.
create or replace function public.create_account_with_restaurant(
  p_name     text,
  p_slug     text,
  p_timezone text default 'Asia/Kolkata',
  p_owner    uuid default auth.uid()
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_slug    text := lower(btrim(coalesce(p_slug, '')));
  v_owner   uuid := p_owner;
  v_account uuid;
  v_id      uuid;
begin
  if v_owner is null then
    raise exception 'unauthenticated' using errcode = 'P0001';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'name_invalid' using errcode = 'P0001';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 60 then
    raise exception 'slug_invalid' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.restaurants where slug = v_slug) then
    raise exception 'slug_taken' using errcode = 'P0001';
  end if;

  insert into public.profiles (id) values (v_owner)
    on conflict (id) do nothing;

  insert into public.accounts (owner_id, plan, plan_status, trial_ends_at)
  values (v_owner, 'trial', 'trialing', now() + interval '21 days')
  returning id into v_account;

  insert into public.restaurants (slug, name, timezone, account_id)
  values (v_slug, v_name, coalesce(nullif(btrim(p_timezone), ''), 'Asia/Kolkata'), v_account)
  returning id into v_id;

  insert into public.menus (restaurant_id, name, is_published)
  values (v_id, 'Main menu', true);

  insert into public.memberships (restaurant_id, user_id, role)
  values (v_id, v_owner, 'owner');

  return v_id;
end;
$$;

revoke all on function public.create_account_with_restaurant(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_account_with_restaurant(text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Manual activation. There is no payment provider in this deployment, and
--    this file does not add one: an operator with the service role records a
--    subscription that was arranged off-line.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_subscription(
  p_restaurant_name text,
  p_plan            text,
  p_days            integer default null,
  p_months          integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account uuid;
  v_found   integer;
  v_now     timestamptz := now();
begin
  if coalesce(btrim(p_plan), '') not in ('trial', 'starter', 'professional', 'business') then
    raise exception 'plan_invalid' using errcode = 'P0001';
  end if;

  -- count/min over uuid is not defined in PostgreSQL, hence the text cast.
  select count(distinct r.account_id), min(r.account_id::text)::uuid
    into v_found, v_account
    from public.restaurants r
   where lower(btrim(r.name)) = lower(btrim(coalesce(p_restaurant_name, '')))
     and r.account_id is not null;

  if v_found = 0 then
    raise exception 'restaurant_not_found' using errcode = 'P0001';
  end if;
  if v_found > 1 then
    raise exception 'restaurant_ambiguous' using errcode = 'P0001';
  end if;

  if p_plan = 'trial' then
    update public.accounts a
       set plan            = 'trial',
           plan_status     = 'trialing',
           trial_started_at = coalesce(a.trial_started_at, v_now),
           trial_ends_at   = v_now + make_interval(days => greatest(coalesce(p_days, 21), 0)),
           plan_started_at = null,
           plan_expires_at = null,
           updated_at      = v_now
     where a.id = v_account;
  else
    update public.accounts a
       set plan            = p_plan,
           plan_status     = 'active',
           plan_started_at = v_now,
           plan_expires_at = v_now + make_interval(months => greatest(coalesce(p_months, 1), 0)),
           updated_at      = v_now
     where a.id = v_account;
  end if;

  return jsonb_build_object(
    'account_id',      v_account,
    'plan',            (select a.plan from public.accounts a where a.id = v_account),
    'plan_status',     (select a.plan_status from public.accounts a where a.id = v_account),
    'trial_ends_at',   (select public.account_trial_ends_at(v_account)),
    'plan_expires_at', (select a.plan_expires_at from public.accounts a where a.id = v_account),
    'outlets',         public.account_outlet_count(v_account)
  );
end;
$$;

revoke all on function public.admin_set_subscription(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_set_subscription(text, text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Nobody edits subscription state by writing the table.
-- ---------------------------------------------------------------------------
create or replace function public.protect_account_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No authenticated actor: the service role and its RPCs, which are the only
  -- supported way to change a subscription.
  if auth.uid() is null then
    return new;
  end if;
  new.owner_id        := old.owner_id;
  new.plan            := old.plan;
  new.plan_status     := old.plan_status;
  new.trial_started_at := old.trial_started_at;
  new.trial_ends_at   := old.trial_ends_at;
  new.plan_started_at := old.plan_started_at;
  new.plan_expires_at := old.plan_expires_at;
  new.updated_at      := old.updated_at;
  return new;
end;
$$;

drop trigger if exists accounts_plan_guard on public.accounts;
create trigger accounts_plan_guard
  before update on public.accounts
  for each row execute function public.protect_account_plan();

-- The legacy per-restaurant columns keep their guard and their values; they
-- are history now, not the gate.
comment on column public.restaurants.plan is
  'Legacy per-outlet plan (pre-Model-C). Kept for history; the authority is public.accounts.plan via restaurants.account_id.';
