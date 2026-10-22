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
