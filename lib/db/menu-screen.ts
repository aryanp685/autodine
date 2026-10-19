/**
 * Load and adapt menu data for the locked screens.
 *
 * Returns null in two situations, and they mean different things:
 *
 *   1. Supabase is not configured. The screens then use their own demo
 *      content, which is exactly what they did before the database existed.
 *      Not passing data keeps the locked markup and its sample content
 *      byte-for-byte identical, so the design baseline does not move.
 *
 *   2. A real query failed. This is thrown to the route error boundary rather
 *      than silently replacing a live restaurant's menu with fictional dishes.
 *
 * A connected database returning no restaurant is distinct from demo mode:
 * callers must show a not-found state, never the built-in sample menu.
 */

import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getRestaurantMenu } from './menu';
import { toDisplayMenu } from './adapt';
import type { DisplayCategory, DisplayItem, DisplayRestaurant } from './adapt';

export type MenuScreenData = {
  restaurant: DisplayRestaurant;
  categories: DisplayCategory[];
  items: DisplayItem[];
};

/** The seeded demo restaurant. Overridden by ?s=<slug> for other venues. */
export const DEFAULT_SLUG = 'saffron-smoke';

export async function getMenuScreenData(slug?: string): Promise<MenuScreenData | null> {
  if (!isSupabaseConfigured) return null;

  const target = slug?.trim() || DEFAULT_SLUG;

  try {
    const data = await getRestaurantMenu(target);
    return data ? toDisplayMenu(data) : null;
  } catch (error) {
    console.error(
      `[autodine] failed to load menu for "${target}":`,
      error instanceof Error ? error.message : error
    );
    throw error;
  }
}
