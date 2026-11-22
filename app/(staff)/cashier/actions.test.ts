import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  order: vi.fn(), payment: vi.fn(), receipt: vi.fn(), rpc: vi.fn(), eq: vi.fn(), revalidate: vi.fn(), staff: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/db/staff', () => ({ getStaffContext: mocks.staff, CASHIER_ROLES: ['owner', 'manager', 'cashier'] }));
import { recordPaymentAction } from './actions';

const OUTLET = '20878f43-fcd6-4a6f-87ee-4d4751923611';
const ORDER = '20ca337b-2848-486c-b0e0-dba94f8d07a4';
const KEY = '41336404-5cb5-4a70-82f9-04453c936d5f';
const PAYMENT = '8115f898-7fa9-418f-86fc-14588ed0d597';
const RECEIPT = '8115f821-7fa9-418f-86fc-14588ed0d597';
const input = { orderId: ORDER, amountPaise: 10511, method: 'card', idempotencyKey: KEY };
const order = { id: ORDER, code: 'JO-12345', total_paise: 10511, prep_status: 'served', payment_status: 'pending' };
const saved = { id: PAYMENT, amount_paise: '10511', status: 'recorded', method: 'card' };
const ok = (data: unknown) => ({ data, error: null });
function ctx(role: string) {
  return {
    restaurantId: OUTLET, slug: 'test-outlet', role, supabase: {
      rpc: mocks.rpc,
      from: (table: string) => {
        const result = table === 'orders_finance' ? mocks.order : table === 'payments' ? mocks.payment : mocks.receipt;
        const query = { eq: (key: string, value: string) => { mocks.eq(table, key, value); return query; }, maybeSingle: result };
        return { select: () => query };
      },
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.staff.mockResolvedValue(ctx('cashier'));
  mocks.order.mockResolvedValue(ok(order));
  mocks.payment.mockResolvedValue(ok(null));
  mocks.receipt.mockResolvedValue(ok({ id: RECEIPT }));
  mocks.rpc.mockResolvedValue(ok(PAYMENT));
});

describe('verified counter recording', () => {
  it('uses the verified amount in paise, not an amount substituted on the server', async () => {
    mocks.order.mockResolvedValue(ok({ ...order, total_paise: 10512 }));
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'row-detail marker' } });
    const result = await recordPaymentAction(input);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Do not collect again') });
    expect(JSON.stringify(result)).not.toContain('row-detail marker');
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('record_counter_payment', {
      p_restaurant_slug: 'test-outlet', p_order_id: ORDER, p_method: 'card', p_amount_paise: 10511, p_idempotency_key: KEY,
      // null, not undefined: one call shape for every method; the RPC ignores
      // it unless the method is UPI.
      p_upi_ref: null,
    });
  });

  it('refuses a UPI recording with no transaction reference, and never calls the RPC', async () => {
    const { recordPaymentAction: act } = await import('./actions');
    void act;
    const upi = { ...input, method: 'upi' };
    expect(await recordPaymentAction(upi)).toEqual({
      ok: false,
      error: 'Enter the UPI transaction reference (the TRN/RRN shown in the UPI app) before recording a UPI payment.',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sends the UPI reference through to the RPC for a UPI recording', async () => {
    const result = await recordPaymentAction({ ...input, method: 'upi', upiRef: '412345678901' });
    expect(result).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('record_counter_payment', expect.objectContaining({
      p_method: 'upi', p_upi_ref: '412345678901',
    }));
  });

  it('returns the exact recorded tender even after the ticket became paid', async () => {
    mocks.order.mockResolvedValue(ok({ ...order, payment_status: 'paid' }));
    mocks.payment.mockResolvedValue(ok(saved));
    expect(await recordPaymentAction(input)).toEqual({ ok: true, message: 'CARD ₹105.11 recorded for JO-12345. Ref 8115f898.', paymentReceiptUrl: `/invoice/payment/${RECEIPT}` });
    expect(mocks.eq).toHaveBeenCalledWith('payments', 'restaurant_id', OUTLET);
    expect(mocks.eq).toHaveBeenCalledWith('payments', 'idempotency_key', `card:${OUTLET}:${ORDER}:${KEY}`);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('reconciles a lost write response with a read of the exact committed row', async () => {
    mocks.rpc.mockRejectedValue(new Error('private transport marker'));
    mocks.payment.mockResolvedValueOnce(ok(null)).mockResolvedValueOnce(ok(saved));
    expect(await recordPaymentAction(input)).toMatchObject({ ok: true });
    expect(mocks.payment).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('does not invent a confirmation when there is no exact record', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '', message: 'private transport marker' } });
    expect(await recordPaymentAction(input)).toMatchObject({ ok: false, unconfirmed: true });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    mocks.order.mockResolvedValue(ok({ ...order, payment_status: 'paid' }));
    mocks.payment.mockResolvedValue(ok({ ...saved, amount_paise: 10512 }));
    expect(await recordPaymentAction(input)).toMatchObject({ ok: false });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('a reconciliation-only request cannot record anything even on a pending ticket', async () => {
    expect(await recordPaymentAction({ ...input, checkOnly: true })).toMatchObject({ ok: false, unconfirmed: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.payment.mockResolvedValue(ok(saved));
    expect(await recordPaymentAction({ ...input, checkOnly: true })).toMatchObject({ ok: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses a different outlet, staff without payment permission and invalid amounts', async () => {
    mocks.order.mockResolvedValue(ok(null));
    expect(await recordPaymentAction(input)).toMatchObject({ ok: false });
    expect(mocks.eq).toHaveBeenCalledWith('orders_finance', 'restaurant_id', OUTLET);
    mocks.staff.mockResolvedValue(ctx('kitchen'));
    expect(await recordPaymentAction(input)).toMatchObject({ ok: false, error: expect.stringContaining('cannot collect') });
    expect(await recordPaymentAction({ ...input, amountPaise: 1.1 })).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
