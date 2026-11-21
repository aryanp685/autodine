import { describe, expect, it } from 'vitest';
import { priceCart, type MenuItemPrice } from './cart-pricing';

/**
 * The join between "what the browser remembers" and "what the database says".
 *
 * The cart holds ids and quantities and nothing else, so this is where a dish
 * becomes an amount. It is also where a stale cart meets a menu that has moved
 * on since it was filled.
 */

const item = (
  id: string,
  name: string,
  pricePaise: number,
  over: Partial<MenuItemPrice> = {}
): MenuItemPrice => ({
  id,
  name,
  pricePaise,
  isVeg: true,
  isAvailable: true,
  ...over,
});

const menu = [
  item('i-1', 'Paneer Tikka', 32000),
  item('i-2', 'Butter Chicken', 42000, { isVeg: false }),
  item('i-3', 'Masala Papad', 9000, { isAvailable: false }),
];

describe('priceCart', () => {
  it('prices a cart from the menu, not from anything the browser sent', () => {
    const cart = priceCart(
      [
        { itemId: 'i-1', qty: 2 },
        { itemId: 'i-2', qty: 1 },
      ],
      menu
    );

    expect(cart.lines).toEqual([
      { itemId: 'i-1', name: 'Paneer Tikka', unitPricePaise: 32000, qty: 2, isVeg: true, lineTotalPaise: 64000 },
      { itemId: 'i-2', name: 'Butter Chicken', unitPricePaise: 42000, qty: 1, isVeg: false, lineTotalPaise: 42000 },
    ]);
    expect(cart.subtotalPaise).toBe(106000);
  });

  it('drops an item that is no longer on the menu rather than pricing it at zero', () => {
    // Deleted since the cart was filled. A line reading "₹0" on a bill is
    // worse than a line that is simply not there.
    const cart = priceCart([{ itemId: 'gone', qty: 1 }, { itemId: 'i-1', qty: 1 }], menu);

    expect(cart.lines).toHaveLength(1);
    expect(cart.missingIds).toEqual(['gone']);
    expect(cart.subtotalPaise).toBe(32000);
  });

  it('holds a sold-out item out of the total but says so separately', () => {
    const cart = priceCart([{ itemId: 'i-3', qty: 2 }, { itemId: 'i-1', qty: 1 }], menu);

    expect(cart.lines).toHaveLength(1);
    expect(cart.unavailableIds).toEqual(['i-3']);
    expect(cart.subtotalPaise).toBe(32000);
  });

  it('returns an empty, zeroed cart when nothing is in it', () => {
    const cart = priceCart([], menu);

    expect(cart.lines).toEqual([]);
    expect(cart.subtotalPaise).toBe(0);
    expect(cart.totals.totalPaise).toBe(0);
  });

  it('keeps totals in whole paise', () => {
    const cart = priceCart([{ itemId: 'i-2', qty: 3 }], menu);
    expect(Number.isInteger(cart.totals.totalPaise)).toBe(true);
  });

  it('produces totals the orders table will accept', () => {
    // The database carries orders_math_check: total = (subtotal - discount) +
    // tax. An order that does not satisfy it is rejected at the insert, which
    // is the worst possible place to discover an arithmetic bug -- the diner
    // has already pressed the button.
    for (const qty of [1, 2, 3, 7, 11]) {
      const cart = priceCart([{ itemId: 'i-1', qty }, { itemId: 'i-2', qty }], menu);
      const { subtotalPaise, discountPaise, taxPaise, totalPaise } = cart.totals;
      expect(totalPaise).toBe(subtotalPaise - discountPaise + taxPaise);
    }
  });

  it('prices with the restaurant rate, not the sample one', () => {
    // maddi sits at 1800 bps (18% GST) while lib/pricing.ts carries a 500 bps
    // sample. A cart that used the sample would show a guest one total and
    // write another -- undercharging by more than a tenth of the order.
    const atDefault = priceCart([{ itemId: 'i-1', qty: 1 }], menu);
    const atEighteen = priceCart([{ itemId: 'i-1', qty: 1 }], menu, 1800);

    expect(atDefault.totals.taxPaise).toBe(1600); // 5% of 32000
    expect(atEighteen.totals.taxPaise).toBe(5760); // 18% of 32000
    expect(atEighteen.totals.totalPaise).toBeGreaterThan(atDefault.totals.totalPaise);
  });

  it('separates GST into CGST and SGST halves', () => {
    const cart = priceCart([{ itemId: 'i-1', qty: 1 }], menu);
    expect(cart.totals.cgstPaise + cart.totals.sgstPaise).toBe(cart.totals.taxPaise);
  });
});

/**
 * Charging for the portion that was actually chosen.
 *
 * Before this, the sheet offered "Half Rs 250" and "Full Rs 469", let the
 * guest pick, and billed the base price either way. The guest was told the
 * choice was free and then charged for the expensive one -- a till dispute
 * waiting to happen on every dish with portions.
 */
