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
import { getStaffContext, KITCHEN_ROLES } from '@/lib/db/staff';
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

  const { supabase, restaurantId, role } = staff;

  // The board hides these buttons for a role that cannot write, but hiding a
  // button is not a permission check: a request can be replayed by hand. The
  // database refuses this anyway (orders_staff_update names owner, manager and
  // kitchen); returning a sentence here means the operator reads a reason
  // instead of a Postgres policy error.
  if (!KITCHEN_ROLES.includes(role)) {
    return {
      ok: false,
      error: `A ${role} can see the kitchen board but cannot move tickets. Ask an owner, a manager or kitchen staff.`,
    };
  }

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

  /**
   * `.select()` IS THE POINT, not a convenience.
   *
   * Without it, a write that RLS filters out -- a read-only restaurant, a role
   * that lost permission between the read and the write -- returns
   * `{ error: null }` and zero rows. The board would accept that as success,
   * move the ticket optimistically, and then quietly put it back on the next
   * refresh, while the kitchen believed it had been marked ready. Asking for
   * the updated row turns "nothing happened" into something this action can
   * see and report.
   */
  const { data: updated, error: updateError } = await supabase
    .from('orders')
    .update({ prep_status: next })
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .select('id, prep_status');

  if (updateError) {
    // 42501 is "permission denied", which here means the second half of the
    // update policy failed: the restaurant is read-only. Naming that is more
    // useful than repeating the Postgres text to a cook.
    if (updateError.code === '42501') {
      return {
        ok: false,
        error: 'This restaurant is read-only right now, so tickets cannot be moved. The account can view orders, menus and reports until a plan is active.',
      };
    }
    return { ok: false, error: `Could not update the ticket: ${updateError.message}` };
  }

  if (!updated || updated.length === 0) {
    return {
      ok: false,
      error: 'The ticket did not change. It may have been moved or cancelled on another screen — the board will catch up on the next refresh.',
    };
  }

  revalidatePath(KITCHEN_PATH);
  return { ok: true, state: next as KitchenPrepState };
}
