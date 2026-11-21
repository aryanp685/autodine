-- Public storefront projection (EXPAND step).
--
-- Why: `restaurants_public` (20261019000002) is `for select using (is_active)`
-- with no role or column restriction. Anyone holding the publishable key --
-- which is in every browser bundle -- can list EVERY active restaurant with
-- EVERY column: plan and trial state, UPI payee details, the whole tenant list.
--
-- Guests need one storefront, addressed by the slug printed in their QR link.
-- This function is that read: one row, by exact slug, storefront columns only.
-- It cannot enumerate tenants and it never returns commercial or payee data.
--
-- PUBLIC SET: the name, the customer-facing phone and the customer-facing
-- address, plus what the storefront has to draw. `gstin` is deliberately not
-- in it: a GSTIN is a tax registration number and reaches a guest only on a
-- billing document the business issues (lib/db/bill.ts is staff-authenticated),
-- never on an anonymous menu page anyone with the link can read.
--

-- Additive on purpose. It is safe to apply while an older application version
-- is still serving: nothing is removed here. The base-table policy is dropped
-- separately in 20261110000700 once the application reads through this
-- function.
--
-- `is_active` is returned rather than filtered so the guest "storefront is
-- closed" screen and the status page of an already-placed order can answer for
-- a closed restaurant, as lib/db/storefront-status.ts and
-- lib/db/order-screen.ts were written to do. Menus, sessions and ordering stay
-- gated by restaurant_is_active() and the order RPC.

create or replace function public.public_restaurant_profile(p_slug text)
returns table (
  id uuid,
  slug text,
  name text,
  tagline text,
  address text,
  phone text,
  timezone text,
  tax_rate_bps integer,
  is_active boolean,
  announcement_text text,
  announcement_on boolean,
  logo_path text,
  banner_path text,
  accent text,
  brand_theme_enabled boolean,
  brand_theme jsonb,
  brand_profile_id uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
rows 1
as $$
  select r.id,
         r.slug::text,
         r.name::text,
         r.tagline::text,
         r.address::text,
         r.phone::text,
         r.timezone::text,
         r.tax_rate_bps::integer,
         r.is_active,
         r.announcement_text::text,
         r.announcement_on,
         r.logo_path::text,
         r.banner_path::text,
         r.accent::text,
         r.brand_theme_enabled,
         r.brand_theme::jsonb,
         r.brand_profile_id
    from public.restaurants r
   where r.slug = nullif(btrim(p_slug), '')
   limit 1;
$$;

comment on function public.public_restaurant_profile(text) is
  'Guest storefront read: one restaurant by exact slug, storefront columns only. Never plan, trial, UPI or timestamps. Not enumerable.';

revoke all on function public.public_restaurant_profile(text) from public, anon, authenticated;
grant execute on function public.public_restaurant_profile(text) to anon, authenticated, service_role;
