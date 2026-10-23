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
};

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
