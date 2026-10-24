import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dashboard } from './DashboardScreen';

// The server action pulls in lib/supabase/admin, which imports the
// `server-only` marker package that Next provides at build time and vitest
// does not resolve. The action itself is not what these tests are about.
vi.mock('@/app/auth/actions', () => ({ signOutAction: async () => undefined }));
import type { DashboardScreenData } from '@/lib/db/dashboard-screen';

/**
 * The dashboard is the first screen an owner opens, and everything on it is
 * money. The bug worth never shipping again: `<Money>` used to format paise as
 * if they were rupees, so a live day of Rs 1,557.60 read as Rs 1,55,760 --
 * while the demo rows, which hold rupees, looked perfectly correct.
 */

function live(over: Partial<DashboardScreenData> = {}): DashboardScreenData {
  return {
    restaurantName: 'maddi',
    timezone: 'Asia/Kolkata',
    tagline: null,
    stats: {
      ordersToday: 3,
      revenueTodayPaise: 155_760,
      averageTicketPaise: 51_920,
      openOrders: 1,
    },
    orders: [
      {
        id: 'o1',
        code: 'MA-1',
        table: 'T1',
        placedAt: '2026-10-21T10:00:00Z',
        paymentStatus: 'paid',
        prepStatus: 'served',
        totalPaise: 50_740,
      },
    ],
    topItems: [{ name: 'koko', qty: 2, revenuePaise: 92_000 }],
    hourlyPaise: [0, 0, 155_760],
    ...over,
  };
}

describe('Dashboard money', () => {
  it('divides live paise before printing, so a day is not shown a hundred times over', () => {
    const html = renderToStaticMarkup(<Dashboard data={live()} />);

    expect(html).toContain('₹1,558'); // 155,760 paise
    expect(html).not.toContain('₹1,55,760');
  });

  it('prints a live order total at the same scale as the stat cards', () => {
    const html = renderToStaticMarkup(<Dashboard data={live()} />);
    expect(html).toContain('₹507'); // 50,740 paise
  });

  it('converts the demo rows, which hold rupees, on the way in', () => {
    const html = renderToStaticMarkup(<Dashboard />);
    // Demo order A-1042 totals 776 rupees...
    expect(html).toContain('₹776');
    // ...and the top-item list holds 21,574 rupees. If it were read as paise
    // it would render as ₹216, which is the exact failure being guarded.
    expect(html).toContain('₹21,574');
    expect(html).not.toContain('₹216');
  });

  it('links Orders and Reports instead of rendering them as dead text', () => {
    const html = renderToStaticMarkup(<Dashboard data={live()} />);
    expect(html).toContain('href="/dashboard/orders"');
    expect(html).toContain('href="/dashboard/reports"');
  });
});

/**
 * The same screen with a restaurant that has not traded yet.
 *
 * Everything here is about the difference between "quiet" and "broken". A new
 * workspace reads zero in all four cards; that is the truth and it stays. What
 * must not happen is the page then saying something false -- claiming a trial
 * that has ended over a paid plan, or leaving four zeros on screen with no next
 * step at all.
 */

const EMPTY: DashboardScreenData = {
  restaurantName: 'Kings of Kings',
  timezone: 'Asia/Kolkata',
  tagline: 'North Indian, since 1998',
  stats: { ordersToday: 0, revenueTodayPaise: 0, averageTicketPaise: 0, openOrders: 0 },
  orders: [],
  topItems: [],
  hourlyPaise: [0, 0, 0],
  access: {
    plan: 'trial',
    status: 'trialing',
    trialEndsAt: '2026-11-01T00:00:00.000Z',
    daysRemaining: 4,
    canWrite: true,
    readOnly: false,
    features: [],
  },
};

