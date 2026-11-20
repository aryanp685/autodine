/** Kitchen moves are compare-and-set from the displayed stage. Database
 * RLS, the restaurant write gate and the forward-only trigger still apply. */

'use server';

import { revalidatePath } from 'next/cache';
import { getStaffContext, KITCHEN_ROLES } from '@/lib/db/staff';
import { nextPrepState } from '@/lib/db/prep';
import type { KitchenPrepState } from '@/lib/db/kitchen-screen';

const KITCHEN_PATH = '/kitchen';

export type AdvanceResult =
  | { ok: true; state: KitchenPrepState | null; changed?: false }
  | { ok: false; error: string };

/**
 * The answer to "I vouched for this table".
 *
 * `confirmed: 0` is a SUCCESS, not a failure: it means somebody else got there
 * first (a second tablet, a second tap, the same person twice). The board reads
 * it as "already done" and settles, instead of showing an error for something
 * that is already true. That distinction is the whole duplicate-confirmation
 * story, and it is decided by the database's own UPDATE predicate, not here.
 */
export type ConfirmResult =
  | { ok: true; confirmed: number }
  | { ok: false; error: string };

export type AnnouncementClaimResult =
  | { ok: true; claimed: boolean }
  | { ok: false; error: string };

/**
 * Elect one kitchen device to announce a newly arrived order. Web Locks only
 * coordinate tabs in one browser profile; the SECURITY DEFINER RPC arbitrates
 * across devices and verifies the caller's kitchen membership.
 */
export async function claimKitchenOrderAnnouncementAction(
  orderId: string,
): Promise<AnnouncementClaimResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    return { ok: false, error: 'That order is no longer on the board.' };
  }

  const staff = await getStaffContext();
  if (!staff) {
    return { ok: false, error: 'Not signed in, or the database is not connected.' };
  }

  if (!KITCHEN_ROLES.includes(staff.role)) {
    return { ok: false, error: 'Only kitchen staff can claim an order announcement.' };
  }

  const { data, error } = await staff.supabase.rpc('claim_kitchen_order_announcement', {
    p_order_id: orderId,
  });

  if (error) {
    return { ok: false, error: error.code === '42501'
      ? 'Kitchen permission was not available for this announcement.'
      : error.message };
  }

  return { ok: true, claimed: data === true };
}

export async function recordKitchenAnnouncementResultAction(input: {
  orderId: string;
  status: 'announced' | 'failed';
  failureReason?: string;
}): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.orderId)) return { ok: false };
  const staff = await getStaffContext();
  if (!staff || !KITCHEN_ROLES.includes(staff.role)) return { ok: false };
  const { data, error } = await staff.supabase.rpc('record_kitchen_announcement_result', {
    p_order_id: input.orderId,
    p_status: input.status,
    p_failure_reason: input.failureReason?.slice(0, 200) ?? null,
  });
  return { ok: !error && data === true };
}

export async function claimTableWaiterCallAnnouncementAction(callId: string): Promise<AnnouncementClaimResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(callId)) return { ok: false, error: 'That waiter call is no longer active.' };
  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Not signed in, or the database is not connected.' };
  if (!['owner', 'manager', 'kitchen', 'cashier'].includes(staff.role)) {
    return { ok: false, error: 'You cannot announce waiter calls for this restaurant.' };
  }
  const { data, error } = await staff.supabase.rpc('claim_table_waiter_call_announcement', { p_call_id: callId });
  if (error) return { ok: false, error: error.code === '42501' ? 'Waiter-call permission was not available.' : error.message };
  return { ok: true, claimed: data === true };
}

export async function recordTableWaiterCallAnnouncementAction(input: {
  callId: string;
  status: 'announced' | 'failed';
  failureReason?: string;
}): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.callId)) return { ok: false };
  const staff = await getStaffContext();
  if (!staff || !['owner', 'manager', 'kitchen', 'cashier'].includes(staff.role)) return { ok: false };
  const { data, error } = await staff.supabase.rpc('record_table_waiter_call_announcement', {
    p_call_id: input.callId,
    p_status: input.status,
    p_failure_reason: input.failureReason?.slice(0, 200) ?? null,
  });
  return { ok: !error && data === true };
}

export async function resolveTableWaiterCallAction(callId: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(callId)) return { ok: false, error: 'That waiter call is no longer active.' };
  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Not signed in, or the database is not connected.' };
  if (!['owner', 'manager', 'kitchen', 'cashier'].includes(staff.role)) {
    return { ok: false, error: 'You cannot clear waiter calls for this restaurant.' };
  }
  const { data, error } = await staff.supabase.rpc('resolve_table_waiter_call', { p_call_id: callId });
  if (error) return { ok: false, error: error.code === '42501' ? 'Waiter-call permission was not available.' : error.message };
  if (data) revalidatePath(KITCHEN_PATH);
  return data ? { ok: true } : { ok: false, error: 'This waiter call was already cleared on another screen.' };
}

/**
 * Advance one ticket to the next prep state.
 *
 * Returns a result rather than redirecting, because the kitchen board is a
 * client component that keeps an optimistic copy: it needs to know whether to
 * commit the optimistic move or roll it back. Redirecting here would throw
 * away the board's scroll position and audio state on every tap.
 */
