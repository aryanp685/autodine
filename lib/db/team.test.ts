import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The People screen's loader.
 *
 * What it must never do is turn a failed read into an empty team: an owner who
 * sees "0 people" and no error will believe their staff were removed. Every
 * failure path here therefore produces a sentence, and the tests below pin
 * that.
 *
 * The SQL itself is not covered here. The RPCs, the last-owner rule and the
 * single-use redemption are database behaviour and are only verifiable against
 * a real Postgres.
 */

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
}));

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.result),
}));

import { getTeamScreenData } from './team';

type Row = Record<string, unknown>;

function fakeSupabase({
  members = [] as Row[],
  invites = [] as Row[],
  membersError = null as { message: string } | null,
  invitesError = null as { message: string } | null,
  onRpc,
}: {
  members?: Row[];
  invites?: Row[];
  membersError?: { message: string } | null;
  invitesError?: { message: string } | null;
  onRpc?: () => void;
}) {
  const from = () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (onFulfilled?: unknown, onRejected?: unknown) =>
        Promise.resolve({ data: invites, error: invitesError }).then(
          onFulfilled as () => unknown,
          onRejected as () => unknown,
        ),
    };
    return chain;
  };

  const rpc = () => {
    onRpc?.();
    return Promise.resolve({ data: membersError ? null : members, error: membersError });
  };

  return { from, rpc } as never;
}

function signedIn(supabase: unknown, role = 'owner') {
  return {
    ok: true as const,
    context: { supabase, restaurantId: 'r-1', restaurantName: 'Maddi', role },
  };
}

beforeEach(() => {
  mocks.staff.result = null;
});

describe('team data', () => {
  it('is null when there is no restaurant to read', async () => {
    mocks.staff.result = { ok: false, reason: 'signed-out' };
    expect(await getTeamScreenData()).toBeNull();
  });

  it('does not even ask the database for a kitchen login', async () => {
    let asked = false;
    mocks.staff.result = signedIn(fakeSupabase({ onRpc: () => (asked = true) }), 'kitchen');

    const data = await getTeamScreenData();

    expect(asked).toBe(false);
    expect(data?.canManage).toBe(false);
    expect(data?.members).toEqual([]);
  });

  it('lists people with the name, email and role the screen draws', async () => {
    const joined = '2026-10-01T09:00:00.000Z';
    mocks.staff.result = signedIn(
      fakeSupabase({
        members: [
          {
            membership_id: 'm-1',
            user_id: 'u-1',
            role: 'owner',
            full_name: 'Asha Rao',
            email: 'asha@example.test',
            joined_at: joined,
            is_self: true,
          },
          {
            membership_id: 'm-2',
            user_id: 'u-2',
            role: 'kitchen',
            full_name: null,
            email: 'cook@example.test',
            joined_at: joined,
            is_self: false,
          },
        ],
        invites: [],
      }),
    );

    const data = await getTeamScreenData();

    expect(data?.canManage).toBe(true);
    expect(data?.isOwner).toBe(true);
    expect(data?.members).toHaveLength(2);
    expect(data?.members[0]).toMatchObject({ name: 'Asha Rao', isSelf: true, role: 'owner' });
    // A person who never filled a name in is still identifiable by email.
    expect(data?.members[1]).toMatchObject({ name: null, email: 'cook@example.test' });
  });

  it('marks an invitation that has run out of time', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    mocks.staff.result = signedIn(
      fakeSupabase({
        members: [],
        invites: [
          { id: 'i-1', role: 'cashier', created_at: past, expires_at: past },
          { id: 'i-2', role: 'kitchen', created_at: past, expires_at: future },
        ],
      }),
    );

    const data = await getTeamScreenData();

    expect(data?.invites.map((invite) => invite.expired)).toEqual([true, false]);
  });

  it('says the team could not be read instead of showing an empty team', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({ membersError: { message: 'function public.list_staff_members does not exist' } }),
    );

    const data = await getTeamScreenData();

    expect(data?.members).toEqual([]);
    expect(data?.unavailable).toMatch(/could not be read/i);
    expect(data?.unavailable).toMatch(/migration/i);
  });

  it('still lists the team when only the invitations failed', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        members: [
          {
            membership_id: 'm-1',
            user_id: 'u-1',
            role: 'owner',
            full_name: 'Asha Rao',
            email: 'asha@example.test',
            joined_at: '2026-10-01T09:00:00.000Z',
            is_self: true,
          },
        ],
        invitesError: { message: 'permission denied' },
      }),
    );

    const data = await getTeamScreenData();

    expect(data?.members).toHaveLength(1);
    expect(data?.invites).toEqual([]);
    expect(data?.unavailable).toMatch(/invitations could not be read/i);
  });
});
