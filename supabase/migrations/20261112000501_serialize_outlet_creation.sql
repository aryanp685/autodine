-- 20261112000500 — Serialize outlet creation per account.
--
-- create_outlet() read the plan-limit count and inserted the new outlet in a
-- later statement, with nothing holding the account steady in between. Two
-- concurrent calls for the same account could both read a count below the
-- limit and both insert, leaving the account with more outlets than its plan
-- allows (Starter: 1, Professional: 5). The same window let two concurrent
-- first-outlet calls for one user (or a signup overlapping an outlet
-- creation) both observe "no account yet" and each insert their own account.
--
-- This migration keeps every signature, the SECURITY DEFINER mode, the fixed
-- search_path and the existing EXECUTE grants. It changes only the locking:
--
--   1. A per-user, transaction-scoped advisory lock serialises the
--      first-outlet bootstrap (new account row and the one-time trial
--      claim) for the same caller, across both creation entry points.
--   2. After the account is resolved (existing or just created), its row is
--      locked FOR UPDATE before the plan limit is read, so a concurrent call
--      for the same account waits, then re-reads the count including any
--      outlet the first call inserted.
--
-- Existing outlets are never deleted; a downgrade still only stops NEW
-- creation. The trial rules, the slug rule and the immutable history are all
-- unchanged.

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

  -- Serialize the account bootstrap for this caller. Held to the end of the
  -- transaction, so two concurrent first-outlet calls cannot both create an
  -- account for the same user.
  perform pg_advisory_xact_lock(hashtext('autodine:account_bootstrap:' || v_user::text));

  select r.account_id into v_account
    from public.restaurants r
    join public.memberships m on m.restaurant_id = r.id
   where m.user_id = v_user
     and m.role = 'owner'
     and r.account_id is not null
   order by r.created_at, r.id
   limit 1;

  if v_account is null then
    -- First outlet for this user: the account starts here, with one trial if
    -- the owner has not already had one.
    insert into public.accounts (owner_id, plan, plan_status, trial_started_at, trial_ends_at)
    values (v_user, 'trial', 'trialing', now(), now() + interval '21 days')
    returning id into v_account;

    if not public.claim_account_trial(v_account) then
      update public.accounts a
         set plan_status   = 'expired',
             trial_ends_at = now(),
             updated_at    = now()
       where a.id = v_account;

      insert into public.subscription_events (account_id, kind, actor, note)
      values (v_account, 'trial_denied', 'system',
              'A trial has already been used by this account holder. Every outlet is preserved; choose a plan to start writing.');
    else
      insert into public.subscription_events (account_id, kind, to_plan, actor, note)
      values (v_account, 'trial_granted', 'trial', 'system',
              'Trial started: 21 days from activation, with every feature switched on.');
    end if;
  else
    -- The caller may not be the only owner linked to this account. Lock the
    -- account row so the plan limit is read against a count that cannot
    -- change while it is being read. A concurrent outlet creation for the
    -- same account waits here, then sees the first call's outlet.
    perform 1 from public.accounts a where a.id = v_account for update;
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

-- The signup entry point takes the same bootstrap lock, so a signup and an
-- outlet creation racing for the same user still produce one account. The
-- slug check and the trial claim are unchanged.
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
  v_trial   boolean;
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

  -- Same per-user bootstrap serialization as create_outlet().
  perform pg_advisory_xact_lock(hashtext('autodine:account_bootstrap:' || v_owner::text));

  insert into public.profiles (id) values (v_owner)
    on conflict (id) do nothing;

  insert into public.accounts (owner_id, plan, plan_status, trial_started_at, trial_ends_at)
  values (v_owner, 'trial', 'trialing', now(), now() + interval '21 days')
  returning id into v_account;

  -- The trial is claimed here, once per person. A second account for the same
  -- owner gets no trial: read-only until a plan is chosen.
  v_trial := public.claim_account_trial(v_account);

  if not v_trial then
    update public.accounts a
       set plan_status   = 'expired',
           trial_ends_at = now(),
           updated_at    = now()
     where a.id = v_account;

    insert into public.subscription_events (account_id, kind, actor, note)
    values (v_account, 'trial_denied', 'system',
            'A trial has already been used by this account holder. Every outlet is preserved; choose a plan to start writing.');
  else
    insert into public.subscription_events (account_id, kind, to_plan, actor, note)
    values (v_account, 'trial_granted', 'trial', 'system',
            'Trial started: 21 days from activation, with every feature switched on.');
  end if;

  insert into public.restaurants (slug, name, timezone, account_id, trial_started_at)
  values (v_slug, v_name, coalesce(nullif(btrim(p_timezone), ''), 'Asia/Kolkata'), v_account, now())
  returning id into v_id;

  insert into public.menus (restaurant_id, name, is_published)
  values (v_id, 'Main menu', true);

  insert into public.memberships (restaurant_id, user_id, role)
  values (v_id, v_owner, 'owner');

  return v_id;
end;
$$;

-- CREATE OR REPLACE preserves the existing ACL; these statements restate it so
-- the boundary is visible in one place: the service role alone may call the
-- signup path.
revoke all on function public.create_account_with_restaurant(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_account_with_restaurant(text, text, text, uuid) to service_role;
