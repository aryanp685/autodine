import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRealtimeMonitor } from './realtime-monitor';

afterEach(() => vi.useRealTimers());

describe('Realtime kitchen monitor', () => {
  it('polls through a transient outage without alerting and cancels the pending alert on recovery', () => {
    vi.useFakeTimers();
    const delivery = vi.fn();
    const signal = vi.fn();
    const monitor = createRealtimeMonitor({ onDelivery: delivery, onSignal: signal, thresholdMs: 60_000 });
    monitor.onStatus('CHANNEL_ERROR');
    monitor.onStatus('TIMED_OUT');
    expect(delivery).toHaveBeenLastCalledWith('polling');
    vi.advanceTimersByTime(59_999);
    monitor.onStatus('SUBSCRIBED');
    vi.advanceTimersByTime(2);
    expect(signal).not.toHaveBeenCalled();
    expect(delivery).toHaveBeenLastCalledWith('live');
    monitor.dispose();
  });

  it('emits one sustained-degradation alert and a recovery with duration', () => {
    vi.useFakeTimers();
    const delivery = vi.fn();
    const signal = vi.fn();
    const monitor = createRealtimeMonitor({ onDelivery: delivery, onSignal: signal, thresholdMs: 60_000 });
    monitor.onStatus('CHANNEL_ERROR');
    vi.advanceTimersByTime(60_000);
    expect(signal).toHaveBeenCalledWith({ kind: 'degraded', durationMs: 60_000 });
    monitor.onStatus('TIMED_OUT');
    vi.advanceTimersByTime(30_000);
    expect(signal).toHaveBeenCalledTimes(1);
    monitor.onStatus('SUBSCRIBED');
    expect(signal).toHaveBeenLastCalledWith({ kind: 'recovered', durationMs: 90_000 });
    monitor.dispose();
  });

  it('does not send a recovery if the board closes while degraded', () => {
    vi.useFakeTimers();
    const signal = vi.fn();
    const monitor = createRealtimeMonitor({ onDelivery: vi.fn(), onSignal: signal });
    monitor.onStatus('TIMED_OUT');
    vi.advanceTimersByTime(60_000);
    monitor.dispose();
    expect(signal).toHaveBeenCalledOnce();
    expect(signal).toHaveBeenCalledWith({ kind: 'degraded', durationMs: 60_000 });
  });
});
