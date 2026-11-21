-- ============================================================================
-- Brand Studio: brand assets, brand profiles (drafts + versions), publish
-- history, and the atomic menu+brand publish/rollback pair.
--
-- WHY THIS SHAPE
--
-- The approved, guest-visible brand already lives on `restaurants`
-- (logo_path, banner_path, accent — migration 20261025001000). This migration
-- does NOT replace that. It adds the reviewable layer around it:
--
--   restaurant_brand_assets    every uploaded or extracted image, with the
--                              metadata an audit needs (mime, size, pixels,
--                              checksum) and a tenant-matchable id.
--   restaurant_brand_profiles  the DRAFT the owner reviews and the PUBLISHED
--                              versions behind it. status: draft → published
--                              → archived. One draft per (restaurant, import).
--   restaurant_publish_history what went live when, and the snapshot needed to
--                              put the previous pair back.
--
-- Publishing copies the profile onto the restaurants row INSIDE one function
-- (`publish_menu_brand_pair`), together with the menu's is_published flip, so
-- a half-published version is not representable: either the transaction
-- commits or the previous live state stands untouched.
--
-- OPT-IN, ALWAYS
--
-- `restaurants.brand_theme_enabled` starts false for every existing and new
-- row. Nothing in this migration changes what a single guest sees today.
--
-- TENANT ISOLATION IS ENFORCED TWICE
--
-- 1. Path CHECKs (path like restaurant_id || '/%') so a row can never point at
--    another tenant's folder, even written by a service-role script.
-- 2. Composite foreign keys (asset_id, restaurant_id) so a profile can never
--    reference ANOTHER restaurant's asset — the database refuses it, not just
--    the application.
--
-- MIRRORING
--
-- Policy spellings mirror 20261029000100 (member_read / manage). Functions
-- mirror create_outlet (20261022000700): security definer, explicit auth.uid()
-- checks, fixed search_path, revoke-from-public then grant to authenticated.
-- ============================================================================

-- ---------------------------------------------------------------- the
-- private source bucket
--
-- The public bucket above is for things a GUEST renders (logo, banner, dish,
-- approved crop). The owner's working material — menu-card originals,
-- reference images — is different: no diner should be able to read it. It
-- goes in a PRIVATE bucket and is served only through short-lived signed
-- URLs to the owner's own session. Same path rules, same role rules.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-brand-source',
  'restaurant-brand-source',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "managers read their own brand sources" on storage.objects;
create policy "managers read their own brand sources"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'restaurant-brand-source'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "managers upload their own brand sources" on storage.objects;
create policy "managers upload their own brand sources"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'restaurant-brand-source'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "managers replace their own brand sources" on storage.objects;
create policy "managers replace their own brand sources"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'restaurant-brand-source'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  )
  with check (
    bucket_id = 'restaurant-brand-source'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "managers delete their own brand sources" on storage.objects;
create policy "managers delete their own brand sources"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'restaurant-brand-source'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

-- ---------------------------------------------------------------- columns

alter table public.restaurants
  add column if not exists brand_theme_enabled boolean not null default false,
  add column if not exists brand_theme jsonb,
  add column if not exists brand_profile_id uuid;

comment on column public.restaurants.brand_theme_enabled is
  'Opt-in flag for per-restaurant guest theming. False for every restaurant until the owner publishes a brand profile. Existing appearance is the default, not a fallback.';
comment on column public.restaurants.brand_theme is
  'The published theme as validated JSON (lib/branding/theme.ts is the only writer through publish_menu_brand_pair). Never model output verbatim.';
comment on column public.restaurants.brand_profile_id is
  'The currently approved brand profile. Null means the restaurant has never opted in.';

-- A menu remembers which import created it, so the pair (menu, brand draft)
-- can be found again and duplicate Creates are refused rather than doubled.
alter table public.menus
  add column if not exists import_id uuid;

comment on column public.menus.import_id is
  'Stable import identifier linking this menu draft to its brand draft. Null for menus created by hand.';

-- ---------------------------------------------------------------- assets

create table if not exists public.restaurant_brand_assets (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  kind          text not null check (kind in ('logo', 'banner', 'reference', 'menu-photo', 'crop')),
  bucket        text not null check (bucket in ('restaurant-assets', 'restaurant-brand-source')),
  path          text not null,
  mime_type     text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size     integer not null check (byte_size > 0 and byte_size <= 8388608),
  width         integer check (width is null or (width > 0 and width <= 20000)),
  height        integer check (height is null or (height > 0 and height <= 20000)),
  checksum      text not null check (checksum ~ '^[0-9a-f]{64}$'),
  source        text not null default 'upload' check (source in ('upload', 'extract')),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),

  unique (bucket, path),
  -- The cross-reference pair used by the composite FKs below.
  unique (id, restaurant_id),
  -- A path always starts with its own restaurant id (same fence as
  -- restaurants_branding_path_check in 20261025001000).
  constraint restaurant_brand_assets_path_check
    check (path like restaurant_id::text || '/%')
);

