import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Checkout } from './CheckoutScreen';

/**
 * The checkout, as the server renders it.
 *
 * WHAT THIS GUARDS
 *
 * The payment step used to be a pair of cards -- "Pay at counter" already
 * selected and unclickable, beside "Pay online" greyed out. Two dead controls
 * at the moment of paying read as a page that does not work, and a guest taps
 * the second one and gives up. There is no method to choose here (an order has
 * to exist before it can be paid for), so the screen states the one thing that
 * will happen.
 *
 * Also pinned: the phone-only action bar carries the total and submits the
 * same form, because on a narrow screen the bill sits below the order.
 */

const mocks = vi.hoisted(() => ({
  cart: {
    lines: [{ itemId: 'i1', qty: 2, variantId: undefined, addonIds: [] }],
    count: 2,
    ready: true,
    add: () => {},
    remove: () => {},
    setQty: () => {},
    clear: () => {},
  },
}));

vi.mock('@/components/CartProvider', () => ({
  useCart: () => mocks.cart,
}));

// A server action: importing the real module would pull in the Supabase server
// client and the `server-only` marker, neither of which this test is about.
vi.mock('@/app/menu/checkout/actions', () => ({
  placeOrderAction: () => Promise.resolve(),
}));

const items = [
  {
    id: 'i1',
    name: 'Butter Chicken',
    pricePaise: 46900,
    isVeg: false,
    isAvailable: true,
  },
];

const render = (onlinePaymentAvailable = false) =>
  renderToStaticMarkup(
    <Checkout
      slug="maddi"
      restaurantName="Maddi"
      taxRateBps={500}
      items={items}
      onlinePaymentAvailable={onlinePaymentAvailable}
    />,
  );

describe('checkout payment step', () => {
  it('states one way to pay instead of offering two dead buttons', () => {
    const html = render();

    expect(html).toContain('How you will pay');
    expect(html).toContain('At the counter');
    // Nothing here is a control the guest could try and fail to use.
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('Not available here');
    expect(html).toMatch(/data-co-pay/);
  });

  it('says what happens to the order while the bill is unpaid', () => {
    const html = render();
    expect(html).toContain('goes to the kitchen straight away');
    expect(html).toContain('marked payment pending');
  });

  it('mentions card and UPI online only when the server said it is offered', () => {
    expect(render(false)).not.toContain('online, on the order page');
    expect(render(true)).toContain('online, on the order page');
  });
});

describe('checkout action bar', () => {
  it('carries the total and submits the same order form', () => {
    const html = render();

    expect(html).toContain('data-co-bar');
    expect(html).toContain('form="co-place-order"');
    // The total appears in the bar as well as the bill, so the guest deciding
    // at the bottom of a long order sees the number they are agreeing to.
    expect(html).toMatch(/data-co-bar[\s\S]*?₹985/);
  });

  it('is not rendered when there is nothing to order', () => {
    mocks.cart = { ...mocks.cart, lines: [], count: 0 };
    const html = render();
    expect(html).not.toContain('data-co-bar');

    // Restore for any later test in this file.
    mocks.cart = {
      ...mocks.cart,
      lines: [{ itemId: 'i1', qty: 2, variantId: undefined, addonIds: [] }],
      count: 2,
    };
  });

  it('keeps both Place order buttons inside the one form', () => {
    // They have to share the form for useFormStatus to make them agree about
    // being busy. Two independent submits meant a second tap could write a
    // second order while the first was still being priced.
    const html = renderToStaticMarkup(<Checkout slug="maddi" items={items} taxRateBps={500} />);
    const formOpen = html.indexOf('<form id="co-place-order"');
    const dock = html.indexOf('data-co-bar');
    const formClose = html.lastIndexOf('</form>');

    expect(formOpen).toBeGreaterThan(-1);
    expect(dock).toBeGreaterThan(formOpen);
    expect(formClose).toBeGreaterThan(dock);
    expect(html.match(/form="co-place-order"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('shows the step the guest is on, not just the word checkout', () => {
    const html = renderToStaticMarkup(<Checkout slug="maddi" items={items} taxRateBps={500} />);
    expect(html).toContain('data-flow-steps');
    expect(html).toMatch(/data-flow-step="now"[^>]*aria-current="step"[^>]*>\s*<span class="sr-only">Pay/);
  });

  it('says a dish sold out instead of quietly shrinking the bill', () => {
    // priceCart drops an unavailable dish because it cannot be ordered. On the
    // last screen before the money, dropping it in silence left the guest
    // looking at a total that had got smaller for no stated reason.
    mocks.cart.lines = [{ itemId: 'i1', qty: 1, variantId: undefined, addonIds: [] }];
    mocks.cart.count = 1;
    try {
      const html = renderToStaticMarkup(
        <Checkout
          slug="maddi"
          taxRateBps={500}
          items={[{ ...items[0], isAvailable: false }]}
        />,
      );

      expect(html).toContain('has sold out since you added it');
      expect(html).toContain('/menu/cart');
      expect(html).toContain('Nothing to order yet');
    } finally {
      mocks.cart.lines = [{ itemId: 'i1', qty: 2, variantId: undefined, addonIds: [] }];
      mocks.cart.count = 2;
    }
  });
});
