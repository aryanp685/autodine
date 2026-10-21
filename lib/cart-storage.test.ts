import { describe, expect, it } from 'vitest';
import {
  addLine,
  cartKey,
  parseCart,
  removeLine,
  serialiseCart,
  setQty,
  totalQty,
} from './cart-storage';

/**
 * localStorage is the customer's to edit, so everything read back from it is
 * treated as hostile. A corrupt cart should look like an emptier cart, never
 * like a broken page.
 */
describe('parseCart', () => {
  it('reads a cart that was written by this app', () => {
    const raw = serialiseCart([
      { itemId: 'i-1', qty: 2 },
      { itemId: 'i-2', qty: 1 },
    ]);
    expect(parseCart(raw)).toEqual([
      { itemId: 'i-1', qty: 2 },
      { itemId: 'i-2', qty: 1 },
    ]);
  });

  it('returns empty for anything that is not a cart', () => {
    for (const raw of [null, '', 'not json', '{}', '42', '"i-1"']) {
      expect(parseCart(raw)).toEqual([]);
    }
  });

  it('drops entries that are not well-formed lines', () => {
    const raw = JSON.stringify([
      { itemId: 'i-1', qty: 2 },
      null,
      'i-2',
      { itemId: 'i-3' },
      { qty: 1 },
      { itemId: 'i-4', qty: 'two' },
      { itemId: 'i-5', qty: 1.5 },
    ]);
    expect(parseCart(raw)).toEqual([{ itemId: 'i-1', qty: 2 }]);
  });

  it('rejects a zero or negative quantity', () => {
    const raw = JSON.stringify([
      { itemId: 'a', qty: 0 },
      { itemId: 'b', qty: -4 },
    ]);
    expect(parseCart(raw)).toEqual([]);
  });

  it('keeps one line per item, so a duplicated id cannot inflate the quantity', () => {
    const raw = JSON.stringify([
      { itemId: 'i-1', qty: 1 },
      { itemId: 'i-1', qty: 99 },
    ]);
    expect(parseCart(raw)).toEqual([{ itemId: 'i-1', qty: 1 }]);
  });

  it('caps an absurd quantity', () => {
    const raw = JSON.stringify([{ itemId: 'i-1', qty: 100000 }]);
    expect(parseCart(raw)).toEqual([]);
  });
});

describe('cart changes', () => {
  it('adds a new line and bumps an existing one', () => {
    const after = addLine([], 'i-1');
    expect(after).toEqual([{ itemId: 'i-1', qty: 1 }]);
    expect(addLine(after, 'i-1')).toEqual([{ itemId: 'i-1', qty: 2 }]);
  });

  it('removes the line when the quantity goes to zero', () => {
    const lines = [{ itemId: 'i-1', qty: 1 }];
    expect(setQty(lines, 'i-1', 0)).toEqual([]);
    expect(setQty(lines, 'i-1', -3)).toEqual([]);
  });

  it('removes by id', () => {
    const lines = [
      { itemId: 'i-1', qty: 1 },
      { itemId: 'i-2', qty: 1 },
    ];
    expect(removeLine(lines, 'i-1')).toEqual([{ itemId: 'i-2', qty: 1 }]);
  });

  it('counts total items, not lines', () => {
    expect(
      totalQty([
        { itemId: 'i-1', qty: 3 },
        { itemId: 'i-2', qty: 2 },
      ])
    ).toBe(5);
  });
});

describe('cartKey', () => {
  it('keys the cart by restaurant so dishes cannot follow a diner between kitchens', () => {
    expect(cartKey('maddi')).not.toBe(cartKey('kings-of-kings'));
    expect(cartKey('maddi')).toContain('maddi');
  });
});
