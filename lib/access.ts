/**
 * A restaurant's plan and trial, as the app describes it.
 *
 * The AUTHORITY is `public.restaurant_access()` in migration 20261026001200 —
 * this type is only the shape of what it returns, plus the sentences that turn
 * it into English. Nothing here decides anything, and no screen may treat a
 * missing value as permission: the database refuses the write either way.
 *
 * Why a separate module: client components (the dashboard's plan line, the
 * Settings trial note) need these helpers, and lib/db/staff.ts imports
 * next/headers, which cannot be pulled into a client bundle.
 */

import { BILLING } from './plans';

export type RestaurantAccess = {
  /** 'trial' | 'starter' | 'professional' | 'business', or anything the DB says. */
  plan: string;
  status: string;
  /** Server timestamp. Null only when the read failed. */
  trialEndsAt: string | null;
  /** Whole days left in the trial, rounded up. 0 when not trialing. */
  daysRemaining: number;
  /** The write gate: false means orders, menus and payments are read-only. */
  canWrite: boolean;
  readOnly: boolean;
  /** Feature ids from the server's matrix. */
  features: string[];
  /**
   * Migration 20261110001000 (Model C). The account that owns this outlet and
   * pays for it. Optional: a deployment predating the migration has no account
   * link, and a screen must not break for it.
   */
  accountId?: string | null;
  /**
   * Migration 20261110001000. How many outlets the account's plan allows, and
   * how many it has. Optional for the same reason, and read through
   * `outletEntitlementOf()` so a missing value is never treated as a licence.
   */
  outlets?: OutletEntitlement;
};

/**
 * Outlets: what the plan allows and what the account already has.
 *
 * `limit: null` is unlimited. `remaining: null` is "not known", which is not
 * the same as "allowed": the server refuses over-limit creation either way
 * (public.create_outlet(), migration 20261110001000). This type only decides
 * what a screen may promise.
 */
export type OutletEntitlement = {
  used: number;
  /** Null = unlimited. */
  limit: number | null;
  unlimited: boolean;
  /** Null when the limit is unlimited or unknown. */
  remaining: number | null;
};

/** What a screen assumes before the server has answered. */
export const UNKNOWN_OUTLET_ENTITLEMENT: OutletEntitlement = {
  used: 1,
  limit: null,
  unlimited: true,
  remaining: null,
};

/** The entitlement of an access read, with an honest default. */
export function outletEntitlementOf(
  access: RestaurantAccess | null | undefined,
): OutletEntitlement {
  const outlets = access?.outlets;
  if (!outlets || typeof outlets !== 'object') return UNKNOWN_OUTLET_ENTITLEMENT;
  const limit = typeof outlets.limit === 'number' ? outlets.limit : null;
  const used = typeof outlets.used === 'number' ? outlets.used : 1;
  return {
    used,
    limit,
    unlimited: limit === null,
    remaining: limit === null ? null : Math.max(limit - used, 0),
  };
}

/** "3 of 5 outlets", "Unlimited outlets", or '' when nothing is known. */
export function outletSummary(access: RestaurantAccess | null | undefined): string {
  if (!access?.outlets) return '';
  return entitlementSummary(outletEntitlementOf(access));
}

/** The same sentence, for a caller that already holds the entitlement. */
export function entitlementSummary(entitlement: OutletEntitlement | null | undefined): string {
  if (!entitlement) return '';
  const { used, limit, unlimited } = entitlement;
  if (unlimited) return 'Unlimited outlets';
  if (limit === null) return '';
  return `${used} of ${limit} ${limit === 1 ? 'outlet' : 'outlets'}`;
}

/** Whether an entitlement still allows another outlet. */
export function entitlementAllowsAnother(entitlement: OutletEntitlement | null | undefined): boolean {
  // Unknown entitlement: offer the control and let the server decide. The
  // database refuses an over-limit create regardless of what this returns.
  if (!entitlement) return true;
  if (entitlement.unlimited) return true;
  return entitlement.remaining === null || entitlement.remaining > 0;
}

