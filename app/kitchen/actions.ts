/**
 * Kitchen board actions.
 *
 * The only mutation is advancing a ticket's prep_status, and the NEXT state
 * IS NEVER TAKEN FROM THE CLIENT. The form posts an order id and nothing
 * else; the action reads the ticket's current state from the database and
 * derives the next one from PREP_TRANSITIONS.
 *
 * Why: if the browser could post 'served' directly, a single click could skip
 * a ticket from 'new' to 'served'. Nothing would crash and no policy would
 * fire -- the kitchen would simply never cook the food. That is exactly the
 * class of bug that is invisible in testing and expensive in a real service.
 *
 * Reverting is deliberately not offered. There is no 'served' -> 'ready'
 * transition, so a mis-tap cannot be silently undone and there is no way to
 * make a ticket disappear from the board without serving it.
 *
 * Authorisation is RLS plus an explicit membership check: the update is
 * filtered by the caller's restaurant through lib/db/staff.ts, so a forged
 * order id belonging to another restaurant affects zero rows.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { getStaffContext } from '@/lib/db/staff';
import { nextPrepState } from '@/lib/db/prep';
import type { KitchenPrepState } from '@/lib/db/kitchen-screen';

const KITCHEN_PATH = '/kitchen';

export type AdvanceResult =
  | { ok: true; state: KitchenPrepState | null }
  | { ok: false; error: string };

/**
 * Advance one ticket to the next prep state.
 *
 * Returns a result rather than redirecting, because the kitchen board is a
 * client component that keeps an optimistic copy: it needs to know whether to
 * commit the optimistic move or roll it back. Redirecting here would throw
 * away the board's scroll position and audio state on every tap.
 */
export async function advanceOrderAction(
  orderId: string
): Promise<AdvanceResult> {
  if (!orderId) return { ok: false, error: 'Missing order.' };

  const staff = await getStaffContext();
  if (!staff) {
    return { ok: false, error: 'Not signed in, or the database is not connected.' };
  }

  const { supabase, restaurantId } = staff;

  // Read the current state. restaurant_id is bound explicitly even though RLS
  // already scopes it, so the query doubles as an existence check this caller
  // is allowed to see.
  const { data: order, error: readError } = await supabase
    .from('orders')
    .select('id, prep_status')
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (readError) {
    return { ok: false, error: `Could not read the ticket: ${readError.message}` };
  }
  if (!order) {
    // Either it does not exist or it belongs to another restaurant. Same
    // answer either way: never confirm which.
    return { ok: false, error: 'That ticket is no longer on the board.' };
  }

  // Derived from the value in the DATABASE, never from the request. See
  // lib/db/prep.ts for why this single definition is shared.
  const next = nextPrepState(order.prep_status);
  if (!next) {
    // Already served or cancelled. Treat as success with no change, so the
    // board settles instead of showing a scary error for a double-tap.
    return { ok: true, state: (order.prep_status as KitchenPrepState) ?? null };
  }

  const { error: updateError } = await supabase
    .from('orders')
    .update({ prep_status: next })
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId);

  if (updateError) {
    return { ok: false, error: `Could not update the ticket: ${updateError.message}` };
  }

  revalidatePath(KITCHEN_PATH);
  return { ok: true, state: next as KitchenPrepState };
}
