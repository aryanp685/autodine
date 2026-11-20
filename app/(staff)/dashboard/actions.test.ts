import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  selected: vi.fn(),
  outlet: vi.fn(),
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

const selectedOutlet = 'e04b1fdd-d682-4155-97a2-38f54670c7f3';
const cashierContext = (role: string) => ({ role, restaurantId: selectedOutlet, supabase:{ rpc: mocks.rpc,
  from: () => ({select: () => ({eq: () => ({eq: (key: string, id: string) => {
    mocks.outlet(key,id);
    return { maybeSingle:mocks.selected };
  }})})}),
} });

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.selected.mockReset().mockResolvedValue({ data:{ id:SESSION_ID }, error:null });
  mocks.outlet.mockClear();
  mocks.revalidatePath.mockReset();
  mocks.staff.result = null;
});

describe('checkoutSessionAction — buyer GSTIN', () => {
  it('rejects a GSTIN whose checksum fails, before reaching the database', async () => {
    mocks.staff.result = cashierContext('cashier');
    const result = await checkoutSessionAction(SESSION_ID, { name: 'Buyer Foods LLP', gstin: '29ABCDE1234F1Z0' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not usable/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('passes a checksum-valid B2B recipient through to the checkout RPC', async () => {
    const invoiceId = 'ee1bdc77-e632-40a2-b5f7-4c17139d6d85';
    mocks.staff.result = cashierContext('cashier');
    mocks.rpc.mockResolvedValue({ data: invoiceId, error: null });
    const result = await checkoutSessionAction(SESSION_ID, { name: 'Buyer Foods LLP', gstin: '29ABCDE1234F1ZW', address: 'Buyer House, MIDC, Pune - 411001', email: 'Accounts@Buyer.example' });
    expect(result).toEqual({ ok: true, invoiceId, invoiceUrl: `/invoice/${invoiceId}` });
    expect(mocks.rpc).toHaveBeenCalledWith('close_order_session_and_issue_receipt', {
      p_order_session_id: SESSION_ID,
      p_recipient: { name: 'Buyer Foods LLP', gstin: '29ABCDE1234F1ZW', address: 'Buyer House, MIDC, Pune - 411001', email: 'accounts@buyer.example' },
    });
  });
});

describe('checkoutSessionAction', () => {
  it('rejects malformed ids before reaching the database', async () => {
    expect(await checkoutSessionAction('T3')).toEqual({
      ok: false,
      error: 'This table session is invalid. Refresh the dashboard.',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not finish a stale checkout for another outlet', async () => {
    mocks.staff.result = cashierContext('owner');
    mocks.selected.mockResolvedValue({ data:null,error:null });
    expect(await checkoutSessionAction(SESSION_ID)).toMatchObject({ ok:false,error:expect.stringMatching(/selected outlet/) });
    expect(mocks.outlet).toHaveBeenCalledWith('restaurant_id', selectedOutlet);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('calls the transactional checkout RPC and returns the invoice route', async () => {
    const invoiceId = 'ee1bdc77-e632-40a2-b5f7-4c17139d6d85';
    mocks.staff.result = cashierContext('cashier');
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
    mocks.staff.result = cashierContext('manager');
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Add the restaurant address first.' } });
    expect(await checkoutSessionAction(SESSION_ID)).toEqual({
      ok: false,
      error: expect.stringMatching(/Could not verify checkout/),
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

  it('scopes the session to the active outlet and invalidates affected staff screens', async () => {
    const paidAt = '2026-11-07T10:42:00.000Z';
    mocks.staff.result = cashierContext('owner');
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

  it('does not echo the database refusal or pretend the table was paid', async () => {
    mocks.staff.result = cashierContext('cashier');
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'read-only restaurant' } });

    expect(await markSessionPaidAction(SESSION_ID)).toEqual({
      ok: false,
      error: expect.stringMatching(/Could not verify settlement/),
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
