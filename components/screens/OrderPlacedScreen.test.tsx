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
  awaitingConfirmation: false,
  paymentStatus: 'pending',
  subtotalPaise: 106000,
  taxPaise: 5300,
  totalPaise: 111300,
  customerNote: null,
  placedAt: '2026-10-21T12:00:00Z',
  onlineEnabled: false,
  upi: null,
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

  it('draws the kitchen progress from the state the board writes', () => {
    // Four real states, in the order a ticket moves. The screen used to say
    // "Being cooked" in a sentence and nothing else, so a guest had no way to
    // tell whether it was still waiting or already on the pass.
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order({ prepStatus: 'preparing' })} />);

    expect(html).toContain('data-placed-track');
    expect(html).toContain('Being cooked');
    expect(html).toContain('Ready to serve');
    // 'new' is behind it, 'served' ahead of it.
    expect(html).toMatch(/data-placed-step="done"[^>]*>.*?Sent to the kitchen/s);
    expect(html).toMatch(/data-placed-step="now"[^>]*>.*?Being cooked/s);
    expect(html).toMatch(/data-placed-step="todo"[^>]*>.*?Served/s);
  });

  it('marks nothing on a state it does not recognise', () => {
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order({ prepStatus: 'mystery' })} />);
    expect(html).not.toContain('data-placed-track');
  });

  it('puts no four-step track on a cancelled order', () => {
    // There is nothing left to move through; four unreached steps would read
    // as an order about to start.
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order({ prepStatus: 'cancelled' })} />);

    expect(html).not.toContain('data-placed-track');
    expect(html).toContain('Nothing is being cooked');
  });

  it('says the status updates itself only while it actually polls', () => {
    // The poller is mounted when the guest can no longer edit. On an editable
    // order it is absent, because a refresh would land on unsaved quantities.
    const locked = renderToStaticMarkup(<OrderPlacedScreen data={order({ canGuestChange: false })} />);
    expect(locked).toContain('Status updates on its own');

    const editable = renderToStaticMarkup(
      <OrderPlacedScreen data={order({ canGuestChange: true })} token="t-1" />
    );
    expect(editable).not.toContain('Status updates on its own');
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

  it('leaves a way back to the menu from the confirmation', () => {
    // The end of the flow used to be a dead end: nothing on the screen led
    // anywhere, so a table ordering a second round had to re-scan the card.
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order()} slug="maddi" />);

    expect(html).toContain('data-flow-steps');
    expect(html).toMatch(/data-flow-step="now"[^>]*aria-current="step"[^>]*>\s*<span class="sr-only">Placed/);
    expect(html).toContain('Order something else');
    expect(html).toContain('href="/menu?s=maddi"');
  });
});

/**
 * The sentence under an unpaid bill.
 *
 * It was fixed: "The kitchen has your order already and is starting on it
 * now." A guest whose food had arrived read that next to "Served", which tells
 * them the meal in front of them has not started. The sentence now follows the
 * same prep status the tracker draws.
 */
describe('OrderPlacedScreen — what happens next', () => {
  it('never says the kitchen is starting once it has started', () => {
    const cooking = renderToStaticMarkup(<OrderPlacedScreen data={order({ prepStatus: 'preparing' })} />);
    expect(cooking).toContain('cooking this now');
    expect(cooking).not.toMatch(/starting on it now/);

    const ready = renderToStaticMarkup(<OrderPlacedScreen data={order({ prepStatus: 'ready' })} />);
    expect(ready).toContain('on its way to your table');
    expect(ready).not.toMatch(/starting on it now/);
  });

  it('asks for the bill at the counter once the food is served, and only once', () => {
    const served = renderToStaticMarkup(<OrderPlacedScreen data={order({ prepStatus: 'served' })} />);
    expect(served).toContain('This has been served');
    expect(served).toContain('settle the bill at the counter');
    expect(served).not.toMatch(/starting on it now/);

    // The status sentence used to settle the bill at the counter AND the pay
    // line next to it sent the guest to the counter again: two "at the
    // counter" sentences in one breath, reading like two different things to
    // do. It is one instruction, said once.
    expect((served.match(/at the counter/g) ?? []).length).toBe(1);
  });

  it('never tells a held order the kitchen is starting', () => {
    // The waiting notice says nothing is cooking; the pay paragraph next to it
    // used to say "the kitchen is starting on it now" -- the exact lie the
    // notice exists to prevent.
    const held = renderToStaticMarkup(
      <OrderPlacedScreen data={order({ awaitingConfirmation: true })} />,
    );
    expect(held).not.toMatch(/starting on it now/);
    expect(held).toContain('The kitchen starts once the table is confirmed.');
  });

  it('sends a takeaway to pickup, not to the counter twice', () => {
    const ready = renderToStaticMarkup(
      <OrderPlacedScreen data={order({ prepStatus: 'ready', tableLabel: null })} />,
    );
    expect(ready).toContain('ready for pickup');
    expect(ready).not.toContain('collect it at the counter');
    expect((ready.match(/at the counter/g) ?? []).length).toBe(1);
  });

  it('explains why a paid order cannot be changed', () => {
    // This used to return an empty reason, so the bill was locked with no
    // sentence at all.
    const html = renderToStaticMarkup(
      <OrderPlacedScreen
        data={order({
          prepStatus: 'new',
          paymentStatus: 'paid',
          canGuestChange: false,
        })}
        token="11111111-1111-1111-1111-111111111111"
      />,
    );

    expect(html).toContain('Paid. Thank you.');
    expect(html).toMatch(/has been paid, so it cannot be changed/);
  });
});

describe('OrderPlacedScreen, a held order', () => {
  it('says the order is waiting for the table to be confirmed, not that it is cooking', () => {
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order({ awaitingConfirmation: true })} />);

    // The honest sentence: with the floor, not in the kitchen.
    expect(html).toContain('waiting for the table to be confirmed');
    expect(html).toContain('Waiting for the restaurant.');

    // The stepper still labels its first step "Sent to the kitchen" -- that is
    // the route the order will take, not a claim about now -- so the assertion
    // is about the status line, which is where a guest actually reads state.
  });

  it('drops the waiting notice the moment a person confirms', () => {
    const html = renderToStaticMarkup(<OrderPlacedScreen data={order({ awaitingConfirmation: false })} />);
    expect(html).not.toContain('Waiting for the restaurant.');
    expect(html).toContain('Sent to the kitchen');
  });
});
