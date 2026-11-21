/**
 * The subscription catalog, as the application sees it.
 *
 * ONE SOURCE OF TRUTH
 *
 * The rupee prices live in lib/plans.ts, because the pricing page renders
 * them. The paise prices the database charges live in
 * `public.plan_price_paise()` (migration 20261110001100). `lib/plans.test.ts`
 * parses both and fails if they disagree, so this file converts and nothing
 * else: there is no third copy of a price anywhere in the app.
 *
 * Money is integer paise. A price is never a float, because a float price
 * multiplied by a number of months is a rounding error waiting to be a refund.
 */

import { PLANS, type PlanId } from '@/lib/plans';
import { rupeesToPaise } from '@/lib/money';

/** The only currency this deployment sells in. */
export const BILLING_CURRENCY = 'INR';

/** The billing period that is for sale. There is no annual price approved. */
export const BILLING_PERIOD_MONTHS = 1;

/** A plan id, or 'trial' for an account that has not chosen one. */
export type SubscriptionPlan = PlanId | 'trial';

export type PlanPrice = {
  id: PlanId;
  name: string;
  /** Monthly price in whole rupees, as printed. */
  rupees: number;
  /** Monthly price in paise, as charged. */
  paise: number;
  /** Outlets included. `null` is unlimited. */
  outlets: number | null;
  fit: string;
};

/** The catalog, in paise, derived from the printed prices. */
export const PLAN_PRICES: PlanPrice[] = PLANS.map((plan) => ({
  id: plan.id,
  name: plan.name,
  rupees: plan.price,
  paise: rupeesToPaise(plan.price),
  outlets: plan.outlets,
  fit: plan.fit,
}));

/** The price of a plan in paise, or null for a plan that is not for sale. */
export function planPricePaise(plan: string | null | undefined): number | null {
  const found = PLAN_PRICES.find((entry) => entry.id === plan);
  return found ? found.paise : null;
}

/** The price of a plan for a number of months, in paise. Null when unknown. */
export function planPriceForMonths(
  plan: string | null | undefined,
  months: number = BILLING_PERIOD_MONTHS,
): number | null {
  const monthly = planPricePaise(plan);
  if (monthly === null) return null;
  const whole = Number.isSafeInteger(months) && months > 0 ? Math.floor(months) : BILLING_PERIOD_MONTHS;
  return monthly * whole;
}

/** Is this an amount this plan actually costs? Used before any write. */
export function amountMatchesPlan(
  plan: string | null | undefined,
  amountPaise: unknown,
  months: number = BILLING_PERIOD_MONTHS,
): boolean {
  const expected = planPriceForMonths(plan, months);
  if (expected === null) return false;
  return typeof amountPaise === 'number' && Number.isSafeInteger(amountPaise) && amountPaise === expected;
}

/**
 * A subscription receipt is not a tax invoice.
 *
 * The law calls a GST tax invoice a document with the supplier's GSTIN, the
 * recipient's details, an HSN/SAC code and the tax split. A subscription
 * receipt has none of those: it records money AutoDine received for a
 * subscription. Every surface that shows one says so, because a receipt that
 * looks like a tax invoice is a receipt somebody will try to file.
 */
export const RECEIPT_DISCLAIMER =
  'Payment receipt · not a GST tax invoice. It records a subscription payment and carries no tax registration number.';

/** How a plan is named on a receipt and in the history list. */
export function planName(plan: string | null | undefined): string {
  const found = PLAN_PRICES.find((entry) => entry.id === plan);
  if (found) return found.name;
  if (plan === 'trial') return 'Free trial';
  return 'No plan';
}
