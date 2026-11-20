import { describe, expect, it } from 'vitest';
import { prepareEinvoicePayload, type EinvoiceInvoiceInput, type EinvoiceProfileInput } from './einvoice';

const SELLER_PROFILE: EinvoiceProfileInput = {
  mode: 'regular',
  registrationType: 'regular',
  gstin: '27AAAAA0000A1Z2',
  legalName: 'GST Test Kitchen LLP',
  tradeName: 'GST Test',
  address: 'Registered office, Test Lane, Robotic Colony, Nagpur - 440001',
  stateCode: '27',
  precedingFyTurnoverPaise: 6_000_000_000, // ₹6 crore — above the ₹5 crore e-invoice threshold
  einvoiceLocation: 'Nagpur',
  einvoicePincode: '440001',
  einvoiceHsnSac: '996331',
};

const B2B_INVOICE: EinvoiceInvoiceInput = {
  invoiceNumber: 'INV/26-27/000001',
  issuedLocalDate: '2026-11-14',
  irpStatus: 'pending',
  status: 'issued',
  documentType: 'gst_tax_invoice', irpEvidence: { applicability: 'required', reportingCategory: 'under_10cr' },
  gst: {
    rateBps: 500,
    taxablePaise: 10000,
    cgstPaise: 250,
    sgstPaise: 250,
    igstPaise: 0,
    placeOfSupplyStateCode: '27',
  },
  totals: { subtotalPaise: 10500, taxPaise: 500, totalPaise: 10500 },
  seller: {
    name: 'GST Test',
    tradeName: 'GST Test',
    address: 'Registered office, Test Lane, Robotic Colony, Nagpur - 440001',
    phone: '+91-9000000000',
  },
  recipient: {
    name: 'Buyer Foods LLP',
    gstin: '29ABCDE1234F1ZW',
    address: 'Buyer House, MIDC, Pune - 411001',
    email: 'accounts@buyer.example', location: 'Pune', pincode: '411001',
  },
  lines: [{ itemName: 'Plate', quantity: 2, unitPricePaise: 5250, amountPaise: 10500 }],
};

const prepare = (invoice = B2B_INVOICE, profile = SELLER_PROFILE) =>
  prepareEinvoicePayload({ invoice, profile });

describe('prepareEinvoicePayload — fail-closed guards', () => {
  const cases: Array<[string, EinvoiceInvoiceInput, EinvoiceProfileInput, RegExp]> = [
    ['a voided document is refused', { ...B2B_INVOICE, status: 'voided' }, SELLER_PROFILE, /voided/i],
    ['a non-tax-invoice document is refused', { ...B2B_INVOICE, documentType: 'bill_of_supply' }, SELLER_PROFILE, /tax invoice/i],
    ['a not-required document is refused', { ...B2B_INVOICE, irpStatus: 'not_required' }, SELLER_PROFILE, /not_required/i],
    ['an already generated document is refused', { ...B2B_INVOICE, irpStatus: 'generated' }, SELLER_PROFILE, /generated/i],
    ['a missing GST snapshot is refused', { ...B2B_INVOICE, gst: null }, SELLER_PROFILE, /decomposition/i],
    ['composition mode is refused', B2B_INVOICE, { ...SELLER_PROFILE, mode: 'composition', registrationType: 'composition' }, /Regular-GST/i],
    ['unknown saved full prior-FY turnover fails closed', { ...B2B_INVOICE, irpEvidence: undefined }, SELLER_PROFILE, /PAN-wide/i],
    ['an issue-time decision of not required cannot be overridden', { ...B2B_INVOICE, irpEvidence: { applicability:'not_required', reportingCategory:'under_10cr' } }, SELLER_PROFILE, /does not require/i],
    ['missing issuance profile fails closed with field names', B2B_INVOICE, { ...SELLER_PROFILE, einvoiceLocation: null, einvoiceHsnSac: '' }, /e-Invoice city.*HSN\/SAC|HSN\/SAC.*e-Invoice city/i],
    ['a non-Indian pincode in the profile is refused', B2B_INVOICE, { ...SELLER_PROFILE, einvoicePincode: '011001' }, /PIN/i],
    ['a seller GSTIN that fails the checksum is refused', B2B_INVOICE, { ...SELLER_PROFILE, gstin: '27AAAAA0000A1Z3' }, /GSTIN/i],
    ['seller state code disagreeing with the GSTIN is refused', B2B_INVOICE, { ...SELLER_PROFILE, stateCode: '29' }, /state code/i],
    ['a seller address longer than 100 characters is refused', B2B_INVOICE, { ...SELLER_PROFILE, address: `Building ${'A'.repeat(120)}, Nagpur` }, /100 characters/i],
    ['a missing buyer address is refused', { ...B2B_INVOICE, recipient: { ...B2B_INVOICE.recipient!, address: null } }, SELLER_PROFILE, /buyer address/i],
    ['a buyer address without a pincode is refused', { ...B2B_INVOICE, recipient: { ...B2B_INVOICE.recipient!, address: 'Buyer House, MIDC, Pune', pincode: undefined } }, SELLER_PROFILE, /PIN/i],
    ['a B2B document with no recipient is refused', { ...B2B_INVOICE, recipient: null }, SELLER_PROFILE, /B2B/i],
    ['an IGST document is refused (not supported here)', { ...B2B_INVOICE, gst: { ...B2B_INVOICE.gst!, igstPaise: 500 } }, SELLER_PROFILE, /IGST/i],
  ];
  for (const [label, invoice, profile, pattern] of cases) {
    it(label, () => {
      const result = prepare(invoice, profile);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(pattern);
    });
  }
});

