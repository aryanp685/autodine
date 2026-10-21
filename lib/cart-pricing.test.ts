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
