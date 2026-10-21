/**
 * Table and QR management.
 *
 * Every action here is server-side and every write is gated by RLS: the
 * policies on dining_tables and qr_tokens are
 * `using (restaurant_id in (select current_restaurant_ids()))`, so even a
 * forged payload can only touch a restaurant the caller belongs to. The
 * restaurant id is NEVER taken from the form -- it is resolved from the
 * session's membership row. Taking it from the form would let any signed-in
 * owner pass someone else's id.
 *
 * QR codes used to be short-lived. They no longer are, and the reason is
 * mundane: nobody reprints five table cards every twelve hours. The card now
 * carries a permanent token, and what expires is the session a scan creates
 * from it. Rotation still exists -- it is how a leaked code is taken out of
 * service -- but it is something a person decides, not a clock running out.
 *
 * A table's code is created by a trigger on dining_tables (migration 0007),
 * not by this file. It used to be created here, which meant any path that
 * added a table without going through this action produced a table with no
 * code -- which is precisely the state four of the six tables were found in.
 *
 * Errors redirect with a message in the query string, matching the pattern in
 * app/auth/actions.ts: these are called by <form action> in Server Components
 * and there is no client state to hold an error in.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getStaffContextDetailed } from '@/lib/db/staff';

const TABLES_PATH = '/dashboard/tables';

function fail(message: string): never {
  redirect(`${TABLES_PATH}?error=${encodeURIComponent(message)}`);
}

/**
 * Resolve the restaurant the signed-in user belongs to.
 * Returns null when unconfigured, signed out, or not a member of anything.
 */
async function currentRestaurant() {
  // One resolver, cookie included: with several outlets on one account an
  // `.limit(1)` here would write into the lowest restaurant id while the
  // screen was showing another -- a silent write into the wrong tenant.
  const staff = await getStaffContextDetailed();
  if (!staff.ok) return null;

  return { supabase: staff.context.supabase, restaurantId: staff.context.restaurantId };
}

/** Next free table label: T1, T2, ... skipping any label already taken. */
function nextLabel(existing: string[]): string {
  const used = new Set(existing);
  for (let i = 1; i <= 999; i++) {
    const candidate = `T${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `T${Date.now()}`;
}

export async function addTableAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to manage tables.');

  const seats = Number(formData.get('seats') ?? 4);
  if (!Number.isInteger(seats) || seats < 1 || seats > 50) {
    fail('Seats must be a whole number between 1 and 50.');
  }

  const { data: existing, error: readError } = await ctx.supabase
    .from('dining_tables')
    .select('label')
    .eq('restaurant_id', ctx.restaurantId);

  if (readError) fail(`Could not read tables: ${readError.message}`);

  const label = nextLabel((existing ?? []).map((row) => row.label as string));

  // No .select(): the returned row is not needed now that the QR code is
  // created by the trigger, and asking for one only to discard it is a
  // round trip's worth of payload for nothing.
  const { error } = await ctx.supabase
    .from('dining_tables')
    .insert({ restaurant_id: ctx.restaurantId, label, seats });

  if (error) fail(`Could not add table: ${error.message}`);

  // No QR insert here. A trigger on dining_tables creates the code in the
  // same transaction as the table, so a table cannot exist without one.
  // Doing it as a second write from here is how four of the six tables ended
  // up with no code at all.
  revalidatePath(TABLES_PATH);
  redirect(`${TABLES_PATH}?notice=${encodeURIComponent(`${label} added with a new QR code.`)}`);
}

export async function setTableActiveAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to manage tables.');

  const tableId = String(formData.get('tableId') ?? '').trim();
  const makeActive = formData.get('active') === 'true';
  if (!tableId) fail('Missing table.');

  const { error } = await ctx.supabase
    .from('dining_tables')
    .update({ is_active: makeActive })
    .eq('id', tableId)
    .eq('restaurant_id', ctx.restaurantId);

  if (error) fail(`Could not update table: ${error.message}`);

  revalidatePath(TABLES_PATH);
  redirect(
    `${TABLES_PATH}?notice=${encodeURIComponent(
      makeActive ? 'Table enabled.' : 'Table disabled. It can no longer take orders.'
    )}`
  );
}

export async function rotateQrAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to manage tables.');

  const tableId = String(formData.get('tableId') ?? '').trim();
  if (!tableId) fail('Missing table.');

  // One call, not two writes. Revoke-then-insert split across the network can
  // fail between the two and leave the table with no code at all. The
  // function holds both, checks membership itself, and revokes any live
  // session created from the old code.
  const { error } = await ctx.supabase.rpc('rotate_table_qr_code', { p_table_id: tableId });

  if (error) fail(`Could not issue a new code: ${error.message}`);

  revalidatePath(TABLES_PATH);
  redirect(
    `${TABLES_PATH}?notice=${encodeURIComponent(
      'New code issued. The old one stops working now -- reprint the card before service.'
    )}`
  );
}

export async function revokeQrAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to manage tables.');

  const tableId = String(formData.get('tableId') ?? '').trim();
  if (!tableId) fail('Missing table.');

  const { error } = await ctx.supabase.rpc('retire_table_qr_code', { p_table_id: tableId });

  if (error) fail(`Could not revoke the code: ${error.message}`);

  revalidatePath(TABLES_PATH);
  redirect(
    `${TABLES_PATH}?notice=${encodeURIComponent(
      'Code revoked. Print a new card before this table can take orders.'
    )}`
  );
}
