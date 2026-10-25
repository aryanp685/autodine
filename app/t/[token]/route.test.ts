import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * What scanning a table's card does.
 *
 * The order matters more than it looks:
 *
 *   1. the card is checked against the database BEFORE anything is granted;
 *   2. a live card leaves behind a browse pass and sends the guest to the
 *      menu -- not to a form;
 *   3. a dead card (revoked, table out of service, restaurant closed) sends
 *      them to the explanation, with no cookie;
 *   4. a card that is not even the right shape never reaches the database.
 *
 * The browse pass is deliberately not a session. If this handler ever wrote
 * `autodine_table` instead of `autodine_table_card`, a scanned photograph
 * would be an order. That is the failure this file exists to catch.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  loadTableAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/env', () => ({ isSupabaseConfigured: true }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/table-access', () => ({ loadTableAccess: mocks.loadTableAccess }));

const { GET } = await import('./route');

const LIVE = '618d77118ea89cbfb12c4a70d9267858cf06d34dc0f6db49';

function scan(token: string) {
  const request = new NextRequest(`http://localhost:3000/t/${token}`);
  return GET(request, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.loadTableAccess.mockReset().mockResolvedValue({ status: 'none' });
});

describe('GET /t/<card token>', () => {
  it('sends a live card to the menu and leaves a browse pass, never a session', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          restaurant_slug: 'maddi',
          restaurant_name: 'Maddi',
          table_label: 'T3',
          window_seconds: 600,
        },
      ],
      error: null,
    });

    const response = await scan(LIVE);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/menu?s=maddi');

    const cookies = response.cookies.getAll();
    expect(cookies.map((c) => c.name)).toEqual(['autodine_table_card']);
    expect(cookies[0]!.value).toBe(LIVE);
    // The session cookie is the thing that authorises an order. It must not
    // appear here.
    expect(cookies.map((c) => c.name)).not.toContain('autodine_table');
  });

  it('does not ask for the code on the way in', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          restaurant_slug: 'maddi',
          restaurant_name: 'Maddi',
          table_label: 'T3',
          window_seconds: 600,
        },
      ],
      error: null,
    });

    const response = await scan(LIVE);

    expect(response.headers.get('location')).not.toContain('/code');
  });

  it('sends a dead card to the explanation with no cookie at all', async () => {
    // public_qr_intro returns no row for a revoked card, an inactive table or
    // a restaurant that is not taking orders.
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const response = await scan(LIVE);

    expect(response.headers.get('location')).toContain('/t/problem?r=unreadable');
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it('refuses a token that is not the right shape without asking the database', async () => {
    const response = await scan('<script>');

    expect(response.headers.get('location')).toContain('/t/problem?r=unreadable');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not pretend the card failed when the database could not answer', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } });

    const response = await scan(LIVE);

    expect(response.headers.get('location')).toContain('/t/problem?r=failed');
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it('leaves an already-verified guest on the menu with no form', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          restaurant_slug: 'maddi',
          restaurant_name: 'Maddi',
          table_label: 'T3',
          window_seconds: 600,
        },
      ],
      error: null,
    });
    mocks.loadTableAccess.mockResolvedValue({
      status: 'verified',
      slug: 'maddi',
      tableLabel: 'T3',
      session: { token: 'x'.repeat(64) },
    });

    const response = await scan(LIVE);

    expect(response.headers.get('location')).toBe('http://localhost:3000/menu?s=maddi');
  });
});

describe('GET /t/<card token>, a restaurant on scan-only verification', () => {
  /**
   * Migration 20261028000900. The database decides: open_table_session answers
   * 'code' for a restaurant still on the rotating digits, and 'opened' for one
   * that chose a scan mode. This handler must act on that answer and nothing
   * else -- it never reads the mode itself.
   */
  function scanModeRpc(status: string, withToken = true) {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'public_qr_intro') {
        return {
          data: [
            { restaurant_slug: 'maddi', restaurant_name: 'Maddi', table_label: 'T3', window_seconds: 600 },
          ],
          error: null,
        };
      }
      return {
        data: [
          {
            status,
            session_token: withToken ? 'a'.repeat(64) : null,
            restaurant_slug: 'maddi',
            table_label: 'T3',
            expires_at: '2026-10-25T16:00:00.000Z',
          },
        ],
        error: null,
      };
    });
  }

  it('writes a table session when the database opens one', async () => {
    scanModeRpc('opened');
    const response = await scan(LIVE);
    const session = response.cookies.get('autodine_table');

    expect(response.status).toBe(307);
    expect(session?.value).toContain('a'.repeat(64));
    // The go-to-menu redirect is unchanged: a scan opens the menu, and the
    // code form does not appear on the way in.
    expect(response.headers.get('location')).toContain('/menu?s=maddi');
  });

  it('writes no session when the restaurant is still on the code', async () => {
    scanModeRpc('code');
    const response = await scan(LIVE);
    expect(response.cookies.get('autodine_table')).toBeUndefined();
    expect(response.cookies.get('autodine_table_card')).toBeDefined();
  });

  it('writes no session when the database refuses for any other reason', async () => {
    scanModeRpc('limited');
    const response = await scan(LIVE);
    expect(response.cookies.get('autodine_table')).toBeUndefined();
    expect(response.status).toBe(307);
  });
});

/*
 * THE THROTTLE, AT THE ROUTE.
 *
 * `open_table_session` can answer `limited` when a card or an address has been
 * opened too often this hour. The route's job is narrow and worth pinning:
 * a throttled scan must not write a session (nothing is verified by it), and it
 * must still leave the guest with a readable menu and their browse pass.
 *
 * What it does NOT prove, and cannot: that the guest is told anything useful.
 * Today they are not — that is finding 5.2, and the sentence that fixes it
 * lives in lib/scan-outcome.ts waiting for the L1 migration.
 */
describe('a throttled scan', () => {
  beforeEach(() => {
    mocks.loadTableAccess.mockResolvedValue({ status: 'browse', qrToken: LIVE });
  });

  it('writes no table session, because nothing was verified', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ status: 'limited', session_token: null, restaurant_slug: 'kabir', table_label: '7' }],
      error: null,
    });

    const response = await scan(LIVE);
    const cookies = response.headers.get('set-cookie') ?? '';

    expect(cookies).toContain('autodine_table_card');
    expect(cookies).not.toContain('autodine_table=');
    expect(response.headers.get('location')).toContain('/menu?s=kabir');
  });

  it('does not mistake a throttle for an opened session', async () => {
    // A database that returned a token alongside a non-opening status must not
    // be trusted with it: the status is the authority, not the payload.
    mocks.rpc.mockResolvedValue({
      data: [{ status: 'limited', session_token: 'a'.repeat(64), restaurant_slug: 'kabir' }],
      error: null,
    });

    const response = await scan(LIVE);
    expect(response.headers.get('set-cookie') ?? '').not.toContain('autodine_table=');
  });

  it('still sends the guest to the menu rather than an error page', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ status: 'limited' }], error: null });

    const response = await scan(LIVE);
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('location')).toContain('/menu');
    expect(response.headers.get('location')).not.toContain('/t/problem');
  });
});
