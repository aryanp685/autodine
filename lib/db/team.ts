/**
 * The team behind one restaurant: who has access, what role, and which
 * invitations are still waiting to be used.
 *
 * WHERE THE DATA COMES FROM
 *
 * Members are read through public.list_staff_members(), a SECURITY DEFINER
 * function, rather than by selecting public.memberships and joining profiles.
 * The reason is privacy: profiles_self lets a person read only their own
 * profile row, so a join would return names for one row and nulls for every
 * colleague -- and widening that policy would expose a co-worker's phone
 * number to the whole team. The function returns exactly the four facts the
 * screen draws and nothing else.
 *
 * Pending invitations are a plain select. restaurant_invites is readable by
 * owners and managers under RLS, and `code_hash` is not even granted to the
 * authenticated role, so this query could not leak a hash if it tried.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * Never returns a raw invitation code. The code exists once, in the response
 * to the minting call, and is carried to the page in a short-lived httpOnly
 * cookie -- see app/(staff)/dashboard/settings/team-actions.ts. A loader that
 * could re-read it would mean the database had kept it, which is the property
 * this design exists to avoid.
 *
 * If the migration has not been applied, this returns `unavailable` with a
 * sentence a human can act on. It does not pretend the team is empty: an
 * empty People list on a working restaurant would read as "all my staff were
 * removed".
 */

import type { MemberRole } from './database';
import { getStaffContextDetailed } from './staff';

export type TeamMember = {
  membershipId: string;
  userId: string;
  role: MemberRole;
  /** Null when the account never filled a name in. The screen says so. */
  name: string | null;
  email: string | null;
  joinedAt: string;
  isSelf: boolean;
};

export type PendingInvite = {
  id: string;
  role: Exclude<MemberRole, 'owner'>;
  createdAt: string;
  expiresAt: string;
  /** Computed here so the row can say "expired" without a second clock. */
  expired: boolean;
};

export type TeamScreenData = {
  /** The caller's own role, so the screen can explain itself. */
  role: MemberRole;
  canManage: boolean;
  isOwner: boolean;
  members: TeamMember[];
  invites: PendingInvite[];
  /**
   * Set when the team tables could not be read at all. The screen shows this
   * sentence and no list, rather than an empty list that would be a lie.
   */
  unavailable?: string;
};

/** Roles this screen can invite. Ownership is never one of them. */
export const INVITABLE_ROLES: Array<{ role: Exclude<MemberRole, 'owner'>; label: string; blurb: string }> = [
  {
    role: 'manager',
    label: 'Manager',
    blurb: 'Runs the restaurant with you: menus, prices, tables, reports and settings.',
  },
  {
    role: 'cashier',
    label: 'Cashier',
    blurb: 'Takes payment at the counter and sees the day’s bills. No menu or settings changes.',
  },
  {
    role: 'kitchen',
    label: 'Kitchen',
    blurb: 'Sees the kitchen board and moves tickets along. No bills, no settings.',
  },
];

/** What a role may open, in one place. Mirrors the RLS policies. */
export function roleLabel(role: MemberRole): string {
  return role === 'owner' ? 'Owner' : role === 'manager' ? 'Manager' : role === 'cashier' ? 'Cashier' : 'Kitchen';
}

/** Where a role lands after signing in. */
export function homeForRole(role: MemberRole): string {
  return role === 'kitchen' ? '/kitchen' : role === 'cashier' ? '/cashier' : '/dashboard';
}

export async function getTeamScreenData(): Promise<TeamScreenData | null> {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) return null;

  const { supabase, restaurantId, role } = staff.context;
  const canManage = role === 'owner' || role === 'manager';

  // A kitchen or cashier login reaching this far should see the screen's own
  // explanation, not a database error. The RPC would refuse them anyway; not
  // calling it is the honest version of the same answer.
  if (!canManage) {
    return { role, canManage: false, isOwner: false, members: [], invites: [] };
  }

  const [membersResult, invitesResult] = await Promise.all([
    supabase.rpc('list_staff_members', { p_restaurant_id: restaurantId }),
    supabase
      .from('restaurant_invites')
      .select('id, role, created_at, expires_at')
      .eq('restaurant_id', restaurantId)
      .is('redeemed_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  if (membersResult.error) {
    return {
      role,
      canManage,
      isOwner: role === 'owner',
      members: [],
      invites: [],
      unavailable:
        'The team list could not be read. If this deployment has just been updated, the team migration may not be applied yet.',
    };
  }

  const now = Date.now();
  const rows = membersResult.data ?? [];

  const members: TeamMember[] = rows.map((row) => ({
    membershipId: row.membership_id,
    userId: row.user_id,
    role: row.role,
    name: row.full_name,
    email: row.email,
    joinedAt: row.joined_at,
    isSelf: row.is_self,
  }));

  /* A failed invites read is not allowed to blank the member list: they are
     separate questions and the people matter more. The invitation card says
     it could not read them. */
  const invites: PendingInvite[] = (invitesResult.data ?? []).map((row) => ({
    id: row.id,
    role: row.role as Exclude<MemberRole, 'owner'>,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    expired: new Date(row.expires_at).getTime() <= now,
  }));

  return {
    role,
    canManage,
    isOwner: role === 'owner',
    members,
    invites,
    ...(invitesResult.error
      ? {
          unavailable:
            'The team is listed below, but the pending invitations could not be read for this deployment.',
        }
      : {}),
  };
}
