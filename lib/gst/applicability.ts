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
 * Threshold: five crore rupees = 5_000_000_000 paise.
 */

import type { Paise } from '../money';
import { addBillingDays, gstFinancialYearStart, validIndianBillingDate, type ReportingCategory } from './onboarding';

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

/** Scope of the active ruleset, not permission to apply its policy
 * to historical docs. Sources and earlier phases are in the source register. */
export const IRP_RULE = { version:'13-2020-amended-10-2023', effectiveFrom:'2023-08-01', firstPriorFy:2017 } as const;
export type IrpMandate = 'required' | 'not_required' | 'unknown';
export type IrpExemptEntity = 'sez_unit' | 'rule54_2_3_4_4a' | 'government_department' | 'local_authority';
const SUPPLIER_EXEMPTIONS = new Set<IrpExemptEntity>(['sez_unit','rule54_2_3_4_4a','government_department','local_authority']);
export type IrpFacts = {
  documentKind: DocumentKind; issueDate: string;
  supply: 'registered' | 'consumer' | 'export' | 'sez_recipient' | 'unknown';
  highestPriorFyPaise: number | null;
  fullPanHistory: boolean;
  knownPriorFyPaise?: number | null;
  entityExemption?: { category: IrpExemptEntity; verifiedForDate: boolean };
};
export type IrpDecision = {
  mandate: IrpMandate;
  reason: 'not_tax_document' | 'consumer' | 'unreviewed_date' | 'unknown_supply' | 'unverified_exemption' |
    'supplier_exemption' | 'prior_pan_above_limit' | 'prior_pan_at_or_below_limit' | 'missing_or_conflicting_pan_review';
  routeScope: 'domestic_subset' | 'unsupported_supply' | 'no_dispatch' | 'hold';
  rule: typeof IRP_RULE;
};
export function explainIrpMandate(input: IrpFacts): IrpDecision {
  const result = (mandate: IrpMandate, reason: IrpDecision['reason']): IrpDecision => ({mandate,reason,rule:IRP_RULE,
    routeScope:mandate==='unknown'?'hold':mandate==='not_required'?'no_dispatch':input.supply==='registered'?'domestic_subset':'unsupported_supply'});
  if (input.documentKind==='bill_of_supply' || input.documentKind==='receipt') return result('not_required','not_tax_document');
  if (!validIndianBillingDate(input.issueDate) || input.issueDate<IRP_RULE.effectiveFrom) return result('unknown','unreviewed_date');
  if (input.supply==='consumer') return result('not_required','consumer');
  if (!['registered','export','sez_recipient'].includes(input.supply)) return result('unknown','unknown_supply');
  if (input.entityExemption) return SUPPLIER_EXEMPTIONS.has(input.entityExemption.category) && input.entityExemption.verifiedForDate===true
    ? result('not_required','supplier_exemption') : result('unknown','unverified_exemption');
  const known=input.knownPriorFyPaise??-1, max=input.highestPriorFyPaise??-1;
  if (Number.isSafeInteger(known) && known>EINVOICE_TURNOVER_THRESHOLD_PAISE) return result('required','prior_pan_above_limit');
  if (!input.fullPanHistory || !Number.isSafeInteger(max) || max<0 || max<known) return result('unknown','missing_or_conflicting_pan_review');
  return max>EINVOICE_TURNOVER_THRESHOLD_PAISE ? result('required','prior_pan_above_limit') : result('not_required','prior_pan_at_or_below_limit');
}
export function evaluateIrpMandate(input: IrpFacts): IrpMandate {
  return explainIrpMandate(input).mandate;
}

/** Highest of the PAN-wide (not outlet-wide) closed years. A known high
 * prior year can trigger a hold even though some years remain unknown. No
 * invented zero for missing years, no current FY, and no summing years. */
export function assessPriorPanYears(issueDate: string, facts: readonly { fyStart: number; paise: number }[]) {
  const buckets = new Map<number,number>();
  const end = validIndianBillingDate(issueDate) ? gstFinancialYearStart(issueDate) : 0;
  let consistent = end>IRP_RULE.firstPriorFy;
  for (const {fyStart,paise} of facts) {
    if (!Number.isInteger(fyStart) || fyStart<IRP_RULE.firstPriorFy || fyStart>=end || !Number.isSafeInteger(paise) || paise<0
      || buckets.has(fyStart)) { consistent=false; continue; }
    buckets.set(fyStart,paise);
  }
  const fullPanHistory=consistent && buckets.size===end-IRP_RULE.firstPriorFy;
  const knownPriorFyPaise=consistent && buckets.size ? Math.max(...buckets.values()):null;
  return { fullPanHistory, knownPriorFyPaise, highestPriorFyPaise:fullPanHistory?knownPriorFyPaise:null };
}

export const IRP_30_DAY_THRESHOLD_PAISE = 10_000_000_000;
export function reportingWindow(issueDate: string, reportingDate: string, category: ReportingCategory):
  { ok: true; lastDate: string | null } | { ok: false; code: 'invalid_date' | 'unknown_window' | 'reporting_window_expired'; lastDate?: string } {
  if (!validIndianBillingDate(issueDate) || !validIndianBillingDate(reportingDate) || issueDate > reportingDate) return { ok: false, code: 'invalid_date' };
  if (reportingDate < '2025-04-01' || category === 'unknown') return { ok: false, code: 'unknown_window' };
  if (category === 'under_10cr') return { ok: true, lastDate: null };
  if (category !== 'at_least_10cr') return { ok: false, code: 'unknown_window' };
  const lastDate = addBillingDays(issueDate, 29);
  return reportingDate <= lastDate ? { ok: true, lastDate } : { ok: false, code: 'reporting_window_expired', lastDate };
}
