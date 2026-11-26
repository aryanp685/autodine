/**
 * What the trial state means for the door.
 *
 * The database (`public.account_can_write`, migration 20261110001100) is the
 * authority: when it refuses a write, nothing in the app can grant one back.
 * This helper reads the same facts the RPC already returned and answers one
 * question for the gates: does this account still have time, or does the
 * owner need to choose a plan before the dashboard opens?
 *
 * `null` (no billing read — a failed read, a Cashier, or demo mode) never
 * blocks. The wall must never trap an owner over a display failure.
 */

import type { RestaurantAccess } from '@/lib/access';

export type SubscriptionStatus = 'ok' | 'ending' | 'blocked';

/** Classify the billing read. Cheap, pure, and tested against the DB rules. */
export function subscriptionStatusOf(access: RestaurantAccess | null | undefined): SubscriptionStatus {
  if (!access) return 'ok';
  const paidPlan = ['starter', 'professional', 'business'].includes(access.plan);
  if (paidPlan) return 'ok';
  if (access.status !== 'trialing') return 'blocked';
  if (access.canWrite === false || access.readOnly === true) return 'blocked';
  if (access.daysRemaining <= 0) return 'blocked';
  return access.daysRemaining <= 3 ? 'ending' : 'ok';
}
