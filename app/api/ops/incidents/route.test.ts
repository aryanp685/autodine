import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getStaffContextDetailed } = vi.hoisted(() => ({
  getStaffContextDetailed: vi.fn(),
}));

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed,
  KITCHEN_ROLES: ['owner', 'manager', 'kitchen'],
}));

const { notifyIncident } = vi.hoisted(() => ({
  notifyIncident: vi.fn(async () => 'not_configured'),
}));

vi.mock('@/lib/incident-notify', () => ({ notifyIncident }));

import { POST } from './route';
import { operationalIncidents, realtimeIncidents } from '@/lib/incident-registry';

const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/ops/incidents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...headers },
    body: JSON.stringify(body),
  });

const manager = { ok: true, context: { restaurantId: 'synthetic-tenant', role: 'manager' } };

beforeEach(() => {
  vi.clearAllMocks();
  realtimeIncidents.sweep();
  for (const incident of realtimeIncidents.list()) {
    if (incident.state !== 'resolved') realtimeIncidents.resolve(incident.incidentId, 'test-setup');
  }
  getStaffContextDetailed.mockResolvedValue(manager);
  notifyIncident.mockClear();
  notifyIncident.mockResolvedValue('not_configured');
});

const openIncident = () =>
  realtimeIncidents.report({ key: `test-${Date.now()}`, kind: 'kitchen_realtime_degraded', severity: 'warning', summary: 'Kitchen realtime delivery degraded' }).record;

