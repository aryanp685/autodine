import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The chainable supabase client is mocked rather than the network.
 *
 * These tests cover the mapping from database rows to board tickets, which is
 * where the money unit, the table join and the age maths can go wrong. They
 * deliberately do NOT cover SQL semantics -- the cancelled filter and the time
 * window are enforced by Postgres and can only be verified against a real
 * database, which this sandbox does not have.
 */

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
}));

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.result),
}));

import { getKitchenScreenData } from './kitchen-screen';

type Row = Record<string, unknown>;

/**
 * A thenable chain: every builder method returns the same object and awaiting
 * it yields the rows registered for that table. Close enough to supabase-js's
 * PostgrestFilterBuilder for the shapes these queries use.
 */
function fakeSupabase(rows: Record<string, Row[]>) {
  const from = (table: string) => {
    const data = rows[table] ?? [];
    // Not annotated as PromiseLike on purpose: the real client's generics
    // cannot be satisfied by a hand-rolled mock, and the object is returned
    // as `never` anyway. `await` and Promise.all only need .then to exist.
    const chain = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      gte: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (onFulfilled?: unknown, onRejected?: unknown) =>
        Promise.resolve({ data, error: null }).then(
          onFulfilled as () => unknown,
          onRejected as () => unknown
        ),
    };
    return chain;
  };
  return { from } as never;
}

function signedIn(supabase: unknown) {
  return {
    ok: true as const,
    context: { supabase, restaurantId: 'r-1', restaurantName: 'Saffron & Smoke' },
  };
}

const NOW = Date.now();
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

beforeEach(() => {
  mocks.staff.result = null;
});

