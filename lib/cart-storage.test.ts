import { describe, expect, it } from 'vitest';
import {
  addLine,
  cartKey,
  lineKey,
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

/**
 * A half plate and a full plate of the same dish are two lines, not one.
 *
 * This is the bug the variant work exists to fix. Collapsing lines by item id
 * meant adding "Full" after "Half" bumped the half's quantity to two and
 * charged the half's price for both -- the kitchen then had to ask which one
 * the guest actually wanted, which is the whole thing a portion picker is
 * supposed to prevent.
 */
describe('portions', () => {
  it('keeps two portions of one dish apart', () => {
    let lines = addLine([], 'i-1', 1, 'v-half');
    lines = addLine(lines, 'i-1', 1, 'v-full');
    expect(lines).toHaveLength(2);
  });

  it('merges a second helping of the same portion', () => {
    let lines = addLine([], 'i-1', 1, 'v-half');
    lines = addLine(lines, 'i-1', 2, 'v-half');
    expect(lines).toEqual([{ itemId: 'i-1', qty: 3, variantId: 'v-half' }]);
  });

  it('treats no portion as its own line, not as the first portion', () => {
    // A dish ordered without picking a portion is priced at the menu price.
    // It must not merge into an existing half or full line.
    let lines = addLine([], 'i-1', 1, 'v-half');
    lines = addLine(lines, 'i-1', 1);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({ itemId: 'i-1', qty: 1 });
  });

  it('changes the quantity of one portion without touching another', () => {
    let lines = addLine([], 'i-1', 1, 'v-half');
    lines = addLine(lines, 'i-1', 1, 'v-full');
    lines = setQty(lines, 'i-1', 5, 'v-full');
    expect(lines[0].qty).toBe(1);
    expect(lines[1].qty).toBe(5);
  });

  it('removes one portion and leaves the other', () => {
    let lines = addLine([], 'i-1', 1, 'v-half');
    lines = addLine(lines, 'i-1', 1, 'v-full');
    lines = removeLine(lines, 'i-1', 'v-half');
    expect(lines).toEqual([{ itemId: 'i-1', qty: 1, variantId: 'v-full' }]);
  });

  it('drops a line to zero quantity by removing it', () => {
    let lines = addLine([], 'i-1', 1, 'v-half');
    lines = setQty(lines, 'i-1', 0, 'v-half');
    expect(lines).toEqual([]);
  });

  it('survives a round trip through storage', () => {
    let lines = addLine([], 'i-1', 2, 'v-half');
    lines = addLine(lines, 'i-1', 1, 'v-full');
    expect(parseCart(serialiseCart(lines))).toEqual(lines);
  });

  it('discards a variant id that is not a string', () => {
    // A coerced id would resolve to some other dish's portion. Dropping it
    // prices the dish at its menu price, which is the safer of the two.
    const raw = JSON.stringify([{ itemId: 'i-1', qty: 1, variantId: 42 }]);
    expect(parseCart(raw)).toEqual([{ itemId: 'i-1', qty: 1 }]);
  });

  it('counts every portion towards the total', () => {
    let lines = addLine([], 'i-1', 2, 'v-half');
    lines = addLine(lines, 'i-1', 3, 'v-full');
    expect(totalQty(lines)).toBe(5);
  });

  it('gives the same key to the same portion and different keys to different ones', () => {
    expect(lineKey({ itemId: 'i-1', variantId: 'v-half' })).toBe(
      lineKey({ itemId: 'i-1', variantId: 'v-half' })
    );
    expect(lineKey({ itemId: 'i-1', variantId: 'v-half' })).not.toBe(
      lineKey({ itemId: 'i-1', variantId: 'v-full' })
    );
    // The separator has to survive a variant id containing it, or two
    // different items could collide onto one key.
    expect(lineKey({ itemId: 'i-1', variantId: undefined })).not.toBe(
      lineKey({ itemId: 'i-1|', variantId: undefined })
    );
  });
});

describe('add-ons', () => {
  it('keeps a plain naan and a naan with cheese as two lines', () => {
    let lines = addLine([], 'i-1');
    lines = addLine(lines, 'i-1', 1, undefined, ['a-cheese']);

    expect(lines).toHaveLength(2);
    expect(totalQty(lines)).toBe(2);
  });

  it('adds to the same line when the same extras are picked again', () => {
    let lines = addLine([], 'i-1', 1, undefined, ['a-cheese']);
    lines = addLine(lines, 'i-1', 1, undefined, ['a-cheese']);

    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(2);
  });

  it('treats the same extras in a different order as the same line', () => {
    let lines = addLine([], 'i-1', 1, undefined, ['a-cheese', 'a-butter']);
    lines = addLine(lines, 'i-1', 1, undefined, ['a-butter', 'a-cheese']);

    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(2);
  });

  it('refuses anything but strings as add-on ids', () => {
    // A number would coerce to some other add-on's id. Dropping it leaves the
    // dish plain, which is the safe direction.
    const raw = JSON.stringify([{ itemId: 'i-1', qty: 1, addonIds: [42, null, 'a-cheese'] }]);
    expect(parseCart(raw)).toEqual([{ itemId: 'i-1', qty: 1, addonIds: ['a-cheese'] }]);
  });

  it('reads a cart written before add-ons existed', () => {
    // Every cart in a guest's phone today is this shape. It must keep working.
    const raw = JSON.stringify([{ itemId: 'i-1', qty: 2, variantId: 'v-half' }]);
    expect(parseCart(raw)).toEqual([{ itemId: 'i-1', qty: 2, variantId: 'v-half' }]);
  });

  it('round-trips add-ons through storage', () => {
    const lines = addLine(addLine([], 'i-1', 2, 'v-half'), 'i-2', 1, undefined, ['a-1', 'a-2']);
    expect(parseCart(serialiseCart(lines))).toEqual(lines);
  });
});
