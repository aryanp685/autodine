import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderPlacedScreen } from './OrderPlacedScreen';
import type { OrderScreenData } from '@/lib/db/order-screen';

/**
 * The screen a diner lands on after pressing "Place order".
 *
 * What matters most here is the payment line. Online payment is not connected,
 * so the order is placed with payment pending and settled at the counter. A
 * confirmation that stayed quiet about that would leave someone waiting for a
 * card prompt that is never coming.
 */

const order = (over: Partial<OrderScreenData> = {}): OrderScreenData => ({
  code: 'MA-K3F9Q',
  restaurantName: 'Maddi',
  tableLabel: 'T1',
  prepStatus: 'new',
  paymentStatus: 'pending',
  subtotalPaise: 106000,
  taxPaise: 5300,
  totalPaise: 111300,
  customerNote: null,
  placedAt: '2026-10-21T12:00:00Z',
  lines: [
    {
      name: 'Paneer Tikka',
      qty: 2,
      unitPricePaise: 32000,
      lineTotalPaise: 64000,
      isVeg: true,
      variantName: null,
    },
    {
      name: 'Butter Chicken',
      qty: 1,
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
