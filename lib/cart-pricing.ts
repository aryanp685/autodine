import { computeOrderTotals, type OrderTotals } from './pricing';
import type { Paise } from './money';
import type { StoredLine } from './cart-storage';

/**
 * Joins what the browser remembers (item ids and quantities) with what the
 * database says (names, prices, availability).
 *
 * This split is the whole point. The cart in localStorage holds no money at
 * all, so there is no number there for a customer to change. Every price on
 * the cart and on the order comes from this join, against rows read from the
 * database.
 */

/**
 * One add-on the guest may pick for a dish.
 *
 * `groupId` and `maxSelect` describe the OTHER rows it competes with: extras
 * in one group share a limit ("pick up to 2 sauces"). An add-on with no group
 * is its own group of one.
 */
export type MenuAddon = {
  id: string;
  name: string;
  pricePaise: Paise;
  groupId?: string;
  maxSelect?: number;
};

export type MenuItemPrice = {
  id: string;
  name: string;
  /** Paise, as stored. Never a float. */
  pricePaise: Paise;
  isVeg: boolean;
  isAvailable: boolean;
  /** What can be added to this dish, and what each costs. */
  addons?: MenuAddon[];
  /**
   * The portions this dish comes in, when it has any.
   *
   * Absent or empty means the dish is sold one way, at `pricePaise`. A dish
   * is never assumed to have portions; the menu either says it does or it
   * does not.
   */
  variants?: { id: string; name: string; pricePaise: Paise }[];
};

export type PricedLine = {
  itemId: string;
  name: string;
  unitPricePaise: Paise;
  qty: number;
  isVeg: boolean;
  lineTotalPaise: Paise;
  /** Which portion, when the dish has portions and one was chosen. */
  variantId?: string;
  variantName?: string;
  /** The add-ons that were picked and still exist, in the order chosen. */
  addonIds?: string[];
  addonNames?: string[];
  /** What those add-ons add to ONE unit, in paise. */
  addonPaise?: Paise;
};

export type PricedCart = {
  lines: PricedLine[];
  /**
   * Items in the cart that no longer exist on the menu -- deleted since the
   * cart was filled, or belonging to a different restaurant.
   */
  missingIds: string[];
  /** Items that exist but are sold out right now. */
  unavailableIds: string[];
  /**
   * Cart lines whose chosen portion no longer exists.
   *
   * These are kept, priced at the dish's menu price, and listed here -- not
   * dropped. Dropping them would lose a sale because a menu changed out from
   * under an open cart, and pricing them silently would take money for
   * something the guest did not pick. Flagging them lets the cart say so in
   * as many words before anyone pays.
   */
  staleVariantIds: string[];
  /**
   * Add-on ids on the cart that no longer exist on that dish.
   *
   * Priced without them and listed here, for the same reason a stale portion
   * is kept rather than dropped: a menu edited under an open cart must not
   * quietly charge for something that is gone, nor throw the line away.
   */
  staleAddonIds: string[];
  subtotalPaise: Paise;
  totals: OrderTotals;
};

/**
 * Which of the chosen add-ons count, and what they cost per unit.
 *
 * The rule mirrors place_public_order exactly, because a cart that prices one
 * way and a till that charges another is the dispute this file exists to
 * avoid:
 *
 *   - an id that is not on this dish is dropped and reported as stale
 *   - picks beyond a group's maxSelect are dropped, in the order they were
 *     chosen, never charged
 *   - a surviving pick adds its own price to one plate
 */
export function resolveAddons(
  addonIds: string[] | undefined,
  addons: MenuAddon[] | undefined
): { ids: string[]; names: string[]; pricePaise: Paise; staleIds: string[] } {
  const chosen = addonIds ?? [];
  if (chosen.length === 0) return { ids: [], names: [], pricePaise: 0, staleIds: [] };

  const byId = new Map((addons ?? []).map((a) => [a.id, a]));
  const usedPerGroup = new Map<string, number>();

  const ids: string[] = [];
  const names: string[] = [];
  const staleIds: string[] = [];
  let pricePaise = 0;

  for (const id of chosen) {
    const addon = byId.get(id);
    if (!addon) {
      staleIds.push(id);
      continue;
    }

    const group = addon.groupId ?? addon.id;
    const used = usedPerGroup.get(group) ?? 0;
    if (used >= (addon.maxSelect ?? 1)) continue;

    usedPerGroup.set(group, used + 1);
    ids.push(addon.id);
    names.push(addon.name);
    pricePaise += addon.pricePaise;
  }

  return { ids, names, pricePaise, staleIds };
}

export function priceCart(
  stored: StoredLine[],
  items: MenuItemPrice[],
  taxRateBps?: number
): PricedCart {
  const byId = new Map(items.map((i) => [i.id, i]));

  const lines: PricedLine[] = [];
  const missingIds: string[] = [];
  const unavailableIds: string[] = [];
  const staleVariantIds: string[] = [];
  const staleAddonIds: string[] = [];

  for (const line of stored) {
    const item = byId.get(line.itemId);

    // A id that resolves to nothing is dropped rather than priced at zero --
    // an unknown dish on a bill is worse than a missing row on a cart.
    if (!item) {
      missingIds.push(line.itemId);
      continue;
    }

    if (!item.isAvailable) {
      unavailableIds.push(line.itemId);
      continue;
    }

    // Resolve the chosen portion. Three outcomes, and only the first is the
    // normal one:
    //
    //   no variant asked for   -> the dish's own price
    //   variant found          -> that portion's price
    //   variant asked, missing -> the dish's own price, and flagged
    //
    // The third is not an error to throw on. Menus change while carts sit
    // open; a portion deleted ten minutes ago should not turn a full cart
    // into an empty one.
    let unitPricePaise = item.pricePaise;
    let variantName: string | undefined;

    if (line.variantId) {
      const variant = (item.variants ?? []).find((v) => v.id === line.variantId);
      if (variant) {
        unitPricePaise = variant.pricePaise;
        variantName = variant.name;
      } else {
        staleVariantIds.push(line.variantId);
      }
    }

    // Add-ons ride on the unit price, not the line total: two plates with
    // extra cheese is two extras. resolveAddons is the single rule, shared
    // with the till.
    const addons = resolveAddons(line.addonIds, item.addons);
    staleAddonIds.push(...addons.staleIds);
    unitPricePaise += addons.pricePaise;

    lines.push({
      itemId: item.id,
      name: item.name,
      unitPricePaise,
      qty: line.qty,
      isVeg: item.isVeg,
      lineTotalPaise: unitPricePaise * line.qty,
      ...(line.variantId ? { variantId: line.variantId } : {}),
      ...(variantName ? { variantName } : {}),
      ...(addons.ids.length
        ? { addonIds: addons.ids, addonNames: addons.names, addonPaise: addons.pricePaise }
        : {}),
    });
  }

  const totals = computeOrderTotals({
    lines: lines.map((l) => ({ unitPricePaise: l.unitPricePaise, qty: l.qty })),
    ...(taxRateBps === undefined ? {} : { taxRateBps }),
  });

  return {
    lines,
    missingIds,
    unavailableIds,
    staleVariantIds,
    staleAddonIds,
    subtotalPaise: totals.subtotalPaise,
    totals,
  };
}
