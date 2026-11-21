import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The e-Invoice attempt action. The thread: the provider gate and the role
 * check run before anything is recorded; a failure before payload_built is
 * never recorded; every submitted attempt leaves a full audit trail; and the
 * document is NEVER marked generated from here.
 */

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
  rpc: vi.fn(),
  loadSources: vi.fn(),
  getAdapter: vi.fn(),
  generateIrn: vi.fn(),
}));

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.result),
}));

vi.mock('@/lib/gst/einvoice-server', () => ({
  loadEinvoiceSources: (...args: unknown[]) => mocks.loadSources(...args),
}));

vi.mock('@/lib/gst/adapter', () => ({
  getIrpAdapter: () => mocks.getAdapter(),
}));

import { attemptEinvoiceAction } from './einvoice-actions';

const INVOICE_ID = 'ee1bdc77-e632-40a2-b5f7-4c17139d6d85';

const SOURCES = {
  timeZone: 'Asia/Kolkata',
  invoice: {
    invoiceNumber: 'INV/26-27/000001',
    issuedLocalDate: '2026-11-14',
    irpStatus: 'pending',
    status: 'issued',
    documentType: 'gst_tax_invoice',
    gst: { rateBps: 500, taxablePaise: 10000, cgstPaise: 250, sgstPaise: 250, igstPaise: 0, placeOfSupplyStateCode: '27' },
    totals: { subtotalPaise: 10500, taxPaise: 500, totalPaise: 10500 },
    seller: { name: 'GST Test', tradeName: 'GST Test', address: 'Registered office, Test Lane, Nagpur - 440001', phone: null },
    recipient: { name: 'Buyer Foods LLP', gstin: '29ABCDE1234F1ZW', address: 'Buyer House, MIDC, Pune - 411001', email: 'accounts@buyer.example' },
    lines: [{ itemName: 'Plate', quantity: 2, unitPricePaise: 5000, amountPaise: 10000 }],
  },
  profile: {
    mode: 'regular',
    registrationType: 'regular',
    gstin: '27AAAAA0000A1Z2',
    legalName: 'GST Test Kitchen LLP',
    tradeName: 'GST Test',
    address: 'Registered office, Test Lane, Nagpur - 440001',
    stateCode: '27',
    precedingFyTurnoverPaise: 6_000_000_000,
    einvoiceLocation: 'Nagpur',
    einvoicePincode: '440001',
    einvoiceHsnSac: '996331',
  },
};

function signedIn(role = 'owner') {
  return {
    ok: true as const,
    context: {
      role,
      restaurantId: 'r-1',
      restaurantName: 'Maddi',
      supabase: { rpc: mocks.rpc },
    },
  };
}

const SANDBOX = { ok: true as const, adapter: { providerId: 'sandbox', generateIrn: (...args: unknown[]) => mocks.generateIrn(...args) } };
const ACK = {
  irn: 'a'.repeat(64),
  ackNo: 1234567890,
  ackDateIso: '2026-11-14T00:00:00.000Z',
  signedQrCode: Buffer.from('qr').toString('base64'),
  signedInvoice: Buffer.from('si').toString('base64'),
};

beforeEach(() => {
  mocks.staff.result = null;
  mocks.rpc.mockReset();
  mocks.loadSources.mockReset();
  mocks.getAdapter.mockReset();
  mocks.generateIrn.mockReset();
  mocks.rpc.mockResolvedValue({ data: 'attempt-uuid', error: null });
  mocks.getAdapter.mockReturnValue(SANDBOX);
  mocks.loadSources.mockResolvedValue({ ok: true, sources: SOURCES });
  mocks.generateIrn.mockResolvedValue({ ok: true, ack: ACK });
});

