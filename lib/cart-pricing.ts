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

export type MenuItemPrice = {
  id: string;
  name: string;
  /** Paise, as stored. Never a float. */
  pricePaise: Paise;
  isVeg: boolean;
  isAvailable: boolean;
};

export type PricedLine = {
  itemId: string;
  name: string;
  unitPricePaise: Paise;
  qty: number;
  isVeg: boolean;
  lineTotalPaise: Paise;
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
  subtotalPaise: Paise;
  totals: OrderTotals;
};

export function priceCart(
  stored: StoredLine[],
  items: MenuItemPrice[],
  taxRateBps?: number
): PricedCart {
  const byId = new Map(items.map((i) => [i.id, i]));

  const lines: PricedLine[] = [];
  const missingIds: string[] = [];
  const unavailableIds: string[] = [];

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

    lines.push({
      itemId: item.id,
      name: item.name,
      unitPricePaise: item.pricePaise,
      qty: line.qty,
      isVeg: item.isVeg,
      lineTotalPaise: item.pricePaise * line.qty,
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
    subtotalPaise: totals.subtotalPaise,
    totals,
  };
}