describe('variant pricing', () => {
  const butterChicken: MenuItemPrice = {
    id: 'i-1',
    name: 'Butter Chicken',
    pricePaise: 46900,
    isVeg: false,
    isAvailable: true,
    variants: [
      { id: 'v-half', name: 'Half', pricePaise: 25000 },
      { id: 'v-full', name: 'Full', pricePaise: 46900 },
    ],
  };

  it('charges the chosen portion, not the menu price', () => {
    const cart = priceCart([{ itemId: 'i-1', qty: 1, variantId: 'v-half' }], [butterChicken], 0);
    expect(cart.lines[0].unitPricePaise).toBe(25000);
    expect(cart.subtotalPaise).toBe(25000);
  });

  it('charges two portions of the same dish at their own prices', () => {
    // The regression this whole change exists for: two lines, two prices.
    const cart = priceCart(
      [
        { itemId: 'i-1', qty: 1, variantId: 'v-half' },
        { itemId: 'i-1', qty: 1, variantId: 'v-full' },
      ],
      [butterChicken],
      0
    );
    expect(cart.subtotalPaise).toBe(25000 + 46900);
  });

  it('multiplies the portion price by the quantity', () => {
    const cart = priceCart([{ itemId: 'i-1', qty: 3, variantId: 'v-half' }], [butterChicken], 0);
    expect(cart.lines[0].lineTotalPaise).toBe(75000);
  });

  it('uses the menu price when no portion was chosen', () => {
    const cart = priceCart([{ itemId: 'i-1', qty: 1 }], [butterChicken], 0);
    expect(cart.lines[0].unitPricePaise).toBe(46900);
    expect(cart.lines[0].variantName).toBeUndefined();
  });

  it('carries the portion name through so the cart can show it', () => {
    const cart = priceCart([{ itemId: 'i-1', qty: 1, variantId: 'v-half' }], [butterChicken], 0);
    expect(cart.lines[0].variantName).toBe('Half');
  });

  it('uses the menu price for a dish with no portions', () => {
    const plain: MenuItemPrice = {
      id: 'i-2',
      name: 'Plain Rice',
      pricePaise: 9000,
      isVeg: true,
      isAvailable: true,
    };
    const cart = priceCart([{ itemId: 'i-2', qty: 2 }], [plain], 0);
    expect(cart.subtotalPaise).toBe(18000);
  });

  it('prices a vanished portion at the menu price and says so', () => {
    // The portion was deleted while the cart sat open. Dropping the line
    // would empty a cart over a menu change; charging it silently would take
    // money for something nobody chose.
    const cart = priceCart(
      [{ itemId: 'i-1', qty: 1, variantId: 'v-gone' }],
      [butterChicken],
      0
    );
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].unitPricePaise).toBe(46900);
    expect(cart.staleVariantIds).toEqual(['v-gone']);
  });

  it('does not flag anything when every portion resolves', () => {
    const cart = priceCart([{ itemId: 'i-1', qty: 1, variantId: 'v-full' }], [butterChicken], 0);
    expect(cart.staleVariantIds).toEqual([]);
  });

  it('taxes the portion price', () => {
    // 18% of Rs 250 is Rs 45.
    const cart = priceCart([{ itemId: 'i-1', qty: 1, variantId: 'v-half' }], [butterChicken], 1800);
    expect(cart.totals.taxPaise).toBe(4500);
    expect(cart.totals.totalPaise).toBe(29500);
  });

  it('still refuses a portion on a dish that is sold out', () => {
    const soldOut = { ...butterChicken, isAvailable: false };
    const cart = priceCart([{ itemId: 'i-1', qty: 1, variantId: 'v-half' }], [soldOut], 0);
    expect(cart.unavailableIds).toEqual(['i-1']);
    expect(cart.lines).toEqual([]);
  });

  it('ignores a portion belonging to a different dish', () => {
    // A hand-edited cart could name another dish's portion id. It is not on
    // this dish's list, so it resolves to nothing and is flagged -- it must
    // never pick up another dish's price.
    const other: MenuItemPrice = {
      id: 'i-9',
      name: 'Lamb Rogan Josh',
      pricePaise: 62000,
      isVeg: false,
      isAvailable: true,
      variants: [{ id: 'v-lamb-half', name: 'Half', pricePaise: 33000 }],
    };
    const cart = priceCart(
      [{ itemId: 'i-1', qty: 1, variantId: 'v-lamb-half' }],
      [butterChicken, other],
      0
    );
    expect(cart.lines[0].unitPricePaise).toBe(46900);
    expect(cart.staleVariantIds).toEqual(['v-lamb-half']);
  });
});

