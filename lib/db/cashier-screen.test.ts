import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
}));

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.result),
}));

import { getCashierScreenData } from './cashier-screen';

type Row = Record<string, unknown>;

function fakeSupabase(rows: Record<string, Row[]>, errors: Record<string, string> = {}) {
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
      maybeSingle: () => Promise.resolve({
        data: errors[table] ? null : data[0] ?? null,
        error: errors[table] ? { message: errors[table] } : null,
      }),
      then: (onFulfilled?: unknown, onRejected?: unknown) =>
        Promise.resolve({ data: errors[table] ? null : data, error: errors[table] ? { message: errors[table] } : null }).then(
          onFulfilled as () => unknown,
          onRejected as () => unknown
        ),
    };
    return chain;
  };
  return {
    from,
    // Migration 20261026001300's UPI claims. This mock has none: the queue's
    // "guest says paid" marker is exercised separately, and every row here is
    // therefore a plain unpaid ticket.
    rpc: () => Promise.resolve({ data: [], error: null }),
  } as never;
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
  it.each(['orders', 'items', 'item_variants', 'dining_tables', 'order_items'])('does not hide a failed %s read from waiters', async (table) => {
    const staff = signedIn(fakeSupabase({ orders: [order()] }, { [table]: 'database unavailable' }));
    mocks.staff.result = { ...staff, context: { ...staff.context, role: 'waiter' } };
    await expect(getCashierScreenData()).rejects.toThrow(/database unavailable/);
  });

  it('does not hide a failed table read when the queue is empty', async () => {
    mocks.staff.result = signedIn(fakeSupabase({}, { dining_tables: 'database unavailable' }));
    await expect(getCashierScreenData()).rejects.toThrow(/database unavailable/);
  });

  it.each(['items', 'item_variants', 'dining_tables', 'payments'])('does not present a failed %s read as an empty counter', async (table) => {
    mocks.staff.result = signedIn(
      fakeSupabase({ orders_finance: [order()] }, { [table]: 'database unavailable' }),
    );
    await expect(getCashierScreenData()).rejects.toThrow(/database unavailable/);
  });

  it.each(['orders_finance', 'payments'])('does not hide a failed %s refund-history read', async (table) => {
    const supabase = fakeSupabase({});
    const originalFrom = (supabase as { from: (name: string) => unknown }).from;
    let financeReads = 0;
    const from = (name: string) => {
      if (name === 'orders_finance') {
        financeReads += 1;
        if (financeReads === 2) {
          return (fakeSupabase(
            { orders_finance: [order()] },
            table === 'orders_finance' ? { orders_finance: 'refund history unavailable' } : {},
          ) as { from: (name: string) => unknown }).from(name);
        }
      }
      if (name === 'payments') {
        return (fakeSupabase({}, { payments: 'refund history unavailable' }) as { from: (name: string) => unknown }).from(name);
      }
      return originalFrom(name);
    };
    const staff = signedIn({ ...(supabase as object), from });
    mocks.staff.result = { ...staff, context: { ...staff.context, role: 'owner' } };
    await expect(getCashierScreenData()).rejects.toThrow(/refund history unavailable/);
  });

  it.each(['restaurant_gst_config', 'restaurant_coupons', 'order_sessions'])('rejects a failed %s read rather than showing default billing data', async (table) => {
    mocks.staff.result = signedIn(fakeSupabase({}, { [table]: 'billing data unavailable' }));
    await expect(getCashierScreenData()).rejects.toThrow(/billing data unavailable/);
  });

  it('does not hide a failed session-order read', async () => {
    const supabase = fakeSupabase({ order_sessions: [{ id: 's-1', table_id: null }] });
    const originalFrom = (supabase as { from: (name: string) => unknown }).from;
    let reads = 0;
    const from = (name: string) => {
      if (name === 'orders_finance' && ++reads === 2) {
        return (fakeSupabase({}, { orders_finance: 'session orders unavailable' }) as { from: (name: string) => unknown }).from(name);
      }
      return originalFrom(name);
    };
    mocks.staff.result = signedIn({ ...(supabase as object), from });
    await expect(getCashierScreenData()).rejects.toThrow(/session orders unavailable/);
  });

  it('propagates rejected session reads instead of claiming there are no sessions', async () => {
    const supabase = fakeSupabase({});
    const originalFrom = (supabase as { from: (name: string) => unknown }).from;
    const from = (name: string) => {
      if (name !== 'order_sessions') return originalFrom(name);
      const chain = {
        select: () => chain,
        eq: () => chain,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.reject(new Error('session connection failed')).then(resolve, reject),
      };
      return chain;
    };
    mocks.staff.result = signedIn({ ...(supabase as object), from });
    await expect(getCashierScreenData()).rejects.toThrow('session connection failed');
  });

  it('preserves restaurant identity, printers and operating mode on an empty counter', async () => {
    const printer = { id: 'printer-1', restaurant_id: 'r-1', name: 'Counter printer' };
    const staff = signedIn(fakeSupabase({ restaurant_printers: [printer] }));
    mocks.staff.result = { ...staff, context: { ...staff.context, operatingMode: 'mode_a', posIntegrationName: 'Existing POS' } };
    const data = await getCashierScreenData();
    expect(data?.queue).toEqual([]);
    expect(data?.restaurantId).toBe('r-1');
    expect(data?.printers).toEqual([expect.objectContaining({ id: printer.id, name: printer.name })]);
    expect(data?.operatingMode).toBe('mode_a');
    expect(data?.posIntegrationName).toBe('Existing POS');
  });

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
    mocks.staff.result = signedIn(fakeSupabase({ orders_finance: [], order_items: [] }));
    const data = await getCashierScreenData();
    expect(data?.queue).toEqual([]);
    expect(data?.blocked).toBeUndefined();
  });

  describe('outstanding balance', () => {
    // record_cash_payment accepts EXACTLY the outstanding balance and nothing
    // else, so if this arithmetic is wrong the till rejects every payment.

    it('equals the total when nothing has been recorded', async () => {
      mocks.staff.result = signedIn(
        fakeSupabase({ orders_finance: [order()], order_items: [], dining_tables: [{ id: 't-3', label: 'T3' }] })
      );
      const row = (await getCashierScreenData())?.queue[0];
      expect(row?.total).toBe(1247);
      expect(row?.outstanding).toBe(1247);
      expect(row?.paid).toBe(0);
    });

    it('subtracts a recorded partial payment', async () => {
      mocks.staff.result = signedIn(
        fakeSupabase({
          orders_finance: [order()],
          order_items: [],
          dining_tables: [{ id: 't-3', label: 'T3' }],
          payments: [{ order_id: 'o-1', amount_paise: 50_000, status: 'recorded' }],
        })
      );
      const row = (await getCashierScreenData())?.queue[0];
      expect(row?.paid).toBe(500);
      expect(row?.outstanding).toBe(747);
    });

    it('ignores failed and refunded attempts — no cash actually moved', async () => {
      // The regression this guards: counting a declined attempt as paid would
      // understate the balance and let the guest leave owing money.
      mocks.staff.result = signedIn(
        fakeSupabase({
          orders_finance: [order()],
          order_items: [],
          dining_tables: [{ id: 't-3', label: 'T3' }],
          payments: [
            { order_id: 'o-1', amount_paise: 50_000, status: 'failed' },
            { order_id: 'o-1', amount_paise: 20_000, status: 'refunded' },
            { order_id: 'o-1', amount_paise: 30_000, status: 'recorded' },
          ],
        })
      );
      const row = (await getCashierScreenData())?.queue[0];
      expect(row?.paid).toBe(300);
      expect(row?.outstanding).toBe(947);
    });

    it('never goes negative on an overpaid order', async () => {
      mocks.staff.result = signedIn(
        fakeSupabase({
          orders_finance: [order()],
          order_items: [],
          dining_tables: [{ id: 't-3', label: 'T3' }],
          payments: [{ order_id: 'o-1', amount_paise: 200_000, status: 'recorded' }],
        })
      );
      const row = (await getCashierScreenData())?.queue[0];
      expect(row?.outstanding).toBe(0);
      // paid is clamped to the total too: a negative "amount due" would be a
      // payment the cashier physically cannot collect.
      expect(row?.paid).toBe(1247);
    });

    it('sums several recorded payments against one order', async () => {
      mocks.staff.result = signedIn(
        fakeSupabase({
          orders_finance: [order()],
          order_items: [],
          dining_tables: [{ id: 't-3', label: 'T3' }],
          payments: [
            { order_id: 'o-1', amount_paise: 20_000, status: 'recorded' },
            { order_id: 'o-1', amount_paise: 30_000, status: 'recorded' },
          ],
        })
      );
      expect((await getCashierScreenData())?.queue[0].outstanding).toBe(747);
    });
  });

  it('converts paise to rupees', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({ orders_finance: [order()], order_items: [], dining_tables: [{ id: 't-3', label: 'T3' }] })
    );
    expect((await getCashierScreenData())?.queue[0].total).toBe(1247);
  });

  it('summarises items as one line of "qty × name"', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders_finance: [order()],
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
      fakeSupabase({ orders_finance: [order()], order_items: [], dining_tables: [{ id: 't-3', label: 'T3' }] })
    );
    expect((await getCashierScreenData())?.queue[0].items).toBe('No items recorded');
  });

  it('humanises the prep state for the queue row', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders_finance: [order({ id: 'o-1', prep_status: 'ready' })],
        order_items: [],
        dining_tables: [{ id: 't-3', label: 'T3' }],
      })
    );
    expect((await getCashierScreenData())?.queue[0].state).toBe('Ready');
  });

  it('keeps the order UUID so payment can target it, and keeps the code separate', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        orders_finance: [order({ id: 'o-77', code: 'A-1041' })],
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
      fakeSupabase({ orders_finance: [order({ table_id: null })], order_items: [] })
    );
    expect((await getCashierScreenData())?.queue[0].table).toBe('Takeaway');
  });

  it('skips the tables query entirely when no order has a table', async () => {
    // An empty `in ([])` is rejected by Postgres, so this path has to short
    // circuit or a takeaway-only queue would throw.
    mocks.staff.result = signedIn(fakeSupabase({ orders_finance: [order({ table_id: null })], order_items: [] }));
    await expect(getCashierScreenData()).resolves.toBeTruthy();
  });
});
