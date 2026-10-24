import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportsScreen, everyNth } from './ReportsScreen';
import { demoReport, emptyPayload, resolveRange, zeroFillBuckets, type ReportsScreenData } from '@/lib/db/reports';

/**
 * The sales report.
 *
 * The thing worth pinning down is not the markup but the claim: BILLED and
 * COLLECTED are two separate figures and the screen never merges them into one
 * word called "revenue". An owner reading a single number would think a table
 * that has not paid yet has paid.
 */

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-10-21T12:30:00Z'); // 18:00 in the restaurant

function live(over: Partial<ReportsScreenData['report']> = {}): ReportsScreenData {
  const range = resolveRange('today', TZ, NOW);
  const report = { ...emptyPayload(), buckets: zeroFillBuckets(range, [], TZ, NOW), ...over };

  return {
    restaurantName: 'maddi',
    tagline: null,
    timezone: TZ,
    range,
    report,
    ordersTruncated: false,
  };
}

describe('ReportsScreen', () => {
  it('asks a signed-out visitor to sign in instead of showing fabricated takings', () => {
    const html = renderToStaticMarkup(
      <ReportsScreen
        data={{
          ...live(),
          report: { ...emptyPayload(), buckets: zeroFillBuckets(resolveRange('today', TZ, NOW), [], TZ, NOW) },
          blocked: 'signed-out',
        }}
      />,
    );

    expect(html).toContain('Sign in');
    expect(html).not.toContain('Sample report');
  });

  it('labels a sample report as fictional rather than looking like real data', () => {
    const html = renderToStaticMarkup(<ReportsScreen />);
    expect(html).toContain('Sample report');
    expect(html).toContain('fictional sample data');
  });

  it('keeps billed and collected as two labelled figures, never one "revenue"', () => {
    const html = renderToStaticMarkup(
      <ReportsScreen
        data={live({
          totals: {
            bills: 4,
            cancelled: 0,
            billedPaise: 200_000,
            taxPaise: 30_000,
            discountPaise: 0,
            collectedPaise: 50_000,
            refundedPaise: 0,
            unpaidPaise: 150_000,
            averageBillPaise: 50_000,
          },
        })}
      />,
    );

    expect(html).toContain('Sales');
    expect(html).toContain('Collected');
    expect(html).toContain('Outstanding');
    // ₹2,000.00 billed against ₹500.00 collected, rendered from paise.
    expect(html).toContain('₹2,000');
    expect(html).toContain('₹500');
    expect(html).toContain('₹1,500');
    expect(html.toLowerCase()).not.toContain('revenue today');
  });

  it('says the range is empty instead of drawing an empty chart silently', () => {
    const html = renderToStaticMarkup(<ReportsScreen data={live()} />);
    expect(html).toContain('Nothing billed in this range yet');
    expect(html).toContain('No bills in this range');
  });

  it('warns when the ledger list is shorter than the bill count', () => {
    const html = renderToStaticMarkup(
      <ReportsScreen
        data={{
          ...live({ totals: { ...emptyPayload().totals, bills: 250 } }),
          ordersTruncated: true,
        }}
      />,
    );
    expect(html).toContain('the totals above cover all of them');
  });

  it('links the exports to the CSV route with the requested range', () => {
    const html = renderToStaticMarkup(<ReportsScreen data={live()} />);
    expect(html).toContain('/dashboard/reports/export?type=orders');
    expect(html).toContain('type=summary');
    expect(html).toContain('type=items');
  });

  it('offers the three ranges and marks the active one', () => {
    const html = renderToStaticMarkup(<ReportsScreen data={live()} />);
    expect(html).toContain('Last 7 days');
    expect(html).toContain('Last 30 days');
    expect(html).toContain('aria-current');
  });

  it('shows a cancelled bill as cancelled, not as a kitchen ticket', () => {
    const html = renderToStaticMarkup(
      <ReportsScreen
        data={live({
          orders: [
            {
              id: 'o1',
              code: 'MA-X',
              placedAt: '2026-10-21T10:00:00Z',
              prepStatus: 'cancelled',
              paymentStatus: 'pending',
              subtotalPaise: 9_000,
              discountPaise: 0,
              taxPaise: 1_620,
              totalPaise: 10_620,
              paidPaise: 0,
              refundedPaise: 0,
              tableLabel: 'T2',
            },
          ],
          totals: { ...emptyPayload().totals, bills: 1, cancelled: 1 },
        })}
      />,
    );

    expect(html).toContain('Cancelled');
    expect(html).toContain('excluded from every figure');
  });

  it('renders the demo report without throwing', () => {
    const html = renderToStaticMarkup(<ReportsScreen />);
    const range = resolveRange('7d', TZ, NOW);
    expect(demoReport(range, TZ, NOW).buckets).toHaveLength(7);
    expect(html).toContain('Top items');
  });
});

/**
 * Two things a 30-day range broke on a phone: thirty labels in one card, and
 * an "Outstanding" figure tinted green -- the colour this product uses for
 * "running right now" -- on the one number that means "collect this".
 */
describe('ReportsScreen, the chart axis and the outstanding card', () => {
  it('prints every axis label when there are few buckets', () => {
    expect([0, 1, 2].every((i) => everyNth(3, i))).toBe(true);
  });

  it('thins the axis on a month of bars instead of smearing thirty labels', () => {
    const printed = Array.from({ length: 30 }, (_, i) => everyNth(30, i)).filter(Boolean);
    expect(printed.length).toBeLessThan(12);
    expect(printed.length).toBeGreaterThan(3);
  });

  it('always labels the last bucket, so the axis does not appear to stop early', () => {
    expect(everyNth(30, 29)).toBe(true);
    expect(everyNth(45, 44)).toBe(true);
  });

  it('draws every bar even when it drops the label', () => {
    const range = resolveRange('30d', TZ, NOW);
    const buckets = zeroFillBuckets(
      range,
      range.bucket === 'hour' ? [] : [{ key: '2026-10-20 00:00', bills: 2, revenuePaise: 90_000 }],
      TZ,
      NOW,
    );
    const html = renderToStaticMarkup(<ReportsScreen data={live({ buckets })} />);

    expect(buckets.length).toBeGreaterThan(12);
    expect(html.match(/rounded-t-\[3px\]/g)?.length).toBe(buckets.length);
  });

  it('tints Outstanding as money to chase, not as something running', () => {
    const empty = emptyPayload();
    const report = {
      ...empty,
      totals: { ...empty.totals, billedPaise: 50_000, unpaidPaise: 20_000, bills: 1 },
      buckets: zeroFillBuckets(resolveRange('today', TZ, NOW), [], TZ, NOW),
    };
    const html = renderToStaticMarkup(<ReportsScreen data={live(report)} />);
    const card = html.slice(html.indexOf('Outstanding'));

    expect(card).toContain('Billed, not yet settled');
    expect(card.slice(0, 1200)).toContain('var(--alert)');
  });
});
