-- ============================================================================
-- AutoDine — migration 20261108000300: the publish snapshot remembers the menu
--
-- WHAT THIS FIXES
--
-- Rollback used to restore only the brand half of a pair: name, logo, banner,
-- theme, the published flag. A dish added or repriced after the publish stayed
-- changed after the rollback — the owner was told so at the time and had to
-- undo menu edits by hand. This closes that gap: the publish snapshot now
-- carries the menu's rows as they were, and a rollback puts them back.
--
-- HOW
--
--   publish_menu_brand_pair  — the snapshot gains `menu_content`: every
--     category, item, variant, add-on group and add-on of the menu being
--     published, captured with to_jsonb so the whole row travels (including
--     columns added by later migrations).
--   rollback_last_publish    — when the snapshot carries menu_content, the
--     menu's rows are replaced with the snapshot's rows inside the same
--     transaction: children first on the way out (add-ons, groups, variants,
--     items, categories), parents first on the way back in.
--
-- Old history rows have no menu_content; a rollback of one of them behaves
-- exactly as before (brand half only). Everything else about publish and
-- rollback — roles, the trial gate, the idempotent `already` answer, the
-- history row — is unchanged.
-- ============================================================================

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
  v_cat_ids   uuid[];
  v_item_ids  uuid[];
  v_group_ids uuid[];
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

  if not public.restaurant_can_write(v_restaurant) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'Only an owner or manager can change the menu, and the trial must still be running. Nothing was published.'
    );
  end if;

  select * into v_menu from public.menus where id = p_menu_id;
  if not found or v_menu.restaurant_id <> v_restaurant then
    return jsonb_build_object('ok', false, 'reason', 'That menu is not on your account.');
  end if;

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

  -- The menu half of the pair, exactly as it stands at this moment. Rollback
  -- restores these rows; see the header.
  select coalesce(array_agg(c.id), '{}') into v_cat_ids
    from public.categories c where c.menu_id = p_menu_id;
  select coalesce(array_agg(i.id), '{}') into v_item_ids
    from public.items i where i.category_id = any(v_cat_ids);
  select coalesce(array_agg(g.id), '{}') into v_group_ids
    from public.item_addon_groups g where g.item_id = any(v_item_ids);

  v_snapshot := jsonb_build_object(
    'name', v_name,
    'logo_path', v_logo,
    'banner_path', v_banner,
    'brand_theme', v_theme,
    'brand_theme_enabled', (select brand_theme_enabled from public.restaurants where id = v_restaurant),
    'brand_profile_id', v_prev_profile,
    'menu_is_published', v_menu.is_published,
    'menu_content', jsonb_build_object(
      'categories', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.categories c where c.id = any(v_cat_ids)),
      'items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.items i where i.id = any(v_item_ids)),
      'item_variants', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from public.item_variants v where v.item_id = any(v_item_ids)),
      'item_addon_groups', (select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) from public.item_addon_groups g where g.id = any(v_group_ids)),
      'item_addons', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.item_addons a where a.group_id = any(v_group_ids))
    )
  );

  select a.path into v_logo
  from public.restaurant_brand_assets a
  where a.id = v_profile.logo_asset_id and a.restaurant_id = v_restaurant;
  select a.path into v_banner
  from public.restaurant_brand_assets a
  where a.id = v_profile.banner_asset_id and a.restaurant_id = v_restaurant;

  v_name  := case when v_profile.name is not null then btrim(v_profile.name) else v_name end;
  v_theme := v_profile.theme;

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
  v_cat_ids  uuid[];
  v_item_ids uuid[];
  v_group_ids uuid[];
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;

  if not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    return jsonb_build_object('ok', false, 'reason', 'Only an owner or manager can roll back.');
  end if;

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

    -- The menu half of the pair, restored row for row. Present only on
    -- snapshots taken after this migration; older ones roll back the brand
    -- half alone, exactly as they always did.
    if v_snap ? 'menu_content' then
      select coalesce(array_agg(c.id), '{}') into v_cat_ids
        from public.categories c where c.menu_id = v_menu_id;
      select coalesce(array_agg(i.id), '{}') into v_item_ids
        from public.items i where i.category_id = any(v_cat_ids);
      select coalesce(array_agg(g.id), '{}') into v_group_ids
        from public.item_addon_groups g where g.item_id = any(v_item_ids);

      -- Children first: each level's rows are only reachable through their
      -- parents, so the parents leave last and return first.
      delete from public.item_addons      where group_id = any(v_group_ids);
      delete from public.item_addon_groups where item_id = any(v_item_ids);
      delete from public.item_variants    where item_id = any(v_item_ids);
      delete from public.items            where category_id = any(v_cat_ids);
      delete from public.categories       where menu_id = v_menu_id;

      insert into public.categories
        select * from jsonb_populate_recordset(null::public.categories, v_snap->'menu_content'->'categories');
      insert into public.items
        select * from jsonb_populate_recordset(null::public.items, v_snap->'menu_content'->'items');
      insert into public.item_variants
        select * from jsonb_populate_recordset(null::public.item_variants, v_snap->'menu_content'->'item_variants');
      insert into public.item_addon_groups
        select * from jsonb_populate_recordset(null::public.item_addon_groups, v_snap->'menu_content'->'item_addon_groups');
      insert into public.item_addons
        select * from jsonb_populate_recordset(null::public.item_addons, v_snap->'menu_content'->'item_addons');
    end if;
  end if;

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
