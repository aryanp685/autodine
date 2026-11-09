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

type Row = { id: string; name: string; trial_started_at: string };

function fakeDb(rows: Row[]) {
  const calls = {
    namePattern: null as string | null,
    updates: [] as Record<string, unknown>[],
    eqIds: [] as string[],
  };
  const db = {
    from: vi.fn((_table: string) => ({
      select: vi.fn((_cols: string) => ({
        filter: vi.fn(async (_col: string, _op: string, pattern: string) => {
          calls.namePattern = pattern;
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

function request(body: unknown, auth?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (auth !== undefined) headers.set('authorization', auth);
  return new Request('http://localhost/api/admin/renew-trial', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const theKing: Row = {
  id: 'rest-1',
  name: 'The King',
  trial_started_at: '2026-10-01T00:00:00.000Z',
};

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
    const { db } = fakeDb([theKing]);
    mocks.getSupabaseAdmin.mockReturnValue(db);

    // Authenticated but unauthenticated-shaped input: still refused.
    const missingName = await POST(request({}, `Bearer ${A_SECRET}`));
    expect(missingName.status).toBe(400);
    expect(await missingName.json()).toEqual({ error: 'Missing restaurantName' });

    const badJson = await POST(request('{oops', `Bearer ${A_SECRET}`));
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ error: 'Invalid JSON body' });

    // Valid credentials and valid input: the renewal proceeds.
    const ok = await POST(request({ restaurantName: 'The King' }, `Bearer ${A_SECRET}`));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.ok).toBe(true);
    expect(body.restaurantName).toBe('The King');
  });

  it('fails closed when ADMIN_SECRET is not configured — every request is unauthorized', async () => {
    vi.stubEnv('ADMIN_SECRET', '');

    const res = await POST(request({ restaurantName: 'The King' }, `Bearer ${A_SECRET}`));
    expect(res.status).toBe(401);
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('rejects an invalid restaurant identifier safely', async () => {
    const { db, calls } = fakeDb([]);
    mocks.getSupabaseAdmin.mockReturnValue(db);

    const res = await POST(request({ restaurantName: 'Nowhere' }, `Bearer ${A_SECRET}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('No restaurant found');
    expect(calls.updates).toHaveLength(0);
  });

  it('renews only the intended restaurant: the name cannot act as a pattern', async () => {
    const { db, calls } = fakeDb([theKing]);
    mocks.getSupabaseAdmin.mockReturnValue(db);

    await POST(request({ restaurantName: 'The King' }, `Bearer ${A_SECRET}`));

    expect(calls.namePattern).toBe('^The King$');
    expect(calls.eqIds).toEqual(['rest-1']);
    expect(Object.keys(calls.updates[0])).toEqual(['trial_started_at']);
  });
});