describe('Dashboard, live and empty', () => {
  it('says there are no orders yet today instead of dressing up the silence', () => {
    const html = renderToStaticMarkup(<Dashboard data={EMPTY} />);
    expect(html).toContain('No orders yet');
    expect(html).toContain('Nothing sold yet today');
    expect(html).not.toContain('fictional');
  });

  it('keeps the real zeros', () => {
    const html = renderToStaticMarkup(<Dashboard data={EMPTY} />);
    expect(html).toContain('0 open · 0 today');
  });

  it('offers the next step rather than leaving four zeros on screen', () => {
    const html = renderToStaticMarkup(<Dashboard data={EMPTY} />);
    expect(html).toContain('href="/dashboard/tables"');
  });

  it('prints the plan the workspace is actually on', () => {
    const trial = renderToStaticMarkup(<Dashboard data={EMPTY} />);
    expect(trial).toContain('Free trial · 4 days left');
    expect(trial).toContain('during the trial');

    const paid = renderToStaticMarkup(
      <Dashboard
        data={{
          ...EMPTY,
          access: { ...EMPTY.access!, plan: 'professional', status: 'active', daysRemaining: 0 },
        }}
      />,
    );
    expect(paid).toContain('Professional');
    expect(paid).not.toMatch(/during the trial/);
  });

  it('tells a read-only workspace its data is still there', () => {
    const html = renderToStaticMarkup(
      <Dashboard
        data={{
          ...EMPTY,
          access: {
            ...EMPTY.access!,
            status: 'expired',
            readOnly: true,
            canWrite: false,
            daysRemaining: 0,
          },
        }}
      />,
    );
    expect(html).toContain('read-only');
    expect(html).toMatch(/nothing has been deleted/i);
  });

  it('explains an empty chart instead of drawing a flat line', () => {
    const html = renderToStaticMarkup(<Dashboard data={EMPTY} />);
    expect(html).toContain('No settled payments yet today');
  });

  it('does not print the plan line on a signed-out screen', () => {
    const html = renderToStaticMarkup(<Dashboard data={{ ...EMPTY, blocked: 'signed-out' }} />);
    expect(html).not.toMatch(/during the trial/);
    expect(html).not.toContain('data-plan-line');
  });
});

/**
 * The chart used to be a fixed 520px squiggle with no axis and no reading --
 * and on a phone it hung out of its card. These pin the three things that
 * turned it into information: it fits the card, it names the busy hour, and a
 * day with no money does not answer a question nobody asked.
 */
describe('Dashboard revenue chart', () => {
  it('names the busiest hour and what it took', () => {
    // Hour 19 is 7-8 pm in the restaurant's zone.
    const html = renderToStaticMarkup(<Dashboard data={live({ hourlyPaise: [0, 10_000, 84_500, 20_000] })} />);

    expect(html).toContain('Busiest hour');
    expect(html).toContain('2–3 am'); // bucket 2, from the hour label table
    expect(html).toContain('₹845'); // 84,500 paise
    expect(html).toContain('Every hour to 3 am');
  });

  it('dots the peak and scales with the card instead of a fixed pixel width', () => {
    const html = renderToStaticMarkup(<Dashboard data={live({ hourlyPaise: [0, 10_000, 84_500] })} />);

    expect(html).toContain('viewBox="0 0 520 120"');
    expect(html).toContain('w-full');
    expect(html).toContain('data-peak="true"');
  });

  it('does not name a busiest hour on a day with no settled payments', () => {
    const html = renderToStaticMarkup(<Dashboard data={live({ hourlyPaise: [0, 0, 0] })} />);

    expect(html).not.toContain('Busiest hour');
    expect(html).not.toContain('data-peak');
    expect(html).toContain('No settled payments yet today');
  });

  it('leaves the sample chart unlabelled, because it has no trading day behind it', () => {
    const html = renderToStaticMarkup(<Dashboard />);

    expect(html).toContain('Sample shape');
    expect(html).not.toContain('Busiest hour');
    expect(html).not.toContain('Every hour to');
  });
});
