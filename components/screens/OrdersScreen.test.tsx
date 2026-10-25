import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrdersScreen } from './OrdersScreen';
import { counterQueue } from '@/lib/demo-data';
import {
  demoReport,
  emptyPayload,
  resolveRange,
  zeroFillBuckets,
  type ReportsScreenData,
  type ReportOrderRow,
} from '@/lib/db/reports';

// The server action behind the bar pulls in the Supabase admin client, and the
// outlet switcher needs a router. Neither is what this screen is about.
vi.mock('@/app/auth/actions', () => ({ signOutAction: async () => undefined }));

/**
 * The order ledger.
 *
 * Two claims matter and both have been wrong in this product before: that the
 * rows on screen are the rows the money came from, and that a control which
 * looks like a link out actually leaves the page. The export is a route
 * handler answering with a file, so it has to be an anchor with `download` --
 * a <Link> would try to fetch a page that does not exist and then reload.
 */

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-10-21T12:30:00Z');

function order(over: Partial<ReportOrderRow> = {}): ReportOrderRow {
  return {
    id: 'o1',
    code: 'MA-1042',
    placedAt: '2026-10-21T10:00:00Z',
    tableLabel: 'T4',
    prepStatus: 'preparing',
    paymentStatus: 'pending',
    subtotalPaise: 80_000,
    discountPaise: 0,
    taxPaise: 4_000,
    totalPaise: 84_000,
    paidPaise: 0,
    refundedPaise: 0,
    ...over,
  };
}

function live(over: Partial<ReportsScreenData['report']> = {}): ReportsScreenData {
  const range = resolveRange('today', TZ, NOW);
  return {
    restaurantName: 'maddi',
    tagline: null,
    timezone: TZ,
    range,
    report: { ...emptyPayload(), buckets: zeroFillBuckets(range, [], TZ, NOW), orders: [order()], ...over },
    ordersTruncated: false,
  };
}

