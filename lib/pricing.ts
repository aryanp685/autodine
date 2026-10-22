/**
 * Order pricing.
 *
 * RULE: the server is the only thing allowed to decide what an order costs.
 * The browser sends item ids and quantities; it never sends a total. This
 * module is where a total becomes a fact.
 *
 * ── TAX STATUS: UNCONFIRMED ────────────────────────────────────────────────
 * The 5% below is a SAMPLE for layout review only. The real GST treatment is
 * still to be decided with a tax adviser, and three questions are open:
 *
 *   1. Are menu prices tax-inclusive or tax-exclusive? (This module assumes
 *      tax-exclusive: prices are shown and stored without GST, and GST is
 *      added at the end. If they are inclusive, the calculation inverts.)
 *   2. Is GST computed per line item and summed, or once on the order total?
 *      For a single-rate order the answers are identical only if each line
 *      rounds the same way; with mixed rates they are not.
 *   3. Are CGST/SGST (intra-state) and IGST (inter-state) both supported,
 *      and is the rate chosen per restaurant state vs customer state?
 *
 * Nothing here charges anyone. This module must not be used for a live
 * transaction until those questions are answered and this comment is deleted.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { assertValidMoney, applyRate, lineTotal, splitInHalf, type Bps, type Paise } from './money';

/** SAMPLE ONLY — see the tax status note above. 500 bps = 5.00%. */
export const SAMPLE_TAX_RATE_BPS: Bps = 500;

/**
 * How the tax line on a bill is labelled.
 *
 * The rate comes from the restaurant when it has one, and falls back to the
 * sample. The label used to say "GST 5% · sample" unconditionally, which was
 * wrong the moment a restaurant configured its own rate: the bill showed one
 * percentage and charged another.
 */
export function gstLabel(taxRateBps?: number): string {
  const bps = taxRateBps ?? SAMPLE_TAX_RATE_BPS;
  const pct = bps / 100;
  const shown = Number.isInteger(pct) ? String(pct) : pct.toFixed(2);
  return taxRateBps == null ? `GST ${shown}% · sample` : `GST ${shown}%`;
}

export type PriceableLine = {
  /** Price of ONE unit, in paise, as stored on the menu. */
  unitPricePaise: Paise;
  qty: number;
};

export type OrderTotalsInput = {
  lines: PriceableLine[];
  /** Applied to the pre-tax subtotal. Positive number, subtracted. */
  discountPaise?: Paise;
  /** Defaults to the sample rate. Bps, e.g. 500 = 5.00%. */
  taxRateBps?: Bps;
};

export type OrderTotals = {
  /** Sum of line totals before any discount. */
  subtotalPaise: Paise;
  /** Discount as given, clamped so the taxable amount never goes negative. */
  discountPaise: Paise;
  /** What tax is actually charged on. subtotal - discount, floored at zero. */
  taxablePaise: Paise;
  taxPaise: Paise;
  /** Split of the tax, for an intra-state (CGST + SGST) invoice. */
  cgstPaise: Paise;
  sgstPaise: Paise;
  /** What the customer pays. Always exactly taxable + tax. */
  totalPaise: Paise;
};

/**
 * Sum of line totals. Each line is rounded to the paisa before being summed,
 * which is the conventional retail behaviour and keeps every line displayable
 * on its own without the column failing to add up.
 */
export function computeSubtotal(lines: PriceableLine[]): Paise {
  if (!Array.isArray(lines)) {
    throw new TypeError(`computeSubtotal expects an array of lines, got: ${typeof lines}`);
  }
  return lines.reduce((sum, l) => sum + lineTotal(l.unitPricePaise, l.qty), 0);
}

/**
 * Full order totals.
 *
 * ORDER OF PRECEDENCE (this is the definition, do not reorder casually):
 *   1. subtotal  = sum of (unit price x qty), each line rounded to the paisa
 *   2. taxable   = max(subtotal - discount, 0)
 *   3. tax       = round(taxable x rate)
 *   4. total     = taxable + tax
 *
 * Tax is charged on the DISCOUNTED amount, which is the standard treatment:
 * a discount granted before supply reduces the value of supply, so GST
 * follows the reduced value, not the original. A discount that exceeds the
 * subtotal clamps the taxable base to zero rather than producing a negative
 * bill — the discount itself is reported unclamped so the anomaly is visible.
 */
export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const { lines, discountPaise = 0, taxRateBps = SAMPLE_TAX_RATE_BPS } = input;

  assertValidMoney(discountPaise);
  if (discountPaise < 0) {
    throw new RangeError(`Discount must not be negative, got: ${discountPaise} paise`);
  }

  const subtotalPaise = computeSubtotal(lines);
  const taxablePaise = Math.max(subtotalPaise - discountPaise, 0);
  const taxPaise = applyRate(taxablePaise, taxRateBps);
  const [cgstPaise, sgstPaise] = splitInHalf(taxPaise);

  return {
    subtotalPaise,
    discountPaise,
    taxablePaise,
    taxPaise,
    cgstPaise,
    sgstPaise,
    totalPaise: taxablePaise + taxPaise,
  };
}
