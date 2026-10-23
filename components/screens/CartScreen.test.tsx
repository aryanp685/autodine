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
    expect(html).toContain('data-cart-dock');
  });

  it('says the cart is empty once, and does not draw a zero bill beside it', () => {
    const html = renderToStaticMarkup(
      <Cart slug="maddi" restaurantName="Maddi" taxRateBps={500} items={items} />,
    );

    expect(html).toContain('Your cart is empty');
    expect(html).toContain('Open the menu');
    expect(html).not.toContain('/menu/checkout');
    // The empty card already explains itself and offers the menu. A bill
    // reading "Subtotal Rs 0 / Total Rs 0" under it was a second, worse
    // explanation of the same fact.
    expect(html).not.toContain('Bill summary');
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
    expect(html).toContain('data-cart-notice-action');
    expect(html).toContain('Remove it from my cart');
  });

  it('tells the guest which table the order is for, when one is known', () => {
    setLines([{ itemId: 'i1', qty: 1 }]);
    const withTable = renderToStaticMarkup(
      <Cart slug="maddi" items={items} tableLabel="T4" taxRateBps={500} />,
    );
    expect(withTable).toContain('T4');

    const without = renderToStaticMarkup(<Cart slug="maddi" items={items} taxRateBps={500} />);
    expect(without).not.toContain('data-flow-table');
  });

  it('does not call the cart empty before it has been read', () => {
    // The disabled "Cart is empty" button rendered while the stored cart was
    // still loading, next to the words "Loading your order…". Two opposite
    // statements, on the screen where the order is agreed.
    mocks.cart.ready = false;
    const html = renderToStaticMarkup(<Cart slug="maddi" items={items} taxRateBps={500} />);

    expect(html).toContain('Loading your order');
    expect(html).not.toContain('Cart is empty');
  });
});

/**
 * A failed order.
 *
 * The message used to float in a fixed banner over the top of the page, on top
 * of the guest's header, and repeated its own headline. Worse, it never said
 * whether the cart survived -- which is the only thing a guest wants to know
 * when an order does not go through.
 */
describe('Cart — a failed order', () => {
  it('says what happened to the cart and to the money', () => {
    const html = renderToStaticMarkup(
      <Cart items={[]} placedError="One of the dishes in your cart is no longer on this menu." />,
    );

    expect(html).toContain('data-place-error');
    expect(html).toContain('That order was not placed');
    expect(html).toContain('no longer on this menu');
    // The two facts that turn a dead end into a decision.
    expect(html).toMatch(/nothing has been charged/i);
    expect(html).toMatch(/cart is still here/i);
  });

  it('renders in the page, not over the guest’s header', () => {
    const html = renderToStaticMarkup(<Cart items={[]} placedError="Something broke." />);
    const at = html.indexOf('data-place-error');
    // The alert is a child of the flow, never a fixed overlay on top of it.
    const alertTag = html.slice(html.lastIndexOf('<div', at), at);
    expect(alertTag).not.toContain('fixed');
  });

  it('offers to dismiss the message without losing the order', () => {
    const html = renderToStaticMarkup(<Cart slug="kings-of-kings" items={[]} placedError="x" />);
    expect(html).toContain('href="/menu/cart?s=kings-of-kings"');
    expect(html).toContain('aria-label="Dismiss this message"');
  });

  it('says nothing at all when the last order went through', () => {
    expect(renderToStaticMarkup(<Cart items={[]} />)).not.toContain('data-place-error');
  });
});

/**
 * The number at the top of the page.
 *
 * It used to be `cart.count`: everything the browser remembers, including
 * dishes that sold out while the cart sat open. The bill below it was built
 * from the priced lines, so a cart of two dishes with one sold out read
 * "2 items" and charged for one -- a small disagreement, on the screen where
 * somebody decides whether to trust the total.
 */
describe('the cart says how many dishes it will actually order', () => {
  const soldOut = [
    { id: 'i1', name: 'Butter Chicken', pricePaise: 46900, isVeg: false, isAvailable: true },
    { id: 'i2', name: 'Laal Maas', pricePaise: 52000, isVeg: false, isAvailable: false },
  ];

  it('counts only the lines that are on the bill', () => {
    setLines([
      { itemId: 'i1', qty: 1 },
      { itemId: 'i2', qty: 1 },
    ]);

    const html = renderToStaticMarkup(
      <Cart slug="maddi" restaurantName="Maddi" taxRateBps={500} items={soldOut} />,
    );

    expect(html).toContain('Maddi · 1 item');
    expect(html).not.toContain('Maddi · 2 items');
    // And the one that is not counted is explained rather than hidden.
    expect(html).toMatch(/no longer available/);
  });
});

/**
 * The reference on a failed order.
 *
 * Every branch the guest can cause has its own sentence. What is left is the
 * unknown, and an unknown with nothing behind it is a screenshot and a shrug.
 * The five-character class is not the database's shape -- it says which kind of
 * refusal it was, so the next failure can be named instead of guessed.
 */
describe('the failure reference', () => {
  it('shows the class of failure when the action carried one', () => {
    setLines([{ itemId: 'i1', qty: 1 }]);

    const html = renderToStaticMarkup(
      <Cart
        slug="maddi"
        restaurantName="Maddi"
        taxRateBps={500}
        items={items}
        placedError="The kitchen’s system was busy for a moment."
        placedErrorCode="PGRST003"
      />,
    );

    expect(html).toContain('Reference PGRST003');
    expect(html).toContain('quote this to staff');
  });

  it('does not invent a reference when there is none', () => {
    setLines([{ itemId: 'i1', qty: 1 }]);

    const html = renderToStaticMarkup(
      <Cart slug="maddi" restaurantName="Maddi" taxRateBps={500} items={items} placedError="Nope." />,
    );

    expect(html).not.toContain('Reference');
  });
});
