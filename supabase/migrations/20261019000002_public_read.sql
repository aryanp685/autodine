-- ============================================================================
-- AutoDine — migration 0002: fix anonymous read of published menus
--
-- WHY THIS EXISTS
--
-- Migration 0001 shipped two bugs that the tenant-isolation check in the
-- setup guide caught on its first real run. Both produced the same symptom:
-- an anonymous guest could see no menu at all.
--
-- BUG 1 — policies reached across tables and got filtered by them.
--
--   In Postgres, a subquery written inside an RLS policy is itself subject to
--   the RLS of the tables it reads. 0001 defined:
--
--     create policy items_public on public.items
--       for select using (
--         is_available
--         and exists (select 1 from public.restaurants r
--                     where r.id = items.restaurant_id and r.is_active));
--
--   public.restaurants had NO policy allowing anonymous reads, so for a guest
--   that EXISTS always saw zero rows, so the whole expression was always
--   false, so every item was invisible. Same for menus_public and its
--   dependency chain into categories_public and variants_public.
--
--   The failure is silent and looks like "no data": no error, no permission
--   denial, just an empty result.
--
-- BUG 2 — restaurants had no public read policy at all.
--
--   A guest sitting in a restaurant must see its name on the menu page. There
--   was no policy granting that, so public.restaurants was invisible to
--   anonymous readers even for active restaurants.
--
-- THE FIX
--
--   * restaurant_is_active() is SECURITY DEFINER, so it reads restaurants
--     with the function owner's rights and bypasses that table's RLS. Menu
--     and item visibility now no longer depend on the restaurants policy
--     staying permissive -- the dependency is explicit rather than implicit.
--
--   * restaurants_public lets anonymous readers see active restaurants,
--     which is what the guest menu page needs to show the name.
--
--   WHAT THIS EXPOSES, stated plainly: an anonymous visitor can read the
--   name, tagline, address, phone, gstin, timezone and tax_rate_bps of every
--   ACTIVE restaurant. Those are business details of a place the guest is
--   physically sitting in -- the kind printed on the bill they are about to
--   receive -- not customer data. It is still more than the menu strictly
--   needs. If that stops being acceptable, replace this policy with a
--   SECURITY DEFINER function returning only the display columns. No customer
--   or payment data is reachable either way.
-- ============================================================================

-- Restaurant active check that is NOT filtered by restaurants' own RLS.
create or replace function public.restaurant_is_active(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.restaurants r
    where r.id = p_restaurant_id
      and r.is_active
  );
$$;

-- Anonymous readers run this inside RLS policies, so they need EXECUTE.
-- (Postgres grants EXECUTE to PUBLIC by default, but be explicit: if that
-- default is ever revoked, the symptom would be an empty menu again.)
grant execute on function public.restaurant_is_active(uuid)
  to anon, authenticated, service_role;

-- Guests need the restaurant's name on the menu page. Active restaurants only.
drop policy if exists restaurants_public on public.restaurants;
create policy restaurants_public on public.restaurants
  for select using (is_active);

-- Re-create the two public read policies so they depend on the SECURITY
-- DEFINER helper instead of on restaurants' own RLS.
drop policy if exists menus_public on public.menus;
create policy menus_public on public.menus
  for select using (
    is_published
    and public.restaurant_is_active(menus.restaurant_id)
  );

drop policy if exists items_public on public.items;
create policy items_public on public.items
  for select using (
    is_available
    and public.restaurant_is_active(items.restaurant_id)
  );

-- categories_public and variants_public reach menus and items rather than
-- restaurants. Those tables now have working public policies, so they resolve
-- correctly without change. Left alone deliberately.