describe('OrdersScreen', () => {
  it('says out loud that the rows are sample data when there is no database', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={null} />);

    expect(html).toContain('Sample ledger');
    expect(html).toContain('fictional sample data');
    // The demo rows are real-looking bills; they must not be dressed as live.
    expect(html).not.toContain('/bill/');
  });

  it('downloads the CSV instead of navigating away from the ledger', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={live()} />);

    expect(html).toContain('/dashboard/reports/export?type=orders&amp;range=today');
    const exportTag = [...html.matchAll(/<a\b[^>]*>/g)]
      .map((match) => match[0])
      .find((tag) => tag.includes('/dashboard/reports/export'));
    expect(exportTag).toBeDefined();
    expect(exportTag).toContain('download');
  });

  it('keeps the range and the search when a filter is picked', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={live()} filter="open" query="T4" />);

    // Filter chips carry the current range and query forward, so filtering
    // does not silently widen the window the person is looking at.
    expect(html).toContain('href="/dashboard/orders?status=settled&amp;q=T4"');
    expect(html).toContain('href="/dashboard/orders?range=7d&amp;status=open&amp;q=T4"');
  });

  it('marks the chosen filter as current, not only as a colour', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={live()} filter="cancelled" />);

    expect(html).toContain('aria-current="true"');
  });

  it('counts what the header promises over the rows actually listed', () => {
    const html = renderToStaticMarkup(
      <OrdersScreen
        data={live({
          orders: [
            order({ id: 'a', prepStatus: 'new' }),
            order({ id: 'b', prepStatus: 'cancelled' }),
            order({ id: 'c', prepStatus: 'served', paymentStatus: 'paid', paidPaise: 84_000 }),
          ],
        })}
      />,
    );

    // One open, one unsettled (the open one), and the cancelled bill is not
    // counted as money owed.
    expect(html).toContain('1 open · 1 not settled');
    expect(html).toContain('3 orders');
  });

  it('sends a signed-out visitor to sign in rather than showing a ledger', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={{ ...live(), blocked: 'signed-out' }} />);

    expect(html).not.toContain('Order CSV');
    expect(html).not.toContain('MA-1042');
  });

  it('links every live bill somewhere it can be settled', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={live()} />);

    expect(html).toContain('href="/bill/o1"');
    expect(html).toContain('href="/cashier"');
  });

  it('explains an empty range instead of showing a blank table', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={live({ orders: [] })} />);

    expect(html).toContain('No orders in this range.');
  });

  it('has no control that cannot be used', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={null} />);

    // Demo mode used to render buttons that did nothing. Nothing here may pose.
    expect(html).not.toContain('pg__miniBtn');
    for (const match of html.matchAll(/<button\b[^>]*>/g)) {
      expect(match[0]).toMatch(/type="submit"|type="button"|disabled/);
    }
  });

  it('gives a phone the same bill as a card, not a sideways scroll', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={live()} />);

    // Both shapes are in the DOM and exactly one of them is displayed at any
    // width: a table with seven columns on a phone is a sideways scroll.
    expect(html).toMatch(/<table/);
    expect(html).toMatch(/<ul[^>]*lg:hidden/);
  });

  it('renders the sample report the demo range asks for', () => {
    // Guards the fallback: the demo rows come from demoReport(), and an empty
    // ledger on the marketing preview would read as a broken product.
    const sample = demoReport(resolveRange('7d', TZ, NOW), TZ);
    expect(sample.orders.length).toBeGreaterThan(0);
  });

  it('keeps a custom date range instead of flattening it to today', () => {
    // The range key used to be rewritten to 'today' whenever it was custom,
    // which lit the wrong chip and made Apply look like it had failed.
    const html = renderToStaticMarkup(
      <OrdersScreen
        data={{ ...live(), range: { ...resolveRange('custom', TZ, NOW, { from: '2026-10-03', to: '2026-10-09' }) } }}
        customFrom="2026-10-03"
        customTo="2026-10-09"
      />,
    );

    expect(html).toContain('value="custom"');
    expect(html).toContain('value="2026-10-03"');
    expect(html).toContain('value="2026-10-09"');
    expect(html).toContain('Apply dates');
  });

  it('carries the custom dates through a filter and into the export', () => {
    const html = renderToStaticMarkup(
      <OrdersScreen
        data={{ ...live(), range: resolveRange('custom', TZ, NOW, { from: '2026-10-03', to: '2026-10-09' }) }}
        customFrom="2026-10-03"
        customTo="2026-10-09"
        filter="settled"
      />,
    );

    // Filtering must not widen the window the person is looking at.
    expect(html).toContain('from=2026-10-03');
    expect(html).toContain('to=2026-10-09');
    // And the CSV covers the same dates the screen shows.
    expect(html).toContain('type=orders&amp;range=custom&amp;from=2026-10-03&amp;to=2026-10-09');
  });

  it('sends an unpaid bill to the counter on that ticket, not the queue in general', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={live()} />);

    expect(html).toContain('/cashier?order=o1');
    expect(html).toContain('Collect');
    // The reference still opens the bill itself; both doors are real.
    expect(html).toContain('/bill/o1');
  });

  it('offers nothing to collect on a settled or cancelled bill', () => {
    const settled = renderToStaticMarkup(
      <OrdersScreen
        data={live({ orders: [order({ paymentStatus: 'paid', paidPaise: 84_000 })] })}
        filter="settled"
      />,
    );
    expect(settled).not.toContain('/cashier?order=');

    const cancelled = renderToStaticMarkup(
      <OrdersScreen data={live({ orders: [order({ prepStatus: 'cancelled' })] })} filter="cancelled" />,
    );
    expect(cancelled).not.toContain('/cashier?order=');
  });

  it('points a sample row only at a ticket the sample counter actually has', () => {
    // The sample ledger and the sample counter are the same six tickets, so a
    // Collect link has to land on one of them. A link built from a fictional
    // id would open some real table's bill at the counter in production.
    const html = renderToStaticMarkup(<OrdersScreen data={null} />);
    const targets = [...html.matchAll(/\/cashier\?order=([^"&]+)/g)].map((m) => decodeURIComponent(m[1]));

    expect(targets.length).toBeGreaterThan(0);
    for (const code of targets) {
      expect(counterQueue.map((ticket) => ticket.id)).toContain(code);
    }
  });
});

/**
 * The ledger after the 2026-10-24 pass. Three things were wrong with it as a
 * page, not as a table: the controls were four different shapes, a column
 * answered "—", and a filter that matched nothing left you with no way back.
 */
describe('OrdersScreen, the ledger as a page', () => {
  const three = () =>
    live({
      orders: [
        order({ id: 'a', prepStatus: 'new' }),
        order({ id: 'b', prepStatus: 'cancelled' }),
        order({ id: 'c', prepStatus: 'served', paymentStatus: 'paid', paidPaise: 84_000 }),
      ],
    });

  it('tells you how many rows each filter would show', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={three()} />);

    // All 3, Open 1 (the new one), Settled 1 (the served and paid one),
    // Cancelled 1. Every count comes from the array the table is drawn from.
    const chip = (label: string) => {
      const at = html.indexOf(`>${label}`);
      const from = html.lastIndexOf('<a', at);
      return html.slice(from, html.indexOf('</a>', at));
    };
    expect(chip('All')).toContain('>3<');
    expect(chip('Open')).toContain('>1<');
    expect(chip('Settled')).toContain('>1<');
    expect(chip('Cancelled')).toContain('>1<');
  });

  it('marks the chosen window as current, in the accent, as a filled pill', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={three()} />);
    // Scoped to the chip row: the rail has a group heading called "Today" too.
    const row = html.slice(html.indexOf('mb-3 flex flex-col gap-2'));
    const today = row.slice(0, row.indexOf('</a>'));

    expect(html).toContain('aria-current="true"');
    // Selected = the accent fill with the on-ink label; unselected = a tint.
    expect(today).toContain('bg-[var(--p-accent)]');
    expect(today).toContain('text-onink');
    expect(today).toContain('rounded-full');
  });

  it('keeps the custom dates behind a summary that opens without JavaScript', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={three()} />);

    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('Custom dates');
  });

  it('holds that summary open while a custom range is the one in force', () => {
    const html = renderToStaticMarkup(
      <OrdersScreen
        data={{ ...live(), range: resolveRange('custom', TZ, NOW, { from: '2026-10-03', to: '2026-10-09' }) }}
        customFrom="2026-10-03"
        customTo="2026-10-09"
      />,
    );

    const details = html.slice(html.indexOf('<details'), html.indexOf('>', html.indexOf('<details')));
    expect(details).toContain('open');
    // And the chip says which days, rather than making you open it to find out.
    expect(html).toContain('2026-10-03 → 2026-10-09');
  });

  it('answers the outstanding column in words, never with a dash', () => {
    const html = renderToStaticMarkup(
      <OrdersScreen
        data={live({
          orders: [
            order({ id: 'paid', paymentStatus: 'paid', paidPaise: 84_000 }),
            order({ id: 'dead', prepStatus: 'cancelled' }),
          ],
        })}
      />,
    );

    expect(html).toContain('Settled');
    expect(html).toContain('Not collectable');
    expect(html).not.toContain('>—<');
  });

  it('gives an empty filter a way back to the full range', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={three()} filter="cancelled" query="T9" />);

    expect(html).toContain('No orders match this filter.');
    expect(html).toContain('Show all 3 in this range');
    expect(html).toContain('href="/dashboard/orders"');
  });

  it('narrows inside a tab, instead of ignoring the search box', () => {
    // The Cancelled branch of the row matcher returned before the query was
    // ever read, so searching on that tab did nothing.
    const html = renderToStaticMarkup(<OrdersScreen data={three()} filter="cancelled" query="T4" />);
    expect(html).toContain('1 order');

    const none = renderToStaticMarkup(<OrdersScreen data={three()} filter="cancelled" query="T9" />);
    expect(none).toContain('No orders match this filter.');
  });

  it('still says plainly when the range itself is empty', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={live({ orders: [] })} filter="open" />);

    expect(html).toContain('No orders in this range.');
    // Nothing to go back to, so no invitation to go back to it.
    expect(html).not.toContain('Show all');
  });

  it('uses the same action geometry in the phone card as in the table', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={live()} />);
    const collects = [...html.matchAll(/<a\b[^>]*>[\s\S]{0,40}Collect/g)].map((m) => m[0]);

    expect(collects.length).toBeGreaterThan(1);
    for (const tag of collects) {
      expect(tag).toContain('h-9 px-4');
      expect(tag).toContain('rounded-full');
    }
  });

  it('draws the sample-data note as the same strip as every other notice', () => {
    const html = renderToStaticMarkup(<OrdersScreen data={null} />);
    const at = html.indexOf('fictional sample data');
    const from = html.lastIndexOf('<div', at);
    // The opening tag only: the status tag inside the strip is a pill, and a
    // pill inside a card is not the thing being tested.
    const opening = html.slice(from, html.indexOf('>', from) + 1);

    expect(opening).toContain('rounded-[var(--p-r-block)]');
    expect(opening).not.toContain('rounded-full');
  });
});
