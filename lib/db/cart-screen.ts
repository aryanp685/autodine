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
  //
  // Portions come along with each item, in the same query. They have to: a
  // cart line names a portion, and a bill that cannot resolve it falls back
  // to the menu price -- which is exactly the undercharge this change exists
  // to stop. Fetching them separately would leave a window where the item is
  // known and its portions are not.
  const { data: rows, error } = await supabase
    .from('items')
    .select('id, name, price_paise, is_veg, is_available, item_variants(id, name, price_paise, sort_order)')
    .eq('restaurant_id', restaurant.id)
    .eq('is_available', true)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`Could not load the menu: ${error.message}`);

  /**
   * item_variants arrives either as an array, as a single object, or as null,
   * depending on how PostgREST infers the relationship for this hand-written
   * Database type. All three are normalised here so the screens never have to
   * care which shape came back.
   */
  function variantsOf(raw: unknown): { id: string; name: string; pricePaise: number }[] {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list
      .map((v) => {
        const row = v as Record<string, unknown>;
        return {
          id: String(row.id ?? ''),
          name: String(row.name ?? ''),
          pricePaise: Number(row.price_paise ?? 0),
          sortOrder: Number(row.sort_order ?? 0),
        };
      })
      .filter((v) => v.id && v.name)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ id, name, pricePaise }) => ({ id, name, pricePaise }));
  }

  return {
    slug: restaurant.slug as string,
    restaurantName: (restaurant.name as string) ?? 'Your table',
    taxRateBps: Number(restaurant.tax_rate_bps ?? 500),
    items: (rows ?? []).map((r) => {
      const variants = variantsOf((r as Record<string, unknown>).item_variants);
      return {
        id: r.id as string,
        name: (r.name as string) ?? '',
        pricePaise: Number(r.price_paise ?? 0),
        isVeg: Boolean(r.is_veg),
        isAvailable: Boolean(r.is_available),
        ...(variants.length ? { variants } : {}),
      };
    }),
  };
}
