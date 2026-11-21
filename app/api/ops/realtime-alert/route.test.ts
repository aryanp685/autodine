import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getStaffContextDetailed, getSupabaseAdmin, rpc } = vi.hoisted(() => ({
  getStaffContextDetailed: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed,
  KITCHEN_ROLES: ['owner', 'manager', 'kitchen'],
}));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin }));

import { POST } from './route';

const request = (body: unknown) => new Request('http://localhost/api/ops/realtime-alert', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  body: JSON.stringify(body),
});
const owner = {
  ok: true,
  context: { restaurantId: 'synthetic-tenant', role: 'owner' },
};

beforeEach(() => {
  vi.clearAllMocks();
  getStaffContextDetailed.mockResolvedValue(owner);
  rpc.mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });
  getSupabaseAdmin.mockReturnValue({ rpc });
});

describe('POST /api/ops/realtime-alert', () => {
  it('rejects cross-origin requests before authorization', async () => {
    const response = await POST(new Request('http://localhost/api/ops/realtime-alert', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid', host: 'localhost' },
      body: JSON.stringify({ kind: 'degraded', durationMs: 60_000 }),
    }));
    expect(response.status).toBe(403);
    expect(getStaffContextDetailed).not.toHaveBeenCalled();
  });

  it('rejects untrusted fields and sub-threshold noise before authorization or logging', async () => {
    const response = await POST(request({ kind: 'degraded', durationMs: 60_000, restaurantName: 'private' }));
    expect(response.status).toBe(400);
    expect(getStaffContextDetailed).not.toHaveBeenCalled();
  });

  it('requires a signed-in kitchen-capable staff role before reserving alert budget', async () => {
    getStaffContextDetailed.mockResolvedValueOnce({ ok: false, reason: 'signed-out' });
    expect((await POST(request({ kind: 'degraded', durationMs: 60_000 }))).status).toBe(401);
    getStaffContextDetailed.mockResolvedValueOnce({ ok: true, context: { restaurantId: 'synthetic-tenant', role: 'cashier' } });
    expect((await POST(request({ kind: 'degraded', durationMs: 60_000 }))).status).toBe(403);
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('emits a privacy-minimized warning and throttles repeated reports', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await POST(request({ kind: 'degraded', durationMs: 60_000 }));
    expect(response.status).toBe(204);
    expect(rpc).toHaveBeenCalledWith('hit_rate_limit', expect.objectContaining({ p_limit: 6, p_window_seconds: 600 }));
    expect(warn).toHaveBeenCalledOnce();
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('kitchen_realtime_degraded');
    expect(message).not.toContain('synthetic-tenant');
    expect(message).not.toContain('restaurantName');

    rpc.mockResolvedValueOnce({ data: [{ allowed: false, retry_after_seconds: 50 }], error: null });
    const limited = await POST(request({ kind: 'degraded', durationMs: 60_000 }));
    expect(limited.status).toBe(204);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('returns unavailable if the shared limiter cannot be checked', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'internal' } });
    expect((await POST(request({ kind: 'recovered', durationMs: 60_000 }))).status).toBe(503);
  });
});
