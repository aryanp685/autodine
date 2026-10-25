/**
 * What a scan's answer from the database means for the guest.
 *
 * WHY THIS IS A MODULE AND NOT THREE `if`s IN THE ROUTE
 *
 * `open_table_session` answers with a status word, and the route used to treat
 * everything that was not `opened` the same way: no cookie, go to the menu.
 * That is right for `code` (the guest will be asked for digits at checkout) and
 * right for `revoked`/`unreadable` (the card is dead), but it is NOT right for
 * `limited`, because a throttled guest in a scan-mode restaurant has no code to
 * fall back to. They get a readable menu, a fillable cart, and a checkout that
 * can never succeed — silently.
 *
 * The status set is the whole contract between the database and this handler,
 * so it lives here, in one table, with no database and no Next.js in sight:
 * every branch is unit-testable, and a new status word from a future migration
 * cannot be silently mis-handled (an unknown word gets the reserved answer).
 *
 * WHAT IS DELIBERATELY NOT DECIDED HERE
 *
 * The proposed L1 behaviour — reuse a live session instead of minting a new one,
 * and hold the first order of a throttled sitting for one staff tap rather than
 * refusing it — is a DATABASE change (`docs/scan-limit-l1.md`). This module is
 * written to the status set that change will produce (`reused`, `held`) so the
 * handler is already correct when it lands, but nothing here mints, holds or
 * counts anything: it only decides what the response to a given answer is.
 */

/** Every status `open_table_session` can return, now or under L1. */
export type ScanStatus =
  | 'opened'
  | 'reused'
  | 'held'
  | 'limited'
  | 'code'
  | 'revoked'
  | 'notserving'
  | 'nomenu'
  | 'unreadable';

export type ScanOutcome = {
  /**
   * Whether the answer carries a usable session token that the response should
   * store. False means the guest keeps browsing without one — never that they
   * are blocked from reading the menu.
   */
  keepSession: boolean;
  /**
   * Why the guest has no session, when they have none. This is what a screen
   * needs in order to say something true; `null` means "nothing to explain".
   */
  reason: 'throttled' | 'code-mode' | 'card' | 'closed' | 'empty' | null;
  /**
   * Whether the visit is expected to end in an order or not. Used by the tests
   * and by callers that want to log a genuine anomaly rather than the ordinary
   * `code` answer.
   */
  expectOrder: boolean;
};

/**
 * The closed set, one row per status.
 *
 * `limited` is the only row that means "this guest cannot order right now", and
 * it is the only one that must ever produce a sentence a guest can act on. In
 * the CURRENT database it cannot lead to an order because no session is minted;
 * under L1 it stops being reachable until the held budget is also spent, and it
 * carries a retry time.
 */
const OUTCOMES: Record<ScanStatus, ScanOutcome> = {
  // A session was minted for this scan. Ordering works.
  opened: { keepSession: true, reason: null, expectOrder: true },
  // L1: an existing live session was reused; nothing was minted or counted.
  reused: { keepSession: true, reason: null, expectOrder: true },
  // L1: minted, but every order of this sitting waits for one staff tap.
  held: { keepSession: true, reason: null, expectOrder: true },
  // The card or this address has been opened too often this hour.
  limited: { keepSession: false, reason: 'throttled', expectOrder: false },
  // The restaurant wants digits. Not an error: checkout asks for them.
  code: { keepSession: false, reason: 'code-mode', expectOrder: true },
  revoked: { keepSession: false, reason: 'card', expectOrder: false },
  notserving: { keepSession: false, reason: 'closed', expectOrder: false },
  nomenu: { keepSession: false, reason: 'empty', expectOrder: false },
  unreadable: { keepSession: false, reason: 'card', expectOrder: false },
};

/**
 * The reservation: an unknown word must never be read as "you may order".
 *
 * A status this file has not been told about can only come from a database that
 * is newer than this build, so the honest handling is the one that grants
 * nothing and explains nothing — the pre-existing behaviour — rather than
 * guessing that it was a success.
 */
const RESERVED: ScanOutcome = { keepSession: false, reason: null, expectOrder: false };

export function scanOutcome(status: string | null | undefined): ScanOutcome {
  if (!status) return RESERVED;
  return (OUTCOMES as Record<string, ScanOutcome>)[status] ?? RESERVED;
}

/**
 * The one sentence a throttled guest is owed.
 *
 * WHY THIS EXISTS BEFORE THE BEHAVIOUR DOES
 *
 * Today `limited` is silent: the guest is sent to the menu and finds out at
 * checkout that ordering is impossible, with nothing to explain it and, in a
 * scan-mode restaurant, no code to enter. Whatever L1 decides, that sentence
 * has to exist — so it is here, with its retry arithmetic tested, waiting for a
 * caller. `retryAfterSeconds` is optional because the current
 * `open_table_session` does not return one; L1 adds it to the return table, and
 * this function already knows what to do with it.
 */
export function throttleNotice(retryAfterSeconds?: number | null): string {
  const retry = formatRetry(retryAfterSeconds);
  return retry
    ? `This table has been scanned unusually often in the last hour. Ordering is paused for ${retry} — your cart is safe. You can also order with staff.`
    : 'This table has been scanned unusually often in the last hour. Ordering is paused for a short while — your cart is safe. You can also order with staff.';
}

/**
 * A duration a person can act on, rounded so it cannot be wrong.
 *
 * Minutes are rounded UP and never below one: telling somebody "try again in 0
 * minutes" is worse than telling them "one minute". Absent, zero or nonsense
 * input produces no estimate rather than a fabricated one.
 */
export function formatRetry(seconds?: number | null): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return 'about a minute';
  if (minutes >= 60) return 'about an hour';
  return `about ${minutes} minutes`;
}
