-- ============================================================================
-- A second outlet on the same account
--
-- WHAT WAS MISSING
--
-- `memberships` has always been a join table, so one account belonging to
-- several restaurants was never a schema problem. The application was the
-- problem: every staff screen resolved "my restaurant" with `.limit(1)`, so
-- the second outlet could not be reached at all. The switcher (lib/outlets.ts,
-- lib/db/staff.ts) fixes the reading half.
--
-- Creating an outlet is the other half, and it cannot be an INSERT from the
-- dashboard: there is deliberately no INSERT policy on public.restaurants, so
-- an authenticated user cannot spin up workspaces in a loop. This function is
-- the single controlled path. SECURITY DEFINER, so it can write the three rows
-- that make a usable outlet -- restaurant, owner membership, starter menu --
-- in one transaction, and no half-created outlet is left behind if any of
-- them fails.
--
-- WHAT IT REFUSES
--
--   name_invalid    shorter than 2 or longer than 80 characters after trim
--   slug_invalid    not lowercase-hyphenated, or longer than 60
--   slug_taken      the address is already somebody's
--   outlet_limit    the caller already owns five restaurants
--   unauthenticated no session
--
-- The limit is here, not in the server action, because the action is not the
-- only way to call a function. Five is not a licensing rule: creating a
-- restaurant starts a fresh ten-day trial, so an uncapped "add outlet" button
-- is an uncapped free trial.
--
-- The new outlet starts at a 0% tax rate rather than inheriting the current
-- one. GST follows the state the outlet is in, and copying a rate across a
-- state line is a wrong bill, not a convenience.
-- ============================================================================

create or replace function public.create_outlet(
  p_name text,
  p_slug text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user  uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_slug  text := lower(btrim(coalesce(p_slug, '')));
  v_owned integer;
  v_id    uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;

  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'name_invalid';
  end if;

  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 60 then
    raise exception 'slug_invalid';
  end if;

  select count(*) into v_owned
  from public.memberships
  where user_id = v_user
    and role = 'owner';

  if v_owned >= 5 then
    raise exception 'outlet_limit';
  end if;

  if exists (select 1 from public.restaurants where slug = v_slug) then
    raise exception 'slug_taken';
  end if;

  insert into public.restaurants (slug, name)
  values (v_slug, v_name)
  returning id into v_id;

  insert into public.memberships (restaurant_id, user_id, role)
  values (v_id, v_user, 'owner');

  -- A published empty menu, because the menu editor and the guest page both
  -- need one to exist before the owner can add a category to it.
  insert into public.menus (restaurant_id, name, is_published)
  values (v_id, 'Main menu', true);

  return v_id;
end;
$$;

-- A policy is not a permission: the table grant is separate from the function
-- grant, and this project has been bitten by that before (see 00500).
revoke all on function public.create_outlet(text, text) from public;
revoke all on function public.create_outlet(text, text) from anon;
revoke all on function public.create_outlet(text, text) from authenticated;
grant execute on function public.create_outlet(text, text) to authenticated;
