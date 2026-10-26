import { describe, expect, it } from 'vitest';
import {
  forgetLastOrder,
  lastCartKey,
  lastOrderKey,
  orderHref,
  parseRememberedOrder,
  readLastCart,
  readLastOrder,
  rememberLastCart,
  rememberLastOrder,
  type StorageLike,
} from './guest-orders';

/**
 * The Orders tab is only as good as this pointer. Two failure modes matter:
 * a stored value that says it exists and then cannot be opened (a dead tab the
 * guest keeps pressing), and a read that throws while rendering the screen a
 * guest lands on seconds after paying.
 */

function memory(seed: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

/** A storage that behaves like Safari private mode: every write throws. */
const locked: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

const ORDER = { code: 'MA-K3F9Q', token: 'tok-123', placedAt: '2026-10-22T12:00:00.000Z' };

describe('the remembered order', () => {
  it('is scoped per restaurant', () => {
    const storage = memory();
    rememberLastOrder(storage, 'copper-pot', ORDER);
    rememberLastOrder(storage, 'maddi', { ...ORDER, code: 'MD-1' });

    expect(readLastOrder(storage, 'copper-pot')?.code).toBe('MA-K3F9Q');
    expect(readLastOrder(storage, 'maddi')?.code).toBe('MD-1');
    expect(readLastOrder(storage, 'somewhere-else')).toBeNull();
  });

  it('normalises the slug so a capitalised link still finds it', () => {
    const storage = memory();
    rememberLastOrder(storage, 'Copper-Pot', ORDER);
    expect(readLastOrder(storage, '  copper-pot ')).toEqual(ORDER);
    expect(lastOrderKey('COPPER-POT')).toBe('ad_last_order:copper-pot');
  });

  it('round-trips the token, which is the only way back into the order', () => {
    const storage = memory();
    rememberLastOrder(storage, 'r1', ORDER);
    expect(readLastOrder(storage, 'r1')?.token).toBe('tok-123');
  });

  it('forgets on request', () => {
    const storage = memory();
    rememberLastOrder(storage, 'r1', ORDER);
    forgetLastOrder(storage, 'r1');
    expect(readLastOrder(storage, 'r1')).toBeNull();
  });

  it('reports whether the write stuck instead of pretending', () => {
    expect(rememberLastOrder(memory(), 'r1', ORDER)).toBe(true);
    expect(rememberLastOrder(locked, 'r1', ORDER)).toBe(false);
  });

  /** Safari private mode must not take the confirmation screen down with it. */
  it('survives storage that throws on every call', () => {
    expect(readLastOrder(locked, 'r1')).toBeNull();
    expect(() => forgetLastOrder(locked, 'r1')).not.toThrow();
    expect(readLastOrder(null, 'r1')).toBeNull();
  });

  it('refuses junk rather than opening the wrong page', () => {
    expect(parseRememberedOrder(null)).toBeNull();
    expect(parseRememberedOrder('not json')).toBeNull();
    expect(parseRememberedOrder('"a string"')).toBeNull();
    expect(parseRememberedOrder('{}')).toBeNull();
    // A code with no token would render a button that cannot work.
    expect(parseRememberedOrder(JSON.stringify({ code: 'MA-1', placedAt: ORDER.placedAt }))).toBeNull();
    expect(parseRememberedOrder(JSON.stringify({ ...ORDER, placedAt: 'yesterday' }))).toBeNull();
    expect(parseRememberedOrder(JSON.stringify({ ...ORDER, code: '  ' }))).toBeNull();
  });

  it('drops a value written by an older build instead of crashing on it', () => {
    const storage = memory({ [lastOrderKey('r1')]: '{"code":7}' });
    expect(readLastOrder(storage, 'r1')).toBeNull();
  });

  it('builds the same URL the redirect after ordering uses', () => {
    const href = orderHref(ORDER, 'copper pot');
    expect(href.startsWith('/menu/order?')).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf('?')));
    expect(params.get('s')).toBe('copper pot');
    expect(params.get('code')).toBe('MA-K3F9Q');
    expect(params.get('t')).toBe('tok-123');
  });
});

/**
 * The remembered cart — what "order these again" is built on.
 *
 * It is the same bargain as the remembered order: a browser fact, scoped to one
 * restaurant, validated on the way back in, silent on every failure. What is
 * different is that this one holds dish ids, so the validation matters more —
 * a junk id would end up in an order.
 */
describe('the remembered cart', () => {
  function fakeStorage(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  }

  const cart = [
    { itemId: 'a1', qty: 2 },
    { itemId: 'b2', qty: 1, variantId: 'v1', addonIds: ['x', 'y'] },
  ];

  it('round-trips portions and add-ons, which is why the cart is used as the memory', () => {
    const storage = fakeStorage();
    rememberLastCart(storage, 'kings-of-kings', cart);

    expect(readLastCart(storage, 'kings-of-kings')).toEqual([
      { itemId: 'a1', qty: 2 },
      { itemId: 'b2', qty: 1, variantId: 'v1', addonIds: ['x', 'y'] },
    ]);
  });

  it('is scoped per restaurant, so one cart cannot cross kitchens', () => {
    const storage = fakeStorage();
    rememberLastCart(storage, 'kings-of-kings', cart);

    expect(readLastCart(storage, 'maddi')).toEqual([]);
  });

  it('normalises the slug, so a capitalised link still finds it', () => {
    const storage = fakeStorage();
    rememberLastCart(storage, 'Kings-Of-Kings', cart);

    expect(readLastCart(storage, 'kings-of-kings')).toHaveLength(2);
  });

  it('drops junk rather than putting it in an order', () => {
    const storage = fakeStorage();
    storage.setItem(
      lastCartKey('k'),
      JSON.stringify([
        { itemId: 'a1', qty: -4 },        // a negative quantity
        { itemId: 42, qty: 1 },            // not an id
        { qty: 3 },                        // no id at all
        { itemId: 'ok', qty: 1 },
      ]),
    );

    expect(readLastCart(storage, 'k')).toEqual([{ itemId: 'ok', qty: 1 }]);
  });

  it('treats an emptied list as a removal, not a stash', () => {
    const storage = fakeStorage();
    rememberLastCart(storage, 'k', cart);
    rememberLastCart(storage, 'k', []);

    expect(readLastCart(storage, 'k')).toEqual([]);
  });

  it('survives storage that throws on every call', () => {
    const angry: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };

    expect(() => rememberLastCart(angry, 'k', cart)).not.toThrow();
    expect(readLastCart(angry, 'k')).toEqual([]);
  });

  it('is a no-op without a restaurant, rather than writing to a global key', () => {
    const storage = fakeStorage();
    rememberLastCart(storage, '   ', cart);

    expect(storage.data.size).toBe(0);
  });
});
