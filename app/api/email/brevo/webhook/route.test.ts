import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { resetDeliveryTelemetry, snapshotDeliveryTelemetry } from '@/lib/delivery-telemetry';
import { operationalIncidents } from '@/lib/incident-registry';

/**
 * The Brevo webhook receiver: fail-closed without its secret, credential-
 * checked with it (Brevo sends no signature), and careful to keep every
 * personal field of the payload out of responses, logs and incidents.
 */

const SECRET = 'route-test-webhook-secret';

function call(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('https://autodine.example/api/email/brevo/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    }),
  );
}

const bearer = { authorization: `Bearer ${SECRET}` };

beforeEach(() => {
  process.env.BREVO_WEBHOOK_SECRET = SECRET;
  resetDeliveryTelemetry();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.BREVO_WEBHOOK_SECRET;
  vi.restoreAllMocks();
});

describe('POST /api/email/brevo/webhook', () => {
  it('fails closed with 503 while no webhook secret is configured', async () => {
    delete process.env.BREVO_WEBHOOK_SECRET;
    const response = await call(JSON.stringify({ event: 'delivered' }), bearer);
    expect(response.status).toBe(503);
    expect(snapshotDeliveryTelemetry().email.delivered).toBe(0);
  });

  it('refuses a wrong or missing credential with 401 and records nothing', async () => {
    const wrong = await call(JSON.stringify({ event: 'delivered' }), { authorization: 'Bearer nope' });
    expect(wrong.status).toBe(401);
    const missing = await call(JSON.stringify({ event: 'delivered' }));
    expect(missing.status).toBe(401);
    expect(snapshotDeliveryTelemetry().email.delivered).toBe(0);
  });

  it('refuses malformed JSON and unknown events with 400', async () => {
    expect((await call('not json', bearer)).status).toBe(400);
    expect((await call(JSON.stringify({ event: 'invoice_paid' }), bearer)).status).toBe(400);
  });

  it('records a delivered event in telemetry without echoing payload data', async () => {
    const response = await call(
      JSON.stringify({ event: 'delivered', email: 'cook@example.com', 'message-id': '<m1>', subject: 'Hi' }),
      bearer,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ received: true, event: 'delivered', outcome: 'delivered' });
    expect(JSON.stringify(body)).not.toContain('cook@example.com');
    expect(snapshotDeliveryTelemetry().email.delivered).toBe(1);
    expect(snapshotDeliveryTelemetry().email.failed).toBe(0);
  });

  it('raises a deduped, tenant-free incident for a hard bounce (camelCase accepted)', async () => {
    const payload = JSON.stringify({ event: 'hardBounce', email: 'cook@example.com', reason: 'no mailbox' });
    const first = await call(payload, { 'x-autodine-webhook-secret': SECRET });
    const second = await call(payload, { 'x-autodine-webhook-secret': SECRET });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json()).event).toBe('hard_bounce');
    expect(snapshotDeliveryTelemetry().email.failed).toBe(2);

    const incidents = operationalIncidents
      .list()
      .filter((record) => record.kind === 'email_delivery_failed');
    expect(incidents).toHaveLength(1);
    expect(incidents[0].count).toBe(2);
    expect(JSON.stringify(incidents[0])).not.toContain('cook@example.com');
  });

  it('observes engagement events without moving telemetry or incidents', async () => {
    const before = operationalIncidents.list().length;
    const response = await call(JSON.stringify({ event: 'opened', email: 'cook@example.com' }), bearer);
    expect(response.status).toBe(200);
    expect((await response.json()).outcome).toBe('observe');
    expect(snapshotDeliveryTelemetry().email.delivered).toBe(0);
    expect(snapshotDeliveryTelemetry().email.failed).toBe(0);
    expect(operationalIncidents.list().length).toBe(before);
  });
});
