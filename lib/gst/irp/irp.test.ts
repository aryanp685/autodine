import { describe, expect, it } from 'vitest';
import { buildIrpPayload, IrpPayloadError, canonicalPayload } from './payload';
import { SandboxIrpAdapter, SANDBOX_PROVIDER_ID, SANDBOX_QR_MARKER, SANDBOX_REJECT_BUYER_GSTIN } from './sandbox';
import { parseSignedQr, isIrn } from './validate';
import { transitionIrpStatus, isFinalTaxInvoice, IrpStateError } from './irp-state';
import { evaluateEInvoiceApplicability } from '../applicability';

const SELLER = {
  gstin: '27AAAAA0000A1Z2',
  legalName: 'GST Test Kitchen LLP',
  tradeName: 'GST Test',
  address1: 'Registered office, Test Lane',
  address2: null,
  location: 'Nagpur',
  pincode: '440001',
  stateCode: '27',
  email: 'billing@example.in',
  phone: '+91-9000000000',
};
const BUYER = {
  gstin: '29ABCDE1234F1ZW',
  legalName: 'Buyer Foods LLP',
  address1: 'Buyer House, MIDC',
  address2: null,
  location: 'Pune',
  pincode: '411001',
  stateCode: '29',
  email: 'accounts@buyer.example',
  phone: null,
};

function payloadInput(over: Partial<Parameters<typeof buildIrpPayload>[0]> = {}) {
  return {
    documentType: 'INV' as const,
    documentNumber: 'INV/26-27/000001',
    issuedDate: '2026-11-14',
    seller: SELLER,
    buyer: BUYER,
    placeOfSupplyStateCode: '27',
    supplyType: 'B2B' as const,
    lines: [
      {
        itemName: 'Plate',
        quantity: 2,
        unitPricePaise: 5000,
        grossAmountPaise: 10000,
        discountPaise: 0,
        taxablePaise: 10000,
        cgstPaise: 250,
        sgstPaise: 250,
        igstPaise: 0,
        rateBps: 500,
        totalItemValuePaise: 10500,
      },
    ],
    ...over,
  };
}

describe('buildIrpPayload', () => {
  it('is deterministic — same inputs produce byte-identical payload', () => {
    const a = buildIrpPayload(payloadInput());
    const b = buildIrpPayload(payloadInput());
    expect(canonicalPayload(a)).toBe(canonicalPayload(b));
    expect(a.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails closed on seller/buyer GSTIN format or checksum failure', () => {
    expect(() => buildIrpPayload(payloadInput({ seller: { ...SELLER, gstin: '27AAAAA0000A1Z3' } })))
      .toThrow(IrpPayloadError); // checksum digit wrong
    expect(() => buildIrpPayload(payloadInput({ buyer: { ...BUYER, gstin: 'XXABCDE1234F1Z5' } })))
      .toThrow(/Buyer GSTIN/);
  });

  it('fails closed on inconsistent numbers rather than papering over them', () => {
    expect(() => buildIrpPayload(payloadInput({
      lines: [{ ...payloadInput().lines[0], taxablePaise: 9999 }],
    }))).toThrow(/taxable/);
    expect(() => buildIrpPayload(payloadInput({ documentNumber: '!!bad!!' }))).toThrow(IrpPayloadError);
    expect(() => buildIrpPayload(payloadInput({ lines: [] }))).toThrow(/At least one line/);
  });
});

describe('SandboxIrpAdapter (offline, deterministic)', () => {
  const adapter = new SandboxIrpAdapter({ now: () => Date.parse('2026-11-14T10:00:00Z') });

  it('generates a stable IRN and a structurally valid signed QR', async () => {
    const payload = buildIrpPayload(payloadInput());
    const first = await adapter.generateIrn(payload);
    const second = await adapter.generateIrn(payload);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.ack.irn).toBe(second.ack.irn); // idempotent replay
      expect(isIrn(first.ack.irn)).toBe(true);
      const parsed = parseSignedQr(first.ack.signedQrCode);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.fields.sellerGstin).toBe(SELLER.gstin);
        expect(parsed.fields.buyerGstin).toBe(BUYER.gstin);
        expect(parsed.fields.docNo).toBe(payload.documentNumber);
        expect(parsed.fields.docTyp).toBe('INV');
        expect(parsed.fields.irn).toBe(first.ack.irn);
        expect(Buffer.from(first.ack.signedQrCode, 'base64').toString('utf8')).toContain(SANDBOX_QR_MARKER);
      }
    }
    expect(adapter.providerId).toBe(SANDBOX_PROVIDER_ID);
  });

  it('rejects the well-known reject buyer GSTIN with code 2150', async () => {
    const payload = buildIrpPayload(payloadInput({ buyer: { ...BUYER, gstin: SANDBOX_REJECT_BUYER_GSTIN, stateCode: '27' } }));
    const outcome = await adapter.generateIrn(payload);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('2150');
  });

  it('cancelIrn enforces the 64-hex IRN shape and the 24h window', async () => {
    const cancel = new SandboxIrpAdapter({ now: () => Date.parse('2026-11-15T10:00:00Z') });
    const badIrn = await cancel.cancelIrn({ irn: 'not-hex', reason: '3', remark: 'order cancelled' });
    expect(badIrn.ok).toBe(false);
    const tooLate = await cancel.cancelIrn({ irn: 'a'.repeat(64), reason: '3', remark: 'order cancelled', generatedAtIso: '2026-11-13T10:00:00Z' });
    expect(tooLate.ok).toBe(false);
    if (!tooLate.ok) expect(tooLate.code).toBe('SANDBOX-WINDOW');
    const fine = await cancel.cancelIrn({ irn: 'a'.repeat(64), reason: '3', remark: 'order cancelled', generatedAtIso: '2026-11-15T00:00:00Z' });
    expect(fine.ok).toBe(true);
  });
});

