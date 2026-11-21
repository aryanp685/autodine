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

import { TRIAL_DAYS } from '@/lib/trial';
import { renewTrialAction } from './actions';

const A_SECRET = 's3cure-admin-secret-value-with-32-chars!!';

/**
 * A stand-in for the one call the action makes:
 * rpc('admin_set_subscription', ...).
 *
 * It records the arguments the action actually sent, which is how the
 * "only the intended restaurant" tests prove their claim. Note what is
 * recorded: the restaurant name arrives as a BOUND PARAMETER, so it can
 * never be read as a pattern by PostgREST or by SQL. The exact-match and
 * ambiguity rules live in the function (migration 20261110001000), where
 * they cannot be bypassed by a caller who reaches the action directly.
 */
function fakeDb(result: Record<string, unknown> | null, error: { message: string } | null = null) {
  const calls = {
    rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    tableWrites: [] as string[],
  };
  const db = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.rpcCalls.push({ fn, args });
      return { data: result, error };
    }),
    from: vi.fn((table: string) => {
      calls.tableWrites.push(table);
      throw new Error(`unexpected table access: ${table}`);
    }),
  };
  return { db, calls };
}

/** A successful renewal, shaped like the function's jsonb return value. */
const renewed = {
  account_id: 'acct-1',
  plan: 'trial',
  plan_status: 'trialing',
  trial_ends_at: '2026-12-01T00:00:00.000Z',
  plan_expires_at: null,
  outlets: 1,
};

const THE_KING = 'The King';

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
    const { db, calls } = fakeDb(renewed);
    mocks.getSupabaseAdmin.mockReturnValue(db);

    const result = await renewTrialAction(THE_KING, A_SECRET);

    expect(result.ok).toBe(true);
    expect(result.restaurantName).toBe(THE_KING);
    expect(result.trialEndsAt).toBe(renewed.trial_ends_at);

    // One call, to the one privileged function, with the name as a parameter.
    expect(calls.rpcCalls).toHaveLength(1);
    expect(calls.rpcCalls[0].fn).toBe('admin_set_subscription');
    expect(calls.rpcCalls[0].args.p_restaurant_name).toBe(THE_KING);
    // And no direct table write on any path: the whole write is inside the
    // function, where protect_account_plan() still governs it.
    expect(calls.tableWrites).toEqual([]);
  });

  it('treats the name as a name: LIKE wildcards cannot reach another restaurant', async () => {
    // "%" is not "every restaurant" — it is a restaurant named "%", which
    // does not exist. The name is a bound parameter, so no layer can read it
    // as a pattern: it is compared with lower(btrim(name)) = lower(btrim(...))
    // inside the function, and matches nothing.
    const { db, calls } = fakeDb(null, { message: 'restaurant_not_found' });
    mocks.getSupabaseAdmin.mockReturnValue(db);

    const result = await renewTrialAction('%', A_SECRET);

    expect(calls.rpcCalls[0].args.p_restaurant_name).toBe('%');
    expect(result.ok).toBe(false);

    const second = fakeDb(null, { message: 'restaurant_not_found' });
    mocks.getSupabaseAdmin.mockReturnValue(second.db);
    await renewTrialAction('a_b', A_SECRET);
    expect(second.calls.rpcCalls[0].args.p_restaurant_name).toBe('a_b');
  });

  it('matches literal asterisks and regex characters without wildcard expansion', async () => {
    // No escaping is applied to the name at all, because none is needed: a
    // bound parameter has no syntax. "Cafe * (A+B)." is searched for as the
    // eleven characters it is.
    const { db, calls } = fakeDb(null, { message: 'restaurant_not_found' });
    mocks.getSupabaseAdmin.mockReturnValue(db);

    await renewTrialAction('Cafe * (A+B).', A_SECRET);

    expect(calls.rpcCalls[0].args.p_restaurant_name).toBe('Cafe * (A+B).');
  });

  it('refuses an ambiguous match instead of guessing which restaurant to renew', async () => {
    // Two accounts own a restaurant called some form of "the king". The
    // function counts distinct accounts and refuses rather than renewing
    // whichever one sorted first.
    const { db } = fakeDb(null, { message: 'restaurant_ambiguous' });
    mocks.getSupabaseAdmin.mockReturnValue(db);

    const result = await renewTrialAction('the king', A_SECRET);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Several accounts own a restaurant called');
    expect(result.error).toContain('the king');
  });

  it('moves only the trial clock — plan columns stay untouched', async () => {
    const { db, calls } = fakeDb(renewed);
    mocks.getSupabaseAdmin.mockReturnValue(db);

    await renewTrialAction(THE_KING, A_SECRET);

    // A trial, and only a trial: never a paid plan, never a term. The
    // function sets plan='trial', plan_status='trialing' and clears both
    // plan_started_at and plan_expires_at.
    expect(calls.rpcCalls[0].args.p_plan).toBe('trial');
    expect(calls.rpcCalls[0].args.p_days).toBe(TRIAL_DAYS);
    expect(calls.rpcCalls[0].args).not.toHaveProperty('p_months');
    // Nothing is written through the table API, so no column can be reached
    // that the function does not set itself.
    expect(calls.tableWrites).toEqual([]);
  });

  it('reports a missing restaurant by name, without guessing at one', async () => {
    const { db, calls } = fakeDb(null, { message: 'restaurant_not_found' });
    mocks.getSupabaseAdmin.mockReturnValue(db);

    const result = await renewTrialAction('Nowhere', A_SECRET);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('No restaurant found with name');
    expect(result.error).toContain('Nowhere');
    // Asked once, and refused: no fallback write, no partial renewal.
    expect(calls.rpcCalls).toHaveLength(1);
    expect(calls.tableWrites).toEqual([]);
  });

  it('surfaces an unexpected database error without leaking a raw message to a stranger', async () => {
    const { db } = fakeDb(null, { message: 'connection to server at "db.internal" failed' });
    mocks.getSupabaseAdmin.mockReturnValue(db);

    const result = await renewTrialAction(THE_KING, A_SECRET);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Could not renew the trial');
    // The host name is in the message: it stays server-side, in the log, and
    // is never a claim about the caller's own authorization.
    expect(result.error).not.toContain('Unauthorized');
  });
});