describe('add-on pricing', () => {
  /**
   * Add-ons are per plate and priced from the menu, exactly like the dish.
   * The cart carries ids; these rows carry the money.
   */
  const dish = item('i-1', 'Butter Naan', 8000, {
    addons: [
      { id: 'a-cheese', name: 'Extra cheese', pricePaise: 4000, groupId: 'g-extra', maxSelect: 2 },
      { id: 'a-butter', name: 'Extra butter', pricePaise: 2000, groupId: 'g-extra', maxSelect: 2 },
      { id: 'a-jain', name: 'Jain', pricePaise: 0, groupId: 'g-jain', maxSelect: 1 },
    ],
  });

  it('adds the add-on to one plate, not to the whole line', () => {
    const cart = priceCart([{ itemId: 'i-1', qty: 3, addonIds: ['a-cheese'] }], [dish], 0);

    expect(cart.lines[0].unitPricePaise).toBe(12000);
    expect(cart.lines[0].lineTotalPaise).toBe(36000);
    expect(cart.lines[0].addonNames).toEqual(['Extra cheese']);
  });

  it('charges nothing for a free add-on, and still records it', () => {
    // "Jain" is a Rs 0 instruction the kitchen must see. A zero price is a
    // price, not a missing one.
    const cart = priceCart([{ itemId: 'i-1', qty: 1, addonIds: ['a-jain'] }], [dish], 0);

    expect(cart.lines[0].unitPricePaise).toBe(8000);
    expect(cart.lines[0].addonNames).toEqual(['Jain']);
  });

  it('keeps two add-ons from the same group when the owner allows two', () => {
    const cart = priceCart(
      [{ itemId: 'i-1', qty: 1, addonIds: ['a-cheese', 'a-butter'] }],
      [dish],
      0
    );

    expect(cart.lines[0].unitPricePaise).toBe(14000);
    expect(cart.lines[0].addonNames).toEqual(['Extra cheese', 'Extra butter']);
    expect(cart.staleAddonIds).toEqual([]);
  });

  it('never charges for more picks than the group allows', () => {
    // The limit lives on the group, and the till applies it too -- a cart
    // that prices one way and a bill that charges another is the dispute
    // this module exists to prevent.
    const strict = item('i-1', 'Butter Naan', 8000, {
      addons: [
        { id: 'a-1', name: 'One', pricePaise: 1000, groupId: 'g', maxSelect: 1 },
        { id: 'a-2', name: 'Two', pricePaise: 1000, groupId: 'g', maxSelect: 1 },
      ],
    });

    const cart = priceCart([{ itemId: 'i-1', qty: 1, addonIds: ['a-1', 'a-2'] }], [strict], 0);

    expect(cart.lines[0].unitPricePaise).toBe(9000);
    expect(cart.lines[0].addonNames).toEqual(['One']);
  });

  it('flags an add-on that is no longer on the dish instead of charging for it', () => {
    const cart = priceCart(
      [{ itemId: 'i-1', qty: 1, addonIds: ['a-deleted'] }],
      [dish],
      0
    );

    expect(cart.lines[0].unitPricePaise).toBe(8000);
    expect(cart.staleAddonIds).toEqual(['a-deleted']);
  });

  it('prices a line with no add-ons exactly as it did before they existed', () => {
    const cart = priceCart([{ itemId: 'i-1', qty: 2 }], [dish], 0);

    expect(cart.lines[0].unitPricePaise).toBe(8000);
    expect(cart.lines[0].addonNames).toBeUndefined();
    expect(cart.staleAddonIds).toEqual([]);
  });

  it('taxes the add-on', () => {
    const cart = priceCart([{ itemId: 'i-1', qty: 1, addonIds: ['a-cheese'] }], [dish], 1800);

    // 18% of Rs 120 is Rs 21.60 -> 2160 paise (rounded once, at the tax step).
    expect(cart.totals.subtotalPaise).toBe(12000);
    expect(cart.totals.taxPaise).toBe(2160);
  });

  it('stacks a portion and an add-on on the same plate', () => {
    const sized = item('i-2', 'Butter Chicken', 42000, {
      variants: [
        { id: 'v-half', name: 'Half', pricePaise: 25000 },
        { id: 'v-full', name: 'Full', pricePaise: 46900 },
      ],
      addons: [{ id: 'a-cheese', name: 'Extra cheese', pricePaise: 4000, groupId: 'g', maxSelect: 1 }],
    });

    const cart = priceCart(
      [{ itemId: 'i-2', qty: 2, variantId: 'v-half', addonIds: ['a-cheese'] }],
      [sized],
      0
    );

    expect(cart.lines[0].unitPricePaise).toBe(29000);
    expect(cart.lines[0].lineTotalPaise).toBe(58000);
    expect(cart.lines[0].variantName).toBe('Half');
  });
});
