/**
 * e-Invoice issuance — the provider-independent half.
 *
 * This module is PURE: it takes the immutable invoice snapshot, the recorded
 * GST configuration and (implicitly) the recorded applicability state, and
 * either produces a deterministic IRP payload or refuses with an owner-
 * actionable reason. It never reads the network, a database, the clock or
 * the environment — the server action (app/invoice/[id]/einvoice-actions.ts)
 * supplies all three.
 *
 * What this deliberately does NOT do:
 *   - call any IRP/GSP. The only adapter in the tree is the offline sandbox
 *     (lib/gst/irp/sandbox.ts); wiring a live provider is an owner decision.
 *   - mark the document generated. The database has no path to flip
 *     irp_status to 'generated' from application code, so a sandbox "accept"
 *     can never masquerade as a real IRN on a legal document. Every attempt
 *     IS recorded (payload_built → submitted → accepted|rejected|transport_error)
 *     in restaurant_irp_requests through the owner/manager definer RPC.
 *
 * Line decomposition: the snapshot stores tax-inclusive prices and only
 * document-level GST figures. Per line we allocate the document totals by
 * line weight (largest remainder, lib/gst/allocate.ts), so line values sum
 * EXACTLY to the document snapshot — no paisa is invented and the payload's
 * own invariants (taxable = gross − discount; total = taxable + taxes) hold.
 * The tax-exclusive unit price is the allocated line value divided by
 * quantity, floored to whole paise; for quantities > 1 the NIC-side rate×qty
 * product may differ from the line total by less than one paise per unit.
 * Document totals are always exact.
 */

import { allocateIntegerPaise } from './allocate';
import { EINVOICE_TURNOVER_THRESHOLD_PAISE } from './applicability';
import { checkGstin } from './gstin';
import { buildIrpPayload, IrpPayloadError, type IrpInput } from './irp/payload';
import type { IrpPayloadV1 } from './irp/types';
import { parseTaxAddress } from './tax-address';

export type EinvoiceInvoiceInput = {
  /** INV/26-27/000001 — must satisfy the payload's 1–16 char rule. */
  invoiceNumber: string;
  /** Outlet-local calendar date (YYYY-MM-DD) of issuance. */
  issuedLocalDate: string;
  irpStatus: string;
  status: string;
  documentType: string;
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
  if (invoice.documentType !== 'gst_tax_invoice') {
    return fail('Only a Regular-GST tax invoice is e-invoice eligible. Bills of Supply and ordinary receipts are not.');
  }
  if (invoice.irpStatus !== 'pending' && invoice.irpStatus !== 'failed') {
    return fail(
      `This document is recorded as IRP status '${invoice.irpStatus}'. Only 'pending' or 'failed' documents can be submitted.`,
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
  const turnover = profile.precedingFyTurnoverPaise;
  if (turnover === null || turnover === undefined) {
    return fail('The preceding-financial-year aggregate turnover is not recorded. Add it in GST settings — applicability cannot be ruled out without it.');
  }
  if (!Number.isFinite(turnover)) {
    return fail('The recorded preceding-financial-year turnover is unreadable. Re-save the GST settings.');
  }
  if (turnover <= EINVOICE_TURNOVER_THRESHOLD_PAISE) {
    return fail('The recorded turnover is at or below ₹5 crore, so a B2B document is not e-invoice applicable. This document is marked pending — reconcile the GST settings before attempting.');
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
    return fail('The e-Invoice PIN code in GST settings is not a valid 6-digit Indian PIN. Fix it and try again.');
  }
  if (!/^[0-9]{4,8}$/.test(hsnSac)) {
    return fail('The e-Invoice HSN/SAC in GST settings must be 4–8 digits. Fix it and try again.');
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
    return fail('The registered address on the GST configuration is too short. Fix it in GST settings.');
  }
  if (sellerAddress.length > 100) {
    return fail('The registered address is longer than 100 characters, which the e-Invoice format cannot carry. Shorten it in GST settings.');
  }
  const legalName = (profile.legalName ?? '').trim();
  if (legalName.length < 2) {
    return fail('The legal name on the GST configuration is missing. Fix it in GST settings.');
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
  const buyerAddress = parseTaxAddress(recipient.address);
  if (!buyerAddress.ok) {
    return fail(`The buyer address on this document cannot feed an e-Invoice: ${buyerAddress.reason}`);
  }

  const docTaxable = invoice.gst.taxablePaise ?? Math.max(invoice.totals.subtotalPaise - invoice.totals.taxPaise, 0);
  if (!Number.isSafeInteger(docTaxable) || docTaxable < 0) {
    return fail('The saved taxable value is unreadable. This document cannot be prepared.');
  }
  const weights = invoice.lines.map((line) => line.amountPaise);
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
    documentType: 'INV',
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
      address1: buyerAddress.address.address1,
      address2: null,
      location: buyerAddress.address.location,
      pincode: buyerAddress.address.pincode,
      stateCode: buyerCheck.parts.stateCode,
      email: recipient.email?.trim() || null,
      phone: null,
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