comment on table public.restaurant_brand_assets is
  'Metadata for every brand Studio asset: originals, references and approved crops. The bytes live in Storage; this row is the ownership record.';
comment on column public.restaurant_brand_assets.bucket is
  'restaurant-assets = public-read (guest-rendered). restaurant-brand-source = private (owner working material, signed URLs only).';

create index if not exists restaurant_brand_assets_restaurant_idx
  on public.restaurant_brand_assets (restaurant_id, created_at desc);

alter table public.restaurant_brand_assets enable row level security;

drop policy if exists brand_assets_member_read on public.restaurant_brand_assets;
create policy brand_assets_member_read on public.restaurant_brand_assets
  for select using (restaurant_id in (select public.current_restaurant_ids()));

-- can_manage_restaurant (owner|manager, independent of billing state) rather
-- than restaurant_can_write: a workspace whose trial expired must still be
-- able to fix its own logo and brand, exactly as 20261025001000 argues.
drop policy if exists brand_assets_manage on public.restaurant_brand_assets;
create policy brand_assets_manage on public.restaurant_brand_assets
  for all
  using (public.can_manage_restaurant(restaurant_id))
  with check (public.can_manage_restaurant(restaurant_id));

-- ---------------------------------------------------------------- profiles

create table if not exists public.restaurant_brand_profiles (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  -- The stable import identifier. One DRAFT per import; repeats of Create with
  -- the same import_id hit the partial unique index below and are refused.
  import_id     uuid not null,
  status        text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version       integer not null default 1,
  -- The owner-confirmed restaurant name. Null = do not touch restaurants.name.
  name          text check (name is null or (length(btrim(name)) between 1 and 80)),
  logo_asset_id   uuid,
  banner_asset_id uuid,
  theme         jsonb not null default '{}'::jsonb,
  -- Provenance per decision (owner-upload / existing / printed-menu / ai) and
  -- the conflict list shown to the owner. Never trusted back without
  -- sanitising (lib/branding/draft.ts).
  source        jsonb not null default '{}'::jsonb,
  menu_id       uuid references public.menus(id) on delete set null,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz,
  published_by  uuid,

  -- Tenant-match enforced by the database: these composite FKs cannot point
  -- at another restaurant's asset even if application code is wrong.
  constraint brand_profile_logo_fk
    foreign key (logo_asset_id, restaurant_id)
    references public.restaurant_brand_assets (id, restaurant_id),
  constraint brand_profile_banner_fk
    foreign key (banner_asset_id, restaurant_id)
    references public.restaurant_brand_assets (id, restaurant_id)
);

comment on table public.restaurant_brand_profiles is
  'Brand drafts and published versions. Guests never read this table: publish_menu_brand_pair copies the approved values onto restaurants.';

create unique index if not exists restaurant_brand_profiles_draft_import
  on public.restaurant_brand_profiles (restaurant_id, import_id)
  where status = 'draft';

create index if not exists restaurant_brand_profiles_status_idx
  on public.restaurant_brand_profiles (restaurant_id, status, version desc);

alter table public.restaurant_brand_profiles enable row level security;

drop policy if exists brand_profiles_member_read on public.restaurant_brand_profiles;
create policy brand_profiles_member_read on public.restaurant_brand_profiles
  for select using (restaurant_id in (select public.current_restaurant_ids()));

drop policy if exists brand_profiles_manage on public.restaurant_brand_profiles;
create policy brand_profiles_manage on public.restaurant_brand_profiles
  for all
  using (public.can_manage_restaurant(restaurant_id))
  with check (public.can_manage_restaurant(restaurant_id));

-- Published and archived profiles are version history: only drafts may be
-- deleted. (Delete of a draft = "discard this import's brand half".)
drop policy if exists brand_profiles_delete_draft on public.restaurant_brand_profiles;
create policy brand_profiles_delete_draft on public.restaurant_brand_profiles
  for delete using (status = 'draft' and public.can_manage_restaurant(restaurant_id));

-- ---------------------------------------------------------------- history

