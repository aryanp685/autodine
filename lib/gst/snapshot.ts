/**
 * Immutable document snapshot — the legal core of the GST system.
 *
 * Every GST (tax-invoice / Bill of Supply) document issued by AutoDine
 * captures, at issue time:
 *   - the seller GST identity (GSTIN, legal name, trade name, address,
 *     state) and registration type,
 *   - the place of supply and the tax component split,
 *   - the recipient, when provided (legal name, GSTIN + its state code
 *     consistency, billing address, invoice email) — format-checked, not
 *     registry-validated,
 *   - the GST profile/effective configuration version that priced it,
 *   - the document sequence (assigned by the database at issue) and IRN
 *     fields (assigned only after the IRP validates).
 *
 * Afterwards the snapshot is IMMUTABLE: the database trigger refuses changes
 * to any protected column (20261113000100), so a later menu price edit,
 * settings change, GSTIN correction or profile switch can NEVER recalculate
 * an issued document. Later payments against the document are recorded as
 * separate receipts/addenda, never by editing the document.
 *
 * Also enforces the hard rule: when the e-invoice applicability engine says
 * IRN is required, the document must NOT be finalised without a validated IRN.
 * With no IRP provider configured (the current state), applicable documents
 * are issued as 'irp_pending' and the app must not render them as final tax
 * invoices.
 */

import type { Paise, Bps } from '../money';
import { splitInHalf } from '../money';
import { checkGstin, isPlausibleEmail } from './gstin';
import { decomposeInclusiveBill } from './money-gst';
import { REGULAR_PROFILES, type GstProfileId } from './profiles';
import { evaluateEInvoiceApplicability, type DocumentKind } from './applicability';
import type { PlaceOfSupply } from './place-of-supply';

export type SellerSnapshot = {
  gstin: string;
  legalName: string;
  tradeName: string | null;
  address: string;
  stateCode: string;
  registrationType: 'regular' | 'composition';
};

export type RecipientSnapshot = {
  legalName: string;
  gstin: string | null;
  gstinStateCode: string | null;
  address: string | null;
  email: string | null;
};

export type LineSnapshot = {
  name: string;
  hsnOrSac: string | null;
  qty: number;
  unitPricePaise: Paise;   // inclusive, as stored on the menu
  amountPaise: Paise;      // inclusive line total
};

export type DocumentSnapshot = {
  docType: DocumentKind;
  gstMode: 'off' | 'regular' | 'composition';
  seller: SellerSnapshot | null;      // null for normal billing
  recipient: RecipientSnapshot | null; // null for B2C
  placeOfSupply: PlaceOfSupply | null;
  rateBps: Bps;                        // 0 for composition/normal
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  taxPaise: Paise;
  totalPaise: Paise;                   // what the customer pays (net payable)
  compositionBill: boolean;
  /** Configuration version used to price this document — audit anchor. */
  configVersion: number;
  lines: LineSnapshot[];
  eInvoiceRequired: boolean;
  eInvoiceReasons: string[];
  /** IRN fields start empty; filled only via the IRP adapter. */
  irn: string | null;
  irpStatus: 'not_required' | 'pending' | 'generated' | 'failed' | 'cancelled';
  /** ISO date the snapshot was taken. */
  issuedAt: string;
};

export type RecipientInput = {
  legalName?: string | null;
  gstin?: string | null;
  address?: string | null;
  email?: string | null;
};

export type RecipientCheck =
  | { ok: true; snapshot: RecipientSnapshot | null }
  | { ok: false; reason: string };

export function checkRecipient(input: RecipientInput | null | undefined): RecipientCheck {
  if (!input) return { ok: true, snapshot: null };
  const name = (input.legalName ?? '').trim();
  const gstinRaw = (input.gstin ?? '').trim();
  const email = (input.email ?? '').trim();
  const wantsGstin = gstinRaw.length > 0;
  if (!name && !wantsGstin && !email) return { ok: true, snapshot: null }; // nothing supplied — B2C
  if (name.length < 2) {
    return { ok: false, reason: 'A recipient tax document needs the recipient legal name (minimum two characters).' };
  }
  let gstinStateCode: string | null = null;
  if (wantsGstin) {
    const check = checkGstin(gstinRaw);
    if (!check.ok) {
      return { ok: false, reason: `Recipient GSTIN rejected: ${check.reason} (format and checksum are verified; registry validity is not checked — confirm on the GST portal).` };
    }
    gstinStateCode = check.parts.stateCode;
  }
  if (email && !isPlausibleEmail(email)) {
    return { ok: false, reason: 'Recipient email address does not look valid.' };
  }
  return {
    ok: true,
    snapshot: {
      legalName: name,
      gstin: wantsGstin ? gstinRaw.toUpperCase() : null,
      gstinStateCode,
      address: (input.address ?? '').trim() || null,
      email: email || null,
    },
  };
}