export async function advanceOrderAction(
  orderId: string,
  displayedState: KitchenPrepState,
): Promise<AdvanceResult> {
  if (!orderId) return { ok: false, error: 'Missing order.' };
  if (!['new', 'preparing', 'ready', 'served'].includes(displayedState)) return { ok: false, error: 'Refresh the board before moving this ticket.' };

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
    return { ok: false, error: 'Could not read the ticket. Check the board again.' };
  }
  if (!order) {
    // Either it does not exist or it belongs to another restaurant. Same
    // answer either way: never confirm which.
    return { ok: false, error: 'That ticket is no longer on the board.' };
  }

  if (order.prep_status !== displayedState) {
    return { ok: true, state: null, changed: false };
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
   *
   * THE THIRD `.eq` IS A COMPARE-AND-SET, and it is not housekeeping.
   *
   * Two screens work this board at once: a wall tablet and a phone on the
   * pass. Both read `new`, so both compute `preparing` -- harmless, the same
   * value twice. The dangerous interleaving is slower: tablet A reads `new`,
   * the cook taps on B, B reads `preparing` and writes `ready`, and only then
   * does A's write land. Without the predicate below that write is
   * unconditional, so a ticket that is in the pass goes BACK to `preparing`:
   * food already cooked, on a board that now says it is not. Matching the
   * state we read makes the loser update zero rows, which the caller reports
   * as "moved on another screen -- the board will catch up".
   */
  const { data: updated, error: updateError } = await supabase
    .from('orders')
    .update({ prep_status: next })
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .eq('prep_status', order.prep_status)
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
    return { ok: false, error: 'Could not update the ticket. Check the board again.' };
  }

  if (!updated || updated.length === 0) {
    return { ok: true, state: null, changed: false };
  }

  revalidatePath(KITCHEN_PATH);
  return { ok: true, state: next as KitchenPrepState };
}

/**
 * Accept every held ticket in one table sitting.
 *
 * The client sends a SESSION id, never a list of orders, a count, or a role.
 * confirm_table_orders reads the session's restaurant from the database,
 * checks the caller's membership and role itself, and updates only rows that
 * are still held and still unconfirmed in one statement. So:
 *
 *   - a forged session id from another restaurant matches zero rows and is
 *     refused by the membership check before that;
 *   - a replayed tap cannot confirm anything twice;
 *   - a race between two tablets has exactly one winner, decided by
 *     `confirmed_at is null` inside the UPDATE.
 *
 * Nothing here is trusted from the request, which is why the function can be
 * called with nothing but an id.
 */
export async function confirmTableAction(tableSessionId: string): Promise<ConfirmResult> {
  if (!tableSessionId) return { ok: false, error: 'That table is no longer on the board.' };

  const staff = await getStaffContext();
  if (!staff) {
    return { ok: false, error: 'Not signed in, or the database is not connected.' };
  }

  if (!KITCHEN_ROLES.includes(staff.role)) {
    return {
      ok: false,
      error: `A ${staff.role} can see the board but cannot confirm a table. Ask an owner, a manager or kitchen staff.`,
    };
  }

  const { supabase } = staff;

  const { data, error } = await supabase.rpc('confirm_table_orders', {
    p_table_session_id: tableSessionId,
  });

  if (error) {
    if (error.code === '42501') {
      return {
        ok: false,
        error: 'This restaurant is read-only right now, so tables cannot be confirmed.',
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(KITCHEN_PATH);

  // Postgres returns the row count of the UPDATE. 0 is "already confirmed".
  const confirmed = typeof data === 'number' ? data : 0;
  return { ok: true, confirmed };
}

/**
 * "Not our table."
 *
 * Cancels only held, unconfirmed, still-open tickets in that sitting. A ticket
 * somebody already vouched for is not touched -- undoing that is cancel_order's
 * job, with its own rules about money and timing.
 *
 * The reason is optional and is appended to the guest-visible note, because a
 * guest whose order vanished deserves a sentence rather than silence.
 */
export async function rejectTableAction(
  tableSessionId: string,
  reason?: string,
): Promise<ConfirmResult> {
  if (!tableSessionId) return { ok: false, error: 'That table is no longer on the board.' };

  const staff = await getStaffContext();
  if (!staff) {
    return { ok: false, error: 'Not signed in, or the database is not connected.' };
  }

  if (!KITCHEN_ROLES.includes(staff.role)) {
    return {
      ok: false,
      error: `A ${staff.role} can see the board but cannot reject a table. Ask an owner, a manager or kitchen staff.`,
    };
  }

  const { supabase } = staff;

  const { data, error } = await supabase.rpc('reject_table_orders', {
    p_table_session_id: tableSessionId,
    p_reason: (reason ?? '').trim() || null,
  });

  if (error) {
    if (error.code === '42501') {
      return {
        ok: false,
        error: 'This restaurant is read-only right now, so tables cannot be rejected.',
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(KITCHEN_PATH);
  return { ok: true, confirmed: typeof data === 'number' ? data : 0 };
}
