/**
 * Composition Scheme — a STATUS, not a rate.
 *
 * Under Section 10 of the CGST Act and the composition rules, an eligible
 * restaurant under composition:
 *   - issues a BILL OF SUPPLY (never a tax invoice),
 *   - collects NO GST from the customer,
 *   - shows NO tax breakdown on the document,
 *   - cannot claim ITC,
 *   - must print "Composition taxable person, not eligible to collect tax on
 *     supplies" on the bill of supply.
 *
 * OWNER DECISION (2026-11-14): activation requires the GSTIN registration
 * type to be 'composition' plus the owner's explicit acknowledgment of the
 * statutory ineligibility list. No CMP-02 evidence reference is required by
 * the product; the acknowledgment checkbox is the recorded control. An
 * outlet that serves alcoholic liquor is not eligible at all, so the
 * acknowledgment text names it explicitly.
 *
 * Nothing here asserts a turnover threshold: thresholds change by
 * notification; strict server-side validation remains authoritative.
 */

export const COMPOSITION_BILL_NOTICE =
  'Composition taxable person, not eligible to collect tax on supplies.';

export const COMPOSITION_ACK_TEXT =
  'I confirm this restaurant (a) is registered under the GST Composition Scheme on the GST portal, ' +
  '(b) does not serve alcoholic liquor for human consumption, sell tobacco or deal in other notified goods, ' +
  'and (c) makes no inter-State outward supplies and no supplies through an e-commerce operator required to collect TCS. ' +
  'I understand a composition restaurant issues a Bill of Supply, collects no GST and claims no ITC.';

export type CompositionEligibility = { ok: true } | { ok: false; reasons: string[] };

export function checkCompositionEligibility(input: {
  /** Registration type recorded on the GSTIN itself (as entered by the owner). */
  registrationType: string | null | undefined;
  /** Owner ticked the acknowledgment checkbox. */
  ineligibilityAcknowledged: boolean;
}): CompositionEligibility {
  const reasons: string[] = [];
  if ((input.registrationType ?? '').trim().toLowerCase() !== 'composition') {
    reasons.push("The GSTIN registration type is not 'composition'. Composition billing requires the registration itself to be on the Composition Scheme.");
  }
  if (!input.ineligibilityAcknowledged) {
    reasons.push('The owner has not acknowledged the composition ineligibility list.');
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
