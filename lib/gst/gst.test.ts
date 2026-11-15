import { describe, expect, it } from 'vitest';
import { decomposeInclusiveBill, extractInclusiveTax, splitTaxComponents } from './money-gst';
import { checkGstin, panMatchesGstin, panStatusConsistencyError, gstinPan, gstinStateCode, isPlausibleEmail } from './gstin';
import { checkCompositionEligibility, COMPOSITION_BILL_NOTICE } from './composition';
import { REGULAR_PROFILES } from './profiles';
import { evaluateEInvoiceApplicability, EINVOICE_TURNOVER_THRESHOLD_PAISE } from './applicability';
import { buildDocumentSnapshot, checkRecipient } from './snapshot';
import { determinePlaceOfSupply } from './place-of-supply';

describe('extractInclusiveTax', () => {
  it('handles the statutory examples exactly', () => {
    expect(extractInclusiveTax(10500, 500)).toEqual({ taxablePaise: 10000, taxPaise: 500 });
    expect(extractInclusiveTax(11800, 1800)).toEqual({ taxablePaise: 10000, taxPaise: 1800 });
    expect(extractInclusiveTax(21000, 500)).toEqual({ taxablePaise: 20000, taxPaise: 1000 });
  });
  it('never loses a paisa on awkward amounts', () => {
    for (const [total, rate] of [[999, 500], [1001, 500], [12345, 1800], [1, 500]] as const) {
      const { taxablePaise, taxPaise } = extractInclusiveTax(total, rate);
      expect(taxablePaise + taxPaise).toBe(total);
      expect(Number.isInteger(taxablePaise)).toBe(true);
    }
  });
  it('extracts zero from zero and rejects bad rates', () => {
    expect(extractInclusiveTax(0, 500)).toEqual({ taxablePaise: 0, taxPaise: 0 });
    expect(() => extractInclusiveTax(10500, -1)).toThrow(RangeError);
  });
});

describe('splitTaxComponents', () => {
  it('splits intra-state tax into CGST + SGST summing exactly', () => {
    expect(splitTaxComponents(1001, false)).toEqual({ cgstPaise: 501, sgstPaise: 500, igstPaise: 0 });
    expect(splitTaxComponents(1000, false)).toEqual({ cgstPaise: 500, sgstPaise: 500, igstPaise: 0 });
  });
  it('routes the whole tax to IGST for inter-state', () => {
    expect(splitTaxComponents(1001, true)).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: 1001 });
  });
});

describe('decomposeInclusiveBill', () => {
  it('refuses discounts until written financial policy approval exists', () => {
    expect(() => decomposeInclusiveBill(10500, 500, false, 100)).toThrow(/financial policy/i);
  });
  it('decomposes a full bill', () => {
    expect(decomposeInclusiveBill(21000, 500, false)).toEqual({
      taxablePaise: 20000, taxPaise: 1000, netPayablePaise: 21000,
      cgstPaise: 500, sgstPaise: 500, igstPaise: 0,
    });
  });
});

describe('checkGstin', () => {
  it('accepts a checksum-valid GSTIN and extracts parts', () => {
    const c = checkGstin('27AAAAA0000A1Z2');
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.parts.stateCode).toBe('27');
      expect(c.parts.pan).toBe('AAAAA0000A');
    }
    expect(gstinStateCode('27AAAAA0000A1Z2')).toBe('27');
    expect(gstinPan('27AAAAA0000A1Z2')).toBe('AAAAA0000A');
  });
  it('rejects a corrupted checksum, bad layout, wrong length and unknown state', () => {
    expect(checkGstin('27AAAAA0000A1Z3').ok).toBe(false);
    expect(checkGstin('XXAAAAA0000A1Z2').ok).toBe(false);
    expect(checkGstin('27AAAAA0000A1Z').ok).toBe(false);
    expect(checkGstin('99AAAAA0000A1Z2').ok).toBe(false); // no such state code
  });
  it('cross-checks PAN against GSTIN and registration consistency per PAN', () => {
    expect(panMatchesGstin('AAAAA0000A', '27AAAAA0000A1Z2')).toBe(true);
    expect(panMatchesGstin('BBBBB0000B', '27AAAAA0000A1Z2')).toBe(false);
    expect(panStatusConsistencyError([
      { gstin: '27AAAAA0000A1Z2', registrationType: 'regular' },
      { gstin: '29AAAAA0000A1Z2', registrationType: 'composition' },
    ])).toMatch(/cannot hold both/i);
    expect(panStatusConsistencyError([
      { gstin: '27AAAAA0000A1Z2', registrationType: 'regular' },
      { gstin: '29AAAAA0000A1Z2', registrationType: 'regular' },
    ])).toBeNull();
  });
  it('validates email format only', () => {
    expect(isPlausibleEmail('owner@example.com')).toBe(true);
    expect(isPlausibleEmail('not-an-email')).toBe(false);
  });
});

