import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAlertWebhook, notifyIncident, notifyHealthFailure } from './incident-notify';
import type { IncidentRecord } from './monitoring-incidents';

/**
 * The webhook push is the one outbound alert path. These tests pin the
 * decision table: no webhook → nothing is sent and nothing claims to have
 * been; invalid webhook → invalid_config; provider failure → failed, honestly.
 * No network is touched — fetch is stubbed.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const record: IncidentRecord = {
  incidentId: 'inc-1',
  kind: 'kitchen_realtime_degraded',
  severity: 'critical',
  state: 'open',
  count: 3,
  summary: 'Kitchen realtime delivery degraded',
  firstSeenAt: 1_800_000_000_000,
  lastSeenAt: 1_800_000_600_000,
  acknowledgedBy: null,
  acknowledgedAt: null,
  resolvedBy: null,
  resolvedAt: null,
  escalatedAt: 1_800_000_700_000,
  escalatedBy: 'cron',
};

describe('getAlertWebhook', () => {
  it('is not_configured when unset, invalid_config for junk and non-https', () => {
    expect(getAlertWebhook({})).toEqual({ error: 'not_configured' });
    expect(getAlertWebhook({ AUTODINE_ALERT_WEBHOOK: '   ' })).toEqual({ error: 'not_configured' });
    expect(getAlertWebhook({ AUTODINE_ALERT_WEBHOOK: 'not a url' })).toEqual({ error: 'invalid_config' });
    expect(getAlertWebhook({ AUTODINE_ALERT_WEBHOOK: 'http://hooks.example/x' })).toEqual({ error: 'invalid_config' });
    expect(getAlertWebhook({ AUTODINE_ALERT_WEBHOOK: 'ftp://hooks.example/x' })).toEqual({ error: 'invalid_config' });
    expect(getAlertWebhook({ AUTODINE_ALERT_WEBHOOK: 'https://hooks.example/services/abc' })).toHaveProperty('url');
  });
});

describe('notifyIncident', () => {
  it('sends nothing and claims nothing without a webhook', async () => {
    const outcome = await notifyIncident('incident_escalated', record, {});
    expect(outcome).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the fixed vocabulary, never the dedup key or tenant data', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    const outcome = await notifyIncident('incident_escalated', record, {
      AUTODINE_ALERT_WEBHOOK: 'https://hooks.example/services/abc',
    });
    expect(outcome).toBe('delivered');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://hooks.example/services/abc');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ event: 'incident_escalated', kind: 'kitchen_realtime_degraded', severity: 'critical' });
    expect(body.escalatedBy).toBe('cron');
    expect(JSON.stringify(body)).not.toContain('kitchen-realtime:');
  });

  it('reports failed after bounded retries when the webhook rejects', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const outcome = await notifyIncident('incident_opened', record, {
      AUTODINE_ALERT_WEBHOOK: 'https://hooks.example/services/abc',
    });
    expect(outcome).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 15000);

  it('does not retry a permanent 4xx: one call, honest failed outcome', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    const outcome = await notifyIncident('incident_opened', record, {
      AUTODINE_ALERT_WEBHOOK: 'https://hooks.example/services/abc',
    });
    expect(outcome).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 15000);
});

describe('notifyHealthFailure', () => {
  const fixed = {
    configured: true,
    serverKey: true,
    reachable: false,
    credentials: 'unknown',
    credentialProbe: null,
    schema: { core_tables: 'missing' },
  };

  it('posts the health payload only when a webhook is configured', async () => {
    expect(await notifyHealthFailure(fixed, {})).toBe('not_configured');
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    expect(await notifyHealthFailure(fixed, { AUTODINE_ALERT_WEBHOOK: 'https://hooks.example/h' })).toBe('delivered');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ event: 'health_check_failed', severity: 'critical', reachable: false });
  });
});
