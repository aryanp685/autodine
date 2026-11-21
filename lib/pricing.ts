/**
 * Guest-facing order-price preview.
 *
 * The browser uses this helper to display a quote from the loaded menu and
 * restaurant rate. The database remains authoritative: it revalidates the
 * cart, calculates, and stores the order total independently.
 *
 * Tax modes mirror the approved two-mode GST policy:
 *   - off: one restaurant rate, added on top of menu prices
 *   - composition: no tax is charged at all (Bill of Supply)
 *   - regular: menu prices include GST; the tax is extracted once from the
 *     document total at the closed 5% or 18% profile
 *
 * The helper does not model per-item rates or interstate IGST. The sample
 * default below is for demos and tests; live cart loaders require an explicit
 * restaurant rate and never substitute that sample. This is implementation
 * behavior, not tax advice or a claim of GST compliance.
 */

import {
  BPS_PER_100_PERCENT,
  assertValidMoney,
  applyRate,
  lineTotal,
  splitInHalf,
  type Bps,
  type Paise,
} from './money';

/** SAMPLE ONLY — see the tax status note above. 500 bps = 5.00%. */
export const SAMPLE_TAX_RATE_BPS: Bps = 500;

export type GstMode = 'off' | 'composition' | 'regular';

/** What the guest quote needs to price an order the way the till will. */
export type GstQuote = {
  mode: GstMode;
  /** Required in regular mode; null or absent in composition mode. */
  rateBps?: Bps | null;
};

/**
 * Require an explicit, valid rate from live restaurant data. The sample rate
 * remains available to demo layouts, but a missing or malformed production
 * value must fail closed rather than silently become a guest-facing charge.
 */
export function requireTaxRateBps(value: unknown): Bps {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('The restaurant tax rate is unavailable. Please try again.');
  }
  return value;
}

/**
 * How the tax line on a bill is labelled.
 *
 * A live rate is named explicitly. When a demo has no configured rate, use a
 * generic label rather than presenting the sample percentage as restaurant
 * tax information.
 */
export function gstLabel(taxRateBps?: number): string {
  if (taxRateBps == null) return 'Taxes';
  const pct = taxRateBps / 100;
  const shown = Number.isInteger(pct) ? String(pct) : pct.toFixed(2);
  return `GST ${shown}%`;
}

export type PriceableLine = {
  /** Price of ONE unit, in paise, as stored on the menu. */
  unitPricePaise: Paise;
  qty: number;
};

export type OrderTotalsInput = {
  lines: PriceableLine[];
  /** Must remain zero until written financial policy approval enables discounts. */
  discountPaise?: Paise;
  /** Defaults to the sample rate. Bps, e.g. 500 = 5.00%. */
  taxRateBps?: Bps;
  /** Defaults to `off`, the historical behaviour. */
  mode?: GstMode;
};

export type OrderTotals = {
  /** The mode these totals were computed under. */
  mode: GstMode;
  /** Sum of line totals before any discount. */
  subtotalPaise: Paise;
  /** Discount as given, clamped so the taxable amount never goes negative. */
  discountPaise: Paise;
  /** Taxable value: the base in off mode, the extracted base in regular mode. */
  taxablePaise: Paise;
  taxPaise: Paise;
  /** Split of the tax, for an intra-state (CGST + SGST) invoice. */
  cgstPaise: Paise;
  sgstPaise: Paise;
  /** What the customer pays. */
  totalPaise: Paise;
};

/**
 * Extract the taxable value from a tax-inclusive amount, mirroring SQL's
 * `round(total * 10000 / (10000 + rate))` with integer arithmetic.
 */
function extractInclusiveTax(inclusivePaise: Paise, rateBps: Bps): Paise {
  const divisor = BPS_PER_100_PERCENT + rateBps;
  return Math.floor(
    (inclusivePaise * BPS_PER_100_PERCENT + Math.floor(divisor / 2)) / divisor
  );
}

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
 * Discount arithmetic is deliberately unavailable until written financial
 * policy approval specifies authority, tax treatment and audit requirements.
 * Every live order path currently supplies zero; this guard prevents a future
 * caller from activating a guessed policy through this shared helper.
 */
export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const { lines, discountPaise = 0, mode = 'off' } = input;

  assertValidMoney(discountPaise);
  if (discountPaise < 0) {
    throw new RangeError(`Discount must not be negative, got: ${discountPaise} paise`);
  }
  if (discountPaise !== 0) {
    throw new Error('Discounts are disabled until written financial policy approval.');
  }

  const subtotalPaise = computeSubtotal(lines);
  const netPaise = Math.max(subtotalPaise - discountPaise, 0);

  if (mode === 'composition') {
    return {
      mode,
      subtotalPaise,
      discountPaise,
      taxablePaise: netPaise,
      taxPaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      totalPaise: netPaise,
    };
  }

  if (mode === 'regular') {
    const rateBps = input.taxRateBps;
    if (typeof rateBps !== 'number' || !Number.isSafeInteger(rateBps) || rateBps < 0) {
      throw new TypeError('A Regular GST profile rate is unavailable. Please try again.');
    }
    const taxablePaise = extractInclusiveTax(netPaise, rateBps);
    const taxPaise = netPaise - taxablePaise;
    const [cgstPaise, sgstPaise] = splitInHalf(taxPaise);
    return {
      mode,
      subtotalPaise,
      discountPaise,
      taxablePaise,
      taxPaise,
      cgstPaise,
      sgstPaise,
      totalPaise: netPaise,
    };
  }

  const taxablePaise = netPaise;
  const taxPaise = applyRate(taxablePaise, input.taxRateBps ?? SAMPLE_TAX_RATE_BPS);
  const [cgstPaise, sgstPaise] = splitInHalf(taxPaise);

  return {
    mode,
    subtotalPaise,
    discountPaise,
    taxablePaise,
    taxPaise,
    cgstPaise,
    sgstPaise,
    totalPaise: taxablePaise + taxPaise,
  };
}
