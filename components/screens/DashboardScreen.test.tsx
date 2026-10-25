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
    // The axis is two ticks, the first and the last hour of trading so far --
    // not a sentence about "every hour to".
    expect(html).toContain('12 am');
    expect(html).toContain('3 am');
    expect(html).not.toContain('Every hour to');
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

/**
 * The chart drew the shape of the day against its own minimum, so a stretch of
 * quiet hours that varied by two hundred rupees filled the whole card height
 * like a dinner rush. Money on an axis has to start at zero; that is the whole
 * difference between a picture and a reading.
 */
describe('Dashboard chart scale', () => {
  it('stands the line on zero rather than on the smallest hour', () => {
    const html = renderToStaticMarkup(
      <Dashboard data={live({ hourlyPaise: [80_000, 82_000, 81_000] })} />,
    );

    expect(html).toContain('data-baseline="true"');
    expect(html).toContain('data-area="true"');
  });

  it('draws a quiet hour low, which is what the old scale could not do', () => {
    const flat = renderToStaticMarkup(
      <Dashboard data={live({ hourlyPaise: [80_000, 82_000, 81_000] })} />,
    );
    const dying = renderToStaticMarkup(
      <Dashboard data={live({ hourlyPaise: [80_000, 82_000, 1_000] })} />,
    );

    // 80,000 of a 82,000 maximum is 97.5% of the height; 1,000 is 1.2%.
    const yOf = (html: string, i: number) => {
      const pts = html.match(/<polyline points="([^"]+)"/)?.[1] ?? '';
      const pair = pts.split(' ')[i] ?? '';
      return Number(pair.split(',')[1]);
    };
    expect(yOf(flat, 1)).toBeLessThan(10);
    expect(yOf(dying, 1)).toBeLessThan(10);
    // ...and the quiet hour sits near the floor in the second chart only.
    expect(yOf(flat, 2)).toBeLessThan(10);
    expect(yOf(dying, 2)).toBeGreaterThan(110);
  });
});

/**
 * The row of figures had no hierarchy: four cards of equal size, and the one
 * an owner opens the screen for happened to be second.
 */
describe('Dashboard, the figures', () => {
  it('leads with revenue, whatever order the source listed them in', () => {
    const html = renderToStaticMarkup(<Dashboard data={live()} />);
    expect(html.indexOf('Revenue today')).toBeLessThan(html.indexOf('Orders today'));
  });

  it('draws revenue larger and lets it have the width', () => {
    const html = renderToStaticMarkup(<Dashboard data={live()} />);

    // It is no longer one of four equal cards with a bigger font: it is the
    // hero, with the shape of the day inside it, and the other three sit beside
    // it. What this asserts is the same intent as before -- revenue is drawn
    // bigger than its siblings and it is given the width to do it in.
    const hero = html.slice(html.indexOf('data-hero="revenue"'));
    expect(hero.slice(0, 4000)).toContain('clamp(2.2rem,5.4vw,4rem)');
    expect(html).toContain('lg:grid-cols-[1.62fr_1fr]');
    // ...and no sibling may borrow the display size.
    const siblings = html.slice(html.indexOf('Other figures for today'));
    expect(siblings).not.toContain('clamp(2.2rem,5.4vw,4rem)');
  });

  it('still tints only open orders, and only when there are some', () => {
    const busy = renderToStaticMarkup(<Dashboard data={live()} />);
    expect(busy).toContain('--p-accent-soft)_62%');

    const quiet = renderToStaticMarkup(
      <Dashboard data={{ ...live(), stats: { ...live().stats!, openOrders: 0 } }} />,
    );
    expect(quiet).not.toContain('--p-accent-soft)_62%');
  });
});

/**
 * Three strips used to be drawn by hand with three radii, three paddings and
 * three ways of ending in a link.
 */
describe('Dashboard, the notices', () => {
  const strip = (html: string) => {
    const at = html.indexOf('data-plan-line');
    // To the next structural boundary, not a magic 700 characters: the strip
    // grew a status disc and the fixed window stopped reaching "Free trial".
    const end = html.indexOf('aria-label="Today at a glance"', at);
    return at < 0 ? '' : html.slice(at, end < 0 ? undefined : end);
  };

  it('draws the plan line as the same strip as everything else', () => {
    const html = renderToStaticMarkup(<Dashboard data={EMPTY} />);
    const plan = strip(html);
    expect(plan).toContain('rounded-[var(--p-r-block)]');
    expect(plan).toContain('Free trial');
  });

  it('says a read-only workspace is read-only, in the due tone', () => {
    const html = renderToStaticMarkup(
      <Dashboard data={{ ...EMPTY, access: { ...EMPTY.access!, status: 'expired', readOnly: true, canWrite: false } }} />,
    );
    expect(html).toContain('--p-due)_24%');
  });

  it('keeps the preview notice for a workspace with no database', () => {
    const html = renderToStaticMarkup(<Dashboard />);
    expect(html).toContain('Preview mode');
    expect(html).toContain('fictional');
  });
});

/**
 * "Top items" was a list of numbers with no scale: three dishes ranked, and no
 * way to see whether the first outsold the third by one or by a hundred.
 */
describe('Dashboard, top items', () => {
  it('scales each bar against the best seller', () => {
    const html = renderToStaticMarkup(
      <Dashboard
        data={live({
          topItems: [
            { name: 'A', qty: 10, revenuePaise: 100_000 },
            { name: 'B', qty: 5, revenuePaise: 50_000 },
          ],
        })}
      />,
    );

    expect(html).toContain('width:100%');
    expect(html).toContain('width:50%');
  });

  it('leaves the bars out when nothing sold', () => {
    const html = renderToStaticMarkup(<Dashboard data={EMPTY} />);
    expect(html).not.toContain('width:100%');
  });
});

/**
 * The closing paragraph repeated the open-order count a third time and then
 * explained the restaurant clock to a screen that says so under its title.
 */
describe('Dashboard, what it does not repeat', () => {
  it('prints the open count once in the panel and once in the card', () => {
    const html = renderToStaticMarkup(<Dashboard data={live()} />);
    expect(html.match(/1 open/g) ?? []).toHaveLength(1);
  });

  it('does not tag the chart Live when the page already says it', () => {
    const html = renderToStaticMarkup(<Dashboard data={live()} />);
    const panel = html.slice(html.indexOf('Revenue today', html.indexOf('data-chart') - 900));
    expect(panel).not.toContain('>Live<');
  });

  it('gives the orders panel a real action, not an underlined word', () => {
    const html = renderToStaticMarkup(<Dashboard data={live()} />);
    const at = html.indexOf('All orders');
    const opening = html.slice(html.lastIndexOf('<a', at), at + 20);
    expect(opening).toContain('h-9 px-3');
  });
});