create table if not exists public.restaurant_publish_history (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  action        text not null check (action in ('publish', 'rollback')),
  menu_id       uuid references public.menus(id) on delete set null,
  brand_profile_id uuid references public.restaurant_brand_profiles(id) on delete set null,
  -- The live state BEFORE this action: name, logo_path, banner_path,
  -- brand_theme, brand_theme_enabled, brand_profile_id, menu_is_published.
  snapshot      jsonb not null,
  actor         uuid default auth.uid(),
  created_at    timestamptz not null default now()
);

comment on table public.restaurant_publish_history is
  'One row per publish or rollback, with the prior live state needed to restore the previous menu+brand pair.';

create index if not exists restaurant_publish_history_idx
  on public.restaurant_publish_history (restaurant_id, created_at desc);

alter table public.restaurant_publish_history enable row level security;

drop policy if exists publish_history_member_read on public.restaurant_publish_history;
create policy publish_history_member_read on public.restaurant_publish_history
  for select using (restaurant_id in (select public.current_restaurant_ids()));

-- Rows are written by the functions below; the policy exists so a direct
-- insert by a manager is possible but updates and deletes are not: history is
-- append-only.
drop policy if exists publish_history_append on public.restaurant_publish_history;
create policy publish_history_append on public.restaurant_publish_history
  for insert with check (public.can_manage_restaurant(restaurant_id));

-- ------------------------------------------------------ publish (atomic)

create or replace function public.publish_menu_brand_pair(
  p_menu_id uuid,
  p_brand_profile_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user      uuid := auth.uid();
  v_restaurant uuid;
  v_profile   public.restaurant_brand_profiles%rowtype;
  v_menu      public.menus%rowtype;
  v_prev_profile uuid;
  v_snapshot  jsonb;
  v_name      text;
  v_logo      text;
  v_banner    text;
  v_theme     jsonb;
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;

  select * into v_profile
  from public.restaurant_brand_profiles
  where id = p_brand_profile_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'That brand draft does not exist.');
  end if;

  v_restaurant := v_profile.restaurant_id;

  if not public.has_restaurant_role(v_restaurant, array['owner', 'manager']) then
    return jsonb_build_object('ok', false, 'reason', 'Only an owner or manager can publish.');
  end if;

  -- The menu half is a write to public.menus, and every menus write is
  -- trial-gated by RLS (menus_manage = role AND restaurant_can_write,
  -- migration 20261029000100). This function runs as SECURITY DEFINER and
  -- would otherwise bypass that gate, so the same condition is enforced
  -- here. The pair is atomic: if the menu half cannot be written, neither
  -- half goes live.
  if not public.restaurant_can_write(v_restaurant) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'Only an owner or manager can change the menu, and the trial must still be running. Nothing was published.'
    );
  end if;

  -- The pair must belong to the same restaurant, and the menu must exist.
  select * into v_menu from public.menus where id = p_menu_id;
  if not found or v_menu.restaurant_id <> v_restaurant then
    return jsonb_build_object('ok', false, 'reason', 'That menu is not on your account.');
  end if;

  -- Idempotent: publishing an already-published pair changes nothing and
  -- writes no second history row.
  if v_profile.status = 'published' and v_menu.is_published then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_profile.status = 'archived' then
    return jsonb_build_object('ok', false, 'reason', 'That brand draft is no longer current. Create a new draft.');
  end if;

  select id into v_prev_profile
  from public.restaurant_brand_profiles
  where restaurant_id = v_restaurant and status = 'published'
    and id <> v_profile.id
  limit 1;

  select name, logo_path, banner_path, brand_theme into v_name, v_logo, v_banner, v_theme
  from public.restaurants where id = v_restaurant;

  v_snapshot := jsonb_build_object(
    'name', v_name,
    'logo_path', v_logo,
    'banner_path', v_banner,
    'brand_theme', v_theme,
    'brand_theme_enabled', (select brand_theme_enabled from public.restaurants where id = v_restaurant),
    'brand_profile_id', v_prev_profile,
    'menu_is_published', v_menu.is_published
  );

  -- Resolve the asset paths the profile points at (same tenant, enforced by
  -- the composite FKs; the join is belt and braces).
  select a.path into v_logo
  from public.restaurant_brand_assets a
  where a.id = v_profile.logo_asset_id and a.restaurant_id = v_restaurant;
  select a.path into v_banner
  from public.restaurant_brand_assets a
  where a.id = v_profile.banner_asset_id and a.restaurant_id = v_restaurant;

  v_name  := case when v_profile.name is not null then btrim(v_profile.name) else v_name end;
  v_theme := v_profile.theme;

  -- One statement for the live brand. Either everything below commits or
  -- nothing does — this function is a single transaction.
  update public.restaurants
  set name = v_name,
      logo_path = v_logo,
      banner_path = v_banner,
      brand_theme = v_theme,
      brand_theme_enabled = true,
      brand_profile_id = v_profile.id,
      updated_at = now()
  where id = v_restaurant;

  update public.menus
  set is_published = true
  where id = p_menu_id;

  -- Version bookkeeping: the outgoing profile keeps its row as history.
  update public.restaurant_brand_profiles
  set status = 'archived', updated_at = now()
  where restaurant_id = v_restaurant and status = 'published' and id <> v_profile.id;

  update public.restaurant_brand_profiles
  set status = 'published',
      menu_id = p_menu_id,
      published_at = now(),
      published_by = v_user,
      updated_at = now()
  where id = v_profile.id;

  insert into public.restaurant_publish_history
    (restaurant_id, action, menu_id, brand_profile_id, snapshot, actor)
  values
    (v_restaurant, 'publish', p_menu_id, v_profile.id, v_snapshot, v_user);

  return jsonb_build_object('ok', true, 'already', false);
