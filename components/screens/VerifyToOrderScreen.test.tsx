import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VerifyToOrderScreen } from './VerifyToOrderScreen';

/**
 * The screen a guest sees at the one moment the on-site code is required.
 *
 * THE THREE THINGS IT MUST DO
 *
 *   1. Show the bill, so a guest knows their cart survived the hop.
 *   2. Say where the six digits actually are, in the room, without telling
 *      them to guess or to contact anybody.
 *   3. Promise nothing. There is no "order placed" copy on a screen that has
 *      not placed anything -- the confirmation belongs to the order page, which
 *      only exists after the database returns an order code.
 */

const mocks = vi.hoisted(() => ({
  cart: {
    lines: [
      { itemId: 'i1', qty: 2, variantId: undefined, addonIds: [] },
      { itemId: 'i2', qty: 1, variantId: undefined, addonIds: [] },
    ] as { itemId: string; qty: number; variantId?: string; addonIds?: string[] }[],
    count: 3,
    ready: true,
    add: () => {},
    remove: () => {},
    setQty: () => {},
    clear: () => {},
  },
}));

vi.mock('@/components/CartProvider', () => ({ useCart: () => mocks.cart }));

vi.mock('@/app/t/[token]/actions', () => ({
  verifyTableCodeAction: () => Promise.resolve(),
}));

const ITEMS = [
  { id: 'i1', name: 'Paneer Tikka', pricePaise: 32000, isVeg: true, categoryId: 'c1', isAvailable: true },
  { id: 'i2', name: 'Masala Chai', pricePaise: 6000, isVeg: true, categoryId: 'c1', isAvailable: true },
] as unknown as Parameters<typeof VerifyToOrderScreen>[0]['items'];

function render(over: Partial<Parameters<typeof VerifyToOrderScreen>[0]> = {}) {
  return renderToStaticMarkup(
    <VerifyToOrderScreen
      slug="maddi"
      token="qr_abcdefghijklmnop"
      restaurantName="Maddi"
      tableLabel="T3"
      windowMinutes={10}
      items={ITEMS}
      {...over}
    />,
  );
}

describe('VerifyToOrderScreen', () => {
  it('shows the bill the code is protecting', () => {
    const html = render();

    expect(html).toContain('Paneer Tikka');
    expect(html).toContain('Total payable');
    expect(html).toContain('Table T3');
  });

  it('says exactly where to find the code', () => {
    const html = render();

    expect(html).toContain('Where to find the code');
    expect(html).toContain('counter or till');
    expect(html).toContain('member of staff');
  });

  it('never sends the guest to guess or to contact support', () => {
    const html = render();

    expect(html.toLowerCase()).not.toContain('contact support');
    expect(html.toLowerCase()).not.toContain('support ticket');
    expect(html.toLowerCase()).not.toContain('try a few codes');
  });

  it('promises nothing: no order has been placed on this screen', () => {
    const html = render();

    expect(html).not.toMatch(/order (has been |was )?placed/i);
    expect(html).not.toMatch(/confirmed order/i);
    expect(html).toContain('Nothing has been ordered yet');
    expect(html).toContain('Nothing has been sent to the kitchen');
  });

  it('carries the card token and the way back, so one code finishes the job', () => {
    const html = render();

    // Hidden field, posted in the body rather than written into the URL.
    expect(html).toContain('name="token"');
    expect(html).toContain('qr_abcdefghijklmnop');
    expect(html).toContain('name="next"');
    expect(html).toContain('/menu/checkout?s=maddi');
  });

  it('does not claim a cart is empty before the browser has read it', () => {
    mocks.cart.ready = false;
    const html = render();
    mocks.cart.ready = true;

    // The server cannot see localStorage. It must not say "nothing" about a
    // cart that simply has not been loaded yet.
    expect(html).not.toContain('nothing in this cart');
  });
});
