/** Pure projection of immutable issued invoice/adjustment evidence into the
 * canonical integer-paise IRP contract. No active configuration lookup. */
import { allocateIntegerPaise } from './allocate';
import type { IrpMandate } from './applicability';
import type { ReportingCategory } from './onboarding';
import { checkGstin } from './gstin';
import { buildIrpPayload, IrpPayloadError, type IrpInput } from './irp/payload';
import type { IrpPayloadV1 } from './irp/types';

export type EinvoiceInvoiceInput = {
  /** INV/26-27/000001 — must satisfy the payload's 1–16 char rule. */
  invoiceNumber: string;
  /** Outlet-local calendar date (YYYY-MM-DD) of issuance. */
  issuedLocalDate: string;
  irpStatus: string;
  status: string;
  documentType: string;
  irpEvidence?: { applicability: IrpMandate; reportingCategory: ReportingCategory };
  originalInvoice?: IrpInput['originalInvoice'];
  gst: {
    rateBps: number;
    taxablePaise: number | null;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    placeOfSupplyStateCode: string | null;
  } | null;
  totals: {
    subtotalPaise: number;
    taxPaise: number;
    totalPaise: number;
  };
  seller: {
    name: string;
    tradeName: string | null;
    address: string;
    phone: string | null;
  };
  recipient: {
    name: string;
    gstin: string;
    address: string | null;
    email: string | null;
    location?: string;
    pincode?: string;
    phone?: string | null;
  } | null;
  lines: Array<{
    itemName: string;
    quantity: number;
    unitPricePaise: number;
    amountPaise: number;
  }>;
};

export type EinvoiceProfileInput = {
  mode: string | null;
  registrationType: string | null;
  gstin: string | null;
  legalName: string | null;
  tradeName: string | null;
  address: string | null;
  stateCode: string | null;
  precedingFyTurnoverPaise: number | null;
  einvoiceLocation: string | null;
  einvoicePincode: string | null;
  einvoiceHsnSac: string | null;
};

export type PrepareEinvoiceResult =
  | { ok: true; payload: IrpPayloadV1 }
  | { ok: false; error: string };

