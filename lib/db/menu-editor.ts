/**
 * Load the editable menu for the locked Menu Editor screen.
 *
 * Unlike the customer-facing read path this does NOT filter to published or
 * available rows: an editor has to see unavailable and unpublished items in
 * order to fix them. It is staff-only -- every read here goes through the
 * session cookie and the items_staff / menus_staff RLS policies.
 *
 * Returns null when Supabase is not configured, and the screen falls back to
 * its demo rows.
 */

import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DEFAULT_SLUG } from './menu-screen';

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
};

export async function getMenuEditorData(): Promise<MenuEditorData | null> {
  if (!isSupabaseConfigured) return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('id, name')
    .eq('slug', DEFAULT_SLUG)
    .maybeSingle();

  if (restaurantError) {
    throw new Error(`Could not load restaurant: ${restaurantError.message}`);
  }
  if (!restaurant) return null;

  const { data: menu, error: menuError } = await supabase
    .from('menus')
    .select('id, is_published')
    .eq('restaurant_id', restaurant.id)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (menuError) throw new Error(`Could not load menu: ${menuError.message}`);
  if (!menu) return null;

  const { data: items, error: itemsError } = await supabase
    .from('items')
    .select('id, category_id, name, description, price_paise, is_veg, is_available, sort_order')
    .eq('restaurant_id', restaurant.id)
    .order('sort_order', { ascending: true });

  if (itemsError) throw new Error(`Could not load items: ${itemsError.message}`);

  return {
    restaurantName: restaurant.name,
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
