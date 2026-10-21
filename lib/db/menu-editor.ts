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

import { getStaffContextDetailed } from './staff';

export type EditorVariant = {
  id: string;
  name: string;
  /** Paise. The editor renders rupees and converts back on save. */
  pricePaise: number;
  sortOrder: number;
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
  sortOrder: number;
  /**
   * The portions this dish is sold in. Empty for most dishes.
   *
   * Loaded with the item rather than on demand, because the editor shows them
   * the moment a row is selected and a second round trip per selection would
   * make every click feel slow for data that is only a handful of rows.
   */
  variants: EditorVariant[];
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

export type MenuEditorData = {
  restaurantName: string;
  menuId: string;
  published: boolean;
  categories: EditorCategory[];
  items: EditorItem[];
  /** Set when the caller has no restaurant to show. See lib/db/staff.ts. */
  blocked?: 'signed-out' | 'no-membership';
};

export async function getMenuEditorData(): Promise<MenuEditorData | null> {
  const staff = await getStaffContextDetailed();

  // Nested rather than a compound condition: a narrowed && does not carry into
  // the next if, so the union would stay wide and `blocked` would not typecheck.
  if (!staff.ok) {
    if (staff.reason === 'unconfigured') return null;
    return {
      restaurantName: '',
      menuId: '',
      published: false,
      categories: [],
      items: [],
      blocked: staff.reason,
    };
  }

  const { supabase, restaurantId, restaurantName } = staff.context;

  const { data: menu, error: menuError } = await supabase
    .from('menus')
    .select('id, is_published')
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (menuError) throw new Error(`Could not load menu: ${menuError.message}`);
  // A restaurant with no menu row is a real state, not a reason to invent one.
  // The editor renders empty and offers to add the first item.
  if (!menu) {
    return { restaurantName, menuId: '', published: false, categories: [], items: [] };
  }

  // Separate queries rather than an embedded select: lib/db/database.ts is
  // hand-written and does not declare every relationship, so an embed such as
  // categories(name) resolves to a SelectQueryError and will not compile.
  const [categoriesResult, itemsResult] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, sort_order')
      .eq('restaurant_id', restaurantId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('items')
      .select('id, category_id, name, description, price_paise, is_veg, is_available, sort_order')
      .eq('restaurant_id', restaurantId)
      .order('sort_order', { ascending: true }),
  ]);

  if (categoriesResult.error) {
    throw new Error(`Could not load categories: ${categoriesResult.error.message}`);
  }
  if (itemsResult.error) {
    throw new Error(`Could not load items: ${itemsResult.error.message}`);
  }

  const items = itemsResult.data ?? [];

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

  const countByCategory = new Map<string, number>();
  for (const row of items) {
    if (!row.category_id) continue;
    countByCategory.set(row.category_id, (countByCategory.get(row.category_id) ?? 0) + 1);
  }

  return {
    restaurantName,
    menuId: menu.id as string,
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
      sortOrder: Number(row.sort_order ?? 0),
      variants: variantsByItem.get(row.id as string) ?? [],
    })),
  };
}
