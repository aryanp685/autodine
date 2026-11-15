/**
 * Deterministic builder for the versioned IRP payload.
 *
 * Pure and fail-closed: any invariant violation throws IrpPayloadError with a
 * machine-readable code. Same inputs in → byte-identical payload out (the
 * fingerprint makes idempotent retries detectable end to end). No dates or
 * randomness are read from the environment — issuedDate and everything else
 * come from the immutable document snapshot.
 */

import { checkGstin, GST_STATE_CODES } from '../gstin';
import type { IrpDocumentKind, IrpLine, IrpPayloadV1, IrpPosKind, IrpRecipientType, IrpSeller, IrpSupplyType } from './types';
import { fingerprint, canonicalJson } from './fingerprint';

export type IrpSellerInput = Omit<IrpSeller, 'gstin' | 'stateCode'> & {
  gstin: string;
  stateCode: string;
};

/** Mandatory on e-Invoice credit/debit notes; forbidden on invoices. */
export type IrpOriginalDocumentInput = {
  documentType: 'INV';
  documentNumber: string;
  issuedDate: string; // YYYY-MM-DD
};

export type IrpInput = {
  documentType: IrpDocumentKind;
  documentNumber: string;
  issuedDate: string; // YYYY-MM-DD
  seller: IrpSellerInput;
  /** null for B2C. */
  buyer: (Omit<import('./types').IrpRecipient, 'placeOfSupplyStateCode'> & { placeOfSupplyStateCode?: string }) | null;
  /** Outlet (supplier) state — place of supply for restaurant services. */
  placeOfSupplyStateCode: string;
  supplyType: IrpSupplyType;
  lines: Array<Omit<IrpLine, 'hsnSac' | 'uom'> & { hsnSac?: string; uom?: 'NOS' }>;
  /**
   * Credit/debit notes only: the original invoice the note adjusts. The DB
   * snapshot carries the source document; callers pass it here so the note
   * payload references the immutable source by number and date, never by a
   * re-resolved live lookup.
   */
  originalInvoice?: IrpOriginalDocumentInput;
};

export type IrpPayloadErrorCode =
  | 'seller_gstin_invalid'
  | 'buyer_gstin_invalid'
  | 'state_code_invalid'
  | 'document_number_required'
  | 'document_number_format'
  | 'issued_date_format'
  | 'lines_required'
  | 'line_qty_invalid'
  | 'line_amounts_invalid'
  | 'values_mismatch'
  | 'place_of_supply_invalid'
  | 'values_mismatch'
  | 'original_invoice_required'
  | 'original_invoice_invalid'
  | 'original_invoice_not_permitted';

