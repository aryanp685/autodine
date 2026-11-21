import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/admin/renew-trial — the HTTP authorization boundary.
 *
 * The endpoint is a trial-clock write with the service role. The order of
 * operations is the security model: authorization is asked before the body
 * is parsed, so an unauthorized caller cannot even probe the input
 * validation. These tests walk the boundary the way a stranger would —
 * no header, a wrong header, a right header — and assert on what the
 * database layer was asked to do (or, for unauthorized calls, not asked).
 */

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
  revalidatePath: vi.fn(),
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
  revalidatePath: mocks.revalidatePath,
}));

import { POST } from './route';

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
 * they cannot be bypassed by a caller who reaches the endpoint directly.
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

function request(body: unknown, auth?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (auth !== undefined) headers.set('authorization', auth);
  return new Request('http://localhost/api/admin/renew-trial', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const THE_KING = 'The King';

beforeEach(() => {
  vi.stubEnv('ADMIN_SECRET', A_SECRET);
  mocks.getSupabaseAdmin.mockReset();
  mocks.revalidatePath.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/admin/renew-trial', () => {
  it('answers 401 to a request with no credentials, and never reaches the database', async () => {
    const res = await POST(request({ restaurantName: 'The King' }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('answers 401 to incorrect credentials — the same answer, nothing leaked', async () => {
    const res = await POST(request({ restaurantName: 'The King' }, 'Bearer wrong-secret'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('rejects malformed Authorization headers the same way', async () => {
    for (const header of ['Basic abc', 'Bearer', A_SECRET, `Bearer ${'x'.repeat(64)}`]) {
      const res = await POST(request({ restaurantName: 'The King' }, header));
      expect(res.status).toBe(401);
    }
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('lets valid credentials through only after normal input validation', async () => {
    const { db } = fakeDb(renewed);
    mocks.getSupabaseAdmin.mockReturnValue(db);

    // Authenticated but unauthenticated-shaped input: still refused.
    const missingName = await POST(request({}, `Bearer ${A_SECRET}`));
    expect(missingName.status).toBe(400);
    expect(await missingName.json()).toEqual({ error: 'Missing restaurantName' });

    const badJson = await POST(request('{oops', `Bearer ${A_SECRET}`));
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ error: 'Invalid JSON body' });

    // Valid credentials and valid input: the renewal proceeds.
    const ok = await POST(request({ restaurantName: THE_KING }, `Bearer ${A_SECRET}`));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.ok).toBe(true);
    expect(body.restaurantName).toBe(THE_KING);
    expect(body.trialEndsAt).toBe(renewed.trial_ends_at);
  });

  it('fails closed when ADMIN_SECRET is not configured — every request is unauthorized', async () => {
    vi.stubEnv('ADMIN_SECRET', '');

    const res = await POST(request({ restaurantName: 'The King' }, `Bearer ${A_SECRET}`));
    expect(res.status).toBe(401);
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('rejects an invalid restaurant identifier safely', async () => {
    const { db } = fakeDb(null, { message: 'restaurant_not_found' });
    mocks.getSupabaseAdmin.mockReturnValue(db);

    const res = await POST(request({ restaurantName: 'Nowhere' }, `Bearer ${A_SECRET}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('No restaurant found');
  });

  it('renews only the intended restaurant: the name cannot act as a pattern', async () => {
    const { db, calls } = fakeDb(renewed);
    mocks.getSupabaseAdmin.mockReturnValue(db);

    await POST(request({ restaurantName: THE_KING }, `Bearer ${A_SECRET}`));

    // The name travels as a parameter, never as syntax — and a request whose
    // name is a wildcard matches a restaurant literally called that, if one
    // exists, and nothing otherwise.
    expect(calls.rpcCalls).toHaveLength(1);
    expect(calls.rpcCalls[0].fn).toBe('admin_set_subscription');
    expect(calls.rpcCalls[0].args.p_restaurant_name).toBe(THE_KING);
    expect(calls.rpcCalls[0].args.p_plan).toBe('trial');
    expect(calls.tableWrites).toEqual([]);
  });

  it('refuses an ambiguous name rather than renewing an arbitrary account', async () => {
    const { db } = fakeDb(null, { message: 'restaurant_ambiguous' });
    mocks.getSupabaseAdmin.mockReturnValue(db);

    const res = await POST(request({ restaurantName: 'the king' }, `Bearer ${A_SECRET}`));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Several accounts own a restaurant called');
  });
});