export function prepareEinvoicePayload(input: {
  invoice: EinvoiceInvoiceInput;
  profile: EinvoiceProfileInput;
}): PrepareEinvoiceResult {
  const { invoice, profile } = input;
  const fail = (error: string): PrepareEinvoiceResult => ({ ok: false, error });

  if (invoice.status !== 'issued') {
    return fail('Only an issued document can be prepared for e-invoicing. This one is voided.');
  }
  const kind = invoice.documentType === 'gst_tax_invoice' ? 'INV' : invoice.documentType === 'credit_note' ? 'CRN' : invoice.documentType === 'debit_note' ? 'DBN' : null;
  if (!kind) return fail('Only a Regular GST tax invoice or an eligible linked note can be prepared.');
  if (invoice.irpStatus !== 'pending' && invoice.irpStatus !== 'failed') {
    return fail(
      `This document is recorded as IRP status '${invoice.irpStatus}'. Only 'pending' or 'failed' documents can be prepared offline.`,
    );
  }
  if (!invoice.gst) {
    return fail('The saved GST decomposition is missing from this document. It cannot be prepared for e-invoicing.');
  }
  if (invoice.gst.igstPaise > 0) {
    return fail('Inter-state (IGST) documents are not supported by this issuance path yet. Nothing was attempted.');
  }
  if (profile.mode !== 'regular' || profile.registrationType !== 'regular') {
    return fail('E-invoicing applies to Regular-GST tax invoices only. Check the GST settings for this restaurant.');
  }
  if (invoice.irpEvidence?.applicability !== 'required') {
    return fail('Required issue-time PAN-wide IRP evidence is missing or does not require an IRN. Reconcile the saved document; do not use today’s settings.');
  }

  const missing: string[] = [];
  if (!profile.einvoiceLocation?.trim()) missing.push('e-Invoice city (GST settings)');
  if (!profile.einvoicePincode?.trim()) missing.push('e-Invoice PIN code (GST settings)');
  if (!profile.einvoiceHsnSac?.trim()) missing.push('e-Invoice HSN/SAC (GST settings)');
  if (missing.length > 0) {
    return fail(`The e-Invoice issuance profile is incomplete. Record: ${missing.join(', ')}. Nothing was attempted.`);
  }
  const sellerLocation = profile.einvoiceLocation!.trim();
  const sellerPincode = profile.einvoicePincode!.trim();
  const hsnSac = profile.einvoiceHsnSac!.trim();
  if (!/^[1-9][0-9]{5}$/.test(sellerPincode)) {
    return fail('The e-Invoice PIN code in GST settings is not a valid 6-digit Indian PIN. Reconcile the saved document.');
  }
  if (!/^[0-9]{4,8}$/.test(hsnSac)) {
    return fail('The e-Invoice HSN/SAC in GST settings must be 4–8 digits. Reconcile the saved document.');
  }

  const sellerCheck = checkGstin(profile.gstin ?? '');
  if (!sellerCheck.ok) {
    return fail(`The restaurant GSTIN on the GST configuration is not usable: ${sellerCheck.reason}`);
  }
  const sellerState = profile.stateCode?.trim() ?? '';
  if (sellerState !== sellerCheck.parts.stateCode) {
    return fail('The state code on the GST configuration does not match the restaurant GSTIN. Fix the GST settings.');
  }
  const sellerAddress = (profile.address ?? '').trim().replace(/\s+/g, ' ');
  if (sellerAddress.length < 5) {
    return fail('The registered address on the GST configuration is too short. Reconcile the saved seller evidence.');
  }
  if (sellerAddress.length > 100) {
    return fail('The registered address is longer than 100 characters, which the e-Invoice format cannot carry. Shorten it in GST settings.');
  }
  const legalName = (profile.legalName ?? '').trim();
  if (legalName.length < 2) {
    return fail('The legal name on the GST configuration is missing. Reconcile the saved seller evidence.');
  }

  const recipient = invoice.recipient;
  if (!recipient || !recipient.gstin) {
    return fail('This document has no B2B recipient recorded. e-Invoicing applies to registered (B2B) supplies only.');
  }
  const buyerCheck = checkGstin(recipient.gstin);
  if (!buyerCheck.ok) {
    return fail(`The buyer GSTIN on this document is not usable: ${buyerCheck.reason}`);
  }
  const buyerName = recipient.name.trim();
  if (buyerName.length < 2) {
    return fail('The buyer legal name on this document is missing or too short.');
  }
  const buyerAddress = recipient.address?.trim().replace(/\s+/g, ' ') ?? '';
  if (buyerAddress.length < 5 || buyerAddress.length > 200 || !recipient.location || !/^[1-9][0-9]{5}$/.test(recipient.pincode ?? '')) {
    return fail('The saved B2B buyer address, city and PIN do not fit the IRP contract. Do not infer address fields.');
  }
  const docTaxable = invoice.gst.taxablePaise;
  if (docTaxable === null || !Number.isSafeInteger(docTaxable) || docTaxable < 0
    || invoice.gst.placeOfSupplyStateCode !== sellerState
    || docTaxable + invoice.gst.cgstPaise + invoice.gst.sgstPaise !== invoice.totals.totalPaise
    || invoice.gst.cgstPaise + invoice.gst.sgstPaise !== invoice.totals.taxPaise) {
    return fail('The saved GST values or place of supply do not reconcile.');
  }
  const weights = invoice.lines.map((line) => line.amountPaise);
  if (!weights.length || weights.some((n) => !Number.isSafeInteger(n) || n < 0)
      || weights.reduce((sum, n) => sum + n, 0) !== invoice.totals.totalPaise) {
    return fail('Saved line amounts do not reconcile to the document.');
  }
  const lineTaxable = allocateIntegerPaise(weights, docTaxable);
  const lineCgst = allocateIntegerPaise(lineTaxable, invoice.gst.cgstPaise);
  const lineSgst = allocateIntegerPaise(lineTaxable, invoice.gst.sgstPaise);

  const lines: IrpInput['lines'] = invoice.lines.map((line, index) => {
    const taxable = lineTaxable[index];
    const cgst = lineCgst[index];
    const sgst = lineSgst[index];
    const qty = line.quantity;
    const unitPricePaise = qty > 0 ? Math.floor(taxable / qty) : taxable;
    return {
      itemName: line.itemName.trim().slice(0, 300) || `Item ${index + 1}`,
      hsnSac,
      quantity: qty,
      uom: 'NOS',
      unitPricePaise,
      grossAmountPaise: taxable,
      discountPaise: 0,
      taxablePaise: taxable,
      cgstPaise: cgst,
      sgstPaise: sgst,
      igstPaise: 0,
      rateBps: invoice.gst!.rateBps,
      totalItemValuePaise: taxable + cgst + sgst,
    };
  });

  const payloadInput: IrpInput = {
    documentType: kind,
    ...(invoice.originalInvoice ? { originalInvoice: invoice.originalInvoice } : {}),
    documentNumber: invoice.invoiceNumber,
    issuedDate: invoice.issuedLocalDate,
    seller: {
      gstin: profile.gstin!.trim().toUpperCase(),
      legalName,
      tradeName: (profile.tradeName ?? '').trim() || null,
      address1: sellerAddress,
      address2: null,
      location: sellerLocation,
      pincode: sellerPincode,
      stateCode: sellerState,
      email: null,
      phone: invoice.seller.phone?.trim() || null,
    },
    buyer: {
      gstin: recipient.gstin.trim().toUpperCase(),
      legalName: buyerName,
      address1: buyerAddress.slice(0,100),
      address2: buyerAddress.slice(100) || null,
      location: recipient.location,
      pincode: recipient.pincode!,
      stateCode: buyerCheck.parts.stateCode,
      email: recipient.email?.trim() || null,
      phone: recipient.phone ?? null,
      placeOfSupplyStateCode: sellerState,
    },
    // Place of supply for restaurant services is the outlet's state, for both parties.
    placeOfSupplyStateCode: sellerState,
    supplyType: 'B2B',
    lines,
  };

  try {
    return { ok: true, payload: buildIrpPayload(payloadInput) };
  } catch (error) {
    if (error instanceof IrpPayloadError) {
      return fail(`The e-Invoice payload was rejected (${error.code}): ${error.message}`);
    }
    throw error;
  }
}
