/**
 * e-Invoice applicability engine.
 *
 * Rule (Notification No. 10/2023-Central Tax, as amended): e-invoice
 * (IRN from the IRP) is mandatory for a registered person whose aggregate
 * annual turnover (AATO) exceeded ₹5 crore in any preceding financial year,
 * for supplies made to registered persons (B2B) and for exports, and for
 * other notified categories. It is NOT required for B2C supplies.
 *
 * Documents never eligible: Bill of Supply (composition), exempt/nil-rated
 * supplies, ordinary restaurant receipts to unregistered persons. Rather than
 * enumerate every carve-out error-prone, the engine is explicit about what
 * AutoDine supports TODAY and fails closed for everything else — the owner
 * is shown the reason; nothing is silently classified "not applicable".
 *
 * Threshold: five crore rupees = 50_000_000_000 paise.
 */

import type { Paise } from '../money';

export const EINVOICE_TURNOVER_THRESHOLD_PAISE: Paise = 5_000_000_000; // ₹5,00,00,000 (₹5 crore) in paise

export type DocumentKind =
  | 'tax_invoice'      // regular-profile GST tax invoice (B2B or export only for IRP)
  | 'bill_of_supply'   // composition scheme — excluded
  | 'receipt'          // normal billing, no GST — excluded
  | 'credit_note'
  | 'debit_note';

export type ApplicabilityInput = {
  documentKind: DocumentKind;
  /** AATO in the preceding financial year, paise. null = unknown → fail closed for B2B. */
  precedingFyTurnoverPaise: Paise | null;
  /** Recipient GSTIN present (B2B). */
  recipientHasGstin: boolean;
  /** Supply is an export (with/without payment of tax). */
  isExport: boolean;
  /** Notified category (e.g., SEZ supply). Defaults false. */
  notifiedCategory?: boolean;
};

export type Applicability =
  | { required: false; reasons: string[] }
  | { required: true; reasons: string[] };

export function evaluateEInvoiceApplicability(input: ApplicabilityInput): Applicability {
  // Hard exclusions first
  if (input.documentKind === 'bill_of_supply') {
    return { required: false, reasons: ['Bill of Supply documents are never subject to e-invoicing.'] };
  }
  if (input.documentKind === 'receipt') {
    return { required: false, reasons: ['Normal-billing receipts are not GST documents and are never e-invoiced.'] };
  }
  const b2bLike = input.recipientHasGstin || input.isExport || Boolean(input.notifiedCategory);
  if (!b2bLike) {
    return { required: false, reasons: ['B2C supplies to unregistered persons are not e-invoiced.'] };
  }
  if (input.precedingFyTurnoverPaise === null || input.precedingFyTurnoverPaise === undefined) {
    // Fail closed: we do not know the AATO, so we cannot lawfully let the
    // owner believe the invoice may skip IRN.
    return {
      required: true,
      reasons: ['Preceding-FY aggregate turnover is unknown — treating e-invoice as REQUIRED until AATO is recorded (fail closed).'],
    };
  }
  if (input.precedingFyTurnoverPaise > EINVOICE_TURNOVER_THRESHOLD_PAISE) {
    const scope = [input.recipientHasGstin && 'B2B', input.isExport && 'export', input.notifiedCategory && 'notified category'].filter(Boolean).join(', ');
    return { required: true, reasons: [`Preceding-FY AATO exceeds ₹5 crore (Notification No. 10/2023-CT, as amended) — this ${input.documentKind} (${scope}) requires an IRN from the IRP before issue.`] };
  }
  return { required: false, reasons: ['Preceding-FY AATO is at or below ₹5 crore — e-invoice not required.'] };
}