describe('checkCompositionEligibility', () => {
  it('requires the composition registration type and the acknowledgment', () => {
    expect(checkCompositionEligibility({ registrationType: 'composition', ineligibilityAcknowledged: true }).ok).toBe(true);
    expect(checkCompositionEligibility({ registrationType: 'regular', ineligibilityAcknowledged: true }).ok).toBe(false);
    expect(checkCompositionEligibility({ registrationType: 'composition', ineligibilityAcknowledged: false }).ok).toBe(false);
  });
  it('prints the statutory notice text', () => {
    expect(COMPOSITION_BILL_NOTICE).toContain('not eligible to collect tax');
  });
});

describe('regular profiles', () => {
  it('exposes exactly two profiles and nothing arbitrary', () => {
    expect(Object.keys(REGULAR_PROFILES)).toEqual(['other_than_specified_premises', 'specified_premises']);
    expect(REGULAR_PROFILES.other_than_specified_premises.rateBps).toBe(500);
    expect(REGULAR_PROFILES.other_than_specified_premises.itc).toBe(false);
    expect(REGULAR_PROFILES.specified_premises.rateBps).toBe(1800);
    expect(REGULAR_PROFILES.specified_premises.itc).toBe(true);
    expect(REGULAR_PROFILES.other_than_specified_premises.notification).toContain('11/2017');
    expect(REGULAR_PROFILES.specified_premises.notification).toContain('05/2025');
  });
});

describe('evaluateEInvoiceApplicability', () => {
  const above = EINVOICE_TURNOVER_THRESHOLD_PAISE + 1;
  const below = EINVOICE_TURNOVER_THRESHOLD_PAISE;
  it('never applies to composition bills or normal receipts or B2C', () => {
    expect(evaluateEInvoiceApplicability({ documentKind: 'bill_of_supply', precedingFyTurnoverPaise: above, recipientHasGstin: true, isExport: false }).required).toBe(false);
    expect(evaluateEInvoiceApplicability({ documentKind: 'receipt', precedingFyTurnoverPaise: above, recipientHasGstin: false, isExport: false }).required).toBe(false);
    expect(evaluateEInvoiceApplicability({ documentKind: 'tax_invoice', precedingFyTurnoverPaise: above, recipientHasGstin: false, isExport: false }).required).toBe(false);
  });
  it('requires IRN above ₹5 crore AATO for B2B', () => {
    const result = evaluateEInvoiceApplicability({ documentKind: 'tax_invoice', precedingFyTurnoverPaise: above, recipientHasGstin: true, isExport: false });
    expect(result.required).toBe(true);
  });
  it('does not require IRN at or below ₹5 crore AATO for B2B', () => {
    expect(evaluateEInvoiceApplicability({ documentKind: 'tax_invoice', precedingFyTurnoverPaise: below, recipientHasGstin: true, isExport: false }).required).toBe(false);
  });
  it('fails closed when AATO is unknown and the document is B2B', () => {
    const result = evaluateEInvoiceApplicability({ documentKind: 'tax_invoice', precedingFyTurnoverPaise: null, recipientHasGstin: true, isExport: false });
    expect(result.required).toBe(true);
    expect(result.reasons[0]).toMatch(/fail closed/i);
  });
});

