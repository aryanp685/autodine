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
};

export type MenuEditorData = {
  restaurantName: string;
  menuId: string;
  published: boolean;
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
    return { restaurantName: '', menuId: '', published: false, items: [], blocked: staff.reason };
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
    return { restaurantName, menuId: '', published: false, items: [] };
  }

  const { data: items, error: itemsError } = await supabase
    .from('items')
    .select('id, category_id, name, description, price_paise, is_veg, is_available, sort_order')
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true });

  if (itemsError) throw new Error(`Could not load items: ${itemsError.message}`);

  return {
    restaurantName,
    menuId: menu.id as string,
    published: Boolean(menu.is_published),
    items: (items ?? []).map((row) => ({
      id: row.id as string,
      categoryId: (row.category_id as string | null) ?? null,
      name: row.name as string,
      desc: (row.description as string | null) ?? '',
      pricePaise: Number(row.price_paise ?? 0),
      veg: Boolean(row.is_veg),
      available: Boolean(row.is_available),
      sortOrder: Number(row.sort_order ?? 0),
    })),
  };
}
