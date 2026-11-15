import { beforeEach, describe, expect, it, vi } from 'vitest';

const { notifyIncident } = vi.hoisted(() => ({
  notifyIncident: vi.fn(async () => 'not_configured'),
}));

vi.mock('@/lib/incident-notify', () => ({ notifyIncident }));

import { GET } from './route';
import { realtimeIncidents } from '@/lib/incident-registry';

/**
 * The cron endpoint is the only scheduled alert path. Fail closed: no secret
 * configured → 503; wrong token → 401; correct token → stale open incidents
 * are escalated exactly once.
 */

const request = (auth?: string) =>
  new Request('http://localhost/api/cron/escalate', {
    method: 'GET',
    headers: auth ? { authorization: auth } : {},
  });

const reportStale = () => {
  // Report an incident "an hour ago" by freezing Date.now, then restore it so
  // the route's staleness check sees a full hour of age.
  const realNow = Date.now();
  const past = realNow - 60 * 60 * 1000;
  const spy = vi.spyOn(Date, 'now').mockReturnValue(past);
  const record = realtimeIncidents.report({
    key: `cron-test-${realNow}-${Math.random()}`,
    kind: 'kitchen_realtime_degraded',
    severity: 'warning',
    summary: 'Kitchen realtime delivery degraded',
  }).record;
  spy.mockRestore();
  return record;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  for (const incident of realtimeIncidents.list()) {
    if (incident.state !== 'resolved') realtimeIncidents.resolve(incident.incidentId, 'test-setup');
  }
  // Make everything reported in a test "stale" by back-dating via a fresh tracker is not
  // possible on the shared registry, so tests use the real threshold but a mocked Date.
});

describe('GET /api/cron/escalate', () => {
  it('fails closed when no cron secret is configured', async () => {
    delete process.env.AUTODINE_CRON_SECRET;
    delete process.env.CRON_SECRET;
    const response = await GET(request('Bearer anything'));
    expect(response.status).toBe(503);
    expect(notifyIncident).not.toHaveBeenCalled();
  });

  it('rejects a missing or wrong token with 401', async () => {
    process.env.AUTODINE_CRON_SECRET = 'test-secret-123';
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('Bearer wrong-secret-123'))).status).toBe(401);
    expect(notifyIncident).not.toHaveBeenCalled();
  });

  it('does not escalate a fresh incident', async () => {
    process.env.AUTODINE_CRON_SECRET = 'test-secret-123';
    const fresh = realtimeIncidents.report({
      key: `cron-fresh-${Date.now()}`,
      kind: 'kitchen_realtime_degraded',
      severity: 'warning',
      summary: 'Kitchen realtime delivery degraded',
    }).record;
    const response = await GET(request('Bearer test-secret-123'));
    expect(response.status).toBe(200);
    expect((await response.json()).escalated).toBe(0);
    expect(notifyIncident).not.toHaveBeenCalled();
    expect(realtimeIncidents.get(fresh.incidentId)?.state).toBe('open');
  });

  it('escalates a stale open incident to critical and pushes it, exactly once', async () => {
    process.env.AUTODINE_CRON_SECRET = 'test-secret-123';
    const stale = reportStale();

    const response = await GET(request('Bearer test-secret-123'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.escalated).toBe(1);
    expect(realtimeIncidents.get(stale.incidentId)?.severity).toBe('critical');
    expect(notifyIncident).toHaveBeenCalledWith('incident_escalated', expect.objectContaining({ incidentId: stale.incidentId }));

    // A second cron pass finds nothing new to escalate.
    notifyIncident.mockClear();
    const second = await GET(request('Bearer test-secret-123'));
    expect((await second.json()).escalated).toBe(0);
    expect(notifyIncident).not.toHaveBeenCalled();
  });
});
