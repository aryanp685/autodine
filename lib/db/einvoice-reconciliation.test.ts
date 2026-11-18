import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The e-Invoice reconciliation loader: owner/manager only (the RPC itself is
 * invoker-rights and RLS-scoped), and a faithful mapping of the audit
 * trail's last-attempt fields.
 */

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
  rpc: vi.fn(),
}));

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.result),
}));

import { getEinvoiceReconciliation } from './einvoice-reconciliation';

function signedIn(role: string) {
  return {
    ok: true as const,
    context: {
      role,
      restaurantId: 'r-1',
      supabase: { rpc: mocks.rpc },
    },
  };
}

const ROW = {
  invoice_id: 'inv-1',
  restaurant_id: 'r-1',
  invoice_number: 'INV/26-27/000001',
  document_type: 'gst_tax_invoice',
  irp_status: 'pending',
  is_b2b: true,
  issued_at: '2026-11-14T04:00:00.000Z',
  last_attempt_at: '2026-11-14T05:00:00.000Z',
  attempt_count: 2,
};

beforeEach(() => {
  mocks.staff.result = null;
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: [ROW], error: null });
});

describe('getEinvoiceReconciliation', () => {
  it('a cashier gets an invisible panel and no RPC call', async () => {
    mocks.staff.result = signedIn('cashier');
    expect(await getEinvoiceReconciliation()).toEqual({ ok: true, visible: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('the kitchen role is likewise invisible', async () => {
    mocks.staff.result = signedIn('kitchen');
    expect(await getEinvoiceReconciliation()).toEqual({ ok: true, visible: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('an owner gets mapped rows', async () => {
    mocks.staff.result = signedIn('owner');
    const result = await getEinvoiceReconciliation();
    expect(mocks.rpc).toHaveBeenCalledWith('list_restaurant_irp_reconciliation');
    expect(result).toEqual({
      ok: true,
      visible: true,
      rows: [{
        invoiceId: 'inv-1',
        invoiceNumber: 'INV/26-27/000001',
        documentType: 'gst_tax_invoice',
        irpStatus: 'pending',
        isB2b: true,
        issuedAt: '2026-11-14T04:00:00.000Z',
        lastAttemptAt: '2026-11-14T05:00:00.000Z',
        attemptCount: 2,
      }],
    });
  });

  it('a manager gets the same view', async () => {
    mocks.staff.result = signedIn('manager');
    const result = await getEinvoiceReconciliation();
    expect(result.ok && result.visible && result.rows).toHaveLength(1);
  });

  it('never-attempted documents map null attempt time and zero count', async () => {
    mocks.staff.result = signedIn('owner');
    mocks.rpc.mockResolvedValue({ data: [{ ...ROW, last_attempt_at: null, attempt_count: 0 }], error: null });
    const result = await getEinvoiceReconciliation();
    expect(result.ok && result.visible && result.rows[0].lastAttemptAt).toBeNull();
    expect(result.ok && result.visible && result.rows[0].attemptCount).toBe(0);
  });

  it('an unknown irp_status fails safe to pending', async () => {
    mocks.staff.result = signedIn('owner');
    mocks.rpc.mockResolvedValue({ data: [{ ...ROW, irp_status: 'weird' }], error: null });
    const result = await getEinvoiceReconciliation();
    expect(result.ok && result.visible && result.rows[0].irpStatus).toBe('pending');
  });

  it('an RPC failure reports unavailable, never an empty success', async () => {
    mocks.staff.result = signedIn('owner');
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'function missing' } });
    expect(await getEinvoiceReconciliation()).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('signed-out is propagated, not hidden', async () => {
    mocks.staff.result = { ok: false, reason: 'signed-out' };
    expect(await getEinvoiceReconciliation()).toEqual({ ok: false, reason: 'signed-out' });
  });
});