describe('buildDocumentSnapshot', () => {
  const seller = {
    gstin: '27AAAAA0000A1Z2', legalName: 'Test Kitchen LLP', tradeName: 'Test Kitchen',
    address: 'Test Lane', stateCode: '27', registrationType: 'regular' as const,
  };
  const line = { name: 'Plate', hsnOrSac: null, qty: 2, unitPricePaise: 10500, amountPaise: 21000 };
  it('normal billing produces a no-tax receipt snapshot', () => {
    const doc = buildDocumentSnapshot({
      config: { mode: 'off', configVersion: 0, profile: null, seller: null, placeOfSupplyStateCode: null, precedingFyTurnoverPaise: null },
      documentKind: 'receipt', lines: [line], recipient: null, issuedAt: '2026-11-14T00:00:00.000Z',
    });
    expect(doc.docType).toBe('receipt');
    expect(doc.totalPaise).toBe(21000);
    expect(doc.irpStatus).toBe('not_required');
    expect(doc.gstMode).toBe('off');
  });
  it('composition produces a Bill of Supply with no tax and the statutory notice', () => {
    const doc = buildDocumentSnapshot({
      config: { mode: 'composition', configVersion: 3, profile: null, seller: { ...seller, registrationType: 'composition' }, placeOfSupplyStateCode: '27', precedingFyTurnoverPaise: null },
      documentKind: 'bill_of_supply', lines: [line], recipient: null, issuedAt: '2026-11-14T00:00:00.000Z',
    });
    expect(doc.docType).toBe('bill_of_supply');
    expect(doc.compositionBill).toBe(true);
    expect(doc.taxPaise).toBe(0);
    expect(doc.cgstPaise + doc.sgstPaise + doc.igstPaise).toBe(0);
    expect(doc.irpStatus).toBe('not_required');
  });
  it('regular 5% extracts tax at document level and splits CGST/SGST', () => {
    const doc = buildDocumentSnapshot({
      config: { mode: 'regular', configVersion: 7, profile: 'other_than_specified_premises', seller, placeOfSupplyStateCode: '27', precedingFyTurnoverPaise: 1_000_000_000 },
      documentKind: 'tax_invoice', lines: [line], recipient: null, issuedAt: '2026-11-14T00:00:00.000Z',
    });
    expect(doc.rateBps).toBe(500);
    expect(doc.taxablePaise).toBe(20000);
    expect(doc.cgstPaise).toBe(500);
    expect(doc.sgstPaise).toBe(500);
    expect(doc.totalPaise).toBe(21000);
    expect(doc.irn).toBeNull();
    expect(doc.irpStatus).toBe('not_required'); // B2C
  });
  it('regular B2B above ₹5 crore AATO fails closed to irp_pending (never final)', () => {
    const recipient = { legalName: 'Buyer Pvt Ltd', gstin: '29ABCPK1234L1ZS', gstinStateCode: '29', address: null, email: null };
    const doc = buildDocumentSnapshot({
      config: { mode: 'regular', configVersion: 7, profile: 'other_than_specified_premises', seller, placeOfSupplyStateCode: '27', precedingFyTurnoverPaise: EINVOICE_TURNOVER_THRESHOLD_PAISE + 1 },
      documentKind: 'tax_invoice', lines: [line], recipient, issuedAt: '2026-11-14T00:00:00.000Z',
    });
    expect(doc.eInvoiceRequired).toBe(true);
    expect(doc.irpStatus).toBe('pending');
    expect(doc.irn).toBeNull();
  });
  it('refuses to build a GST document without a seller identity', () => {
    expect(() => buildDocumentSnapshot({
      config: { mode: 'regular', configVersion: 7, profile: 'other_than_specified_premises', seller: null, placeOfSupplyStateCode: '27', precedingFyTurnoverPaise: null },
      documentKind: 'tax_invoice', lines: [line], recipient: null, issuedAt: '2026-11-14T00:00:00.000Z',
    })).toThrow(/seller/i);
  });
});

describe('checkRecipient', () => {
  it('treats an empty recipient as B2C', () => {
    expect(checkRecipient(null)).toEqual({ ok: true, snapshot: null });
    expect(checkRecipient({})).toEqual({ ok: true, snapshot: null });
  });
  it('requires a legal name when anything is supplied, and checks the GSTIN checksum', () => {
    expect(checkRecipient({ gstin: '27AAAAA0000A1Z2' }).ok).toBe(false); // no name
    expect(checkRecipient({ legalName: 'Buyer Pvt Ltd', gstin: '27AAAAA0000A1Z3' }).ok).toBe(false); // bad checksum
    const ok = checkRecipient({ legalName: 'Buyer Pvt Ltd', gstin: '27AAAAA0000A1Z2', email: 'ap@buyer.example.com' });
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.snapshot) expect(ok.snapshot.gstinStateCode).toBe('27');
  });
});

describe('determinePlaceOfSupply', () => {
  it('restaurant service POS is the outlet state, never the guest state', () => {
    expect(determinePlaceOfSupply({ outletStateCode: '27', recipientStateCode: '29', interState: false }))
      .toEqual({ stateCode: '27', interState: false, igstApplies: false });
  });
  it('fails closed on an invalid outlet state code', () => {
    expect(() => determinePlaceOfSupply({ outletStateCode: 'XX', interState: false })).toThrow();
  });
});

describe('e-Invoice applicability for credit/debit notes', () => {
  const above = EINVOICE_TURNOVER_THRESHOLD_PAISE + 1;

  it('treats an unknown AATO as required (fail closed) for a B2B note', () => {
    const result = evaluateEInvoiceApplicability({ documentKind: 'credit_note', precedingFyTurnoverPaise: null, recipientHasGstin: true, isExport: false });
    expect(result.required).toBe(true);
  });

  it('requires IRN for notes on documents of AATO-exceeding registrants (B2B)', () => {
    expect(evaluateEInvoiceApplicability({ documentKind: 'credit_note', precedingFyTurnoverPaise: above, recipientHasGstin: true, isExport: false }).required).toBe(true);
    expect(evaluateEInvoiceApplicability({ documentKind: 'debit_note', precedingFyTurnoverPaise: above, recipientHasGstin: false, isExport: true }).required).toBe(true);
  });

  it('does not require IRN for B2C or composition-linked notes', () => {
    expect(evaluateEInvoiceApplicability({ documentKind: 'credit_note', precedingFyTurnoverPaise: above, recipientHasGstin: false, isExport: false }).required).toBe(false);
    expect(evaluateEInvoiceApplicability({ documentKind: 'bill_of_supply', precedingFyTurnoverPaise: above, recipientHasGstin: true, isExport: false }).required).toBe(false);
  });
});
