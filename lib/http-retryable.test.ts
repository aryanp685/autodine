/**
 * Retry policy for outbound deliveries: permanent 4xx stops early,
 * everything transient keeps the bounded backoff.
 */

import { describe, expect, it, vi } from 'vitest';

import { HttpStatusError, isRetryableDeliveryError } from './http-retryable';
import { deliverWithRetry } from './monitoring-incidents';

describe('isRetryableDeliveryError', () => {
  it('treats 4xx (except 408/429) as permanent', () => {
    for (const status of [400, 401, 403, 404, 410, 422]) {
      expect(isRetryableDeliveryError(new HttpStatusError(status))).toBe(false);
    }
    expect(isRetryableDeliveryError(new HttpStatusError(408))).toBe(true);
    expect(isRetryableDeliveryError(new HttpStatusError(429))).toBe(true);
  });

  it('treats 5xx, timeouts and network errors as transient', () => {
    for (const status of [500, 502, 503]) {
      expect(isRetryableDeliveryError(new HttpStatusError(status))).toBe(true);
    }
    expect(isRetryableDeliveryError(new Error('socket hangup'))).toBe(true);
    expect(isRetryableDeliveryError(new TypeError('fetch failed'))).toBe(true);
  });
});

describe('deliverWithRetry with shouldRetry', () => {
  const sleep = () => Promise.resolve();

  it('returns immediately on a permanent failure without burning the budget', async () => {
    const deliver = vi.fn().mockRejectedValue(new HttpStatusError(400));
    const result = await deliverWithRetry(deliver, { maxAttempts: 3, baseDelayMs: 0, sleep, shouldRetry: isRetryableDeliveryError });
    expect(result).toEqual({ delivered: false, attempts: 1 });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure to the bound, then reports failure honestly', async () => {
    const deliver = vi.fn().mockRejectedValue(new HttpStatusError(503));
    const result = await deliverWithRetry(deliver, { maxAttempts: 3, baseDelayMs: 0, sleep, shouldRetry: isRetryableDeliveryError });
    expect(result).toEqual({ delivered: false, attempts: 3 });
    expect(deliver).toHaveBeenCalledTimes(3);
  });

  it('defaults to retrying everything when no predicate is given', async () => {
    const deliver = vi.fn().mockRejectedValue(new HttpStatusError(400));
    const result = await deliverWithRetry(deliver, { maxAttempts: 2, baseDelayMs: 0, sleep });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ delivered: false, attempts: 2 });
  });

  it('still delivers on a later attempt after a transient failure', async () => {
    const deliver = vi.fn()
      .mockRejectedValueOnce(new HttpStatusError(503))
      .mockResolvedValueOnce(undefined);
    const result = await deliverWithRetry(deliver, { maxAttempts: 3, baseDelayMs: 0, sleep, shouldRetry: isRetryableDeliveryError });
    expect(result).toEqual({ delivered: true, attempts: 2 });
  });
});
