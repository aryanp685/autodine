import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The server-action authorization boundary.
 *
 * These tests invoke renewTrialAction the way an attacker would — directly,
 * with no page, no route, and no ceremony. The action is a privileged write
 * (service role, RLS bypass), so the authorization must live inside it:
 * whatever path reaches the write, the credential check reaches it first.
 * The Supabase admin client is mocked so "never invoked" can be asserted,
 * not merely hoped for.
 */

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

// The env module freezes its configuration booleans at import time; the
// tests supply the admin client themselves, so the flag simply says the
// server is wired.
vi.mock('@/lib/supabase/env', () => ({
  isSupabaseAdminConfigured: true,
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { renewTrialAction } from './actions';

const A_SECRET = 's3cure-admin-secret-value-with-32-chars!!';

type Row = { id: string; name: string; trial_started_at: string };

/**
 * A stand-in for the exact query chain the action uses:
 * select().ilike() for the lookup, update().eq().select().single() for the
 * write. It records what the action actually asked for, which is how the
 * "only the intended restaurant" tests prove their claim.
 */
function fakeDb(rows: Row[]) {
  const calls = {
    ilikePattern: null as string | null,
    updates: [] as Record<string, unknown>[],
    eqIds: [] as string[],
  };
  const db = {
    from: vi.fn((_table: string) => ({
      select: vi.fn((_cols: string) => ({
        ilike: vi.fn(async (_col: string, pattern: string) => {
          calls.ilikePattern = pattern;
          return { data: rows, error: null };
        }),
      })),
      update: vi.fn((payload: Record<string, unknown>) => {
        calls.updates.push(payload);
        return {
          eq: vi.fn((_col: string, id: string) => {
            calls.eqIds.push(id);
            return {
              select: vi.fn((_c2: string) => ({
                single: vi.fn(async () => ({
                  data: { ...rows[0], trial_started_at: new Date().toISOString() },
                  error: null,
                })),
              })),
            };
          }),
        };
      }),
    })),
  };
  return { db, calls };
}

const theKing: Row = {
  id: 'rest-1',
  name: 'The King',
  trial_started_at: '2026-10-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.stubEnv('ADMIN_SECRET', A_SECRET);
  mocks.getSupabaseAdmin.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('renewTrialAction — direct invocation', () => {
  it('rejects a direct call with no authorization and never touches the database', async () => {
    const result = await renewTrialAction('The King', '');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unauthorized');
    // The service-role client is never even constructed — no write is possible.
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('rejects an invalid admin secret with the same generic answer', async () => {
    const result = await renewTrialAction('The King', 'wrong-secret-entirely');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unauthorized');
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('fails closed when ADMIN_SECRET is missing — no caller is authorized', async () => {
    vi.stubEnv('ADMIN_SECRET', '');

    for (const guess of ['', A_SECRET, 'x'.repeat(64)]) {
      const result = await renewTrialAction('The King', guess);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Unauthorized');
    }
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('rejects an invalid restaurant identifier safely, before any query', async () => {
    const result = await renewTrialAction('   ', A_SECRET);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Missing restaurantName');
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('renews exactly the intended restaurant when authorized', async () => {
    const { db, calls } = fakeDb([theKing]);
    mocks.getSupabaseAdmin.mockReturnValue(db);

    const result = await renewTrialAction('The King', A_SECRET);

    expect(result.ok).toBe(true);
    expect(result.restaurantName).toBe('The King');
    expect(calls.updates).toHaveLength(1);
    expect(calls.eqIds).toEqual(['rest-1']);
  });

  it('treats the name as a name: LIKE wildcards cannot reach another restaurant', async () => {
    // "%" is not "every restaurant" — it is a restaurant named "%", which
    // does not exist. Before the escape it matched everything and renewed
    // whichever row came first.
    const { db, calls } = fakeDb([]);
    mocks.getSupabaseAdmin.mockReturnValue(db);

    const result = await renewTrialAction('%', A_SECRET);

    expect(calls.ilikePattern).toBe('\\%');
    expect(result.ok).toBe(false);
    expect(calls.updates).toHaveLength(0);

    const second = fakeDb([]);
    mocks.getSupabaseAdmin.mockReturnValue(second.db);
    await renewTrialAction('a_b', A_SECRET);
    expect(second.calls.ilikePattern).toBe('a\\_b');
  });

  it('refuses an ambiguous match instead of guessing which restaurant to renew', async () => {
    const { db, calls } = fakeDb([theKing, { ...theKing, id: 'rest-2', name: 'The king' }]);
    mocks.getSupabaseAdmin.mockReturnValue(db);

    const result = await renewTrialAction('the king', A_SECRET);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Multiple restaurants match');
    expect(calls.updates).toHaveLength(0);
  });

  it('moves only the trial clock — plan columns stay untouched', async () => {
    const { db, calls } = fakeDb([theKing]);
    mocks.getSupabaseAdmin.mockReturnValue(db);

    await renewTrialAction('The King', A_SECRET);

    // Exactly one key: trial_started_at. The plan, plan_status and the rest
    // stay under protect_restaurant_plan(); this write cannot reach them.
    expect(Object.keys(calls.updates[0])).toEqual(['trial_started_at']);
  });

  it('reports a missing restaurant by name, without touching the database', async () => {
    const { db, calls } = fakeDb([]);
    mocks.getSupabaseAdmin.mockReturnValue(db);

    const result = await renewTrialAction('Nowhere', A_SECRET);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('No restaurant found');
    expect(calls.updates).toHaveLength(0);
  });
});
