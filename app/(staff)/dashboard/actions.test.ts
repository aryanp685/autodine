import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  staff: { result: null as unknown },
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/db/staff', () => ({
  CASHIER_ROLES: ['owner', 'manager', 'cashier'],
  getStaffContext: () => Promise.resolve(mocks.staff.result),
}));

import { checkoutSessionAction, markSessionPaidAction } from './actions';

const SESSION_ID = 'd220f1e4-f155-49b3-a56b-96b59ced7f50';

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.staff.result = null;
});

describe('checkoutSessionAction', () => {
  it('rejects malformed ids before reaching the database', async () => {
    expect(await checkoutSessionAction('T3')).toEqual({
      ok: false,
      error: 'This table session is invalid. Refresh the dashboard.',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('calls the transactional checkout RPC and returns the invoice route', async () => {
    const invoiceId = 'ee1bdc77-e632-40a2-b5f7-4c17139d6d85';
    mocks.staff.result = { supabase: { rpc: mocks.rpc }, role: 'cashier' };
    mocks.rpc.mockResolvedValue({ data: invoiceId, error: null });

    expect(await checkoutSessionAction(SESSION_ID)).toEqual({
      ok: true,
      invoiceId,
      invoiceUrl: `/invoice/${invoiceId}`,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('close_order_session_and_issue_receipt', {
      p_order_session_id: SESSION_ID,
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/dashboard'],
      ['/dashboard/orders'],
      ['/cashier'],
      [`/invoice/${invoiceId}`],
    ]);
  });

  it('does not claim checkout completed when the database refuses', async () => {
    mocks.staff.result = { supabase: { rpc: mocks.rpc }, role: 'manager' };
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Add the restaurant address first.' } });
    expect(await checkoutSessionAction(SESSION_ID)).toEqual({
      ok: false,
      error: 'Add the restaurant address first.',
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('markSessionPaidAction', () => {
  it('rejects malformed ids before reaching the database', async () => {
    const result = await markSessionPaidAction('T6');
    expect(result).toEqual({ ok: false, error: 'This table session is invalid. Refresh the dashboard.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires an authenticated staff session', async () => {
    expect(await markSessionPaidAction(SESSION_ID)).toEqual({
      ok: false,
      error: 'Sign in to mark this table paid.',
    });
  });

  it('rejects roles that cannot collect payment', async () => {
    mocks.staff.result = { supabase: { rpc: mocks.rpc }, role: 'kitchen' };
    expect(await markSessionPaidAction(SESSION_ID)).toEqual({
      ok: false,
      error: 'Your role (kitchen) cannot mark payments. Ask an owner or manager.',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('calls only the session RPC, then invalidates affected staff screens', async () => {
    const paidAt = '2026-11-07T10:42:00.000Z';
    mocks.staff.result = { supabase: { rpc: mocks.rpc }, role: 'owner' };
    mocks.rpc.mockResolvedValue({ data: paidAt, error: null });

    expect(await markSessionPaidAction(SESSION_ID)).toEqual({ ok: true, paidAt });
    expect(mocks.rpc).toHaveBeenCalledWith('mark_order_session_paid', {
      p_order_session_id: SESSION_ID,
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/dashboard'],
      ['/dashboard/orders'],
      ['/cashier'],
    ]);
  });

  it('returns the database refusal without pretending the table was paid', async () => {
    mocks.staff.result = { supabase: { rpc: mocks.rpc }, role: 'cashier' };
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'read-only restaurant' } });

    expect(await markSessionPaidAction(SESSION_ID)).toEqual({
      ok: false,
      error: 'read-only restaurant',
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
