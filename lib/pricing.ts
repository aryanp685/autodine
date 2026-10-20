/**
 * Order pricing.
 *
 * RULE: the server is the only thing allowed to decide what an order costs.
 * The browser sends item ids and quantities; it never sends a total. This
 * module is where a total becomes a fact.
 *
 * ── PREVIEW DEFAULT — VENUE STATUS UNVERIFIED ───────────────────────────────
 * Use one flat 5% restaurant-service rate for the ordinary standalone-restaurant
 * preview model; do not apply category-wise rates to ordinary menu dishes. Menu
 * prices are tax-exclusive in this preview. For a local dine-in order the 5%
 * is represented as 2.5% CGST + 2.5% SGST. No service charge or other default
 * fee is added.
 *
 * This is a conventional preview default, NOT a verified tax determination for
 * this venue. Specified-premises hotel restaurants, registration/composition
 * status, inter-state supply, packaged goods/alcohol, and other exceptions may
 * require different treatment. Confirm the restaurant's GST status and premises
 * before using these figures for live billing. The database remains the trusted
 * source of order totals; browser calculations are display-only.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { assertValidMoney, applyRate, lineTotal, splitInHalf, type Bps, type Paise } from './money';

/** Preview default for ordinary restaurant service: 500 bps = 5.00%. */
export const SAMPLE_TAX_RATE_BPS: Bps = 500;

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