/**
 * Build the snapshot for a document. Deterministic and pure: same inputs →
 * same output (issuedAt injected by the caller).
 */
export function buildDocumentSnapshot(input: {
  config: {
    mode: 'off' | 'regular' | 'composition';
    configVersion: number;
    profile: GstProfileId | null;
    seller: SellerSnapshot | null;
    placeOfSupplyStateCode: string | null;
    /** AATO preceding FY, paise (required for B2B applicability). */
    precedingFyTurnoverPaise: Paise | null;
  };
  documentKind: DocumentKind;
  lines: LineSnapshot[];
  recipient: RecipientSnapshot | null;
  issuedAt: string;
}): DocumentSnapshot {
  const { config } = input;
  const inclusiveTotal = input.lines.reduce((sum, l) => sum + l.amountPaise, 0);

  if (config.mode === 'off') {
    return {
      docType: 'receipt',
      gstMode: 'off',
      seller: null,
      recipient: null,
      placeOfSupply: null,
      rateBps: 0,
      taxablePaise: inclusiveTotal,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      taxPaise: 0,
      totalPaise: inclusiveTotal,
      compositionBill: false,
      configVersion: config.configVersion,
      lines: input.lines,
      eInvoiceRequired: false,
      eInvoiceReasons: ['Normal billing — not a GST document.'],
      irn: null,
      irpStatus: 'not_required',
      issuedAt: input.issuedAt,
    };
  }

  if (!config.seller) {
    throw new Error('GST mode is active but no seller identity is configured — refusing to issue a document. Fix the GST settings first.');
  }

  if (config.mode === 'composition') {
    return {
      docType: 'bill_of_supply',
      gstMode: 'composition',
      seller: config.seller,
      recipient: input.recipient,
      placeOfSupply: config.placeOfSupplyStateCode ? { stateCode: config.placeOfSupplyStateCode, interState: false, igstApplies: false } : null,
      rateBps: 0,
      taxablePaise: inclusiveTotal,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      taxPaise: 0,
      totalPaise: inclusiveTotal,
      compositionBill: true,
      configVersion: config.configVersion,
      lines: input.lines,
      eInvoiceRequired: false,
      eInvoiceReasons: ['Bill of Supply documents are never subject to e-invoicing.'],
      irn: null,
      irpStatus: 'not_required',
      issuedAt: input.issuedAt,
    };
  }

  // Regular profile
  const profile = REGULAR_PROFILES[config.profile ?? 'other_than_specified_premises'];
  if (!profile) throw new Error('Unknown GST profile — refusing to issue.');
  // Restaurant services: place of supply is the outlet's state — a B2B
  // recipient in another state does NOT make this an inter-state supply
  // (see lib/gst/place-of-supply.ts). interState is threaded through the
  // config for supplies whose governing rule is inter-state; when false the
  // split is always CGST + SGST.
  const interState = false;
  const decomp = decomposeInclusiveBill(inclusiveTotal, profile.rateBps, interState);
  const applicability = evaluateEInvoiceApplicability({
    documentKind: 'tax_invoice',
    precedingFyTurnoverPaise: config.precedingFyTurnoverPaise,
    recipientHasGstin: Boolean(input.recipient?.gstin),
    isExport: false,
    notifiedCategory: false,
  });
  return {
    docType: 'tax_invoice',
    gstMode: 'regular',
    seller: config.seller,
    recipient: input.recipient,
    placeOfSupply: { stateCode: config.placeOfSupplyStateCode ?? config.seller.stateCode, interState, igstApplies: false },
    rateBps: profile.rateBps,
    taxablePaise: decomp.taxablePaise,
    cgstPaise: decomp.cgstPaise,
    sgstPaise: decomp.sgstPaise,
    igstPaise: decomp.igstPaise,
    taxPaise: decomp.taxPaise,
    totalPaise: decomp.netPayablePaise,
    compositionBill: false,
    configVersion: config.configVersion,
    lines: input.lines,
    eInvoiceRequired: applicability.required,
    eInvoiceReasons: applicability.reasons,
    irn: null,
    irpStatus: applicability.required ? 'pending' : 'not_required',
    issuedAt: input.issuedAt,
  };
}

/** CGST for odd paise lands in CGST (kept consistent with lib/bill.ts). */
export function splitIntraState(taxPaise: Paise): [Paise, Paise] {
  return splitInHalf(taxPaise);
}
