/**
 * Load the editable menu for the locked Menu Editor screen.
 *
 * Unlike the customer-facing read path this does NOT filter to published or
 * available rows: an editor has to see unavailable and unpublished items in
 * order to fix them. It is staff-only -- every read goes through the session
 * cookie and the items_staff / menus_staff RLS policies.
 *
 * WHY THE RESTAURANT COMES FROM THE SESSION AND NOT A SLUG
 *
 * This used to look the restaurant up by a hardcoded slug. That slug named a
 * seeded demo venue which no longer exists, so the lookup returned nothing and
 * the screen quietly fell back to its fictional sample menu -- a signed-in
 * owner would see somebody else's dishes, believe they were theirs, and be
 * offered a form that could not save. The restaurant id is now derived from
 * the caller's membership row, exactly as it is on the kitchen board, so the
 * screen can only ever read a restaurant the caller belongs to.
 *
 * Returns null when Supabase is not configured, and the screen falls back to
 * its demo rows. A configured-but-blocked caller gets `blocked` instead, which
 * the screen must render as a prompt: showing sample dishes to someone who is
 * merely logged out reads as real data.
 */

import { cookies } from 'next/headers';
import { chooseMenu } from '@/lib/menu-select';
import { getStaffContextDetailed } from './staff';
import { publicAssetUrl } from '@/lib/storage/assets';

/** The name of the cookie that remembers which menu the owner is editing. */
export const EDITOR_MENU_COOKIE = 'autodine.editor.menu';

export type EditorVariant = {
  id: string;
  name: string;
  /** Paise. The editor renders rupees and converts back on save. */
  pricePaise: number;
  sortOrder: number;
};

export type EditorAddon = {
  id: string;
  name: string;
  /** Paise. The editor renders rupees and converts back on save. */
  pricePaise: number;
  available: boolean;
  sortOrder: number;
};

/**
 * A heading of choices against one dish, with its options.
 *
 * Loaded with the dish rather than on demand, for the same reason portions
 * are: the editor shows them the moment a row is selected, and a round trip
 * per click would make every selection feel slow for a handful of rows.
 */
export type EditorAddonGroup = {
  id: string;
  name: string;
  /** 0 = skippable, 1 or more = required, shown with a default chosen. */
  minSelect: number;
  /** 1 = pick one, higher = pick up to that many. */
  maxSelect: number;
  sortOrder: number;
  addons: EditorAddon[];
};

export type EditorItem = {
  id: string;
  categoryId: string | null;
  name: string;
  desc: string;
  /** Paise. The editor renders rupees and converts back on save. */
  pricePaise: number;
  veg: boolean;
  available: boolean;
  /**
   * Public URL of the dish photo, or null when none has been uploaded.
   *
   * Migration 20261025001000 gave this column a write path for the first time;
   * before that `items.image_url` existed and was read by three screens but no
   * UI ever set it.
   */
  img: string | null;
  sortOrder: number;
  /**
   * The owner's own pronunciation, or '' when the board should say the name.
   * Loaded with the item because the editor previews it the moment a row is
   * selected.
   */
  spokenName: string;
  /**
   * The portions this dish is sold in. Empty for most dishes.
   *
   * Loaded with the item rather than on demand, because the editor shows them
   * the moment a row is selected and a second round trip per selection would
   * make every click feel slow for data that is only a handful of rows.
   */
  variants: EditorVariant[];
  /** Add-on groups with their options. Empty for a dish with none. */
  addonGroups: EditorAddonGroup[];
};

export type EditorCategory = {
  id: string;
  name: string;
  /**
   * Items in this category, unavailable ones included: the editor shows them
   * so they can be fixed, so the count has to match what the list shows.
   */
  itemCount: number;
};

/** One menu, as the editor's tab bar needs it. */
export type EditorMenu = {
  id: string;
  name: string;
  published: boolean;
  /** Categories in this menu, so a tab can say how much is on it. */
  categoryCount: number;
};

export type MenuEditorData = {
  restaurantName: string;
  menuId: string;
  menuName: string;
  published: boolean;
  /** Every menu on the account, drafts included, in the owner's order. */
  menus: EditorMenu[];
  categories: EditorCategory[];
  items: EditorItem[];
  /** Set when the caller has no restaurant to show. See lib/db/staff.ts. */
  blocked?: 'signed-out' | 'no-membership';
};

/**
 * The menu the owner last opened, if the cookie says so.
 *
 * `cookies()` throws when there is no request in flight -- a unit test, or any
 * future job that loads this outside a browser turn. That is not a failure
 * worth throwing for: with no memory we fall back to the first menu, which is
 * exactly what the editor did before it could remember anything.
 */