describe('prepareEinvoicePayload — happy path', () => {
  it('builds a valid INV payload from the immutable snapshot', () => {
    const result = prepare();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { payload } = result;
    expect(payload.documentType).toBe('INV');
    expect(payload.documentNumber).toBe('INV/26-27/000001');
    expect(payload.supplyType).toBe('B2B');
    expect(payload.posKind).toBe('B2B');
    expect(payload.recipientType).toBe('B');
    expect(payload.placeOfSupplyStateCode).toBe('27');
    expect(payload.buyer?.gstin).toBe('29ABCDE1234F1ZW');
    expect(payload.buyer?.location).toBe('Pune');
    expect(payload.buyer?.pincode).toBe('411001');
    expect(payload.seller.location).toBe('Nagpur');
    expect(payload.seller.pincode).toBe('440001');
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0]).toMatchObject({
      hsnSac: '996331',
      uom: 'NOS',
      taxablePaise: 10000,
      cgstPaise: 250,
      sgstPaise: 250,
      rateBps: 500,
      totalItemValuePaise: 10500,
    });
    expect(payload.values).toEqual({
      taxablePaise: 10000,
      cgstPaise: 250,
      sgstPaise: 250,
      igstPaise: 0,
      otherChargesPaise: 0,
      totalPaise: 10500,
    });
    expect(payload.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: identical inputs give the identical fingerprint', () => {
    const a = prepare();
    const b = prepare();
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.payload.fingerprintSha256).toBe(b.payload.fingerprintSha256);
  });

  it('allocates document totals across lines exactly, sums always match', () => {
    const invoice: EinvoiceInvoiceInput = {
      ...B2B_INVOICE,
      gst: { ...B2B_INVOICE.gst!, taxablePaise: 10001, cgstPaise: 251, sgstPaise: 251 },
      totals: { subtotalPaise: 10503, taxPaise: 502, totalPaise: 10503 },
      lines: [
        { itemName: 'Thali', quantity: 3, unitPricePaise: 2334, amountPaise: 7352 },
        { itemName: 'Lassi', quantity: 1, unitPricePaise: 3000, amountPaise: 3151 },
      ],
    };
    const result = prepare(invoice);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { payload } = result;
    expect(payload.lines[0].taxablePaise + payload.lines[1].taxablePaise).toBe(10001);
    expect(payload.lines[0].cgstPaise + payload.lines[1].cgstPaise).toBe(251);
    expect(payload.lines[0].sgstPaise + payload.lines[1].sgstPaise).toBe(251);
    expect(payload.values.totalPaise).toBe(10503);
    for (const line of payload.lines) {
      expect(line.taxablePaise).toBe(line.grossAmountPaise - line.discountPaise);
      expect(line.totalItemValuePaise).toBe(line.taxablePaise + line.cgstPaise + line.sgstPaise + line.igstPaise);
    }
  });

  it('is deterministic via the payload fingerprint across allocations', () => {
    const invoice: EinvoiceInvoiceInput = {
      ...B2B_INVOICE,
      lines: [
        { itemName: 'A', quantity: 1, unitPricePaise: 5000, amountPaise: 5251 },
        { itemName: 'B', quantity: 1, unitPricePaise: 5000, amountPaise: 5249 },
      ],
      gst: { ...B2B_INVOICE.gst!, taxablePaise: 10000, cgstPaise: 250, sgstPaise: 250 },
      totals: { subtotalPaise: 10500, taxPaise: 500, totalPaise: 10500 },
    };
    const a = prepare(invoice);
    const b = prepare(structuredClone(invoice));
    expect(a.ok && b.ok && a.payload.fingerprintSha256 === b.payload.fingerprintSha256).toBe(true);
  });
});
