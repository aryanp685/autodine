-- ============================================================================
-- Restaurant settings: who is allowed to edit the restaurant row.
--
-- BEFORE THIS
--
-- The only UPDATE policy on public.restaurants was
--
--   for update using (id in (select public.current_restaurant_ids()));
--
-- which every member satisfies. A cashier could rename the restaurant, change
-- the tax rate, or point the public web address at something else. In
-- production the policy was missing entirely, and a missing policy under RLS
-- is a denial, not an error: an UPDATE from the dashboard matched zero rows
-- and returned no error at all. A Settings screen that trusted .update() would
-- have shown "Saved" over a row that never changed.
--
-- AFTER
--
-- Owner and manager only. Enforced on both the existing row (USING) and the
-- new one (WITH CHECK), because a tenant isolation bug that lets an update
-- move a row to another restaurant id has to be refused as well.
--
-- The app applies the same rule (lib/settings-input.ts) so a cashier sees a
-- disabled form and a sentence explaining why, rather than a Postgres error.
--
-- WHY NOT restaurant_can_write()
--
-- That function also refuses every workspace write once the trial has lapsed.
-- An expired workspace must still be able to correct its name, phone number
-- and GSTIN -- those are what an invoice and a payment are addressed to. The
-- gate belongs on the features that consume the workspace, where it already
-- is (menus, items, orders).
--
-- ALSO IN HERE: the default tax rate.
--
-- Migration 0001 shipped default 500 (the SAMPLE 5% used for layout review).
-- Production has 0. Repo and production disagreeing about a money column is
-- the kind of drift that ends with one environment charging a rate the owner
-- never set, so the repo is aligned to 0 here. Settings shows a 0% warning
-- until the owner sets a real rate; inventing one is worse than showing none.
-- Existing rows are untouched.
-- ============================================================================

-- ------------------------------------------------------------------ helpers

-- Does the caller manage this restaurant? SECURITY DEFINER so the membership
-- lookup inside a policy does not recurse through memberships' own RLS.
create or replace function public.can_manage_restaurant(p_restaurant_id uuid)
returns boolean
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
      and m.role in ('owner', 'manager')
  );
$$;

-- ------------------------------------------------------------------- policy

-- Dropped first so this migration can be re-run. The loose policy it replaces
-- is the one described in the header.
drop policy if exists restaurants_update on public.restaurants;

create policy restaurants_update on public.restaurants
  for update
  using (
    id in (select public.current_restaurant_ids())
    and public.can_manage_restaurant(id)
  )
  with check (
    id in (select public.current_restaurant_ids())
    and public.can_manage_restaurant(id)
  );

-- ------------------------------------------------------------------- grants

-- A policy is not a permission. This project grants table privileges per table
-- rather than relying on Supabase's default privileges -- public.restaurants
-- had SELECT for anon/authenticated and nothing else. Without this grant the
-- UPDATE above is refused with "permission denied for table restaurants"
-- (42501) before RLS is ever consulted, which is what a real owner hit while
-- this screen was being built.
--
-- anon deliberately gets nothing new: a guest reads the name and tagline of an
-- active restaurant and can never write to one.
grant update on public.restaurants to authenticated;

-- --------------------------------------------------------------- tax default

alter table public.restaurants
  alter column tax_rate_bps set default 0;
