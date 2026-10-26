/**
 * The prep status state machine.
 *
 * ONE definition, used by both the server action that writes it and the
 * client component that predicts it. Two copies of a state machine drift:
 * the optimistic move says 'ready' while the database says 'served', and the
 * board disagrees with itself until the next refresh.
 *
 * Terminal states map to null, meaning "there is nothing further to advance
 * to". Callers treat that as a no-op rather than an error, because two cooks
 * tapping the same ticket at the same moment is normal, not exceptional.
 *
 * There is deliberately NO reverse transition. 'served' cannot go back to
 * 'ready': without one, a mis-tap cannot be silently undone and there is no
 * way to make a ticket vanish from the board without serving it. If a
 * correction is ever needed it must be an explicit, audit-logged action, not
 * a button that looks like a normal move.
 */

import type { PrepStatus } from './types';

/**
 * The states a ticket can be moved INTO. 'cancelled' is excluded because no
 * transition leads there: it is a state an order can hold, never one the
 * board advances to. Typing the result this way means the board's optimistic
 * overlay cannot be handed a value the ticket column would reject.
 */
export type PrepState = Exclude<PrepStatus, 'cancelled'>;

/**
 * How old a ticket is, in the words a cook would use. Minutes.
 *
 * These live here rather than beside the query that stamps each ticket with
 * its age, because the BOARD is the thing that colours a ticket red -- and the
 * board is a client component. A value imported from lib/db/kitchen-screen
 * would drag that module's database client (and next/headers) into the browser
 * bundle; a threshold is not worth a build error. Kept next to the state
 * machine so "late" and "ready" can never be defined in two places.
 */
export const LATE_AFTER_MIN = 20;
export const WARN_AFTER_MIN = 10;

export const PREP_TRANSITIONS: Record<PrepStatus, PrepState | null> = {
  new: 'preparing',
  preparing: 'ready',
  ready: 'served',
  served: null,
  cancelled: null,
};

/** The next state, or null if `current` is terminal or unknown. */
export function nextPrepState(
  current: PrepStatus | string | null | undefined
): PrepState | null {
  if (!current) return null;
  return PREP_TRANSITIONS[current as PrepStatus] ?? null;
}

/**
 * The only prep transition worth announcing: a server-confirmed state change.
 * A failed action, null state, or stale click returning the same state must not
 * be announced as if the ticket moved.
 */
export function confirmedPrepChange(
  previous: PrepState,
  result: { ok: boolean; state?: PrepState | null },
): PrepState | null {
  if (!result.ok || !result.state || result.state === previous) return null;
  return result.state;
}

/** True when a ticket can still move forward. */
export function canAdvance(current: PrepStatus | string | null | undefined): boolean {
  return nextPrepState(current) !== null;
}
