import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getDocument: vi.fn(),
  selectEq: vi.fn(),
  staff: { result: null as unknown },
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/db/staff', () => ({
  getStaffContext: () => Promise.resolve(mocks.staff.result),
}));

import { issueInvoiceNoteAction, voidInvoiceNoteAction } from './note-actions';

const INVOICE_ID = 'd220f1e4-f155-49b3-a56b-96b59ced7f50';
const NOTE_ID = 'ee1bdc77-e632-40a2-b5f7-4c17139d6d85';
const REASON = 'Buyer returned the full supply';

const OUTLET_ID = '6503c246-5405-4950-ba4f-cb668677fe0d';
const entitledStaff = (role: string) => ({ role, restaurantId: OUTLET_ID, entitlement: { canWrite: true }, supabase: {
  rpc: mocks.rpc, from: () => ({ select: () => ({ eq: (key: string, value: string) => {
    mocks.selectEq(key, value);
    return { eq: (k: string, v: string) => { mocks.selectEq(k,v); return { maybeSingle: mocks.getDocument }; } };
  } }) }),
} });

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.staff.result = null;
  mocks.getDocument.mockReset().mockResolvedValue({data:{status:'issued',irp_status:'not_required'},error:null});
  mocks.selectEq.mockClear();
});

describe('issueInvoiceNoteAction', () => {
  it('rejects malformed input before reaching the database', async () => {
    expect((await issueInvoiceNoteAction({ invoiceId: 'nope', documentType: 'credit_note', reasonCode: 'other', reason: REASON })).ok).toBe(false);
    expect((await issueInvoiceNoteAction({ invoiceId: INVOICE_ID, documentType: 'invoice', reasonCode: 'other', reason: REASON })).ok).toBe(false);
    expect((await issueInvoiceNoteAction({ invoiceId: INVOICE_ID, documentType: 'credit_note', reasonCode: 'because', reason: REASON })).ok).toBe(false);
    expect((await issueInvoiceNoteAction({ invoiceId: INVOICE_ID, documentType: 'credit_note', reasonCode: 'other', reason: 'abc' })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses kitchen and cashier staff before the RPC', async () => {
    for (const role of ['kitchen', 'cashier']) {
      mocks.staff.result = { supabase: { rpc: mocks.rpc }, role };
      const result = await issueInvoiceNoteAction({ invoiceId: INVOICE_ID, documentType: 'credit_note', reasonCode: 'returned_supply', reason: REASON });
      expect(result).toEqual({ ok: false, error: 'Only an owner or manager can issue a credit or debit note.' });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires sign-in', async () => {
    mocks.staff.result = null;
    const result = await issueInvoiceNoteAction({ invoiceId: INVOICE_ID, documentType: 'credit_note', reasonCode: 'other', reason: REASON });
    expect(result).toEqual({ ok: false, error: 'Sign in to issue a note.' });
  });

  it('calls the transactional RPC as an owner and passes values through', async () => {
    mocks.staff.result = entitledStaff('owner');
    mocks.rpc.mockResolvedValue({ data: NOTE_ID, error: null });
    const result = await issueInvoiceNoteAction({ invoiceId: INVOICE_ID, documentType: 'credit_note', reasonCode: 'returned_supply', reason: `  ${REASON}  ` });
    expect(result).toEqual({ ok: true, id: NOTE_ID });
    expect(mocks.rpc).toHaveBeenCalledWith('issue_invoice_note', {
      p_invoice_id: INVOICE_ID,
      p_document_type: 'credit_note',
      p_reason_code: 'returned_supply',
      p_reason: REASON,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/dashboard/invoices');
  });

  it('requires the selected outlet and keeps managers from writing activated notes', async () => {
    mocks.staff.result = entitledStaff('manager');
    const input = { invoiceId: INVOICE_ID, documentType: 'credit_note', reasonCode: 'returned_supply', reason: REASON };
    mocks.getDocument.mockResolvedValueOnce({ data: null, error:null });
    expect(await issueInvoiceNoteAction(input)).toMatchObject({ ok:false,error:expect.stringMatching(/selected outlet/i) });
    expect(mocks.selectEq).toHaveBeenCalledWith('restaurant_id',OUTLET_ID);
    mocks.getDocument.mockResolvedValueOnce({ data:{status:'issued',irp_status:'not_required',seller_snapshot:{activation_effective_from:'2026-11-19'}},error:null });
    expect(await issueInvoiceNoteAction(input)).toMatchObject({ ok:false,error:expect.stringMatching(/only the outlet owner/i) });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('surfaces the database refusal without inventing success', async () => {
    mocks.staff.result = entitledStaff('manager');
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Credit/debit notes exist only against GST documents (a tax invoice or a Bill of Supply).' } });
    const result = await issueInvoiceNoteAction({ invoiceId: INVOICE_ID, documentType: 'debit_note', reasonCode: 'other', reason: REASON });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('GST documents');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('voidInvoiceNoteAction', () => {
  it('rejects malformed input and unauthorized roles', async () => {
    expect((await voidInvoiceNoteAction({ noteId: 'T7', reason: REASON })).ok).toBe(false);
    mocks.staff.result = { supabase: { rpc: mocks.rpc }, role: 'cashier' };
    expect((await voidInvoiceNoteAction({ noteId: NOTE_ID, reason: REASON }))).toEqual({
      ok: false,
      error: 'Only an owner or manager can void a credit or debit note.',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('voids through the RPC and revalidates the invoices page', async () => {
    mocks.staff.result = entitledStaff('owner');
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await voidInvoiceNoteAction({ noteId: NOTE_ID, reason: REASON })).toEqual({ ok: true, id: NOTE_ID });
    expect(mocks.rpc).toHaveBeenCalledWith('void_invoice_note', { p_note_id: NOTE_ID, p_reason: REASON });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/dashboard/invoices');
  });
});
