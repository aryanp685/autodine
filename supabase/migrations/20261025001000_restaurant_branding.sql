-- ============================================================================
-- Branding, and the first Storage bucket this project has ever had.
--
-- WHY
--
-- The guest menu could show a restaurant's name, tagline, address and dishes,
-- and nothing else. There was no column for a logo, a banner or an accent
-- colour anywhere in the schema, and `grep storage supabase/migrations` found
-- one hit -- the word "storage" in a comment about timezones. So "each
-- restaurant has its own branding" was not a UI problem, it was a schema and
-- infrastructure problem, and this migration is both.
--
-- WHAT IS ADDED
--
--   restaurants.logo_path    {restaurant_id}/logo.<ext>
--   restaurants.banner_path  {restaurant_id}/banner.<ext>
--   restaurants.accent       one of a curated set, see lib/branding/palette.ts
--   restaurants.updated_at   when branding last changed
--   items.image_url          ALREADY EXISTED and was already read by three
--                            screens, but no UI ever wrote it. No change here;
--                            its storage policy is created below so the dish
--                            photo field can finally use it.
--
-- PATHS ARE RELATIVE, NOT URLS
--
-- The columns store the object PATH, not a signed or public URL. A URL is a
-- deployment artefact: it embeds the project ref, it expires when signed, and
-- it would have to be rewritten the day a project is migrated. A path is the
-- durable fact. `lib/storage/public-url.ts` turns it into a URL at render time.
--
-- THE BUCKET IS PUBLIC-READ, PRIVATE-WRITE
--
-- Read has to be public: a diner's phone has no session, and a signed URL per
-- dish would be an extra round trip on every menu load. Write is restricted to
-- the restaurant's own owners and managers by policy, and by the path prefix --
-- see the comment above the policies for why BOTH checks are required.
-- ============================================================================

-- ---------------------------------------------------------------- columns

alter table public.restaurants
  add column if not exists logo_path   text,
  add column if not exists banner_path text,
  add column if not exists accent      text not null default 'forest',
  add column if not exists updated_at  timestamptz not null default now();

comment on column public.restaurants.logo_path is
  'Storage object path, e.g. "<restaurant_id>/logo.png". Null means no logo, and the guest menu draws an initials tile instead.';
comment on column public.restaurants.banner_path is
  'Storage object path for the optional menu banner. Null is the normal case and is a designed state, not missing data.';
comment on column public.restaurants.accent is
  'Key into the curated palette in lib/branding/palette.ts. Not a hex value: an owner cannot pick a colour that fails contrast because there is nothing to type.';

-- The CHECK is written as a constraint so a bad key cannot get in by any path,
-- including a future SQL import. It must match ACCENT_KEYS in
-- lib/branding/palette.ts; lib/branding/palette.test.ts asserts that the two
-- lists are identical, because a mismatch would mean an owner saving a colour
-- the database silently refuses.
alter table public.restaurants
  drop constraint if exists restaurants_accent_check;

alter table public.restaurants
  add constraint restaurants_accent_check
  check (accent in ('forest', 'terracotta', 'maroon', 'indigo', 'ochre', 'slate'));

-- A path always starts with the restaurant's own id. Enforced here as well as
-- in Storage so a row can never point at another tenant's folder, even if it
-- was written by a service-role script that bypasses RLS.
alter table public.restaurants
  drop constraint if exists restaurants_branding_path_check;

alter table public.restaurants
  add constraint restaurants_branding_path_check
  check (
    (logo_path is null or logo_path like id::text || '/%')
    and (banner_path is null or banner_path like id::text || '/%')
  );

create index if not exists restaurants_updated_at_idx
  on public.restaurants (updated_at desc);

-- ---------------------------------------------------------------- the bucket

-- `public = true` is the read half. It does NOT mean anyone can write: object
-- writes are governed by the policies below, and a public bucket with no
-- policy is read-only to every client key, including the publishable one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-assets',
  'restaurant-assets',
  true,
  -- 4 MB. The largest thing we accept is a dish photo; menu-card photographs
  -- for AI extraction never land in this bucket (they are processed and
  -- discarded), so this ceiling is about logos, banners and dishes only.
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------- policies
--
-- Both halves of every write policy matter, and this is the part worth reading
-- twice:
--
--   1. `bucket_id = 'restaurant-assets'` -- without it the policy would apply
--      to every bucket in the project, including any added later.
--   2. `can_manage_restaurant(<first path segment>)` -- without it ANY signed
--      in user could write to ANY path in the bucket. Storage does not consult
--      the row a path belongs to; the path IS the only tenant signal there is.
--
-- (storage.foldername(name))[1] is the first directory of the object name.
-- Cast to uuid inside a case guard so a malformed path returns false instead
-- of raising 22P02 and turning a refusal into a 500.
--
-- `can_manage_restaurant` (owner|manager, independent of billing state) is used
-- rather than `restaurant_can_write` (which also refuses once a trial lapses):
-- a workspace whose trial has expired must still be able to fix its own logo
-- and dish photos, exactly as migration 000500 argues for the restaurant row.

drop policy if exists "restaurant assets are publicly readable" on storage.objects;
create policy "restaurant assets are publicly readable"
  on storage.objects
  for select
  using (bucket_id = 'restaurant-assets');

drop policy if exists "managers upload their own restaurant assets" on storage.objects;
create policy "managers upload their own restaurant assets"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'restaurant-assets'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "managers replace their own restaurant assets" on storage.objects;
create policy "managers replace their own restaurant assets"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'restaurant-assets'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  )
  with check (
    bucket_id = 'restaurant-assets'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "managers delete their own restaurant assets" on storage.objects;
create policy "managers delete their own restaurant assets"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'restaurant-assets'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

-- ------------------------------------------------------------------- note
--
-- This migration is UNVERIFIED against a real database. The sandbox has no
-- Postgres, and scripts/check-sql.mjs cannot parse CREATE POLICY, so
-- `npm run sql:check` proves only that the ALTER TABLE statements parse.
--
-- Before this touches a shared project, run it once against a throwaway
-- Supabase project and confirm, as an owner of tenant A:
--   * upload to  A/logo.png     -> allowed
--   * upload to  B/logo.png     -> refused (42501 / RLS)
--   * delete     B/logo.png     -> refused
--   * upload to  ../escape.png  -> refused (no uuid in the first segment)
--   * anon GET   A/logo.png     -> 200, because the bucket is public-read
