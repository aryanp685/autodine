/**
 * Delivery telemetry: the fixed, tenant-free counters behind
 * Settings → Operations. Records outcomes as they are reported; never
 * fabricates, never carries identifiers.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  recordDelivery,
  resetDeliveryTelemetry,
  snapshotDeliveryTelemetry,
} from './delivery-telemetry';

beforeEach(() => {
  resetDeliveryTelemetry();
});

describe('recordDelivery / snapshotDeliveryTelemetry', () => {
  it('starts at zero everywhere', () => {
    const snap = snapshotDeliveryTelemetry();
    for (const channel of ['email', 'alert'] as const) {
      expect(snap[channel]).toMatchObject({
        delivered: 0, failed: 0, notConfigured: 0, refused: 0, attempts: 0,
        consecutiveFailures: 0, lastOutcome: null, lastAt: null,
      });
    }
  });

  it('counts a success and resets the consecutive-failure streak', () => {
    recordDelivery('alert', 'failed', 3);
    recordDelivery('alert', 'failed', 3);
    recordDelivery('alert', 'delivered', 1);
    const snap = snapshotDeliveryTelemetry();
    expect(snap.alert.failed).toBe(2);
    expect(snap.alert.delivered).toBe(1);
    expect(snap.alert.attempts).toBe(7);
    expect(snap.alert.consecutiveFailures).toBe(0);
    expect(snap.alert.lastOutcome).toBe('delivered');
    expect(snap.alert.lastAt).not.toBeNull();
  });

  it('counts config gaps as notConfigured, never as delivery failures', () => {
    recordDelivery('email', 'not_configured', 0);
    recordDelivery('alert', 'invalid_config', 0);
    const snap = snapshotDeliveryTelemetry();
    expect(snap.email.notConfigured).toBe(1);
    expect(snap.alert.notConfigured).toBe(1);
    expect(snap.email.consecutiveFailures).toBe(0);
    expect(snap.alert.consecutiveFailures).toBe(0);
    expect(snap.email.attempts).toBe(0);
  });

  it('counts refused recipients separately from provider failures', () => {
    recordDelivery('email', 'invalid_recipient', 0);
    recordDelivery('email', 'failed', 3);
    const snap = snapshotDeliveryTelemetry();
    expect(snap.email.refused).toBe(1);
    expect(snap.email.failed).toBe(1);
    expect(snap.email.consecutiveFailures).toBe(1);
  });

  it('tracks channels independently and caps the outcome word', () => {
    recordDelivery('alert', 'x'.repeat(200), 1);
    const snap = snapshotDeliveryTelemetry();
    expect(snap.alert.lastOutcome).toHaveLength(40);
    expect(snap.email.lastOutcome).toBeNull();
  });

  it('returns copies callers cannot mutate', () => {
    recordDelivery('alert', 'delivered', 1);
    const snap = snapshotDeliveryTelemetry();
    snap.alert.delivered = 9999;
    expect(snapshotDeliveryTelemetry().alert.delivered).toBe(1);
  });
});
