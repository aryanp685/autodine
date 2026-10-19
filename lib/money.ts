/**
 * Money primitives.
 *
 * RULE: all money in AutoDine is an integer number of paise. Never a
 * floating-point number of rupees.
 *
 * Why: 0.1 + 0.2 !== 0.3 in binary floating point. On a restaurant bill that
 * error shows up as a receipt that does not add up, or a payment that is one
 * paisa short of the order total. Integer paise cannot drift.
 *
 * These helpers are the ONLY place in the codebase allowed to divide by 100.
 */

/** An amount of money, as a whole number of paise. */
export type Paise = number;

/** A rate in basis points. 500 bps = 5.00%. Integers, so no drift either. */
export type Bps = number;

export const PAISE_PER_RUPEE = 100;

/** Basis points per 100%: 10_000 bps = 100.00%. */
export const BPS_PER_100_PERCENT = 10_000;

/**
 * Round to the nearest paisa, half away from zero.
 *
 * Half-up (not banker's rounding) is the convention shoppers expect and the
 * one Indian invoicing software overwhelmingly uses. It is defined explicitly
 * here rather than left to Math.round, because Math.round is half-up for
 * positives but half-toward-+Infinity for negatives: Math.round(-0.5) is -0,
 * not -1. Discounts and refunds are negative, so that matters.
 */
export function roundPaise(value: number): Paise {
  if (!Number.isFinite(value)) {
    throw new RangeError(`roundPaise received a non-finite value: ${value}`);
  }
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Convert rupees to paise. Accepts fractional rupees (e.g. 12.34). */
export function rupeesToPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees)) {
    throw new RangeError(`rupeesToPaise received a non-finite value: ${rupees}`);
  }
  return roundPaise(rupees * PAISE_PER_RUPEE);
}

/** Convert paise to rupees. Use for display only — never for arithmetic. */
export function paiseToRupees(paise: Paise): number {
  assertValidMoney(paise);
  return paise / PAISE_PER_RUPEE;
}

/**
 * Apply a rate expressed in basis points: paise * bps / 10_000.
 * Used for tax, service charge and commission.
 */
export function applyRate(paise: Paise, rateBps: Bps): Paise {
  assertValidMoney(paise);
  if (!Number.isFinite(rateBps)) {
    throw new RangeError(`applyRate received a non-finite rate: ${rateBps}`);
  }
  return roundPaise((paise * rateBps) / BPS_PER_100_PERCENT);
}

/** Line total = unit price x quantity. */
export function lineTotal(unitPricePaise: Paise, qty: number): Paise {
  assertValidMoney(unitPricePaise);
  if (!Number.isInteger(qty) || qty < 0) {
    throw new RangeError(`lineTotal quantity must be a non-negative integer, got: ${qty}`);
  }
  return roundPaise(unitPricePaise * qty);
}

/**
 * Split an amount into two halves, e.g. CGST + SGST for an intra-state supply.
 * If the amount is an odd number of paise, the extra paisa goes to the first
 * half. The two halves always sum back to the original — never lose a paisa.
 */
export function splitInHalf(paise: Paise): [Paise, Paise] {
  assertValidMoney(paise);
  const first = roundPaise(paise / 2);
  return [first, paise - first];
}

/**
 * Split an amount across n parts without losing or inventing a paisa.
 * Any remainder is distributed one paisa at a time to the earliest parts,
 * so the sum of the parts always equals the original amount exactly.
 * Used for splitting a bill or apportioning a discount across order lines.
 */
export function splitEvenly(paise: Paise, parts: number): Paise[] {
  assertValidMoney(paise);
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new RangeError(`splitEvenly parts must be a positive integer, got: ${parts}`);
  }
  const negative = paise < 0;
  const magnitude = Math.abs(paise);
  const base = Math.floor(magnitude / parts);
  let remainder = magnitude - base * parts;
  const out: Paise[] = [];
  for (let i = 0; i < parts; i += 1) {
    out.push(base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return negative ? out.map((p) => -p) : out;
}

/** Guard used by every function above: money must be a whole, sane number. */
export function assertValidMoney(paise: Paise): void {
  if (typeof paise !== 'number' || !Number.isInteger(paise) || !Number.isFinite(paise)) {
    throw new TypeError(`Money must be an integer number of paise, got: ${paise}`);
  }
}