/** Why an entitlement blocks another outlet, or null. */
export function entitlementBlockedReason(entitlement: OutletEntitlement | null | undefined): string | null {
  if (!entitlement) return null;
  if (entitlementAllowsAnother(entitlement)) return null;
  const { limit, used } = entitlement;
  return `This plan includes ${limit} ${limit === 1 ? 'outlet' : 'outlets'} and ${used} ${used === 1 ? 'is' : 'are'} already open. Every outlet keeps working — adding another one needs a larger plan.`;
}

/**
 * Whether the account may add another outlet.
 *
 * A rendering hint. The limit is enforced in public.create_outlet(), and a
 * plan that shrinks never removes an outlet that already exists: it stops NEW
 * creation only, and this function says which case the caller is in.
 */
export function canCreateOutlet(access: RestaurantAccess | null | undefined): boolean {
  return entitlementAllowsAnother(outletEntitlementOf(access));
}

/**
 * Why an outlet cannot be added, or null.
 *
 * Says what still works, because "you have hit your limit" reads to an owner
 * as "one of my restaurants has stopped". None of them have: a downgrade or an
 * expiry keeps every outlet and every row of data.
 */
export function outletBlockedReason(access: RestaurantAccess | null | undefined): string | null {
  return entitlementBlockedReason(outletEntitlementOf(access));
}

/** How the plan is named on screen. Never invents a tier. */
export function planLabel(plan: string): string {
  switch (plan) {
    case 'trial':
      return 'Free trial';
    case 'starter':
      return 'Starter';
    case 'professional':
      return 'Professional';
    case 'business':
      return 'Business';
    default:
      return 'No plan';
  }
}

/**
 * One line for the dashboard header. Says the plan, and — only when it is
 * actually running — how long is left. It never says "expired" to someone whose
 * trial is fine, and never hides an expiry behind a friendly noun.
 */
export function accessSummary(access: RestaurantAccess): string {
  if (access.plan === 'trial') {
    if (access.readOnly) return `Trial ended · read-only`;
    const days = access.daysRemaining;
    if (days <= 0) return 'Trial ends today';
    return `Free trial · ${days} ${days === 1 ? 'day' : 'days'} left`;
  }

  if (access.readOnly) return `${planLabel(access.plan)} · read-only`;

  return `${planLabel(access.plan)} · ${BILLING.connected ? 'active' : 'preview'}`;
}

/**
 * What the plan line says under the plan tag.
 *
 * There were two sentences and one of them was a lie most of the time: the
 * dashboard printed "Every feature in the product is on during the trial." for
 * every workspace that could write, including one on a paid plan whose trial
 * ended weeks ago. An owner reading their own billing status is entitled to a
 * sentence that is about their plan and not somebody else's.
 *
 * Three cases, three sentences, and none of them claim a payment happened:
 *
 *   read-only   what still works, so nobody goes looking for a backup.
 *   trial       every feature is on, because a trial is not a cut-down tier.
 *   paid        what the tier includes -- and NOT "active", because whether
 *               money has been collected is the bank's answer, not this page's.
 */
export function planSentence(access: RestaurantAccess): string {
  if (access.readOnly) return READ_ONLY_SENTENCE;
  if (access.plan === 'trial') return 'Every feature in the product is on during the trial.';
  return `${planLabel(access.plan)} plan · every feature in this tier is switched on.`;
}

/**
 * The sentence a read-only workspace is owed. It says what still works, because
 * a screen that only says "you cannot write" leaves the owner guessing whether
 * their data is gone. It is not gone; that is the point.
 */
export const READ_ONLY_SENTENCE =
  'This workspace is read-only until a plan is active. Menus, order history and reports stay readable, and nothing has been deleted. Write to us and we will extend access.';

/**
 * Features the caller may rely on BEFORE the server has answered.
 *
 * An unconfigured deployment (demo mode) and a failed read both land here, and
 * both return everything — because the alternative is hiding working controls
 * from a signed-in owner over a failed query. It is a rendering hint only; the
 * server still refuses anything the plan does not include.
 */
export const ALL_FEATURES_FALLBACK = [
  'menus',
  'qr',
  'ordering',
  'kitchen',
  'cashier',
  'reports',
  'roles',
  'import',
  'outlets',
  'support',
];
