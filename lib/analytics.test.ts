import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_EVENT_NAMES, track } from './analytics';

/**
 * The analytics layer is privacy-conscious by design: it fails closed in
 * production (no provider, no data sent) and only emits to the console in
 * demo mode. The one invariant these tests defend is that nothing that could
 * identify a guest survives into an emitted event.
 */

describe('track()', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
    vi.unstubAllEnvs();
  });

  it('is a no-op in a production-like environment', () => {
    vi.stubEnv('AUTODINE_DEMO_MODE', '');
    vi.stubEnv('NEXT_PUBLIC_AUTODINE_DEMO_MODE', '');

    track({ name: 'order_placed', properties: { item_count: 3 } });

    expect(log).not.toHaveBeenCalled();
  });

  it('logs the event in demo mode', () => {
    vi.stubEnv('AUTODINE_DEMO_MODE', 'true');

    track({ name: 'order_placed', properties: { item_count: 3 }, timestamp: 123 });

    expect(log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(log.mock.calls[0]![1]));
    expect(payload.name).toBe('order_placed');
    expect(payload.properties).toEqual({ item_count: 3 });
    expect(payload.timestamp).toBe(123);
  });

  it('logs in demo mode via NEXT_PUBLIC flag', () => {
    vi.stubEnv('NEXT_PUBLIC_AUTODINE_DEMO_MODE', 'true');

    track({ name: 'repeat_visit' });

    expect(log).toHaveBeenCalledTimes(1);
  });

  it('ignores event names outside the whitelist', () => {
    vi.stubEnv('AUTODINE_DEMO_MODE', 'true');

    // @ts-expect-error exercising a name that must not be tracked
    track({ name: 'payment_gateways_viewed' });

    expect(log).not.toHaveBeenCalled();
  });

  it('strips PII-ish properties', () => {
    vi.stubEnv('AUTODINE_DEMO_MODE', 'true');

    track({
      name: 'order_placed',
      properties: {
        guest_token: 'secret-token',
        phone: '9876543210',
        gstin: '27ABCDE1234F1Z5',
        name: 'Aryan',
        order_code: 'T-12',
        item_count: 2,
      },
    });

    const payload = JSON.parse(String(log.mock.calls[0]![1]));
    expect(payload.properties).toEqual({ item_count: 2 });
    expect(payload.properties).not.toHaveProperty('guest_token');
    expect(payload.properties).not.toHaveProperty('phone');
    expect(payload.properties).not.toHaveProperty('gstin');
  });

  it('exposes a stable whitelist of event names', () => {
    expect(ANALYTICS_EVENT_NAMES).toContain('order_placed');
    expect(ANALYTICS_EVENT_NAMES).toContain('repeat_visit');
  });
});