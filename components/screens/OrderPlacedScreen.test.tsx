import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderPlacedScreen } from './OrderPlacedScreen';
import type { OrderScreenData } from '@/lib/db/order-screen';

/*
 * The screen now contains a client component with quantity controls, so the
 * hooks it uses have to exist in a static render. Effects do not run here:
 * what these tests check is the markup a guest sees first.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

/*
 * The pay button is a client component that imports a 'use server' action,
 * which pulls in the admin Supabase client (server-only). In a static render
 * that module must not be executed, so it is replaced with a stub — these
 * tests are about which sentence appears, not about payment.
 */
vi.mock('@/app/menu/order/pay-actions', () => ({
  startOnlinePaymentAction: async () => ({ ok: false, error: 'not in this test' }),
}));

vi.mock('@/app/menu/order/actions', () => ({
  cancelGuestOrderAction: async () => ({ ok: true, message: 'Cancelled.' }),
  setGuestOrderLinesAction: async () => ({ ok: true, message: 'Saved.' }),
}));

/**
 * The screen a diner lands on after pressing "Place order".
 *
 * What matters most here is the payment line. Online payment is not connected,
 * so the order is placed with payment pending and settled at the counter. A
 * confirmation that stayed quiet about that would leave someone waiting for a
 * card prompt that is never coming.
 */

const order = (over: Partial<OrderScreenData> = {}): OrderScreenData => ({
  id: 'o-1',
  code: 'MA-K3F9Q',
  canGuestChange: false,
  restaurantName: 'Maddi',
  tableLabel: 'T1',
  prepStatus: 'new',
  paymentStatus: 'pending',
  subtotalPaise: 106000,
  taxPaise: 5300,
  totalPaise: 111300,
  customerNote: null,
  placedAt: '2026-10-21T12:00:00Z',
  onlineEnabled: false,
  lines: [
    {
      id: 'l-1',
      name: 'Paneer Tikka',
      qty: 2,
      addons: [],
      unitPricePaise: 32000,
      lineTotalPaise: 64000,
      isVeg: true,
      variantName: null,
    },
    {
      id: 'l-2',
      name: 'Butter Chicken',
      qty: 1,
      addons: [],
      unitPricePaise: 42000,
      lineTotalPaise: 42000,
      isVeg: false,
      variantName: 'Half',
    },
  ],
  ...over,
});

