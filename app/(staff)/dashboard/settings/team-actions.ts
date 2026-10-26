/**
 * Minting, revoking and removing: the three writes behind Settings → People.
 *
 * THREE RULES THIS FILE KEEPS
 *
 * 1. THE RESTAURANT COMES FROM THE SESSION. Never from the form. The RPC takes
 *    the id and re-checks the caller's role in that restaurant, so a forged
 *    payload is refused twice rather than once.
 *
 * 2. THE CODE NEVER TOUCHES A URL. The invitation is created here, and the
 *    only copy of it -- the database keeps a hash -- is handed to the screen in
 *    a short-lived httpOnly cookie. A redirect that carried it would put a
 *    working staff invitation into access logs, browser history and the
 *    Referer of every subsequent request.
 *
 * 3. A REFUSAL IS REPORTED AS A REFUSAL. The Postgres functions return status
 *    words for the normal outcomes ("used", "not_found") and raise for the
 *    things a person did wrong. Both are turned into a sentence here, and a
 *    write that matched nothing never reports success.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { canEditSettings } from '@/lib/settings-input';
import {
  INVITE_FLASH_COOKIE,
  INVITE_FLASH_SECONDS,
  encodeInviteFlash,
} from '@/lib/team-invite';
import type { MemberRole } from '@/lib/db/database';

const SETTINGS_PATH = '/dashboard/settings';
const PEOPLE_HASH = '#settings-people';

type InvitableRole = Exclude<MemberRole, 'owner'>;

const INVITABLE: InvitableRole[] = ['manager', 'cashier', 'kitchen'];

function fail(message: string): never {
  redirect(`${SETTINGS_PATH}?error=${encodeURIComponent(message)}${PEOPLE_HASH}`);
}

function done(message: string): never {
  redirect(`${SETTINGS_PATH}?notice=${encodeURIComponent(message)}${PEOPLE_HASH}`);
}

async function requireEditor() {
  const staff = await getStaffContextDetailed();

  if (!staff.ok) {
    if (staff.reason === 'signed-out') fail('You need to be signed in to change the team.');
    if (staff.reason === 'no-membership') fail('This account is not a member of any restaurant yet.');
    fail('The database is not connected, so there is nothing to change.');
  }

  if (!canEditSettings(staff.context.role)) {
    fail('Only the owner or a manager can change who has access. Ask them to do it.');
  }

  return staff.context;
}

/**
 * Create an invitation.
 *
 * `days` is the owner's choice from a fixed set (1, 7, 30); anything else is
 * clamped by the function itself, so a hand-made request cannot mint a link
 * that outlives a season.
 */
export async function createInviteAction(formData: FormData): Promise<void> {
  const role = String(formData.get('role') ?? '') as InvitableRole;
  const days = Number(formData.get('days') ?? 7);

  if (!INVITABLE.includes(role)) {
    fail('Choose which role this invitation is for.');
  }
  if (!Number.isFinite(days) || days < 1 || days > 30) {
    fail('Choose how long the invitation should work — between 1 and 30 days.');
  }

  const ctx = await requireEditor();

  /* Mirrors the database rule, so the owner-facing message is a sentence
     instead of a raised exception from Postgres. The function is still the
     authority; this only makes the common case readable. */
  if (role === 'manager' && ctx.role !== 'owner') {
    fail('Only the owner can invite a manager.');
  }

  const { data, error } = await ctx.supabase.rpc('create_staff_invite', {
    p_restaurant_id: ctx.restaurantId,
    p_role: role,
    p_days: days,
  });

  if (error || !data) {
    // The function's own messages are written for a human; pass them through
    // rather than replacing them with something vaguer.
    fail(error?.message ?? 'Could not create the invitation. Please try again.');
  }

  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const store = await cookies();
  store.set(INVITE_FLASH_COOKIE, encodeInviteFlash({ code: data, role, expiresAt }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/dashboard/settings',
    maxAge: INVITE_FLASH_SECONDS,
  });

  revalidatePath(SETTINGS_PATH);
  done(`Invitation ready for a ${role}. Copy the link below and send it to them.`);
}

/** Withdraw a link that has not been used. */
export async function revokeInviteAction(formData: FormData): Promise<void> {
  const inviteId = String(formData.get('inviteId') ?? '').trim();
  if (!inviteId) fail('That invitation is no longer listed. Reload the page and try again.');

  const ctx = await requireEditor();
  const { data, error } = await ctx.supabase.rpc('revoke_staff_invite', { p_invite_id: inviteId });

  if (error) fail(error.message);
  if (data === 'used') fail('That invitation has already been used, so there is nothing to revoke.');
  if (data === 'not_found') fail('That invitation no longer exists. Reload the page.');
  if (data !== 'revoked') fail('Could not revoke that invitation. Please try again.');

  revalidatePath(SETTINGS_PATH);
  done('Invitation cancelled. The link stops working immediately.');
}

/**
 * Remove somebody from the team.
 *
 * The last owner is protected by the database. A manager cannot remove anyone
 * here at all: the function checks for the owner role, so the button is hidden
 * from them and a hand-made request is refused.
 */
export async function removeMemberAction(formData: FormData): Promise<void> {
  const membershipId = String(formData.get('membershipId') ?? '').trim();
  if (!membershipId) fail('That person is no longer listed. Reload the page and try again.');

  const ctx = await requireEditor();
  if (ctx.role !== 'owner') {
    fail('Only the owner can remove someone’s access.');
  }

  const { data, error } = await ctx.supabase.rpc('remove_staff_member', {
    p_membership_id: membershipId,
  });

  if (error) fail(error.message);
  if (data === 'not_found') fail('That person is no longer on the team. Reload the page.');
  if (data !== 'removed') fail('Could not remove that person. Please try again.');

  revalidatePath(SETTINGS_PATH);
  done('Access removed. They are signed out of this restaurant on their next request.');
}
