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
 * QR tokens are short-lived (QR_TTL_HOURS) on purpose. A static printed code
 * cannot prove a diner is physically in the room, so a leaked screenshot of
 * an old code must stop working on its own.
 *
 * Errors redirect with a message in the query string, matching the pattern in
 * app/auth/actions.ts: these are called by <form action> in Server Components
 * and there is no client state to hold an error in.
 */

'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { QR_TTL_HOURS } from '@/lib/db/tables-screen';

const TABLES_PATH = '/dashboard/tables';

function fail(message: string): never {
  redirect(`${TABLES_PATH}?error=${encodeURIComponent(message)}`);
}

/**
 * Resolve the restaurant the signed-in user belongs to.
 * Returns null when unconfigured, signed out, or not a member of anything.
 */
async function currentRestaurant() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership, error } = await supabase
    .from('memberships')
    .select('restaurant_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (error || !membership) return null;
  return { supabase, restaurantId: membership.restaurant_id as string };
}

/** A short, URL-safe, unguessable table code. Not a JWT, not sequential. */
function newToken(): string {
  return randomBytes(16).toString('base64url');
}

function expiresAt(): string {
  return new Date(Date.now() + QR_TTL_HOURS * 60 * 60 * 1000).toISOString();
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

  const { data: created, error } = await ctx.supabase
    .from('dining_tables')
    .insert({ restaurant_id: ctx.restaurantId, label, seats })
    .select('id')
    .single();

  if (error) fail(`Could not add table: ${error.message}`);

  // A new table gets a live code immediately, so it can take orders the
  // moment it exists.
  const { error: tokenError } = await ctx.supabase.from('qr_tokens').insert({
    restaurant_id: ctx.restaurantId,
    table_id: created.id as string,
    token: newToken(),
    expires_at: expiresAt(),
  });

  if (tokenError) fail(`Table added, but its QR could not be created: ${tokenError.message}`);

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

  // Drop the old codes first, then issue one. Both writes are RLS-gated to
  // this restaurant, so a wrong table id simply affects no rows.
  const { error: clearError } = await ctx.supabase
    .from('qr_tokens')
    .delete()
    .eq('table_id', tableId)
    .eq('restaurant_id', ctx.restaurantId);

  if (clearError) fail(`Could not retire the old code: ${clearError.message}`);

  const { error } = await ctx.supabase.from('qr_tokens').insert({
    restaurant_id: ctx.restaurantId,
    table_id: tableId,
    token: newToken(),
    expires_at: expiresAt(),
  });

  if (error) fail(`Could not create a new code: ${error.message}`);

  revalidatePath(TABLES_PATH);
  redirect(
    `${TABLES_PATH}?notice=${encodeURIComponent(
      `New code issued. It expires in ${QR_TTL_HOURS} hours and the old one stops working now.`
    )}`
  );
}

export async function revokeQrAction(formData: FormData): Promise<void> {
  const ctx = await currentRestaurant();
  if (!ctx) fail('You need to be signed in to manage tables.');

  const tableId = String(formData.get('tableId') ?? '').trim();
  if (!tableId) fail('Missing table.');

  const { error } = await ctx.supabase
    .from('qr_tokens')
    .delete()
    .eq('table_id', tableId)
    .eq('restaurant_id', ctx.restaurantId);

  if (error) fail(`Could not revoke the code: ${error.message}`);

  revalidatePath(TABLES_PATH);
  redirect(
    `${TABLES_PATH}?notice=${encodeURIComponent('Code revoked. Print a new card before this table can take orders.')}`
  );
}
