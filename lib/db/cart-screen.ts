/**
 * Prices for the cart and checkout screens.
 *
 * Separate from lib/db/menu-screen.ts because that one adapts rows into
 * display shapes with rupee amounts, and money that has been turned into a
 * rupee float and back is money that has been through a rounding step it did
 * not need. These screens need paise, so they read paise.
 *
 * Returns null when Supabase is not configured, which is the demo signal the
 * other screens use, and when there is no active restaurant at the slug.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import type { MenuItemPrice } from '@/lib/cart-pricing';

export type CartScreenData = {
  slug: string;
  restaurantName: string;
  /**
   * The restaurant's own rate, in basis points.
   *
   * A bill priced at a rate the restaurant did not set is wrong in a way the
   * guest cannot check and finance only finds later, so the screens price
   * with this and the database prices with the same column. It is read here
   * rather than defaulted, because the fallback in lib/pricing.ts is a
   * layout sample -- it is the right number to draw a screen with and the
   * wrong number to charge somebody.
   */
  taxRateBps: number;
  /** Only items a diner can actually order right now. */
  items: MenuItemPrice[];
};

export async function getCartScreenData(slug?: string): Promise<CartScreenData | null> {
  if (!isSupabaseConfigured) return null;
  if (!slug?.trim()) return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('id, name, slug, tax_rate_bps')
    .eq('slug', slug.trim())
    .eq('is_active', true)
    .maybeSingle();

  if (restaurantError) throw new Error(`Could not load restaurant: ${restaurantError.message}`);
  if (!restaurant) return null;

  // Sold-out items are left out entirely. A dish a diner cannot order should
  // not be priced on a bill they are about to be asked to pay.
  const { data: rows, error } = await supabase
    .from('items')
    .select('id, name, price_paise, is_veg, is_available')
    .eq('restaurant_id', restaurant.id)
    .eq('is_available', true)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`Could not load the menu: ${error.message}`);

  return {
    slug: restaurant.slug as string,
    restaurantName: (restaurant.name as string) ?? 'Your table',
    taxRateBps: Number(restaurant.tax_rate_bps ?? 500),
    items: (rows ?? []).map((r) => ({
      id: r.id as string,
      name: (r.name as string) ?? '',
      pricePaise: Number(r.price_paise ?? 0),
      isVeg: Boolean(r.is_veg),
      isAvailable: Boolean(r.is_available),
    })),
  };
}
