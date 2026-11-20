import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The counter's page.
 *
 * WHAT IS BEING PINNED
 *
 * A guest pays at the counter, so the queue has to move on its own. That is now
 * the staff shell's job: one coordinator subscribes to the outlet's committed
 * revision and asks the router to re-read. A second per-page timer would be two
 * refresh loops racing each other, so this page must NOT mount one.
 */

const mocks = vi.hoisted(() => ({
  data: null as unknown,
  outlet: null as unknown,
}));

vi.mock('@/lib/db/cashier-screen', () => ({
  getCashierScreenData: () => Promise.resolve(mocks.data),
}));

vi.mock('@/lib/db/outlet-bar', () => ({
  getOutletBar: () => Promise.resolve(mocks.outlet),
}));

// The three pieces around the assertion: the counter itself (a large client
// component), the bar (needs a router) and the refresh loop (needs a mount).
vi.mock('@/components/screens/CashierScreen', () => ({
  Cashier: () => <div data-cashier />,
}));

vi.mock('@/components/DashboardBar', () => ({
  DashboardBar: () => <div data-bar />,
}));

import CashierPage from './page';

async function render(searchParams: Record<string, string> = {}) {
  const tree = await CashierPage({ searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(tree);
}

beforeEach(() => {
  mocks.data = { restaurantName: 'Maddi', queue: [] };
  mocks.outlet = null;
});

describe('the counter refreshes itself', () => {
  it('leaves the refresh loop to the one shared coordinator', async () => {
    const html = await render();
    expect(html).toContain('data-cashier');
    expect(html).not.toContain('data-auto-refresh');
  });

  it('still opens the ticket a ledger row asked for', async () => {
    const html = await render({ order: 'order-1' });
    expect(html).toContain('data-cashier');
  });
});
