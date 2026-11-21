/**
 * Decide whether a failed outbound delivery deserves another attempt.
 *
 * WHY
 *
 * `deliverWithRetry` is deliberately provider-agnostic: it cannot know that a
 * 400 from a webhook is a misconfiguration that will never succeed, while a
 * 503 from the same webhook will. Retrying a permanent failure burns the
 * bounded attempt budget on something that cannot work and delays the honest
 * `failed` outcome — and for a webhook that rejects every call with 4xx, it
 * triples the request rate against an endpoint that already said no.
 *
 * THE RULE
 *
 * - 4xx (except 408 Request Timeout and 429 Too Many Requests) is permanent:
 *   the request, the key or the address is wrong. No retry.
 * - 408/429/5xx, timeouts, DNS failures and connection resets are transient:
 *   bounded retry as before.
 * - Anything that is not an HttpStatusError is treated as transient (network
 *   class), which is the old behaviour.
 */

export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

/** True when the failure looks transient and a bounded retry is worthwhile. */
export function isRetryableDeliveryError(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    const status = error.status;
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
    return true;
  }
  return true;
}