async function readRememberedMenu(): Promise<string | null> {
  try {
    return (await cookies()).get(EDITOR_MENU_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

export async function getMenuEditorData(): Promise<MenuEditorData | null> {
  const staff = await getStaffContextDetailed();

  // Nested rather than a compound condition: a narrowed && does not carry into
  // the next if, so the union would stay wide and `blocked` would not typecheck.
  if (!staff.ok) {
    if (staff.reason === 'unconfigured') return null;
    return {
      restaurantName: '',
      menuId: '',
      menuName: '',
      published: false,
      menus: [],
      categories: [],
      items: [],
      blocked: staff.reason,
    };
  }

  const { supabase, restaurantId, restaurantName } = staff.context;

  /**
   * Every menu, drafts included -- this is the editor, and a draft is exactly
   * what gets edited before it goes live.
   *
   * Which one is being edited comes from a cookie rather than the URL, so that
   * every existing form in this screen keeps its action and its redirect
   * unchanged. A URL would have meant threading a menu id through twenty
   * forms, and the first one anybody forgot would silently save into the
   * other menu.
   */
  const { data: menuRows, error: menuError } = await supabase
    .from('menus')
    .select('id, name, is_published, sort_order')
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (menuError) throw new Error(`Could not load menus: ${menuError.message}`);

  const allMenus = (menuRows ?? []) as { id: string; name: string; is_published: boolean }[];

  // A restaurant with no menu row is a real state, not a reason to invent one.
  // The editor renders empty and offers to add the first item.
  if (allMenus.length === 0) {
    return {
      restaurantName,
      menuId: '',
      menuName: '',
      published: false,
      menus: [],
      categories: [],
      items: [],
    };
  }

  const remembered = await readRememberedMenu();
  const menu = chooseMenu(allMenus, remembered) ?? allMenus[0];

  // Separate queries rather than an embedded select: lib/db/database.ts is
  // hand-written and does not declare every relationship, so an embed such as
  // categories(name) resolves to a SelectQueryError and will not compile.
  const [categoriesResult, itemsResult, allCategoriesResult] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, sort_order')
      .eq('restaurant_id', restaurantId)
      .eq('menu_id', menu.id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('items')
      .select(
        'id, category_id, name, description, price_paise, is_veg, is_available, image_url, sort_order, spoken_name'
      )
      .eq('restaurant_id', restaurantId)
      .order('sort_order', { ascending: true }),
    // Every category in the restaurant, only to count them per menu for the
    // tab bar. Cheap: two columns, and a menu list is small.
    supabase.from('categories').select('id, menu_id').eq('restaurant_id', restaurantId),
  ]);

  if (categoriesResult.error) {
    throw new Error(`Could not load categories: ${categoriesResult.error.message}`);
  }
  if (itemsResult.error) {
    throw new Error(`Could not load items: ${itemsResult.error.message}`);
  }
  if (allCategoriesResult.error) {
    throw new Error(`Could not load categories: ${allCategoriesResult.error.message}`);
  }

  const categoriesInMenu = new Map<string, number>();
  for (const row of allCategoriesResult.data ?? []) {
    const menuId = row.menu_id as string | null;
    if (!menuId) continue;
    categoriesInMenu.set(menuId, (categoriesInMenu.get(menuId) ?? 0) + 1);
  }

  const menus: EditorMenu[] = allMenus.map((row) => ({
    id: row.id,
    name: row.name,
    published: Boolean(row.is_published),
    categoryCount: categoriesInMenu.get(row.id) ?? 0,
  }));

  /**
   * Dishes shown for this menu.
   *
   * A dish belongs to a menu through its category, so a dish filed under
   * another menu is not this menu's business. Dishes with no category at all
   * are kept: they are on no menu, which is exactly the problem the
   * Uncategorised counter exists to surface, and hiding them from every menu
   * would hide the problem too.
   */
  const menuCategoryIds = new Set((categoriesResult.data ?? []).map((row) => row.id as string));

  const items = (itemsResult.data ?? []).filter((row) => {
    const categoryId = row.category_id as string | null;
    return !categoryId || menuCategoryIds.has(categoryId);
  });

  /**
   * Portions are a second query, not an embed.
   *
   * The Database type in lib/db/database.ts is hand-written and describes the
   * variant relationship only well enough to typecheck a plain select; asking
   * PostgREST for an embedded item_variants(...) resolves to a
   * GenericStringError and every column read off it fails. Two queries over a
   * menu's worth of rows is not worth fighting a type for.
   *
   * Scoped by item id, because item_variants has no restaurant column --
   * a portion belongs to a dish and inherits its ownership. The item ids come
   * from the query above, which is already filtered to this restaurant, so
   * this cannot reach another kitchen's portions.
   */
  const itemIds = items.map((row) => row.id as string);
  const { data: variantRows, error: variantsError } = itemIds.length
    ? await supabase
        .from('item_variants')
        .select('id, item_id, name, price_paise, sort_order')
        .in('item_id', itemIds)
    : { data: [] as { id: string; item_id: string; name: string; price_paise: number; sort_order: number }[], error: null };

  // A failed variants read is not fatal. The editor still works; the owner
  // sees no portions and can still save the item. Failing the whole screen
  // over a cosmetic section would be worse than showing it empty.
  if (variantsError) {
    console.error(`[menu-editor] could not load portions: ${variantsError.message}`);
  }

  const variantsByItem = new Map<string, EditorVariant[]>();
  for (const row of variantRows ?? []) {
    const itemId = row.item_id as string;
    const list = variantsByItem.get(itemId) ?? [];
    list.push({
      id: row.id as string,
      name: (row.name as string) ?? '',
      pricePaise: Number(row.price_paise ?? 0),
      sortOrder: Number(row.sort_order ?? 0),
    });
    variantsByItem.set(itemId, list);
  }
  for (const list of variantsByItem.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);

  /**
   * Add-ons: two more queries, scoped by item id like portions above.
   *
   * A failure here is logged and the section renders empty rather than
   * failing the whole screen -- the same call as portions, and for the same
   * reason: an owner must still be able to edit a price while a new table is
   * missing.
   */
  const { data: addonGroupRows, error: addonGroupsError } = itemIds.length
    ? await supabase
        .from('item_addon_groups')
        .select('id, item_id, name, min_select, max_select, sort_order')
        .in('item_id', itemIds)
        .order('sort_order', { ascending: true })
    : { data: [], error: null };

  if (addonGroupsError) {
    console.error(`[menu-editor] could not load add-on groups: ${addonGroupsError.message}`);
  }

  const groupIds = (addonGroupRows ?? []).map((row) => row.id as string);

  const { data: addonRows, error: addonsError } = groupIds.length
    ? await supabase
        .from('item_addons')
        .select('id, group_id, name, price_paise, is_available, sort_order')
        .in('group_id', groupIds)
        .order('sort_order', { ascending: true })
    : { data: [], error: null };

  if (addonsError) {
    console.error(`[menu-editor] could not load add-ons: ${addonsError.message}`);
  }

  const addonsByGroup = new Map<string, EditorAddon[]>();
  for (const row of addonRows ?? []) {
    const groupId = row.group_id as string;
    const list = addonsByGroup.get(groupId) ?? [];
    list.push({
      id: row.id as string,
      name: (row.name as string) ?? '',
      pricePaise: Number(row.price_paise ?? 0),
      available: Boolean(row.is_available),
      sortOrder: Number(row.sort_order ?? 0),
    });
    addonsByGroup.set(groupId, list);
  }
  for (const list of addonsByGroup.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);

  const addonGroupsByItem = new Map<string, EditorAddonGroup[]>();
  for (const row of addonGroupRows ?? []) {
    const itemId = row.item_id as string;
    const list = addonGroupsByItem.get(itemId) ?? [];
    list.push({
      id: row.id as string,
      name: (row.name as string) ?? '',
      minSelect: Number(row.min_select ?? 0),
      maxSelect: Number(row.max_select ?? 1),
      sortOrder: Number(row.sort_order ?? 0),
      addons: addonsByGroup.get(row.id as string) ?? [],
    });
    addonGroupsByItem.set(itemId, list);
  }
  for (const list of addonGroupsByItem.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);

  const countByCategory = new Map<string, number>();
  for (const row of items) {
    if (!row.category_id) continue;
    countByCategory.set(row.category_id, (countByCategory.get(row.category_id) ?? 0) + 1);
  }

  return {
    restaurantName,
    menuId: menu.id as string,
    menuName: menu.name as string,
    menus,
    published: Boolean(menu.is_published),
    categories: (categoriesResult.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      itemCount: countByCategory.get(row.id as string) ?? 0,
    })),
    items: items.map((row) => ({
      id: row.id as string,
      categoryId: (row.category_id as string | null) ?? null,
      name: row.name as string,
      desc: (row.description as string | null) ?? '',
      pricePaise: Number(row.price_paise ?? 0),
      veg: Boolean(row.is_veg),
      available: Boolean(row.is_available),
      // Stored as a URL (not a path) because items.image_url predates this
      // feature and three existing readers expect a URL. See
      // lib/storage/assets.ts for the reasoning.
      img: publicAssetUrl((row.image_url as string | null) ?? null),
      sortOrder: Number(row.sort_order ?? 0),
      spokenName: ((row.spoken_name as string | null) ?? '').trim(),
      variants: variantsByItem.get(row.id as string) ?? [],
      addonGroups: addonGroupsByItem.get(row.id as string) ?? [],
    })),
  };
}