describe('getKitchenScreenData', () => {
  it('returns null when Supabase is unconfigured, so the screen uses demo data', async () => {
    mocks.staff.result = { ok: false, reason: 'unconfigured' };
    expect(await getKitchenScreenData()).toBeNull();
  });

  it('returns an EMPTY board when signed out — never the demo tickets', async () => {
    // The regression this guards: falling back to demo data for a logged-out
    // user makes six fictional tickets look like the restaurant's real board.
    mocks.staff.result = { ok: false, reason: 'signed-out' };
    const data = await getKitchenScreenData();
    expect(data).not.toBeNull();
    expect(data?.tickets).toEqual([]);
  });

  it('returns an empty board when the user belongs to no restaurant', async () => {
    mocks.staff.result = { ok: false, reason: 'no-membership' };
    expect((await getKitchenScreenData())?.tickets).toEqual([]);
  });

  it('reports WHY it is blocked, so the screen can prompt instead of looking empty', async () => {
    // A blank board reads as "quiet service". These two states must be
    // distinguishable or a signed-out cook waits for orders that cannot come.
    mocks.staff.result = { ok: false, reason: 'signed-out' };
    expect((await getKitchenScreenData())?.blocked).toBe('signed-out');

    mocks.staff.result = { ok: false, reason: 'no-membership' };
    expect((await getKitchenScreenData())?.blocked).toBe('no-membership');
  });

  it('leaves blocked unset when a real board loads, even an empty one', async () => {
    mocks.staff.result = signedIn(fakeSupabase({ orders: [], order_items: [] }));
    const data = await getKitchenScreenData();
    expect(data?.tickets).toEqual([]);
    expect(data?.blocked).toBeUndefined();
  });

  it('converts paise to rupees and keeps an integer-safe total', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [
          {
            id: 'o-1',
            code: 'A-1042',
            table_id: null,
            customer_note: null,
            prep_status: 'new',
            payment_status: 'pending',
            total_paise: 77_600,
            placed_at: iso(4),
          },
        ],
        order_items: [],
      })
    );

    const ticket = (await getKitchenScreenData())?.tickets[0];
    expect(ticket?.total).toBe(776);
  });

  it('joins the table label and falls back to Takeaway', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [
          {
            id: 'o-1',
            code: 'A-1',
            table_id: 't-7',
            customer_note: null,
            prep_status: 'new',
            payment_status: 'paid',
            total_paise: 100,
            placed_at: iso(1),
          },
          {
            id: 'o-2',
            code: 'A-2',
            table_id: null,
            customer_note: null,
            prep_status: 'new',
            payment_status: 'paid',
            total_paise: 100,
            placed_at: iso(1),
          },
        ],
        order_items: [],
        dining_tables: [{ id: 't-7', label: 'T7' }],
      })
    );

    const tickets = (await getKitchenScreenData())?.tickets ?? [];
    expect(tickets.find((t) => t.code === 'A-1')?.table).toBe('T7');
    expect(tickets.find((t) => t.code === 'A-2')?.table).toBe('Takeaway');
  });

  it('computes age in minutes from placed_at', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [
          {
            id: 'o-1',
            code: 'A-1',
            table_id: null,
            customer_note: null,
            prep_status: 'new',
            payment_status: 'paid',
            total_paise: 100,
            placed_at: iso(23),
          },
        ],
        order_items: [],
      })
    );

    // 23 minutes is past the 20-minute "late" threshold the board colours by.
    expect((await getKitchenScreenData())?.tickets[0].ageMin).toBe(23);
  });

  it('builds the item detail from variant and addons, in that order', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [
          {
            id: 'o-1',
            code: 'A-1',
            table_id: null,
            customer_note: null,
            prep_status: 'new',
            payment_status: 'paid',
            total_paise: 100,
            placed_at: iso(1),
          },
        ],
        order_items: [
          {
            order_id: 'o-1',
            qty: 2,
            name_snapshot: 'Butter Naan',
            variant_snapshot: 'Regular',
            addons_snapshot: ['Butter', 'Garlic'],
            is_veg: true,
            sort_order: 0,
          },
        ],
      })
    );

    const items = (await getKitchenScreenData())?.tickets[0].items ?? [];
    expect(items[0]).toEqual({
      qty: 2,
      name: 'Butter Naan',
      // `detail` is what the voice reads: portion first, then every add-on.
      detail: 'Regular · Butter · Garlic',
      // The same facts, split for the ticket card: the portion qualifies the
      // dish, the add-ons are tags pinned to it.
      portion: 'Regular',
      addons: ['Butter', 'Garlic'],
      veg: true,
    });
  });

  it('omits detail entirely when there is no variant or addons', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [
          {
            id: 'o-1',
            code: 'A-1',
            table_id: null,
            customer_note: null,
            prep_status: 'new',
            payment_status: 'paid',
            total_paise: 100,
            placed_at: iso(1),
          },
        ],
        order_items: [
          {
            order_id: 'o-1',
            qty: 1,
            name_snapshot: 'Mango Lassi',
            variant_snapshot: null,
            addons_snapshot: [],
            is_veg: true,
            sort_order: 0,
          },
        ],
      })
    );

    const items = (await getKitchenScreenData())?.tickets[0].items ?? [];
    // undefined, not '' — an empty string would render a dangling ' · '.
    expect(items[0].detail).toBeUndefined();
  });

  it('reads a refunded order as paid, so it is not badged unpaid', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [
          {
            id: 'o-1',
            code: 'A-1',
            table_id: null,
            customer_note: null,
            prep_status: 'new',
            payment_status: 'refunded',
            total_paise: 100,
            placed_at: iso(1),
          },
        ],
        order_items: [],
      })
    );

    expect((await getKitchenScreenData())?.tickets[0].payment).toBe('paid');
  });

  it('keeps the order UUID so the advance button can target it', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [
          {
            id: 'o-99',
            code: 'A-1',
            table_id: null,
            customer_note: 'Ring the bell',
            prep_status: 'new',
            payment_status: 'paid',
            total_paise: 100,
            placed_at: iso(1),
          },
        ],
        order_items: [],
      })
    );

    const ticket = (await getKitchenScreenData())?.tickets[0];
    expect(ticket?.id).toBe('o-99');
    expect(ticket?.note).toBe('Ring the bell');
  });
});
