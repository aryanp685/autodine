/**
 * Push delivery for operational alerts — the one outbound integration.
 *
 * WHAT THIS IS
 *
 * Every incident already lands in the structured log, which is the durable
 * record. This module additionally POSTs a fixed-shape, tenant-free payload to
 * an owner-configured webhook (a chat incoming webhook, a push service, an
 * alertmanager, a ticket hook — whatever speaks HTTPS POST JSON) so a failure
 * is observable without somebody reading logs.
 *
 * WHAT IT REFUSES TO DO
 *
 * - No webhook configured: say `not_configured` and move on. Nothing else
 *   changes; the log lines still happen.
 * - No tenant, user or restaurant data in the payload. Ever. The payload is
 *   the same fixed vocabulary the log line carries.
 * - Never throws. A webhook outage is an `failed` outcome in the log, not a
 *   500 in front of a cook.
 * - No retries beyond deliverWithRetry's bounded backoff; alert storms are
 *   capped by the tracker's dedup before they reach here.
 */

import { deliverWithRetry, type IncidentRecord } from './monitoring-incidents';

export type AlertEvent =
  | 'incident_opened'
  | 'incident_reopened'
  | 'incident_escalated'
  | 'incident_acknowledged'
  | 'incident_resolved'
  | 'health_check_failed';

export type AlertNotifyOutcome = 'delivered' | 'failed' | 'not_configured' | 'invalid_config';

export type HealthAlertPayload = {
  event: 'health_check_failed';
  severity: 'critical';
  configured: boolean;
  serverKey: boolean;
  reachable: boolean;
  credentials: string;
  credentialProbe: string | null;
  schema: Record<string, string>;
};

const TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;

type WebhookResolution = { url: URL } | { error: 'not_configured' | 'invalid_config' };

export function getAlertWebhook(env: Record<string, string | undefined> = process.env): WebhookResolution {
  const raw = env.AUTODINE_ALERT_WEBHOOK?.trim() ?? '';
  if (!raw) return { error: 'not_configured' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'invalid_config' };
  }
  // HTTPS only. http leaks the payload on the wire; other schemes are refused.
  if (url.protocol !== 'https:' || !url.hostname) return { error: 'invalid_config' };
  return { url };
}

function logDelivery(event: AlertEvent, outcome: AlertNotifyOutcome, attempts: number, status?: number): void {
  const line = JSON.stringify({ event: 'alert_delivery', incidentEvent: event, outcome, attempts, ...(status ? { status } : {}) });
  if (outcome === 'delivered' || outcome === 'not_configured') console.info(`[autodine:alert] ${line}`);
  else console.warn(`[autodine:alert] ${line}`);
}

/** POST a fixed payload to the configured webhook. Shared by incident and health alerts. */
export async function postAlert(
  event: AlertEvent,
  payload: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
): Promise<AlertNotifyOutcome> {
  const resolved = getAlertWebhook(env);
  if ('error' in resolved) {
    logDelivery(event, resolved.error, 0);
    return resolved.error;
  }
  let lastStatus: number | undefined;
  const result = await deliverWithRetry(async () => {
    const response = await fetch(resolved.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    lastStatus = response.status;
    if (!response.ok) throw new Error(`Alert webhook responded ${response.status}`);
  }, { maxAttempts: MAX_ATTEMPTS, baseDelayMs: 300 });
  const outcome: AlertNotifyOutcome = result.delivered ? 'delivered' : 'failed';
  logDelivery(event, outcome, result.attempts, lastStatus);
  return outcome;
}

/** Incident → webhook. The payload is exactly the fixed incident vocabulary. */
export async function notifyIncident(
  event: Exclude<AlertEvent, 'health_check_failed'>,
  record: IncidentRecord,
  env: Record<string, string | undefined> = process.env,
): Promise<AlertNotifyOutcome> {
  return postAlert(event, {
    event,
    incidentId: record.incidentId,
    kind: record.kind,
    severity: record.severity,
    state: record.state,
    count: record.count,
    summary: record.summary,
    firstSeenAt: new Date(record.firstSeenAt).toISOString(),
    lastSeenAt: new Date(record.lastSeenAt).toISOString(),
    ...(record.escalatedAt
      ? { escalatedAt: new Date(record.escalatedAt).toISOString(), escalatedBy: record.escalatedBy }
      : {}),
  }, env);
}

/** Health failure → webhook. Mirrors formatHealthAlertLine's fixed shape. */
export async function notifyHealthFailure(
  input: Omit<HealthAlertPayload, 'event' | 'severity'>,
  env: Record<string, string | undefined> = process.env,
): Promise<AlertNotifyOutcome> {
  return postAlert('health_check_failed', {
    event: 'health_check_failed',
    severity: 'critical',
    configured: input.configured,
    serverKey: input.serverKey,
    reachable: input.reachable,
    credentials: input.credentials,
    credentialProbe: input.credentialProbe,
    schema: input.schema,
  }, env);
}
