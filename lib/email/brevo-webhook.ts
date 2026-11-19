/**
 * Brevo transactional webhook events — parsing and caller verification.
 *
 * Brevo does NOT sign webhook payloads (no HMAC header exists to verify).
 * Its documented protections are a bearer token or custom headers set when
 * the webhook is created, plus optional source-IP allowlisting at the edge.
 * This module implements the credential half: a shared secret the owner puts
 * in the Brevo webhook's auth settings and in `BREVO_WEBHOOK_SECRET` here,
 * compared in constant time. An unconfigured secret means the route refuses
 * every call — a webhook nobody configured must not become an open POST
 * endpoint that can move telemetry or raise incidents.
 *
 * Events are monitoring-only. Nothing here changes account, membership or
 * billing state, and nothing keeps the recipient address, subject, link or
 * message id from the payload: the vocabulary below is all that survives.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** Fixed event vocabulary (payload spellings, normalized to snake_case). */
const KNOWN_EVENTS = new Set([
  'request',
  'delivered',
  'deferred',
  'soft_bounce',
  'hard_bounce',
  'invalid_email',
  'blocked',
  'error',
  'spam',
  'unsubscribed',
  'opened',
  'unique_opened',
  'click',
  'proxy_open',
  'unique_proxy_open',
]);

/** Events that mean a message permanently failed or was reported. */
const FAILURE_EVENTS = new Set(['hard_bounce', 'invalid_email', 'blocked', 'error', 'spam']);

export type BrevoWebhookClassification = {
  /** Normalized event word, e.g. `hard_bounce`. */
  event: string;
  /** What the receiver does with it. */
  action: 'delivered' | 'failed' | 'observe';
  /** Incident kind for `failed` events; null otherwise. */
  incidentKind: 'email_delivery_failed' | 'email_spam_complaint' | null;
  severity: 'warning' | 'critical' | null;
};

function normalizeEvent(value: unknown): string {
  const raw = String(value ?? '').trim();
  // Brevo subscribes with camelCase names (hardBounce) but posts snake_case
  // (hard_bounce); accept both and keep one internal vocabulary.
  return raw.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().slice(0, 40);
}

/**
 * Validate and classify one webhook payload. The payload's recipient,
 * subject, links and identifiers are deliberately discarded here — callers
 * receive only the fixed classification.
 */
export function parseBrevoWebhookEvent(payload: unknown): BrevoWebhookClassification | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const event = normalizeEvent((payload as Record<string, unknown>).event);
  if (!KNOWN_EVENTS.has(event)) return null;
  if (event === 'delivered') return { event, action: 'delivered', incidentKind: null, severity: null };
  if (FAILURE_EVENTS.has(event)) {
    return event === 'spam'
      ? { event, action: 'failed', incidentKind: 'email_spam_complaint', severity: 'critical' }
      : { event, action: 'failed', incidentKind: 'email_delivery_failed', severity: 'warning' };
  }
  return { event, action: 'observe', incidentKind: null, severity: null };
}

function equalSecret(candidate: string, secret: string): boolean {
  if (!candidate || !secret) return false;
  // Hash both sides so the comparison is constant-time AND length-hiding;
  // comparing raw strings would leak the secret's length through timing.
  const left = createHash('sha256').update(candidate).digest();
  const right = createHash('sha256').update(secret).digest();
  return timingSafeEqual(left, right);
}

/**
 * Verify the credential Brevo was configured to send: either
 * `Authorization: Bearer <secret>` (Brevo webhook "bearer" auth) or the
 * custom header `x-autodine-webhook-secret` (Brevo custom-header auth).
 */
export function verifyBrevoWebhookCredential(
  headers: { authorization?: string | null; customSecret?: string | null },
  secret: string,
): boolean {
  const expected = secret.trim();
  if (!expected) return false;
  const bearer = /^Bearer\s+(.+)$/i.exec(headers.authorization?.trim() ?? '')?.[1]?.trim() ?? '';
  if (bearer && equalSecret(bearer, expected)) return true;
  return equalSecret(headers.customSecret?.trim() ?? '', expected);
}
