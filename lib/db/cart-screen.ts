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
  /**
   * Has the owner switched card/UPI payment on for this outlet?
   *
   * The checkout screen uses it to describe what happens after placing the
   * order -- not to take payment there. Whether this DEPLOYMENT has gateway
   * keys is decided on the page (lib/payments/online-availability.ts).
   */
  onlinePaymentsEnabled: boolean;
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
    .select('id, name, slug, tax_rate_bps, online_payments_enabled')
    .eq('slug', slug.trim())
    .eq('is_active', true)
    .maybeSingle();

  if (restaurantError) throw new Error(`Could not load restaurant: ${restaurantError.message}`);
  if (!restaurant) return null;

  /**
   * Only dishes on a PUBLISHED menu are priced here.
   *
   * A cart can be filled from any of the restaurant's live menus, so this
   * cannot be scoped to one menu the way the guest menu screen is -- but it
   * must be scoped to the published ones. A dish the owner moved to a draft
   * menu is not orderable, and pricing it on the cart screen would promise a
   * total that checkout then refuses.
   *
   * Three reads rather than an embedded filter: lib/db/database.ts is
   * hand-written and does not describe the categories->menus relationship well
   * enough to compile an embed.
   */
  const { data: menuRows, error: menusError } = await supabase
    .from('menus')
    .select('id')
    .eq('restaurant_id', restaurant.id)
    .eq('is_published', true);

  if (menusError) throw new Error(`Could not load the menus: ${menusError.message}`);

  const menuIds = (menuRows ?? []).map((row) => row.id as string);

  const { data: categoryRows, error: categoriesError } = menuIds.length
    ? await supabase
        .from('categories')
        .select('id')
        .eq('restaurant_id', restaurant.id)
        .in('menu_id', menuIds)
    : { data: [], error: null };

  if (categoriesError) throw new Error(`Could not load the menus: ${categoriesError.message}`);

  const categoryIds = (categoryRows ?? []).map((row) => row.id as string);

  // Sold-out items are left out entirely. A dish a diner cannot order should
  // not be priced on a bill they are about to be asked to pay.
  //
  // Portions come along with each item, in the same query. They have to: a
  // cart line names a portion, and a bill that cannot resolve it falls back
  // to the menu price -- which is exactly the undercharge this change exists
  // to stop. Fetching them separately would leave a window where the item is
  // known and its portions are not.
  const { data: rows, error } = categoryIds.length
    ? await supabase
        .from('items')
        .select('id, name, price_paise, is_veg, is_available, image_url, item_variants(id, name, price_paise, sort_order)')
        .in('category_id', categoryIds)
        .eq('is_available', true)
        .order('sort_order', { ascending: true })
    : { data: [], error: null };

  if (error) throw new Error(`Could not load the menu: ${error.message}`);

  /**
   * Add-ons, with their prices and their group limits.
   *
   * They have to be here, not only on the dish sheet: a cart line names the
   * add-ons it was built with, and a bill that cannot resolve them would
   * quietly drop them from the total -- the same undercharge the portions
   * join above exists to stop. The group's max_select is carried too, because
   * lib/cart-pricing applies it and the bill must agree with the till.
   */
  const itemIds = (rows ?? []).map((r) => r.id as string);

  const { data: groupRows, error: groupsError } = itemIds.length
    ? await supabase
        .from('item_addon_groups')
        .select('id, item_id, max_select')
        .in('item_id', itemIds)
    : { data: [], error: null };

  if (groupsError) {
    console.error(`[cart] could not load add-on groups: ${groupsError.message}`);
  }

  const groupIds = (groupRows ?? []).map((g) => g.id as string);

  const { data: addonRows, error: addonsError } = groupIds.length
    ? await supabase
        .from('item_addons')
        .select('id, group_id, name, price_paise, is_available, sort_order')
        .in('group_id', groupIds)
        .eq('is_available', true)
        .order('sort_order', { ascending: true })
    : { data: [], error: null };

  if (addonsError) {
    console.error(`[cart] could not load add-ons: ${addonsError.message}`);
  }

  const groupById = new Map(
    (groupRows ?? []).map((g) => [
      g.id as string,
      { itemId: g.item_id as string, maxSelect: Number(g.max_select ?? 1) },
    ])
  );

  const addonsByItem = new Map<
    string,
    { id: string; name: string; pricePaise: number; groupId: string; maxSelect: number }[]
  >();
  for (const row of addonRows ?? []) {
    const group = groupById.get(row.group_id as string);
    if (!group) continue;
    const list = addonsByItem.get(group.itemId) ?? [];
    list.push({
      id: row.id as string,
      name: (row.name as string) ?? '',
      pricePaise: Number(row.price_paise ?? 0),
      groupId: row.group_id as string,
      maxSelect: group.maxSelect,
    });
    addonsByItem.set(group.itemId, list);
  }

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
    onlinePaymentsEnabled: restaurant.online_payments_enabled === true,
    items: (rows ?? []).map((r) => {
      const variants = variantsOf((r as Record<string, unknown>).item_variants);
      const addons = addonsByItem.get(r.id as string) ?? [];
      const img = (r as Record<string, unknown>).image_url;
      return {
        id: r.id as string,
        name: (r.name as string) ?? '',
        ...(typeof img === 'string' && img ? { img } : {}),
        pricePaise: Number(r.price_paise ?? 0),
        isVeg: Boolean(r.is_veg),
        isAvailable: Boolean(r.is_available),
        ...(variants.length ? { variants } : {}),
        ...(addons.length ? { addons } : {}),
      };
    }),
  };
}
