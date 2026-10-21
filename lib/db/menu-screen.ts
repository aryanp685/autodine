/** Load the selected restaurant's menu without falling back to demo data on query errors. */

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
