import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The strip that asks the floor one question per table sitting.
 *
 * The actions are stubbed: a 'use server' module cannot be imported outside
 * Next's build, and what matters here is what the board OFFERS and what it
 * refuses to offer -- not the round trip, which is the database's job and is
 * guarded by the UPDATE predicate `confirmed_at is null`.
 */
vi.mock('@/app/(staff)/kitchen/actions', () => ({
  confirmTableAction: vi.fn(),
  rejectTableAction: vi.fn(),
}));

import { HeldTableStrip } from './HeldTableStrip';
import type { HeldTable } from '@/lib/db/kitchen-screen';

function table(over: Partial<HeldTable> = {}): HeldTable {
  return {
    sessionId: 'sess-1',
    table: 'T4',
    placedAt: '9:14 PM',
    placedAtIso: '2026-10-25T15:44:00Z',
    ageMin: 3,
    latest: '9:20 PM',
    orders: [{ id: 'o-1', code: 'AU-1234', total: 640 }],
    itemCount: 3,
    items: [
      { qty: 2, name: 'Paneer Tikka', veg: true },
      { qty: 1, name: 'Butter Naan', veg: true },
    ],
    ...over,
  };
}

describe('HeldTableStrip', () => {
  it('says nothing at all when nothing is held', () => {
    expect(renderToStaticMarkup(<HeldTableStrip tables={[]} canConfirm />)).toBe('');
  });

  it('shows the table, what is waiting, and both decisions', () => {
    const html = renderToStaticMarkup(<HeldTableStrip tables={[table()]} canConfirm />);
    expect(html).toContain('Waiting for the floor');
    expect(html).toContain('Table');
    expect(html).toContain('T4');
    expect(html).toContain('Nothing here is cooking yet');
    expect(html).toContain('Confirm table');
    expect(html).toContain('Not our table');
    expect(html).toContain('Paneer Tikka');
  });

  it('counts a sitting, not its orders: two orders, one decision', () => {
    const html = renderToStaticMarkup(
      <HeldTableStrip
        tables={[
          table({
            itemCount: 5,
            orders: [
              { id: 'o-1', code: 'AU-1234', total: 640 },
              { id: 'o-2', code: 'AU-1235', total: 240 },
            ],
            latest: '9:20 PM',
          }),
        ]}
        canConfirm
      />,
    );
    expect(html).toContain('2 orders');
    expect(html).toContain('5 items');
    // One confirm control for the pair, not one per order.
    expect(html.match(/Confirm table/g)).toHaveLength(1);
  });

  it('disables the decision for a role that cannot make it, and says why', () => {
    const html = renderToStaticMarkup(<HeldTableStrip tables={[table()]} canConfirm={false} />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Confirm table<\/button>/);
    expect(html).toContain('Only an owner, a manager or kitchen staff can confirm a table');
  });

  it('never offers a confirm for an order with no sitting behind it', () => {
    const html = renderToStaticMarkup(<HeldTableStrip tables={[table({ sessionId: null })]} canConfirm />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Confirm table<\/button>/);
    expect(html).toContain('not tied to a table sitting');
  });

  it('does not pretend a held ticket is in the kitchen', () => {
    const html = renderToStaticMarkup(<HeldTableStrip tables={[table()]} canConfirm />);
    expect(html).not.toContain('Cooking');
    expect(html).toContain('held');
  });
});
