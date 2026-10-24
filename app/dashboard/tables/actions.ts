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

/**
 * Switch a table on or off.
 *
 * ENABLING A TABLE WITH NO CODE CREATES ONE FIRST.
 *
 * This is the fix for a reported bug: "I pressed Enable and the table's QR
 * still is not enabled." The write was working -- is_active went true -- but
 * the table had no live code (its last one had been retired), so the card had
 * nothing to scan and the screen called that state "Revoked". The owner was
 * left with a table switched on, showing a QR-shaped pattern that decoded to
 * nothing, and no code that could ever be printed.
 *
 * A switched-on table nobody can scan is not a success, so enabling now
 * finishes the job: if there is no live code, one is issued first, through the
 * same SECURITY DEFINER function the Regenerate button uses (which checks
 * membership itself -- nothing about the restaurant is taken from the form).
 *
 * The order matters. Code first, then is_active: if the second write fails the
 * table has a code and is still off, which is safe. The reverse would leave an
 * enabled table with nothing to scan.
 */
export async function setTableActiveAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to manage tables.');

  const tableId = String(formData.get('tableId') ?? '').trim();
  const makeActive = formData.get('active') === 'true';
  if (!tableId) fail('Missing table.');

  let issuedCode = false;

  if (makeActive) {
    const { data: liveCodes } = await ctx.supabase
      .from('table_qr_codes')
      .select('id')
      .eq('table_id', tableId)
      .eq('restaurant_id', ctx.restaurantId)
      .is('revoked_at', null)
      .limit(1);

    if (!liveCodes || liveCodes.length === 0) {
      const { error: codeError } = await ctx.supabase.rpc('rotate_table_qr_code', {
        p_table_id: tableId,
      });
      // Not fatal for the disable path -- we are not in it -- but a table
      // switched on without a code is the bug we are fixing, so it is.
      if (codeError) fail(`Could not create a code for this table: ${codeError.message}`);
      issuedCode = true;
    }
  }

  const { error } = await ctx.supabase
    .from('dining_tables')
    .update({ is_active: makeActive })
    .eq('id', tableId)
    .eq('restaurant_id', ctx.restaurantId);

  if (error) fail(`Could not update table: ${error.message}`);

  revalidatePath(TABLES_PATH);

  const message = !makeActive
    ? 'Table disabled. It can no longer take orders.'
    : issuedCode
      ? 'Table enabled with a new QR code. Print that card before service.'
      : 'Table enabled.';

  redirect(`${TABLES_PATH}?notice=${encodeURIComponent(message)}`);
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

/**
 * Replace the six digits showing inside the restaurant.
 *
 * The code rolls on its own every ten minutes; this is for the case where it
 * leaked before the window ended -- somebody read it out over the phone, or a
 * guest photographed the screen. Rotating makes the code from that moment
 * wrong, without touching any table's card and without ending the session of
 * anyone who already verified: they proved presence at the time, and their
 * hour stands.
 *
 * Owner and manager only, enforced inside the function rather than here --
 * auth.uid() is the only thing that can name the caller, and a check in this
 * file would be a check the browser could skip by calling the RPC directly.
 */
export async function rotateVerificationCodeAction(): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to change the on-site code.');

  const { error } = await ctx.supabase.rpc('rotate_verification_code', {
    p_restaurant_id: ctx.restaurantId,
  });

  if (error) fail(`Could not change the code: ${error.message}`);

  // The old code is dead the moment this returns, so the screen must not keep
  // showing it from a cached render.
  revalidatePath(TABLES_PATH);
  redirect(
    `${TABLES_PATH}?notice=${encodeURIComponent(
      'New code showing. Tell guests the digits on screen now — the old ones no longer work.'
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
