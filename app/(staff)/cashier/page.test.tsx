import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The counter's page.
 *
 * WHAT IS BEING PINNED
 *
 * A guest pays at the counter, so the queue has to move on its own. The only
 * refresh this screen ever had was the one it triggered after settling a bill
 * -- which meant the NEXT guest's ticket stayed invisible until somebody
 * reloaded. That is a cashier staring at an empty queue while a person waits.
 *
 * So: the page must mount the (already tested) refresh loop, it must be faster
 * than the owner dashboard's, and it must not run when there is no database to
 * read.
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

vi.mock('@/components/owner/AutoRefresh', () => ({
  AutoRefresh: ({ enabled, seconds }: { enabled: boolean; seconds?: number }) => (
    <div data-auto-refresh data-enabled={String(enabled)} data-seconds={String(seconds ?? '')} />
  ),
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
  it('mounts the refresh loop at twenty seconds', async () => {
    const html = await render();

    expect(html).toContain('data-auto-refresh');
    expect(html).toContain('data-enabled="true"');
    expect(html).toContain('data-seconds="20"');
  });

  it('does not refresh a screen with nothing behind it', async () => {
    // A demo or signed-out counter has no queue to poll; a timer there is a
    // request per interval for an answer that cannot change.
    const html = await render();
    expect(html).toContain('data-enabled="true"');

    mocks.data = { restaurantName: '', queue: [], blocked: 'signed-out' };
    const blocked = await render();
    expect(blocked).toContain('data-enabled="false"');
  });

  it('still opens the ticket a ledger row asked for', async () => {
    mocks.data = { restaurantName: 'Maddi', queue: [] };
    const html = await render({ order: 'order-1' });
    // The focus prop is threaded through to the screen; the screen is mocked
    // here, so the assertion is that the page resolved and rendered at all
    // with a query string -- the failure this guards is a page that throws on
    // an unexpected searchParams shape.
    expect(html).toContain('data-cashier');
  });
});
