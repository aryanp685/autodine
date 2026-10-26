import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The status endpoint, called the way the browser calls it.
 *
 * The two things worth guarding here are the ones a passing UI test cannot see:
 * what the endpoint will answer for a token that belongs to somebody else's
 * order, and what it leaks in the response body.
 */

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock('@/lib/db/order-status', () => ({
  readGuestOrderStatus: mocks.read,
}));

import { GET, POST } from './route';

const TOKEN = '3f1c9f52-8f0e-4a5f-9a6b-2c1d4e5f6a7b';

function post(body: unknown) {
  return POST(
    new Request('https://autodine.test/menu/orders/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }) as never,
  );
}

const valid = { s: 'kings-of-kings', code: 'KI-ABC12', t: TOKEN };

beforeEach(() => {
  mocks.read.mockReset();
  mocks.read.mockResolvedValue({
    kind: 'ok',
    snapshot: {
      status: 'preparing',
      awaitingConfirmation: false,
      paymentStatus: 'pending',
      placedAt: '2026-10-26T10:00:00.000Z',
      checkedAt: '2026-10-26T10:01:00.000Z',
    },
  });
});

describe('a status read', () => {
  it('answers with the status and nothing else', async () => {
    const response = await post(valid);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      status: 'preparing',
      awaitingConfirmation: false,
      paymentStatus: 'pending',
      placedAt: '2026-10-26T10:00:00.000Z',
      checkedAt: '2026-10-26T10:01:00.000Z',
    });

    // No bill, no table, no lines, and above all no token coming back.
    expect(JSON.stringify(json)).not.toContain(TOKEN);
    expect(json).not.toHaveProperty('tableLabel');
    expect(json).not.toHaveProperty('lines');
    expect(json).not.toHaveProperty('totalPaise');
  });

  it('passes all three credentials to the database, never an id', async () => {
    await post(valid);
    expect(mocks.read).toHaveBeenCalledWith({
      slug: 'kings-of-kings',
      code: 'KI-ABC12',
      token: TOKEN,
    });
  });

  it('can never be cached', async () => {
    const response = await post(valid);
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
  });
});

describe('a request that cannot name an order', () => {
  it.each([
    ['no body', { s: 'x', code: 'y' }],
    ['no token', { s: 'x', code: 'y', t: '' }],
    ['not json', 'not json at all'],
    ['null', null],
  ])('is refused before the database is asked (%s)', async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: false, reason: 'bad_request' });
  });
});

describe('when the order is not there', () => {
  it('stops the client without pretending the read failed', async () => {
    mocks.read.mockResolvedValue({ kind: 'not_found' });

    const response = await post(valid);
    const json = await response.json();

    // 200, not 404: a 404 would be retried by the client's error path and the
    // screen would sit on "Reconnecting" for a token that can never work.
    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('when the database will not answer', () => {
  it('says so with a 503 so the client backs off and retries', async () => {
    mocks.read.mockResolvedValue({ kind: 'unavailable', message: 'connection refused' });

    const response = await post(valid);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: 'unavailable' });
    // The database's own words stay server-side: they can name internal objects.
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
  });
});

describe('the method', () => {
  it('refuses GET, so the token has no route into a URL', async () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});
