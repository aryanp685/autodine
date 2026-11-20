'use server';

import { FLOOR_ROLES, getStaffContext } from '@/lib/db/staff';
import { liveIdentifier } from '@/lib/realtime-revisions';
import { dbErrorReference } from '@/lib/db/error-reference';

export type FloorResult = { ok: true; message: string } | { ok: false; message: string };

export async function workWaiterCall(input: { outlet: string; call: string; operation: 'acknowledge' | 'resolve' }): Promise<FloorResult> {
  if (!liveIdentifier(input?.call) || !['acknowledge', 'resolve'].includes(input?.operation)) return { ok: false, message: 'That call is unavailable.' };
  const staff = await getStaffContext();
  if (!staff || staff.restaurantId !== input.outlet || !FLOOR_ROLES.includes(staff.role)) {
    return { ok: false, message: 'Open the floor from an authorized staff account.' };
  }
  const { data, error } = await staff.supabase.rpc(input.operation === 'acknowledge' ? 'acknowledge_waiter_call' : 'finish_waiter_call', {
    p_outlet: staff.restaurantId, p_call_id: input.call,
  });
  if (error) console.warn('[floor] call update refused', dbErrorReference(error));
  if (error || data === 'not_found' || !data) return { ok: false, message: 'Could not confirm the call update. Check the floor again.' };
  return { ok: true, message: data === 'resolved' ? 'Call resolved.' : 'Call acknowledged.' };
}

export async function transferSitting(input: { outlet: string; sitting: string; from: string; to: string; request: string }): Promise<FloorResult> {
  if (!input || ![input.sitting, input.from, input.to, input.request].every(liveIdentifier)) {
    return { ok: false, message: 'Choose an available destination table.' };
  }
  const staff = await getStaffContext();
  if (!staff || staff.restaurantId !== input.outlet || !['owner', 'manager'].includes(staff.role)) {
    return { ok: false, message: 'An owner or manager must move the sitting.' };
  }
  const { data, error } = await staff.supabase.rpc('transfer_open_sitting', {
    p_outlet: staff.restaurantId, p_sitting: input.sitting, p_from: input.from, p_to: input.to, p_request: input.request,
  });
  if (error) console.warn('[floor] sitting move refused', dbErrorReference(error));
  if (data === 'moved' || data === 'already_recorded') return { ok: true, message: 'Sitting moved. Ask guests to scan the destination card before adding orders.' };
  return { ok: false, message: data === 'occupied' ? 'That table is already occupied.'
    : data === 'call_open' ? 'Resolve the open waiter call before moving this sitting.'
    : data === 'held_or_paid' ? 'Finish outstanding confirmations or checkout before moving this sitting.'
    : 'Could not confirm the move. Check which table is occupied before trying again.' };
}
