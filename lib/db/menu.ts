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
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Category, Item, ItemVariant, Menu, MenuItem, Restaurant, RestaurantMenu } from './types';

export { usingDemoData } from './demo-menu';

/**
 * Load a restaurant's published menu by slug.
 * Returns null when there is no such active restaurant or no published menu.
 */
export async function getRestaurantMenu(slug: string): Promise<RestaurantMenu | null> {
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

  const { data: menu, error: menuError } = await supabase
    .from('menus')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .eq('is_published', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (menuError) throw new Error(`Could not load menu: ${menuError.message}`);
  if (!menu) return null;

  const [categoriesResult, itemsResult] = await Promise.all([
    supabase.from('categories').select('*').eq('restaurant_id', restaurant.id).order('sort_order', { ascending: true }),
    supabase
      .from('items')
      .select('*, item_variants(*)')
      .eq('restaurant_id', restaurant.id)
      .eq('is_available', true)
      .order('sort_order', { ascending: true }),
  ]);

  if (categoriesResult.error) throw new Error(`Could not load categories: ${categoriesResult.error.message}`);
  if (itemsResult.error) throw new Error(`Could not load items: ${itemsResult.error.message}`);

  const items: MenuItem[] = (itemsResult.data ?? []).map((row: Item & { item_variants?: ItemVariant[] }) => ({
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
    variants: (row.item_variants ?? []).slice().sort((a, b) => a.sort_order - b.sort_order),
  }));

  return {
    restaurant: restaurant as Restaurant,
    menu: menu as Menu,
    categories: (categoriesResult.data ?? []) as Category[],
    items,
  };
}
