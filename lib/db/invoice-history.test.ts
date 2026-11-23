import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ staff: vi.fn() }));
vi.mock('./staff', () => ({
  CASHIER_ROLES: ['owner', 'manager', 'cashier'],
  getStaffContextDetailed: () => mocks.staff(),
}));

import { getInvoiceHistory } from './invoice-history';

const session = {
  id: 'session-1', restaurant_id: 'restaurant-1', table_id: 'table-1',
  opened_at: '2026-11-22T08:00:00Z', closed_at: '2026-11-22T09:00:00Z', status: 'closed',
};
const invoice = {
  id: 'invoice-1', order_session_id: 'session-1', invoice_number: 'INV-1',
  status: 'issued', issued_at: '2026-11-22T09:00:00Z', table_label_snapshot: 'Original table',
  document_type: 'receipt', irp_status: 'not_required',
  totals_snapshot: { total_paise: 2500, payment_status: 'paid' },
};

function setup({ role = 'owner', total = 2500 as unknown, snapshot = 'Original table' as string | null, errorTable = '', sessions = [session] } = {}) {
  const rows: Record<string, unknown[]> = {
    order_sessions: sessions,
    dining_tables: [{ id: 'table-1', label: 'Renamed table' }],
    restaurant_invoices: [{ ...invoice, table_label_snapshot: snapshot, totals_snapshot: { total_paise: total, payment_status: 'paid' } }],
  };
  const calls: { table: string; filters: [string, unknown][] }[] = [];
  const from = vi.fn((table: string) => {
    const call = { table, filters: [] as [string, unknown][] };
    calls.push(call);
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => { call.filters.push([column, value]); return chain; }),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: table === errorTable ? null : rows[table],
        error: table === errorTable ? { message: 'read failed' } : null,
      }).then(resolve),
    };
    return chain;
  });
  mocks.staff.mockResolvedValue({ ok: true, context: { role, restaurantId: 'restaurant-1', supabase: { from } } });
  return { from, calls };
}

beforeEach(() => vi.clearAllMocks());

describe('invoice history', () => {
  it.each([null, '', ' ', false, true, [], {}, -1, 1.5, Infinity])('does not invent a total for invalid snapshot %j', async (total) => {
    setup({ total });
    const result = await getInvoiceHistory();
    expect(result.ok && result.rows[0].invoice?.totalPaise).toBeNull();
  });

  it.each([0, '0', 2500, '2500'])('retains valid snapshot total %j', async (total) => {
    setup({ total });
    const result = await getInvoiceHistory();
    expect(result.ok && result.rows[0].invoice?.totalPaise).toBe(Number(total));
  });

  it('uses the immutable table label rather than a renamed live table', async () => {
    const { calls } = setup();
    const result = await getInvoiceHistory();
    expect(result.ok && result.rows[0].tableLabel).toBe('Original table');
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.filters).toContainEqual(['restaurant_id', 'restaurant-1']);
  });

  it('uses the live label when a legacy invoice has no saved label', async () => {
    setup({ snapshot: null });
    const result = await getInvoiceHistory();
    expect(result.ok && result.rows[0].tableLabel).toBe('Renamed table');
  });

  it.each(['owner', 'manager', 'cashier'])('allows %s to read invoices', async (role) => {
    setup({ role });
    expect((await getInvoiceHistory()).ok).toBe(true);
  });

  it.each(['waiter', 'kitchen'])('denies %s before querying invoices', async (role) => {
    const { from } = setup({ role });
    expect(await getInvoiceHistory()).toEqual({ ok: false, reason: 'role-denied' });
    expect(from).not.toHaveBeenCalled();
  });

  it.each(['signed-out', 'no-membership', 'unconfigured'])('preserves %s auth failure', async (reason) => {
    mocks.staff.mockResolvedValue({ ok: false, reason });
    expect(await getInvoiceHistory()).toEqual({ ok: false, reason });
  });

  it.each(['order_sessions', 'dining_tables', 'restaurant_invoices'])('surfaces %s read errors', async (errorTable) => {
    setup({ errorTable });
    await expect(getInvoiceHistory()).rejects.toThrow('read failed');
  });

  it('returns a genuine empty state without querying invoices', async () => {
    const { from } = setup({ sessions: [] });
    expect(await getInvoiceHistory()).toEqual({ ok: true, rows: [] });
    expect(from).toHaveBeenCalledTimes(1);
  });
});
