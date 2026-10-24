/**
 * What a failed order is allowed to say.
 *
 * WHY THIS IS NOT IN THE ACTION FILE
 *
 * `app/menu/checkout/actions.ts` is marked 'use server', and a module with that
 * marker may export nothing but async functions -- the build refuses the whole
 * file otherwise. So the sentences live here, where they can also be tested
 * without standing up a server action.
 *
 * The guest is standing in a restaurant holding a phone. They need one of three
 * things: a reason they can act on, a reason staff can act on, or an honest "we
 * do not know yet" that does not invite them to tap the same button forever.
 *
 * THE CODES
 *
 *   23505 unique violation      - the same order was written twice, usually a
 *                                 double tap on a slow connection.
 *   23502 not-null              - a column the app expects is missing, which
 *   42703 undefined column        means the deploy and the database disagree.
 *   42P01 undefined table
 *   22P02 invalid text repr.    - an id in the cart is not the shape the
 *                                 database expects: a cart left over from an
 *                                 older menu, or a demo id.
 *   23503 foreign key           - the dish was deleted under the cart.
 *   23514 check violation       - the bill's arithmetic did not satisfy the
 *                                 orders_math_check constraint.
 *   57014 statement timeout     - the write took too long; nothing was saved.
 *   21000 cardinality viol.     - a query inside the order transaction matched
 *   PGRST116 singular response    more than one row where it needed exactly
 *                                 one. The database refused to guess, which is
 *                                 correct, and nothing was written.
 *
 * Everything else is the catch-all, and it is the only branch that carries a
 * code back to the screen.
 */
/**
 * Failures that mean the order was never written, and may not even have been
 * attempted.
 *
 * WHY THESE ARE SAFE TO TRY AGAIN
 *
 * A PostgREST or Postgres error is returned only after the statement failed:
 * the transaction was aborted, so nothing was committed. Retrying therefore
 * cannot create a second order. (A *lost response* -- the connection dropping
 * after a commit -- arrives as a thrown fetch error, not one of these codes,
 * and is deliberately not retried.)
 *
 * The list is the class that says "the database was not reachable right now":
 * the schema cache still loading, the connection pool full, an admin shutdown,
 * a serialisation conflict, or a statement that timed out. On a free-tier
 * project these are ordinary and transient, and the guest's alternative is to
 * tap Place order again and hope -- which is what this code exists to avoid.
 */
const TRANSIENT_PLACE_CODES = new Set([
  'PGRST000', // could not connect to the database
  'PGRST001', // internal server error before the query
  'PGRST002', // schema cache still loading after a restart
  'PGRST003', // timed out waiting for a connection from the pool
  '08000',
  '08003',
  '08006', // connection exception
  '53300', // too many connections
  '57P01', // admin shutdown / server restart
  '40001', // serialisation failure
  '40P01', // deadlock detected
  '55P03', // could not obtain lock
  '57014', // statement timeout
  'XX000', // internal error
]);

export function isTransientPlaceCode(code?: string | null): boolean {
  return Boolean(code && TRANSIENT_PLACE_CODES.has(code));
}

/**
 * Codes this module has a written sentence for.
 *
 * Used for one decision only: the database's own words are attached to the
 * screen for the *unclassified* failures, because those are the ones nobody can
 * explain yet. A named class already says what happened in a sentence written
 * for a guest, and a Postgres message beside it would only leak the schema.
 */
const NAMED_PLACE_CODES = new Set([
  '23505',
  '22P02',
  '23503',
  '23502',
  '42703',
  '42P01',
  '21000',
  'PGRST116',
  '23514',
  '57014',
  'PGRST301',
  '401',
  ...TRANSIENT_PLACE_CODES,
]);

export function isNamedPlaceFailure(code?: string | null): boolean {
  return Boolean(code && NAMED_PLACE_CODES.has(code));
}

export function describePlaceFailure(code?: string): string {
  if (!code) {
    return 'The kitchen’s system did not answer. Your cart is safe — please try again in a moment.';
  }

  switch (code) {
    case '23505':
      return 'This order already went through. Open Orders to see it before placing another.';
    case '22P02':
    case '23503':
      return 'One of the dishes in your cart is no longer on this menu. Remove it and add it again, or order with staff.';
    case '23502':
    case '42703':
    case '42P01':
      return 'This restaurant is still being set up for ordering. Please ask a member of staff to take your order.';
    case '21000':
    case 'PGRST116':
      // "More than one row where one was needed." Nothing was written, and
      // trying again sends the same ambiguous question to the same database,
      // so this must not be retried and must not say "try again". It is not
      // the guest's mistake either: a duplicated row on the menu or the card
      // is the restaurant's to fix, and the reference tells them what to look
      // for in the logs.
      return 'The kitchen’s system found more than one match for something in this order, so nothing was sent. Please order with staff, quoting the reference below.';
    case '23514':
      return 'The bill did not add up when the kitchen checked it, so nothing was sent. Please try again, or order with staff.';
    case '57014':
      return 'The kitchen’s system took too long to answer. Nothing was sent — please try again.';
    case 'PGRST301':
    case '401':
      return 'Your session timed out. Reopen the menu from the QR code on your table and order again.';
    case 'PGRST000':
    case 'PGRST001':
    case 'PGRST002':
    case 'PGRST003':
    case '08000':
    case '08003':
    case '08006':
    case '53300':
    case '57P01':
    case '40001':
    case '40P01':
    case '55P03':
    case 'XX000':
      // The database was unreachable or busy, not wrong. The action has
      // already tried once more by the time a guest reads this.
      return 'The kitchen’s system was busy for a moment, so this order was not sent. Nothing was charged — tap Place order once more.';
    default:
      // The database's own message is logged by the action and never rendered
      // here: a Postgres sentence would tell a guest the shape of the schema.
      return 'We could not place that order. Nothing was charged — please try again, or order with staff.';
  }
}