describe('attemptEinvoiceAction — gates before anything is recorded', () => {
  it('refuses when the provider gate is closed, before staff or the database', async () => {
    mocks.getAdapter.mockReturnValue({ ok: false, error: 'E-invoicing is not enabled on this deployment (AUTODINE_IRP_PROVIDER is unset). Nothing was attempted.' });
    const result = await attemptEinvoiceAction(INVOICE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/AUTODINE_IRP_PROVIDER/);
    expect(mocks.loadSources).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed ids before the gate', async () => {
    const result = await attemptEinvoiceAction('T3');
    expect(result).toEqual({ ok: false, error: 'This document is invalid. Refresh and try again.' });
    expect(mocks.getAdapter).not.toHaveBeenCalled();
  });

  it('an unwired provider name is an explicit refusal, never a fallback', async () => {
    mocks.getAdapter.mockReturnValue({ ok: false, error: "Provider 'nic' is not wired into this build." });
    const result = await attemptEinvoiceAction(INVOICE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not wired/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('a cashier is refused before any database read', async () => {
    mocks.staff.result = signedIn('cashier');
    const result = await attemptEinvoiceAction(INVOICE_ID);
    expect(result).toEqual({ ok: false, error: 'Only the owner or a manager can attempt e-invoice issuance.' });
    expect(mocks.loadSources).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('attemptEinvoiceAction — preparation failures record nothing', () => {
  it('a document that loads but fails preparation records no attempt', async () => {
    mocks.staff.result = signedIn('owner');
    mocks.loadSources.mockResolvedValue({
      ok: true,
      sources: { ...SOURCES, invoice: { ...SOURCES.invoice, irpStatus: 'not_required' } },
    });
    const result = await attemptEinvoiceAction(INVOICE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not_required/);
    expect(mocks.generateIrn).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('a load failure is passed through untouched', async () => {
    mocks.staff.result = signedIn('owner');
    mocks.loadSources.mockResolvedValue({ ok: false, error: 'This document does not exist, or it belongs to a different restaurant.' });
    const result = await attemptEinvoiceAction(INVOICE_ID);
    expect(result).toEqual({ ok: false, error: 'This document does not exist, or it belongs to a different restaurant.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('attemptEinvoiceAction — the audited attempt path', () => {
  beforeEach(() => {
    mocks.staff.result = signedIn('owner');
  });

  it('records payload_built → submitted → accepted and reports the sandbox IRN honestly', async () => {
    const result = await attemptEinvoiceAction(INVOICE_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe('accepted');
    expect(result.irn).toBe(ACK.irn);
    expect(result.recorded).toBe(true);
    expect(result.message).toMatch(/sandbox/i);
    expect(result.message).not.toMatch(/filed|submitted to NIC/i);

    expect(mocks.rpc.mock.calls.map((c) => c[1].p_status)).toEqual(['payload_built', 'submitted', 'accepted']);
    for (const call of mocks.rpc.mock.calls) {
      expect(call[0]).toBe('record_restaurant_irp_request');
      expect(call[1].p_provider).toBe('sandbox');
      expect(call[1].p_payload_version).toBe('autodine.irp.v1');
      expect(call[1].p_request_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const accepted = mocks.rpc.mock.calls[2][1];
    expect(accepted.p_response_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a provider rejection is recorded as rejected with the provider code', async () => {
    mocks.generateIrn.mockResolvedValue({ ok: false, code: '2150', message: 'Invalid GSTIN of recipient' });
    const result = await attemptEinvoiceAction(INVOICE_ID);
    expect(result.ok && result.outcome).toBe('rejected');
    expect(result.ok && result.irn).toBeNull();
    expect(mocks.rpc.mock.calls.map((c) => c[1].p_status)).toEqual(['payload_built', 'submitted', 'rejected']);
    const rejected = mocks.rpc.mock.calls[2][1];
    expect(rejected.p_error_code).toBe('2150');
    expect(rejected.p_error_message).toMatch(/Invalid GSTIN/);
  });

  it('an adapter exception is recorded as transport_error', async () => {
    mocks.generateIrn.mockRejectedValue(new Error('socket hang up'));
    const result = await attemptEinvoiceAction(INVOICE_ID);
    expect(result.ok && result.outcome).toBe('transport_error');
    expect(mocks.rpc.mock.calls.map((c) => c[1].p_status)).toEqual(['payload_built', 'submitted', 'transport_error']);
    expect(mocks.rpc.mock.calls[2][1].p_error_code).toBe('ADAPTER-EXCEPTION');
  });

  it('if payload_built cannot be recorded, the provider is never called', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'not authorized' } });
    const result = await attemptEinvoiceAction(INVOICE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/could not be recorded/);
    expect(mocks.generateIrn).not.toHaveBeenCalled();
  });

  it('if the submission confirmation cannot be recorded, the provider is never called', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: 'a', error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'audit table unavailable' } });
    const result = await attemptEinvoiceAction(INVOICE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no provider was called/);
    expect(mocks.generateIrn).not.toHaveBeenCalled();
  });

  it('a recording failure on the outcome is surfaced, not hidden', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: 'a', error: null })
      .mockResolvedValueOnce({ data: 'b', error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'audit table unavailable' } });
    const result = await attemptEinvoiceAction(INVOICE_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recorded).toBe(false);
      expect(result.message).toMatch(/recording the attempt failed/);
    }
  });
});
