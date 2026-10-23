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
 *
 * Everything else is the catch-all, and it is the only branch that carries a
 * code back to the screen.
 */
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
    case '23514':
      return 'The bill did not add up when the kitchen checked it, so nothing was sent. Please try again, or order with staff.';
    case '57014':
      return 'The kitchen’s system took too long to answer. Nothing was sent — please try again.';
    case 'PGRST301':
    case '401':
      return 'Your session timed out. Reopen the menu from the QR code on your table and order again.';
    default:
      // The database's own message is logged by the action and never rendered
      // here: a Postgres sentence would tell a guest the shape of the schema.
      return 'We could not place that order. Nothing was charged — please try again, or order with staff.';
  }
}