describe('OrderPlacedScreen', () => {
  it('leads with the table, not with a code', () => {
    // The confirmation is a guest checking the kitchen knows where to bring
    // the food. A reference number answers a question nobody is asking yet.
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order()} />);
    expect(html).toContain('Table T1');
    expect(html).not.toContain('<h1>Order MA-K3F9Q</h1>');
  });

  it('says counter order when there is no table', () => {
    // A takeaway really has no table, and saying so is better than a blank.
    const html = renderToStaticMarkup(
      <OrderPlacedScreen data={order({ tableLabel: null })} />
    );
    expect(html).toContain('Counter order');
    expect(html).not.toContain('Table');
  });

  it('keeps the code as a reference for the counter', () => {
    // Not the headline, but not gone: for a counter order there is no table
    // to find the bill by.
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order()} />);
    expect(html).toContain('MA-K3F9Q');
  });

  it('says the order is with the kitchen', () => {
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order()} />);
    expect(html).toContain('Sent to the kitchen');
  });

  it('tells a diner with an unpaid order to pay at the counter', () => {
    // The whole point: payment is pending, and silence here would read as
    // "already paid".
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order()} />);
    expect(html).toContain('Pay at the counter');
    expect(html).not.toContain('Paid. Thank you.');
  });

  describe('paying online', () => {
    it('offers the pay button when the server says it may', () => {
      const html = renderToStaticMarkup(
        <OrderPlacedScreen
          data={order({ onlineEnabled: true })}
          slug="maddi"
          token="11111111-1111-1111-1111-111111111111"
          onlinePay={{ available: true, note: null }}
        />,
      );

      expect(html).toContain('Pay ₹1,113 online');
      // The counter is still offered, because a guest may prefer it.
      expect(html).toContain('pay at the counter');
    });

    it('never draws the button when the server withheld it, and says why', () => {
      const html = renderToStaticMarkup(
        <OrderPlacedScreen
          data={order({ onlineEnabled: true })}
          slug="maddi"
          token="11111111-1111-1111-1111-111111111111"
          onlinePay={{
            available: false,
            note: 'Card payment is not connected on this deployment yet — pay at the counter.',
          }}
        />,
      );

      expect(html).not.toContain('Pay ₹');
      expect(html).toContain('Card payment is not connected');
      expect(html).toContain('Pay at the counter');
    });

    it('does not offer payment on an order that is already paid', () => {
      // Even if a caller passes a permissive offer, the paid branch wins.
      const html = renderToStaticMarkup(
        <OrderPlacedScreen
          data={order({ paymentStatus: 'paid' })}
          slug="maddi"
          token="11111111-1111-1111-1111-111111111111"
          onlinePay={{ available: true, note: null }}
        />,
      );

      expect(html).toContain('Paid. Thank you.');
      expect(html).not.toContain('Pay ₹');
    });
  });

  it('does not ask for payment that has already been made', () => {
    const html = renderToStaticMarkup(
      <OrderPlacedScreen data={order({ paymentStatus: 'paid' })} />
    );
    expect(html).toContain('Paid. Thank you.');
    expect(html).not.toContain('Pay at the counter');
  });

  it('reads each line from its snapshot, not from the item today', () => {
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order()} />);
    expect(html).toContain('Paneer Tikka');
    expect(html).toContain('Butter Chicken');
  });

  it('shows a note the diner left for the kitchen', () => {
    const html = renderToStaticMarkup(
      <OrderPlacedScreen data={order({ customerNote: 'No onion in the raita' })} />
    );
    expect(html).toContain('No onion in the raita');
  });

  it('offers the guest a way out of an order the kitchen has not started', () => {
    const html = renderToStaticMarkup(
      <OrderPlacedScreen data={order({ canGuestChange: true })} token="t-1" />
    );
    expect(html).toContain('Cancel this order');
    expect(html).toContain('Save changes');
  });

  it('does not draw the controls on a link that carries no token', () => {
    // Without the token the server returns no order at all, but a hand-typed
    // code plus a stale page must never look like it can cancel something.
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order()} />);
    expect(html).not.toContain('Cancel this order');
  });

  it('says the order is cancelled instead of asking for payment', () => {
    const html = renderToStaticMarkup(
      <OrderPlacedScreen data={order({ prepStatus: 'cancelled' })} token="t-1" />
    );
    expect(html).toContain('This order was cancelled');
    expect(html).toContain('nothing is owed');
    expect(html).not.toContain('Pay at the counter');
    expect(html).not.toContain('Cancel this order');
  });

  it('explains why the order can no longer be changed once cooking starts', () => {
    const html = renderToStaticMarkup(
      <OrderPlacedScreen data={order({ prepStatus: 'preparing', canGuestChange: false })} token="t-1" />
    );
    expect(html).toContain('The kitchen has started');
    expect(html).not.toContain('Cancel this order');
  });

  it('says so plainly when the order cannot be found', () => {
    const html = renderToStaticMarkup(<OrderPlacedScreen data={null} />);
    expect(html).toContain('Order not found');
  });

  it('shows which portion was ordered', () => {
    // The snapshot, not the current menu. A guest checking their receipt
    // needs to see what they bought, and a portion picker that never reaches
    // the receipt is a choice the guest cannot confirm.
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order()} />);
    expect(html).toContain('Half');
  });

  it('does not invent a portion for a dish that has none', () => {
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order()} />);
    expect(html).toContain('Paneer Tikka');
    expect(html).not.toContain('Paneer Tikka · ');
  });
});
