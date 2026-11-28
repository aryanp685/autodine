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

vi.mock('@/lib/health', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/health')>();
  return {
    ...actual,
    probeHealth: mocks.probeHealth,
    probeOperationalSchema: mocks.probeOperationalSchema,
    isReady: mocks.isReady,
  };
});
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

describe('GET /api/health schema detail', () => {
  const SECRET = 'monitor-secret-long-enough';
  const withSecret = () => new Request('http://localhost/api/health', { headers: { 'x-health-secret': SECRET } });

  it('returns only ok to an anonymous caller, even when the deployment is ready', async () => {
    vi.stubEnv('HEALTH_SECRET', SECRET);
    const response = await GET(new Request('http://localhost/api/health'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, checkedAt: expect.any(String) });
    expect(JSON.stringify(body)).not.toMatch(/schema|trialAndWriteGate|serverKey|credentialProbe/);
    vi.unstubAllEnvs();
  });

  it('returns only ok when no monitor secret is configured at all', async () => {
    vi.stubEnv('HEALTH_SECRET', '');
    const response = await GET(withSecret());
    const body = await response.json();
    expect(body.schema).toBeUndefined();
    expect(body.ok).toBe(true);
    vi.unstubAllEnvs();
  });

  it('refuses a wrong or truncated secret', async () => {
    vi.stubEnv('HEALTH_SECRET', SECRET);
    const wrong = await GET(new Request('http://localhost/api/health', { headers: { 'x-health-secret': SECRET.slice(0, 10) } }));
    expect((await wrong.json()).schema).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('shows the probe map to the monitor that presents the secret', async () => {
    vi.stubEnv('HEALTH_SECRET', SECRET);
    const response = await GET(withSecret());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.schema).toMatchObject({ trialAndWriteGate: 'applied' });
    expect(body.operational).toMatchObject({ invoices: 'applied' });
    vi.unstubAllEnvs();
  });
});
