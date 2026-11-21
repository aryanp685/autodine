import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  probeHealth: vi.fn(),
  probeOperationalSchema: vi.fn(),
  isReady: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  isSupabaseConfigured: true,
  isSupabaseAdminConfigured: true,
}));

vi.mock('@/lib/health', () => ({
  probeHealth: mocks.probeHealth,
  probeOperationalSchema: mocks.probeOperationalSchema,
  isReady: mocks.isReady,
}));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('@/lib/supabase/env', () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
  isSupabaseAdminConfigured: mocks.isSupabaseAdminConfigured,
}));
vi.mock('@/lib/plans', () => ({ BILLING: { trialDays: 14 } }));

import { GET } from './route';

const HEALTH = {
  configured: true,
  serverKey: true,
  reachable: true,
  credentialProbe: null,
  credentials: 'accepted' as const,
  schema: { trialAndWriteGate: 'applied', planEntitlements: 'applied', restaurantUpi: 'applied' },
  trialDays: 14,
};
const OPERATIONAL = { orderSessions: 'applied', settlement: 'applied', invoices: 'applied', paymentReceipts: 'applied', announcementClaims: 'applied' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.probeHealth.mockResolvedValue(HEALTH);
  mocks.probeOperationalSchema.mockResolvedValue(OPERATIONAL);
  mocks.isReady.mockReturnValue(true);
  mocks.getSupabaseAdmin.mockReturnValue(null);
  mocks.createSupabaseServerClient.mockResolvedValue(null);
});

describe('GET /api/health', () => {
  it('returns 200 with fixed-vocabulary booleans and no alert line when ready', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns 503 and emits one privacy-minimized critical alert when unready', async () => {
    mocks.isReady.mockReturnValue(false);
    mocks.probeOperationalSchema.mockResolvedValue({ ...OPERATIONAL, invoices: 'missing' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await GET();
    expect(response.status).toBe(503);
    expect(warn).toHaveBeenCalledOnce();
    const line = String(warn.mock.calls[0][0]);
    expect(line.startsWith('[autodine:alert] ')).toBe(true);
    const parsed = JSON.parse(line.slice('[autodine:alert] '.length));
    expect(parsed).toMatchObject({ event: 'health_check_failed', severity: 'critical', credentials: 'accepted' });
    expect(parsed.schema.invoices).toBe('missing');
    // The probe keys themselves (e.g. restaurantUpi) are fixed public vocabulary;
    // no tenant values, JWTs, or secrets may appear.
    expect(line).not.toMatch(/eyJ|password|secret|@example|synthetic/i);
    warn.mockRestore();
  });
});
