/**
 * Adapt database rows into the display shapes the locked screens consume.
 *
 * Why adapt instead of rewriting the screens: the design is locked, and the
 * screens' JSX is the locked artefact. The demo data and the database disagree
 * about both names and units -- the demo says `price` in rupees and `desc`,
 * the database says `price_paise` in integer paise and `description`.
 *
 * Adapting at the boundary means every screen keeps its markup untouched, and
 * the money conversion lives in exactly one place, which is tested.
 *
 * The display types below deliberately mirror the `Item` type in
 * lib/demo-data.ts. They are restated rather than imported so that this module
 * never pulls demo data into the database path -- importing demo data here
 * would quietly keep the fallback alive in production.
 */

import { paiseToRupees } from '@/lib/money';
import { publicAssetUrl } from '@/lib/storage/assets';
import type { Category, ItemVariant, MenuItem, Restaurant, RestaurantMenu } from './types';

export type DisplayModifierOption = {
  id: string;
  name: string;
  price: number;
};

export type DisplayModifierGroup = {
  id: string;
  name: string;
  type: 'single' | 'multi';
  required?: boolean;
  /** How many may be picked at once. Only meaningful for a multi group. */
  max?: number;
  options: DisplayModifierOption[];
};

export type DisplayItem = {
  id: string;
  name: string;
  desc: string;
  /** Rupees, for display only. The cart converts back to paise. */
  price: number;
  category: string;
  veg: boolean;
  available: boolean;
  img?: string;
  badge?: string;
  variants?: { id: string; name: string; price: number }[];
  /**
   * Add-on groups, from item_addon_groups and item_addons.
   *
   * Undefined when the dish has none -- not an empty array -- so the sheet can
   * tell "nothing to choose" from "a group with nothing in it", and stops
   * offering a customisation step that would lead nowhere.
   */
  modifiers?: DisplayModifierGroup[];
};

export type DisplayCategory = {
  id: string;
  name: string;
  count: number;
};

/**
 * The fields the locked screens read about the venue. Several have no column
 * in the database yet, so they fall back to the same placeholders the demo
 * uses rather than rendering blank or `undefined`.
 */
export type DisplayRestaurant = {
  /** Restaurant slug is used to preserve context between menu and item routes. */
  slug?: string;
  name: string;
  tagline: string;
  address: string;
  phone: string;
  gstin: string;
  fssai: string;
  currency: string;
  openHours: string;
  timezone: string;
  /**
   * Restaurant branding. All three are optional, and every consumer must treat
   * them that way: a restaurant that has never opened the branding screen is
   * the normal case on day one, and the menu has to look finished for it.
   *
   * `accent` is a palette KEY (`forest`, `terracotta`, ...), never a hex value
   * -- see lib/branding/palette.ts for why an owner cannot pick arbitrary
   * colour.
   */
  logoUrl?: string;
  bannerUrl?: string;
  accent?: string;
};

export function toDisplayItem(item: MenuItem): DisplayItem {
  const variants: { id: string; name: string; price: number }[] = (item.variants ?? []).map(
    (v: ItemVariant) => ({
      id: v.id,
      name: v.name,
      price: paiseToRupees(v.price_paise),
    }),
  );

  const modifiers = toDisplayModifiers(item);

  return {
    id: item.id,
    name: item.name,
    desc: item.description ?? '',
    price: paiseToRupees(item.price_paise),
    // An item with no category still has to appear under some tab. 'all' is
    // the screen's own catch-all id, so it lands there instead of vanishing.
    category: item.category_id ?? 'all',
    veg: item.is_veg,
    available: item.is_available,
    ...(item.image_url ? { img: item.image_url } : {}),
    ...(variants.length ? { variants } : {}),
    ...(modifiers.length ? { modifiers } : {}),
  };
}

/**
 * Add-on groups, in display units.
 *
 * A group with no available options is dropped rather than rendered empty: an
 * owner who retired every choice would otherwise leave guests facing a heading
 * with nothing under it.
 */
export function toDisplayModifiers(item: MenuItem): DisplayModifierGroup[] {
  return (item.addonGroups ?? [])
    .map((group) => {
      const options = group.addons
        .filter((addon) => addon.is_available)
        .map((addon) => ({
          id: addon.id,
          name: addon.name,
          price: paiseToRupees(addon.price_paise),
        }));

      const single = group.max_select <= 1;

      return {
        id: group.id,
        name: group.name,
        type: single ? 'single' : ('multi' as const),
        required: group.min_select > 0,
        max: group.max_select,
        options,
      } satisfies DisplayModifierGroup;
    })
    .filter((group) => group.options.length > 0);
}

export function toDisplayCategories(
  categories: Category[],
  items: MenuItem[]
): DisplayCategory[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.category_id) {
      counts.set(item.category_id, (counts.get(item.category_id) ?? 0) + 1);
    }
  }

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    count: counts.get(c.id) ?? 0,
  }));
}

export function toDisplayRestaurant(r: Restaurant): DisplayRestaurant {
  return {
    slug: r.slug,
    name: r.name,
    tagline: r.tagline ?? '',
    address: r.address ?? '',
    phone: r.phone ?? '',
    // The seed writes the literal string 'GSTIN — add in Settings' so the
    // placeholder is visible on a real receipt rather than silently blank.
    gstin: r.gstin ?? 'GSTIN — add in Settings',
    fssai: 'FSSAI — add in Settings',
    currency: 'INR',
    openHours: 'Hours — add in Settings',
    timezone: r.timezone,
    // Absent, not empty string: the header branches on truthiness to decide
    // between the banner layout and the paper layout, and '' would be a third
    // state that renders neither.
    ...(publicAssetUrl(r.logo_path) ? { logoUrl: publicAssetUrl(r.logo_path)! } : {}),
    ...(publicAssetUrl(r.banner_path) ? { bannerUrl: publicAssetUrl(r.banner_path)! } : {}),
    accent: r.accent || undefined,
  };
}

/** Convenience: adapt a whole RestaurantMenu in one call. */
export function toDisplayMenu(data: RestaurantMenu) {
  return {
    restaurant: toDisplayRestaurant(data.restaurant),
    /** The tabs. One entry means no tabs, which is most restaurants. */
    menus: data.menus,
    menuId: data.menu.id,
    menuName: data.menu.name,
    categories: toDisplayCategories(data.categories, data.items),
    items: data.items.map(toDisplayItem),
  };
}
