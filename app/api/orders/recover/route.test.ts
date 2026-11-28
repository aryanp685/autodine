import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  recover: vi.fn(),
  budget: vi.fn(),
}));

vi.mock('@/lib/db/order-recovery', () => ({
  recoverGuestOrderAttempt: mocks.recover,
}));

vi.mock('@/lib/server/guest-recover-rate-limit', () => ({
  consumeGuestRecoverBudget: mocks.budget,
}));

const { GET, POST } = await import('./route');

const TOKEN = '11111111-1111-4111-8111-111111111111';

function post(body: unknown) {
  return new NextRequest('https://example.test/api/orders/recover', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/orders/recover', () => {
  beforeEach(() => {
    mocks.recover.mockReset();
    mocks.budget.mockReset();
    mocks.budget.mockResolvedValue({ state: 'allow' });
  });

  it('rejects GET so the bearer attempt token never leaks into URLs or logs', () => {
    const res = GET();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('rejects malformed or missing tokens with 400', async () => {
    const res = await POST(post({ s: 'maddi', attempt: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it('returns 503 when the database is unavailable so client keeps pending state', async () => {
    mocks.recover.mockResolvedValue({ kind: 'unavailable', message: 'db down' });
    const res = await POST(post({ s: 'maddi', attempt: TOKEN }));
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('returns found:true with the server order identity when already accepted', async () => {
    mocks.recover.mockResolvedValue({
      kind: 'found',
      orderId: 'ord-uuid-1',
      code: 'MA-9K2P1',
      placedAt: '2026-11-20T12:00:00Z',
      prepStatus: 'new',
      awaitingConfirmation: false,
      tableLabel: 'T2',
    });

    const res = await POST(post({ s: 'maddi', attempt: TOKEN }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      found: true,
      orderId: 'ord-uuid-1',
      code: 'MA-9K2P1',
      placedAt: '2026-11-20T12:00:00Z',
      prepStatus: 'new',
      awaitingConfirmation: false,
      tableLabel: 'T2',
    });
  });

  it('returns found:false when no server order exists for the attempt', async () => {
    mocks.recover.mockResolvedValue({ kind: 'not_found' });
    const res = await POST(post({ s: 'maddi', attempt: TOKEN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, found: false });
  });

  it('answers 429 with a wait once the caller budget is spent, before touching the database', async () => {
    mocks.budget.mockResolvedValue({ state: 'limited', retryAfterSeconds: 240 });

    const res = await POST(post({ s: 'maddi', attempt: TOKEN }));

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('240');
    expect(await res.json()).toEqual({ ok: false, reason: 'too_many' });
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it('still recovers the order when the limiter itself cannot answer', async () => {
    mocks.budget.mockResolvedValue({ state: 'unavailable' });
    mocks.recover.mockResolvedValue({ kind: 'not_found' });

    const res = await POST(post({ s: 'maddi', attempt: TOKEN }));

    expect(res.status).toBe(200);
    expect(mocks.recover).toHaveBeenCalledTimes(1);
  });

  it('does not spend budget on a malformed request', async () => {
    const res = await POST(post({ s: 'maddi', attempt: 'not-a-uuid' }));

    expect(res.status).toBe(400);
    expect(mocks.budget).not.toHaveBeenCalled();
  });
});
