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
   * Add-on groups. The database has no modifier concept yet, so this is
   * always undefined for real menus -- the screens fall back to built-in
   * presets. Defined here rather than omitted so that type stays honest about
   * what the screens read.
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
  /** Owner-configured tax in basis points; zero means no tax line. */
  taxRateBps: number;
};

export function toDisplayItem(item: MenuItem): DisplayItem {
  const variants: { id: string; name: string; price: number }[] = (item.variants ?? []).map(
    (v: ItemVariant) => ({
      id: v.id,
      name: v.name,
      price: paiseToRupees(v.price_paise),
    }),
  );

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
  };
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
    taxRateBps: r.tax_rate_bps,
  };
}

/** Convenience: adapt a whole RestaurantMenu in one call. */
export function toDisplayMenu(data: RestaurantMenu) {
  return {
    restaurant: toDisplayRestaurant(data.restaurant),
    categories: toDisplayCategories(data.categories, data.items),
    items: data.items.map(toDisplayItem),
  };
}
