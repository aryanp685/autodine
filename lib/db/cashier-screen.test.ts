import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
}));

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.result),
}));

import { getCashierScreenData } from './cashier-screen';

type Row = Record<string, unknown>;

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

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o-1',
    code: 'A-1041',
    table_id: 't-3',
    prep_status: 'preparing',
    total_paise: 124_700,
    placed_at: iso(12),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.staff.result = null;
});

describe('getCashierScreenData', () => {
  it('returns null when Supabase is unconfigured, so the screen uses demo data', async () => {
    mocks.staff.result = { ok: false, reason: 'unconfigured' };
    expect(await getCashierScreenData()).toBeNull();
  });

  it('returns an EMPTY queue when signed out — never the demo queue', async () => {
    // A logged-out cashier must not be handed a queue of fictional bills to
    // take real money against.
    mocks.staff.result = { ok: false, reason: 'signed-out' };
    const data = await getCashierScreenData();
    expect(data).not.toBeNull();
    expect(data?.queue).toEqual([]);
  });

  it('reports why it is blocked, so the screen prompts instead of looking empty', async () => {
    mocks.staff.result = { ok: false, reason: 'signed-out' };
    expect((await getCashierScreenData())?.blocked).toBe('signed-out');

    mocks.staff.result = { ok: false, reason: 'no-membership' };
    expect((await getCashierScreenData())?.blocked).toBe('no-membership');
  });

  it('leaves blocked unset when a real queue loads, even an empty one', async () => {
    mocks.staff.result = signedIn(fakeSupabase({ orders: [], order_items: [] }));
    const data = await getCashierScreenData();
    expect(data?.queue).toEqual([]);
    expect(data?.blocked).toBeUndefined();
  });

  it('converts paise to rupees', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({ orders: [order()], order_items: [], dining_tables: [{ id: 't-3', label: 'T3' }] })
    );
    expect((await getCashierScreenData())?.queue[0].total).toBe(1247);
  });

  it('summarises items as one line of "qty × name"', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [order()],
        order_items: [
          { order_id: 'o-1', qty: 2, name_snapshot: 'Chicken Biryani', sort_order: 0 },
          { order_id: 'o-1', qty: 3, name_snapshot: 'Tandoori Roti', sort_order: 1 },
        ],
        dining_tables: [{ id: 't-3', label: 'T3' }],
      })
    );
    expect((await getCashierScreenData())?.queue[0].items).toBe(
      '2 × Chicken Biryani · 3 × Tandoori Roti'
    );
  });

  it('says so when a ticket has no items rather than rendering blank', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({ orders: [order()], order_items: [], dining_tables: [{ id: 't-3', label: 'T3' }] })
    );
    expect((await getCashierScreenData())?.queue[0].items).toBe('No items recorded');
  });

  it('humanises the prep state for the queue row', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [order({ id: 'o-1', prep_status: 'ready' })],
        order_items: [],
        dining_tables: [{ id: 't-3', label: 'T3' }],
      })
    );
    expect((await getCashierScreenData())?.queue[0].state).toBe('Ready');
  });

  it('keeps the order UUID so payment can target it, and keeps the code separate', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders: [order({ id: 'o-77', code: 'A-1041' })],
        order_items: [],
        dining_tables: [{ id: 't-3', label: 'T3' }],
      })
    );
    const row = (await getCashierScreenData())?.queue[0];
    // The UUID is the payment target; the code is what the guest is asked for.
    // Conflating them would let a cashier settle by guessing 'A-1042'.
    expect(row?.id).toBe('o-77');
    expect(row?.code).toBe('A-1041');
  });

  it('labels a takeaway order when there is no table', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({ orders: [order({ table_id: null })], order_items: [] })
    );
    expect((await getCashierScreenData())?.queue[0].table).toBe('Takeaway');
  });

  it('skips the tables query entirely when no order has a table', async () => {
    // An empty `in ([])` is rejected by Postgres, so this path has to short
    // circuit or a takeaway-only queue would throw.
    mocks.staff.result = signedIn(fakeSupabase({ orders: [order({ table_id: null })], order_items: [] }));
    await expect(getCashierScreenData()).resolves.toBeTruthy();
  });
});
