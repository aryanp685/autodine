import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The cart, as the server renders it.
 *
 * WHAT THIS GUARDS
 *
 * Two things, both about being told the truth on the screen where money is
 * agreed.
 *
 * The tax note. It used to render for every guest -- including one sitting in
 * a real restaurant with a real GST rate -- and told them the tax they were
 * about to pay was "sample values for layout review". That sentence is true on
 * a demo menu with no rate and false on a live one, so it is now conditional
 * on exactly that.
 *
 * Dishes that went away. A line whose dish was deleted, or sold out, is named
 * in a notice rather than dropped silently: a bill that shrinks without a word
 * reads as a mistake, and the guest has no way to ask about it.
 */

const mocks = vi.hoisted(() => ({
  cart: {
    lines: [] as { itemId: string; qty: number; variantId?: string; addonIds?: string[] }[],
    count: 0,
    ready: true,
    add: () => {},
    remove: () => {},
    removeItems: () => {},
    setQty: () => {},
    clear: () => {},
  },
}));

vi.mock('@/components/CartProvider', () => ({
  useCart: () => mocks.cart,
}));

import { Cart } from './CartScreen';

const items = [
  {
    id: 'i1',
    name: 'Butter Chicken',
    pricePaise: 46900,
    isVeg: false,
    isAvailable: true,
  },
];

function setLines(lines: typeof mocks.cart.lines, count = 0) {
  mocks.cart.lines = lines;
  mocks.cart.count = count || lines.reduce((sum, line) => sum + line.qty, 0);
}

beforeEach(() => {
  setLines([], 0);
  // One test turns this off to prove the loading state; leaving it off would
  // make every later render look like a cart that has not been read yet.
  mocks.cart.ready = true;
});

describe('the cart bill', () => {
  it('shows the restaurant rate and does not call its own tax a sample', () => {
    setLines([{ itemId: 'i1', qty: 2 }]);

    const html = renderToStaticMarkup(
      <Cart slug="maddi" restaurantName="Maddi" taxRateBps={500} items={items} />,
    );

    // 5% GST, named as the rate rather than as "taxes".
    expect(html).toContain('Taxes (GST 5%)');
    expect(html).toContain('₹938');
    expect(html).toContain('₹985');
    // The old copy, and the reason this test exists.
    expect(html).not.toContain('sample values for layout review');
  });

  it('says the tax is a sample when the menu has no rate configured', () => {
    setLines([{ itemId: 'i1', qty: 1 }]);

    const html = renderToStaticMarkup(<Cart slug="maddi" restaurantName="Maddi" items={items} />);

    expect(html).toContain('no tax rate configured');
  });

  it('names a dish that is gone instead of quietly shrinking the bill', () => {
    setLines([{ itemId: 'i1', qty: 1 }]);
    mocks.cart.lines = [
      { itemId: 'i1', qty: 1 },
      { itemId: 'deleted-dish', qty: 1 },
    ];
    mocks.cart.count = 2;

    const html = renderToStaticMarkup(
      <Cart slug="maddi" restaurantName="Maddi" taxRateBps={500} items={items} />,
    );

    expect(html).toContain('no longer');
    expect(html).toContain('not on the bill');
  });
});

describe('the cart actions', () => {
  it('offers checkout when there is something to check out', () => {
    setLines([{ itemId: 'i1', qty: 1 }]);

    const html = renderToStaticMarkup(
      <Cart slug="maddi" restaurantName="Maddi" taxRateBps={500} items={items} />,
    );

    expect(html).toContain('href="/menu/checkout?s=maddi"');
    expect(html).toContain('Continue to checkout');
    // The phone bar is the same destination, with the number being decided on.
    expect(html).toContain('cart__bar');
  });

  it('shows an empty state and a disabled button rather than a checkout link', () => {
    const html = renderToStaticMarkup(
      <Cart slug="maddi" restaurantName="Maddi" taxRateBps={500} items={items} />,
    );

    expect(html).toContain('Your cart is empty');
    expect(html).toContain('Open the menu');
    expect(html).not.toContain('/menu/checkout');
    expect(html).toMatch(/class="cart__cta"[^>]*disabled/);
  });

  it('does not claim an order exists while localStorage is still being read', () => {
    mocks.cart.ready = false;
    setLines([{ itemId: 'i1', qty: 1 }]);
    mocks.cart.ready = false;

    const html = renderToStaticMarkup(
      <Cart slug="maddi" restaurantName="Maddi" taxRateBps={500} items={items} />,
    );

    expect(html).toContain('Loading your order');
    expect(html).not.toContain('Your cart is empty');
  });

  it('offers one checkout button, not two', () => {
    setLines([{ itemId: 'i1', qty: 1 }]);
    const html = renderToStaticMarkup(<Cart slug="maddi" items={items} taxRateBps={500} />);

    // The dock is the only route to checkout: the summary used to carry a
    // second identical button that was hidden below 900px, which meant the
    // two widths disagreed about how many actions the screen had.
    expect(html.match(/Continue to checkout/g)).toHaveLength(1);
  });

  it('lets the guest clear dishes that no longer exist', () => {
    mocks.cart.lines = [{ itemId: 'gone', qty: 2 }];
    mocks.cart.count = 2;
    const html = renderToStaticMarkup(<Cart slug="maddi" items={items} taxRateBps={500} />);

    // The notice used to be permanent: the dead ids stayed in localStorage, so
    // every visit found them again and warned about them again.
    expect(html).toContain('no longer available');
    expect(html).toContain('cart__noticeBtn');
    expect(html).toContain('Remove it from my cart');
  });

  it('tells the guest which table the order is for, when one is known', () => {
    setLines([{ itemId: 'i1', qty: 1 }]);
    const withTable = renderToStaticMarkup(
      <Cart slug="maddi" items={items} tableLabel="T4" taxRateBps={500} />,
    );
    expect(withTable).toContain('T4');

    const without = renderToStaticMarkup(<Cart slug="maddi" items={items} taxRateBps={500} />);
    expect(without).not.toContain('flow__table');
  });
});