describe('parseSignedQr', () => {
  it('refuses non-JSON and wrong-shaped payloads', () => {
    expect(parseSignedQr('not-base64!!!').ok).toBe(false);
    expect(parseSignedQr(Buffer.from('{"DocNo":"1"}').toString('base64')).ok).toBe(false);
  });
});

describe('transitionIrpStatus (document state machine)', () => {
  it('walks pending → generated → cancelled and refuses illegal moves', () => {
    expect(transitionIrpStatus('pending', { kind: 'irnGenerated' })).toBe('generated');
    expect(transitionIrpStatus('generated', { kind: 'cancel' })).toBe('cancelled');
    expect(() => transitionIrpStatus('not_required', { kind: 'cancel' })).toThrow(IrpStateError);
    expect(() => transitionIrpStatus('cancelled', { kind: 'retry' })).toThrow(IrpStateError);
    expect(transitionIrpStatus('failed', { kind: 'retry' })).toBe('pending');
  });
  it('only generated / not-required documents may render as final', () => {
    expect(isFinalTaxInvoice('generated')).toBe(true);
    expect(isFinalTaxInvoice('not_required')).toBe(true);
    expect(isFinalTaxInvoice('pending')).toBe(false);
    expect(isFinalTaxInvoice('failed')).toBe(false);
    expect(isFinalTaxInvoice('cancelled')).toBe(false);
  });
});

describe('e-invoice applicability stays consistent with the database predicate', () => {
  it('B2B at exactly ₹5 crore AATO is NOT applicable; ₹5 crore + 1 paise is; unknown fails closed', () => {
    const base = { documentKind: 'tax_invoice' as const, recipientHasGstin: true, isExport: false };
    expect(evaluateEInvoiceApplicability({ ...base, precedingFyTurnoverPaise: 5_000_000_000 }).required).toBe(false);
    expect(evaluateEInvoiceApplicability({ ...base, precedingFyTurnoverPaise: 5_000_000_001 }).required).toBe(true);
    expect(evaluateEInvoiceApplicability({ ...base, precedingFyTurnoverPaise: null }).required).toBe(true);
    expect(evaluateEInvoiceApplicability({ ...base, precedingFyTurnoverPaise: 5_000_000_000, recipientHasGstin: false }).required).toBe(false);
    expect(evaluateEInvoiceApplicability({ documentKind: 'bill_of_supply', precedingFyTurnoverPaise: null, recipientHasGstin: true, isExport: false }).required).toBe(false);
  });
});

describe('credit/debit note payloads', () => {
  const ORIGINAL = { documentType: 'INV' as const, documentNumber: 'INV/26-27/000001', issuedDate: '2026-11-14' };

  it('refuses a CRN without the original invoice reference', () => {
    expect(() => buildIrpPayload(payloadInput({ documentType: 'CRN', documentNumber: 'CN/26-27/000001' })))
      .toThrow(/original invoice/i);
    try {
      buildIrpPayload(payloadInput({ documentType: 'DBN', documentNumber: 'DN/26-27/000001' }));
      expect.unreachable('DBN without originalInvoice must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(IrpPayloadError);
      expect((error as IrpPayloadError).code).toBe('original_invoice_required');
    }
  });

  it('refuses an INV payload that carries an original reference', () => {
    try {
      buildIrpPayload(payloadInput({ originalInvoice: ORIGINAL }));
      expect.unreachable('INV with originalInvoice must throw');
    } catch (error) {
      expect((error as IrpPayloadError).code).toBe('original_invoice_not_permitted');
    }
  });

  it('refuses malformed original references', () => {
    expect(() => buildIrpPayload(payloadInput({ documentType: 'CRN', documentNumber: 'CN/26-27/000001', originalInvoice: { ...ORIGINAL, documentNumber: '!!' } })))
      .toThrow(IrpPayloadError);
    expect(() => buildIrpPayload(payloadInput({ documentType: 'CRN', documentNumber: 'CN/26-27/000001', originalInvoice: { ...ORIGINAL, issuedDate: '14-11-2026' } })))
      .toThrow(IrpPayloadError);
  });

  it('builds a deterministic CRN that references the source document and fingerprints it', () => {
    const a = buildIrpPayload(payloadInput({ documentType: 'CRN', documentNumber: 'CN/26-27/000001', originalInvoice: ORIGINAL }));
    const b = buildIrpPayload(payloadInput({ documentType: 'CRN', documentNumber: 'CN/26-27/000001', originalInvoice: ORIGINAL }));
    expect(a.originalInvoice).toEqual(ORIGINAL);
    expect(a.fingerprintSha256).toBe(b.fingerprintSha256);
    expect(canonicalPayload(a)).toContain('"originalInvoice"');
    const inv = buildIrpPayload(payloadInput());
    expect(inv.fingerprintSha256).not.toBe(a.fingerprintSha256); // note ≠ invoice even with same numbers
  });

  it('fails closed when CGST/SGST coexist with IGST on one document', () => {
    try {
      buildIrpPayload(payloadInput({
        lines: [{ ...payloadInput().lines[0], igstPaise: 500, totalItemValuePaise: 11000 }],
      }));
      expect.unreachable('mixed IGST + CGST must throw');
    } catch (error) {
      expect((error as IrpPayloadError).code).toBe('values_mismatch');
    }
  });
});