end;
$$;

revoke all on function public.publish_menu_brand_pair(uuid, uuid) from public;
revoke all on function public.publish_menu_brand_pair(uuid, uuid) from anon;
revoke all on function public.publish_menu_brand_pair(uuid, uuid) from authenticated;
grant execute on function public.publish_menu_brand_pair(uuid, uuid) to authenticated;

-- ------------------------------------------------------------- rollback

create or replace function public.rollback_last_publish(
  p_restaurant_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user   uuid := auth.uid();
  v_last   public.restaurant_publish_history%rowtype;
  v_snap   jsonb;
  v_menu_id uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;

  if not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    return jsonb_build_object('ok', false, 'reason', 'Only an owner or manager can roll back.');
  end if;

  -- Rollback also writes menus.is_published, so it carries the same trial
  -- gate as publish (see the note there): SECURITY DEFINER must not become a
  -- way around menus_manage.
  if not public.restaurant_can_write(p_restaurant_id) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'Only an owner or manager can change the menu, and the trial must still be running. Nothing was rolled back.'
    );
  end if;

  select * into v_last
  from public.restaurant_publish_history
  where restaurant_id = p_restaurant_id
  order by created_at desc, id desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'There is nothing to roll back.');
  end if;
  if v_last.action = 'rollback' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  v_snap := v_last.snapshot;
  v_menu_id := v_last.menu_id;

  -- Put the previous live state back, one statement per table, same
  -- transaction: if anything fails, the current pair stays live.
  update public.restaurants
  set name = v_snap->>'name',
      logo_path = v_snap->>'logo_path',
      banner_path = v_snap->>'banner_path',
      brand_theme = (v_snap->'brand_theme'),
      brand_theme_enabled = coalesce((v_snap->>'brand_theme_enabled')::boolean, false),
      brand_profile_id = (v_snap->>'brand_profile_id')::uuid,
      updated_at = now()
  where id = p_restaurant_id;

  if v_menu_id is not null then
    update public.menus
    set is_published = coalesce((v_snap->>'menu_is_published')::boolean, false)
    where id = v_menu_id;
  end if;

  -- The restored profile (if any) is approved again; the rolled-back one goes
  -- back to draft so the owner can fix and re-publish it.
  if (v_snap->>'brand_profile_id') is not null then
    update public.restaurant_brand_profiles
    set status = 'published', updated_at = now()
    where id = (v_snap->>'brand_profile_id')::uuid
      and restaurant_id = p_restaurant_id;
  end if;

  update public.restaurant_brand_profiles
  set status = 'draft', updated_at = now()
  where id = v_last.brand_profile_id
    and restaurant_id = p_restaurant_id;

  insert into public.restaurant_publish_history
    (restaurant_id, action, menu_id, brand_profile_id, snapshot, actor)
  values
    (p_restaurant_id, 'rollback', v_menu_id, v_last.brand_profile_id, v_snap, v_user);

  return jsonb_build_object('ok', true, 'already', false);
end;
$$;

revoke all on function public.rollback_last_publish(uuid) from public;
revoke all on function public.rollback_last_publish(uuid) from anon;
revoke all on function public.rollback_last_publish(uuid) from authenticated;
grant execute on function public.rollback_last_publish(uuid) to authenticated;

-- ---------------------------------------------------------- brand theme
-- restaurants.brand_theme_enabled / brand_theme are written only by
-- publish_menu_brand_pair and rollback_last_publish above. The existing
-- restaurants_update policy covers the branding screen's logo/banner/name
-- writes and is deliberately NOT widened here.
