/**
 * Delivery telemetry for outbound integrations — in-process counters.
 *
 * WHAT THIS IS
 *
 * Every outbound delivery AutoDine attempts already writes one structured log
 * line (`email_delivery` / `alert_delivery`). This module keeps the same
 * fixed, tenant-free vocabulary in memory as counters so that Settings →
 * Operations can answer "what happened to the last attempts on this instance?"
 * without anyone tailing logs — and so a failing webhook is visible instead of
 * silently rotting behind a green log page.
 *
 * WHAT IT IS NOT
 *
 * - Not a durable record. Counters are per server instance and reset on
 *   restart. The structured log line remains the durable record; the panel is
 *   a window.
 * - Not a store of addresses, payloads or identifiers. Outcomes are the fixed
 *   vocabulary the log lines already carry (`delivered`, `failed`,
 *   `not_configured`, …). Nothing else is kept.
 * - Not a health oracle. `consecutiveFailures` is a hint, not an SLO verdict.
 */

export type DeliveryChannel = 'email' | 'alert';

export type DeliveryCounters = {
  /** Successful deliveries (provider accepted the message). */
  delivered: number;
  /** Attempts that exhausted their bounded retries without delivery. */
  failed: number;
  /** Attempts refused because no provider/webhook is configured. */
  notConfigured: number;
  /** Attempts refused before the network (bad address, malformed webhook config). */
  refused: number;
  /** Total network attempts (retries counted). */
  attempts: number;
  /** Deliveries that failed in a row, on this instance. Reset by any success. */
  consecutiveFailures: number;
  /** The most recent outcome word, or null before the first attempt. */
  lastOutcome: string | null;
  /** Epoch millis of the most recent attempt, or null. */
  lastAt: number | null;
};

const empty = (): DeliveryCounters => ({
  delivered: 0,
  failed: 0,
  notConfigured: 0,
  refused: 0,
  attempts: 0,
  consecutiveFailures: 0,
  lastOutcome: null,
  lastAt: null,
});

const counters: Record<DeliveryChannel, DeliveryCounters> = {
  email: empty(),
  alert: empty(),
};

/**
 * Record one delivery outcome. `outcome` is the fixed vocabulary each caller
 * already logs; unknown words are counted as `failed` for the tally (but the
 * word itself is what is reported in `lastOutcome`, capped at 40 chars).
 */
export function recordDelivery(
  channel: DeliveryChannel,
  outcome: string,
  attempts: number,
  now: number = Date.now(),
): void {
  const bucket = counters[channel];
  const word = String(outcome ?? 'failed').trim().slice(0, 40) || 'failed';
  const countedAttempts = Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0;
  bucket.attempts += countedAttempts;
  bucket.lastOutcome = word;
  bucket.lastAt = now;
  if (word === 'delivered') {
    bucket.delivered += 1;
    bucket.consecutiveFailures = 0;
    return;
  }
  if (word === 'not_configured' || word === 'invalid_config') {
    bucket.notConfigured += 1;
    // Configuration gaps are not delivery failures; do not page anyone.
    return;
  }
  if (word === 'invalid_recipient') {
    bucket.refused += 1;
    return;
  }
  bucket.failed += 1;
  bucket.consecutiveFailures += 1;
}

/** A tenant-free snapshot of both channels. Copies; callers cannot mutate. */
export function snapshotDeliveryTelemetry(): Record<DeliveryChannel, DeliveryCounters> {
  return {
    email: { ...counters.email },
    alert: { ...counters.alert },
  };
}

/** Test-only reset. Production code never calls this. */
export function resetDeliveryTelemetry(): void {
  counters.email = empty();
  counters.alert = empty();
}
