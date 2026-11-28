import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({ rpc }),
}));

import { GET } from './route';

/**
 * The only scheduled path that marks a subscription expired. Fail closed: no
 * secret configured -> 503, wrong token -> 401, sweep failure -> 500, and only
 * a correct call runs expire_subscriptions() -- once.
 */

// A throwaway value for the test process only; the real secret lives in the
// deployment's environment (and in the Vault here).
const TOKEN = randomUUID();

const request = (auth?: string) =>
  new Request('http://localhost/api/cron/subscription-expiry', {
    method: 'GET',
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  delete process.env.AUTODINE_CRON_SECRET;
  delete process.env.CRON_SECRET;
});

describe('GET /api/cron/subscription-expiry', () => {
  it('fails closed when no cron secret is configured', async () => {
    const response = await GET(request(`Bearer ${TOKEN}`));
    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a missing or wrong token with 401', async () => {
    process.env.AUTODINE_CRON_SECRET = TOKEN;
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('Bearer wrong'))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports a failed sweep instead of pretending it ran', async () => {
    process.env.CRON_SECRET = TOKEN;
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    const response = await GET(request(`Bearer ${TOKEN}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'The expiry sweep failed.' });
  });

  it('runs expire_subscriptions once and reports what it ended', async () => {
    process.env.CRON_SECRET = TOKEN;
    rpc.mockResolvedValueOnce({ data: 2, error: null });

    const response = await GET(request(`Bearer ${TOKEN}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ expired: 2 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('expire_subscriptions');
  });
});
