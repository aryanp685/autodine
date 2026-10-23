/**
 * Subscription trial state.
 *
 * RULES (from the product spec — these are not negotiable):
 *   - Every new account gets a 7-day trial with all main features on.
 *   - When the trial ends and there is no subscription: the account becomes
 *     READ-ONLY. New orders are BLOCKED.
 *   - Data is NEVER deleted for non-payment. Not after a week, not after a
 *     year. Read-only means read-only, not "scheduled for deletion".
 *   - All of this is decided by the SERVER, from server timestamps. The
 *     browser's clock is not evidence of anything.
 */

/**
 * Seven days. Change this and the database must change with it:
 * `public.restaurant_can_write()` and `public.restaurant_trial_ends_at()` both
 * hard-code `interval '7 days'`, and lib/trial.test.ts asserts the two agree by
 * reading this number. The server is the authority; this constant exists so the
 * app can describe the same clock without a round trip.
 */
export const TRIAL_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type TrialStatus = 'trialing' | 'expired' | 'subscribed';

export type TrialState = {
  status: TrialStatus;

  /** Whole days left, counting today. 0 once the trial is over. */
  daysRemaining: number;

  /** When the trial ends. Always present, even after it ends. */
  endsAt: Date;

  /** True once the trial has run out with no subscription. */
  expired: boolean;

  /**
   * Can this restaurant accept NEW orders right now?
   * This is the gate that matters: it is what blocks a new order at the
   * counter, and it must be checked server-side on every placement.
   */
  canPlaceOrders: boolean;

  /**
   * Is the account read-only? True only after the trial ends unpaid.
   * Read-only means no writes — it does NOT mean data has been removed.
   */
  readOnly: boolean;
};

export type TrialInput = {
  /** When the trial started. Server-generated. */
  startedAt: Date;
  /** Current time. Passed in so this is testable and never reads the clock. */
  now: Date;
  /** When a paid subscription began, if it has. */
  subscribedAt?: Date | null;
};

/** Whole days remaining, counting the current day. Never negative. */
function daysLeft(from: Date, to: Date): number {
  const diff = to.getTime() - from.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / MS_PER_DAY);
}

export function computeTrialState({ startedAt, now, subscribedAt = null }: TrialInput): TrialState {
  const endsAt = new Date(startedAt.getTime() + TRIAL_DAYS * MS_PER_DAY);

  // A subscription outranks the trial entirely. Once paying, always on.
  if (subscribedAt) {
    return {
      status: 'subscribed',
      daysRemaining: 0,
      endsAt,
      expired: false,
      canPlaceOrders: true,
      readOnly: false,
    };
  }

  const remaining = daysLeft(now, endsAt);

  // Clock skew guard: if 'now' is somehow before the start, give the full
  // trial rather than instantly expiring someone because of a bad clock.
  const isBeforeStart = now.getTime() < startedAt.getTime();
  const daysRemaining = isBeforeStart ? TRIAL_DAYS : Math.min(remaining, TRIAL_DAYS);
  const expired = !isBeforeStart && remaining <= 0;

  return {
    status: expired ? 'expired' : 'trialing',
    daysRemaining,
    endsAt,
    expired,
    // Blocking new orders is the point of the gate. Everything the restaurant
    // already has stays readable, forever.
    canPlaceOrders: !expired,
    readOnly: expired,
  };
}

/**
 * The single guard every order-placement path must call.
 *
 * Returns null when the order may proceed, or a reason when it may not.
 * Deliberately returns a message rather than throwing: the caller shows this
 * to a human at the counter, and "your trial ended" is not an exception.
 */
export function orderBlockedReason(state: TrialState): string | null {
  if (state.canPlaceOrders) return null;
  if (state.status === 'expired') {
    return 'Your trial has ended. Existing orders, menus and reports are all still here — choose a plan to start taking new orders again.';
  }
  return 'New orders are currently disabled on this account.';
}