export class IrpPayloadError extends Error {
  readonly code: IrpPayloadErrorCode;
  constructor(code: IrpPayloadErrorCode, message: string) {
    super(message);
    this.name = 'IrpPayloadError';
    this.code = code;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_RE = /^[A-Za-z0-9/-]{1,16}$/;

export function buildIrpPayload(input: IrpInput): IrpPayloadV1 {
  const sellerCheck = checkGstin(input.seller.gstin);
  if (!sellerCheck.ok) {
    throw new IrpPayloadError('seller_gstin_invalid', `Seller GSTIN rejected: ${sellerCheck.reason}`);
  }
  if (!GST_STATE_CODES.has(input.seller.stateCode) || input.seller.stateCode !== sellerCheck.parts.stateCode) {
    throw new IrpPayloadError('state_code_invalid', 'Seller state code must match the seller GSTIN state code.');
  }
  if (!input.documentNumber || !DOC_RE.test(input.documentNumber)) {
    throw new IrpPayloadError('document_number_format', 'Invoice number must be 1–16 alphanumerics, / or -.');
  }
  if (!input.documentNumber.trim()) {
    throw new IrpPayloadError('document_number_required', 'Invoice number is required.');
  }
  if (!DATE_RE.test(input.issuedDate) || Number.isNaN(Date.parse(input.issuedDate))) {
    throw new IrpPayloadError('issued_date_format', 'Issue date must be YYYY-MM-DD.');
  }
  if (!GST_STATE_CODES.has(input.placeOfSupplyStateCode)) {
    throw new IrpPayloadError('place_of_supply_invalid', 'Place of supply must be a GST state code.');
  }
  const isNote = input.documentType === 'CRN' || input.documentType === 'DBN';
  if (isNote) {
    const original = input.originalInvoice;
    if (!original) {
      throw new IrpPayloadError('original_invoice_required', 'A credit/debit note payload must reference the original invoice.');
    }
    if (original.documentType !== 'INV') {
      throw new IrpPayloadError('original_invoice_invalid', 'The original document must be an invoice (INV).');
    }
    if (!original.documentNumber || !DOC_RE.test(original.documentNumber)) {
      throw new IrpPayloadError('original_invoice_invalid', 'The original invoice number must be 1–16 alphanumerics, / or -.');
    }
    if (!DATE_RE.test(original.issuedDate) || Number.isNaN(Date.parse(original.issuedDate))) {
      throw new IrpPayloadError('original_invoice_invalid', 'The original invoice date must be YYYY-MM-DD.');
    }
  } else if (input.originalInvoice) {
    throw new IrpPayloadError('original_invoice_not_permitted', 'An invoice payload must not reference an original document.');
  }
  const lines: IrpLine[] = input.lines.map((line, index) => {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new IrpPayloadError('line_qty_invalid', `Line ${index + 1}: quantity must be positive.`);
    }
    const ints = [line.unitPricePaise, line.grossAmountPaise, line.discountPaise, line.taxablePaise, line.cgstPaise, line.sgstPaise, line.igstPaise, line.totalItemValuePaise];
    for (const n of ints) {
      if (!Number.isSafeInteger(n) || n < 0) {
        throw new IrpPayloadError('line_amounts_invalid', `Line ${index + 1}: amounts must be non-negative integer paise.`);
      }
    }
    if (line.taxablePaise !== line.grossAmountPaise - line.discountPaise) {
      throw new IrpPayloadError('line_amounts_invalid', `Line ${index + 1}: taxable ≠ gross − discount.`);
    }
    if (line.totalItemValuePaise !== line.taxablePaise + line.cgstPaise + line.sgstPaise + line.igstPaise) {
      throw new IrpPayloadError('line_amounts_invalid', `Line ${index + 1}: line total ≠ taxable + taxes.`);
    }
    return { ...line, hsnSac: line.hsnSac ?? '996331', uom: line.uom ?? 'NOS' };
  });
  if (lines.length === 0) {
    throw new IrpPayloadError('lines_required', 'At least one line is required.');
  }

  // Document totals are derived below from per-line values; the per-line
  // identity (taxable = gross - discount, total = taxable + taxes) was
  // already enforced above.

  let buyer: IrpPayloadV1['buyer'] = null;
  let posKind: IrpPosKind = 'B2CS';
  let recipientType: IrpRecipientType = 'C';
  if (input.buyer) {
    const buyerCheck = checkGstin(input.buyer.gstin);
    if (!buyerCheck.ok) {
      throw new IrpPayloadError('buyer_gstin_invalid', `Buyer GSTIN rejected: ${buyerCheck.reason}`);
    }
    if (!GST_STATE_CODES.has(input.buyer.stateCode) || input.buyer.stateCode !== buyerCheck.parts.stateCode) {
      throw new IrpPayloadError('state_code_invalid', 'Buyer state code must match the buyer GSTIN state code.');
    }
    buyer = {
      gstin: input.buyer.gstin.toUpperCase(),
      legalName: input.buyer.legalName,
      address1: input.buyer.address1,
      address2: input.buyer.address2 ?? null,
      location: input.buyer.location,
      pincode: input.buyer.pincode,
      stateCode: input.buyer.stateCode,
      email: input.buyer.email ?? null,
      phone: input.buyer.phone ?? null,
      placeOfSupplyStateCode: input.buyer.placeOfSupplyStateCode ?? input.placeOfSupplyStateCode,
    };
    posKind = 'B2B';
    recipientType = 'B';
  }

  const values = {
    taxablePaise: lines.reduce((a, l) => a + l.taxablePaise, 0),
    cgstPaise: lines.reduce((a, l) => a + l.cgstPaise, 0),
    sgstPaise: lines.reduce((a, l) => a + l.sgstPaise, 0),
    igstPaise: lines.reduce((a, l) => a + l.igstPaise, 0),
    otherChargesPaise: 0,
    totalPaise: lines.reduce((a, l) => a + l.totalItemValuePaise, 0),
  };
  if (values.igstPaise > 0 && (values.cgstPaise > 0 || values.sgstPaise > 0)) {
    throw new IrpPayloadError('values_mismatch', 'CGST/SGST and IGST cannot coexist on one document.');
  }

  const withoutFingerprint = {
    schemaVersion: 'autodine.irp.v1' as const,
    documentType: input.documentType,
    documentNumber: input.documentNumber,
    issuedDate: input.issuedDate,
    ...(input.originalInvoice ? { originalInvoice: { ...input.originalInvoice, documentType: 'INV' as const } } : {}),
    supplyType: input.supplyType,
    posKind,
    recipientType,
    placeOfSupplyStateCode: input.placeOfSupplyStateCode,
    seller: { ...input.seller, gstin: input.seller.gstin.toUpperCase() },
    buyer,
    lines,
    values,
  };
  return { ...withoutFingerprint, fingerprintSha256: fingerprint(withoutFingerprint) };
}

/** Stable canonical string of the payload — used for idempotency keys. */
export function canonicalPayload(payload: IrpPayloadV1): string {
  return canonicalJson(payload);
}
