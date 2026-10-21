/**
 * Menu reads.
 *
 * Two sources, deliberately:
 *
 *   1. Supabase, when it is configured. Reads go through the anon key, so Row
 *      Level Security applies: an anonymous guest can read a PUBLISHED menu at
 *      an ACTIVE restaurant and nothing else.
 *
 *   2. The demo data in lib/demo-data.ts, when it is not.
 *
 * The fallback exists so the live Netlify site keeps rendering before the
 * database is connected. It is scaffolding. Once the database is live, delete
 * it: a misconfiguration should fail loudly, not quietly serve sample dishes
 * to a real guest who is trying to order dinner.
 */

import { demoMenu } from './demo-menu';
import { chooseMenu } from '@/lib/menu-select';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  Category,
  Item,
  ItemAddon,
  ItemAddonGroup,
  ItemVariant,
  Menu,
  MenuItem,
  Restaurant,
  RestaurantMenu,
} from './types';

export { usingDemoData } from './demo-menu';

/**
 * Load one published menu of a restaurant by slug.
 *
 * `menuId` picks which one; omitted (or unknown) means the restaurant's first
 * published menu. See lib/menu-select.ts for the rule and why it is not "the
 * newest".
 *
 * Returns null when there is no such active restaurant or no published menu.
 */
export async function getRestaurantMenu(
  slug: string,
  menuId?: string | null,
): Promise<RestaurantMenu | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return demoMenu(slug);

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (restaurantError) throw new Error(`Could not load restaurant: ${restaurantError.message}`);
  if (!restaurant) return null;

  // Every published menu, so the guest can switch, and the chosen one, so the
  // dishes below are scoped to it. `created_at` is the tie-break: two menus
  // with the same sort_order must not swap places between loads.
  const { data: menuRows, error: menuError } = await supabase
    .from('menus')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .eq('is_published', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (menuError) throw new Error(`Could not load menus: ${menuError.message}`);

  const published = (menuRows ?? []) as Menu[];
  const menu = chooseMenu(published, menuId);
  if (!menu) return null;

  // Categories belong to a menu. Loading them by restaurant instead is what
  // merged Breakfast and Dinner into one list, with half the dishes failing at
  // the last step because the ordering function had picked the other menu.
  const { data: categoryRows, error: categoriesError } = await supabase
    .from('categories')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .eq('menu_id', menu.id)
    .order('sort_order', { ascending: true });

  if (categoriesError) throw new Error(`Could not load categories: ${categoriesError.message}`);

  const categories = (categoryRows ?? []) as Category[];
  const categoryIds = categories.map((category) => category.id);

  // A dish is reachable only through its category, and an item with no
  // category belongs to no menu. Scoped by id rather than by restaurant for
  // the same reason as the categories above.
  const { data: itemRows, error: itemsError } = categoryIds.length
    ? await supabase
        .from('items')
        .select('*, item_variants(*)')
        .in('category_id', categoryIds)
        .eq('is_available', true)
        .order('sort_order', { ascending: true })
    : { data: [], error: null };

  if (itemsError) throw new Error(`Could not load items: ${itemsError.message}`);

  const categoriesResult = { data: categories };
  const itemsResult = { data: itemRows ?? [] };

  /**
   * Add-ons: two more reads, scoped by the item ids just loaded.
   *
   * A guest choosing "Extra cheese" has to see the price and the dish has to
   * be priced with it, so both the sheet and the bill need these rows. They
   * are read for every item on the menu at once rather than per sheet opening,
   * because the dish list already shows "Choose options" -- a second round
   * trip when that link is pressed would make the sheet feel broken.
   *
   * A failure is logged, not thrown: an add-ons outage should cost the reader
   * a set of choices, not the whole menu.
   */
  const menuItemIds = (itemsResult.data ?? []).map((row) => row.id);

  const { data: addonGroupRows, error: addonGroupsError } = menuItemIds.length
    ? await supabase
        .from('item_addon_groups')
        .select('id, item_id, name, min_select, max_select, sort_order')
        .in('item_id', menuItemIds)
        .order('sort_order', { ascending: true })
    : { data: [], error: null };

  if (addonGroupsError) {
    console.error(`[menu] could not load add-on groups: ${addonGroupsError.message}`);
  }

  const addonGroupIds = (addonGroupRows ?? []).map((row) => row.id as string);

  const { data: addonRows, error: addonsError } = addonGroupIds.length
    ? await supabase
        .from('item_addons')
        .select('id, group_id, name, price_paise, is_available, sort_order')
        .in('group_id', addonGroupIds)
        .eq('is_available', true)
        .order('sort_order', { ascending: true })
    : { data: [], error: null };

  if (addonsError) {
    console.error(`[menu] could not load add-ons: ${addonsError.message}`);
  }

  const addonsByGroup = new Map<string, ItemAddon[]>();
  for (const row of addonRows ?? []) {
    const groupId = row.group_id as string;
    const list = addonsByGroup.get(groupId) ?? [];
    list.push(row as unknown as ItemAddon);
    addonsByGroup.set(groupId, list);
  }

  const addonGroupsByItem = new Map<string, (ItemAddonGroup & { addons: ItemAddon[] })[]>();
  for (const row of addonGroupRows ?? []) {
    const itemId = row.item_id as string;
    const group = row as unknown as ItemAddonGroup;
    const options = addonsByGroup.get(group.id) ?? [];
    // An empty group is nothing a guest can act on, so it is not shown. The
    // editor still lists it, which is where it gets filled in.
    if (options.length === 0) continue;
    const list = addonGroupsByItem.get(itemId) ?? [];
    list.push({ ...group, addons: options });
    addonGroupsByItem.set(itemId, list);
  }

  const items: MenuItem[] = (itemsResult.data ?? []).map((raw) => {
    // The hand-written Database type cannot always tell Postgrest that this
    // embed is one-to-many, so it is typed as either shape. The wire format is
    // an array; normalise defensively rather than trusting the type.
    const row = raw as unknown as Item & { item_variants?: ItemVariant[] | ItemVariant | null };
    const embedded = row.item_variants;
    const variants: ItemVariant[] = Array.isArray(embedded)
      ? embedded
      : embedded
        ? [embedded]
        : [];

    return {
      id: row.id,
      restaurant_id: row.restaurant_id,
      category_id: row.category_id,
      name: row.name,
      description: row.description,
      price_paise: row.price_paise,
      is_veg: row.is_veg,
      is_available: row.is_available,
      image_url: row.image_url,
      sort_order: row.sort_order,
      variants: variants.slice().sort((a, b) => a.sort_order - b.sort_order),
      addonGroups: (addonGroupsByItem.get(row.id) ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order),
    };
  });

  return {
    restaurant: restaurant as Restaurant,
    menu,
    menus: published.map((row) => ({ id: row.id, name: row.name })),
    categories: categoriesResult.data as Category[],
    items,
  };
}
