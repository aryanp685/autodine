-- Google review invitation (guest order screen, after payment).
--
-- The guest order screen asks a paid guest to review the restaurant on
-- Google. To open the RIGHT page -- this restaurant's review form, not a
-- search the guest must complete themselves -- the restaurant row carries one
-- destination, and the storefront projection exposes it to guests.
--
-- One column, two things an owner can paste:
--   a Google review URL (what "Rate us on Google" emails contain), or
--   a bare Google Place ID, which the app expands to
--   https://search.google.com/local/writereview?placeid=<id>.
-- Normalisation happens in lib/settings-input.ts; the column stores the final
-- https URL only, so every reader (guest screens, bills, future QR stands)
-- has exactly one shape to open.
--
-- Fairness rule the product commits to (Google Business Profile guidance):
-- every guest who paid sees the SAME invitation and the same destination.
-- Nothing here, now or later, may branch on sentiment. The column is a
-- destination, not a score.

alter table public.restaurants
  add column if not exists google_review_url text;

-- Adding a CHECK constraint without NOT VALID already validates every
-- existing row on commit; the new column is all NULL here, so the check holds
-- trivially (the 20261122190000 lesson: never assume the pre-existing table
-- matches the migration's shape).
alter table public.restaurants
  add constraint restaurants_google_review_url_len
  check (char_length(google_review_url) <= 500);

-- Rebuild the storefront projection with the destination included. It is the
-- only guest read of the restaurant (lib/db/public-restaurant.ts), and the
-- guest order screen may only open what this function chose to return.
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
  brand_profile_id uuid,
  google_review_url text
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
         r.brand_profile_id,
         r.google_review_url::text
    from public.restaurants r
   where r.slug = nullif(btrim(p_slug), '')
   limit 1;
$$;

comment on function public.public_restaurant_profile(text) is
  'Guest storefront read: one restaurant by exact slug, storefront columns only. Never plan, trial, UPI or timestamps. Not enumerable.';

revoke all on function public.public_restaurant_profile(text) from public, anon, authenticated;
grant execute on function public.public_restaurant_profile(text) to anon, authenticated, service_role;

comment on column public.restaurants.google_review_url is
  'Where the paid-guest review invitation opens: a https Google review URL, or the writereview URL built from the owner''s Place ID. Blank = feature off for this restaurant.';