describe('POST /api/ops/incidents — escalation and delivery', () => {
  it('escalates an open incident once and pushes it to the webhook', async () => {
    const incident = openIncident();
    const response = await POST(request({ action: 'escalate', incidentId: incident.incidentId }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.incident.severity).toBe('critical');
    expect(body.incident.escalatedAt).not.toBeNull();
    expect(body.delivery).toBe('not_configured');
    expect(notifyIncident).toHaveBeenCalledWith('incident_escalated', expect.objectContaining({ incidentId: incident.incidentId }));

    notifyIncident.mockClear();
    const again = await POST(request({ action: 'escalate', incidentId: incident.incidentId }));
    const body2 = await again.json();
    expect(body2.delivery).toBe('already_escalated');
    expect(notifyIncident).not.toHaveBeenCalled(); // never pushed twice
  });

  it('acknowledge and resolve also push to the webhook, once each', async () => {
    const incident = openIncident();
    const ack = await POST(request({ action: 'acknowledge', incidentId: incident.incidentId }));
    expect(ack.status).toBe(200);
    expect(notifyIncident).toHaveBeenCalledWith('incident_acknowledged', expect.anything());

    notifyIncident.mockClear();
    const resolved = await POST(request({ action: 'resolve', incidentId: incident.incidentId }));
    expect(resolved.status).toBe(200);
    expect(notifyIncident).toHaveBeenCalledWith('incident_resolved', expect.anything());
  });

  it('escalation of an unknown incident reports 409 and pushes nothing', async () => {
    const response = await POST(request({ action: 'escalate', incidentId: 'nope' }));
    expect(response.status).toBe(409);
    expect(notifyIncident).not.toHaveBeenCalled();
  });
});

describe('POST /api/ops/incidents', () => {
  it('rejects cross-origin requests before authorization', async () => {
    const response = await POST(request({ action: 'list' }, { origin: 'https://attacker.invalid' }));
    expect(response.status).toBe(403);
    expect(getStaffContextDetailed).not.toHaveBeenCalled();
  });

  it('rejects unknown actions and junk bodies before authorization', async () => {
    expect((await POST(request({ action: 'delete-everything' }))).status).toBe(400);
    expect((await POST(request('not an object'))).status).toBe(400);
    expect(getStaffContextDetailed).not.toHaveBeenCalled();
  });

  it('requires a signed-in owner or manager, and never trusts the client for that', async () => {
    getStaffContextDetailed.mockResolvedValueOnce({ ok: false, reason: 'signed-out' });
    expect((await POST(request({ action: 'list' }))).status).toBe(401);
    getStaffContextDetailed.mockResolvedValueOnce({ ok: false, reason: 'unconfigured' });
    expect((await POST(request({ action: 'list' }))).status).toBe(503);
    for (const role of ['cashier', 'kitchen']) {
      getStaffContextDetailed.mockResolvedValueOnce({ ok: true, context: { restaurantId: 'synthetic-tenant', role } });
      expect((await POST(request({ action: 'list' }))).status).toBe(403);
    }
    getStaffContextDetailed.mockResolvedValueOnce({ ok: true, context: { restaurantId: 'synthetic-tenant', role: 'owner' } });
    expect((await POST(request({ action: 'list' }))).status).toBe(200);
  });

  it('lists live incidents for the instance without tenant or credential material', async () => {
    const record = openIncident();
    const response = await POST(request({ action: 'list' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    const found = body.incidents.find((incident: { incidentId: string }) => incident.incidentId === record.incidentId);
    expect(found).toBeDefined();
    expect(JSON.stringify(body)).not.toContain('synthetic-tenant');
  });

  it('lists operational incidents next to realtime ones, and can acknowledge them', async () => {
    const { record } = operationalIncidents.report({
      key: `test-ops-${Date.now()}`,
      kind: 'staff_invitation_email_failed',
      severity: 'warning',
      summary: 'Staff invitation email delivery failed',
    });
    try {
      const listResponse = await POST(request({ action: 'list' }));
      const listBody = await listResponse.json();
      const found = listBody.incidents.find(
        (incident: { incidentId: string }) => incident.incidentId === record.incidentId,
      );
      expect(found).toMatchObject({ kind: 'staff_invitation_email_failed', state: 'open' });

      const ackResponse = await POST(request({ action: 'acknowledge', incidentId: record.incidentId }));
      expect(ackResponse.status).toBe(200);
      const ackBody = await ackResponse.json();
      expect(ackBody.incident).toMatchObject({ incidentId: record.incidentId, state: 'acknowledged' });
    } finally {
      if (record.state !== 'resolved') operationalIncidents.resolve(record.incidentId, 'test-cleanup');
    }
  });

  it('carries tenant-free delivery telemetry alongside the list', async () => {
    const response = await POST(request({ action: 'list' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.telemetry).toBeDefined();
    for (const channel of ['email', 'alert'] as const) {
      expect(body.telemetry[channel]).toEqual(expect.objectContaining({
        delivered: expect.any(Number),
        failed: expect.any(Number),
        notConfigured: expect.any(Number),
        refused: expect.any(Number),
        attempts: expect.any(Number),
        consecutiveFailures: expect.any(Number),
      }));
    }
    expect(JSON.stringify(body.telemetry)).not.toContain('synthetic-tenant');
  });

  it('acknowledges an open incident exactly once and refuses a second acknowledge', async () => {
    const record = openIncident();
    const response = await POST(request({ action: 'acknowledge', incidentId: record.incidentId }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.incident.state).toBe('acknowledged');
    expect(body.incident.acknowledgedBy).toBe('manager');

    expect((await POST(request({ action: 'acknowledge', incidentId: record.incidentId }))).status).toBe(409);
  });

  it('resolves an acknowledged incident and refuses to resolve it again', async () => {
    const record = openIncident();
    await POST(request({ action: 'acknowledge', incidentId: record.incidentId }));
    const response = await POST(request({ action: 'resolve', incidentId: record.incidentId }));
    expect(response.status).toBe(200);
    expect((await response.json()).incident.state).toBe('resolved');
    expect((await POST(request({ action: 'resolve', incidentId: record.incidentId }))).status).toBe(409);
  });

  it('answers 409 with a generic sentence for an unknown incident and never reveals state', async () => {
    const response = await POST(request({ action: 'acknowledge', incidentId: 'does-not-exist' }));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain('does-not-exist');
  });

  it('requires a bounded incident id for mutating actions', async () => {
    expect((await POST(request({ action: 'resolve' }))).status).toBe(400);
    expect((await POST(request({ action: 'resolve', incidentId: 'x'.repeat(200) }))).status).toBe(400);
  });
});
