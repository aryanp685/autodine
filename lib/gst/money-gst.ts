/**
 * GST billing arithmetic, integer paise only.
 *
 * MENU PRICES ARE TAX-INCLUSIVE.
 *
 * A ₹105.00 plate at 5% GST is stored as 10500 paise; the bill must show
 * ₹100.00 taxable + ₹5.00 tax. A ₹118.00 plate at 18% is 10000 + 1800.
 * Extraction happens at DOCUMENT level (one rounding), never per line, so a
 * bill can never accumulate per-line rounding drift.
 *
 * This module never computes a rate the statute does not allow. The only
 * profiles are REGULAR_5 and REGULAR_18 (lib/gst/profiles) and the
 * composition scheme (lib/gst/composition), which collects no GST at all.
 */

import { assertValidMoney, roundPaise, splitInHalf, type Paise, type Bps, BPS_PER_100_PERCENT } from '../money';

export type InclusiveExtraction = {
  /** Net taxable value, paise. inclusive - tax. */
  taxablePaise: Paise;
  /** GST contained in the inclusive price, paise. */
  taxPaise: Paise;
};

/**
 * Extract tax from an inclusive paise amount.
 *
 * taxable = round-half-away-from-zero(inclusive * 10000 / (10000 + bps))
 * tax     = inclusive - taxable
 *
 * Exact at the statutory examples: 10500 @ 500 → 10000 + 500;
 * 11800 @ 1800 → 10000 + 1800.
 */
export function extractInclusiveTax(inclusivePaise: Paise, rateBps: Bps): InclusiveExtraction {
  assertValidMoney(inclusivePaise);
  if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps >= BPS_PER_100_PERCENT) {
    throw new RangeError(`rateBps must be a non-negative integer below ${BPS_PER_100_PERCENT}, got: ${rateBps}`);
  }
  if (inclusivePaise === 0) return { taxablePaise: 0, taxPaise: 0 };
  const taxable = roundPaise((inclusivePaise * BPS_PER_100_PERCENT) / (BPS_PER_100_PERCENT + rateBps));
  return { taxablePaise: taxable, taxPaise: inclusivePaise - taxable };
}

export type TaxComponentPaise = {
  /** Intra-state: Central GST (half of the tax). */
  cgstPaise: Paise;
  /** Intra-state: State GST (the other half). */
  sgstPaise: Paise;
  /** Inter-state: IGST (the full tax). Zero for intra-state invoices. */
  igstPaise: Paise;
};

/** Split a tax amount into its statutory components. Never loses a paisa. */
export function splitTaxComponents(taxPaise: Paise, interState: boolean): TaxComponentPaise {
  assertValidMoney(taxPaise);
  if (interState) return { cgstPaise: 0, sgstPaise: 0, igstPaise: taxPaise };
  const [cgst, sgst] = splitInHalf(taxPaise);
  return { cgstPaise: cgst, sgstPaise: sgst, igstPaise: 0 };
}

/**
 * Full inclusive-price decomposition of a cart/order.
 *
 * lines are inclusive paise ints; discount (paise) is deducted from the
 * INCLUSIVE amount first (the customer asks for one price off), then the
 * remainder is decomposed. Discounts must remain disabled until written
 * financial policy approval exists, matching lib/pricing.ts.
 */
export function decomposeInclusiveBill(
  inclusivePaise: Paise,
  rateBps: Bps,
  interState: boolean,
  discountPaise: Paise = 0
): InclusiveExtraction & TaxComponentPaise & { netPayablePaise: Paise } {
  assertValidMoney(inclusivePaise);
  assertValidMoney(discountPaise);
  if (discountPaise < 0) throw new RangeError('Discount must not be negative.');
  if (discountPaise !== 0) {
    throw new Error('Discounts are disabled until written financial policy approval.');
  }
  const netPayable = inclusivePaise - discountPaise;
  const { taxablePaise, taxPaise } = extractInclusiveTax(netPayable, rateBps);
  return { taxablePaise, taxPaise, netPayablePaise: netPayable, ...splitTaxComponents(taxPaise, interState) };
}
