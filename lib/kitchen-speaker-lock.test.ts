import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimKitchenSpeaker } from './kitchen-speaker-lock';

afterEach(() => vi.useRealTimers());

describe('same-browser kitchen speaker lock', () => {
  it('grants one active tab and keeps a second tab silent until release', async () => {
    let occupied = false;
    const locks: NonNullable<Parameters<typeof claimKitchenSpeaker>[0]> = {
      async request(_name, _options, callback) {
        if (occupied) return callback(null);
        occupied = true;
        try { return await callback({}); }
        finally { occupied = false; }
      },
    };
    const first: string[] = [];
    const second: string[] = [];
    const releaseFirst = claimKitchenSpeaker(locks, 'restaurant-1', (state) => first.push(state));
    const releaseSecond = claimKitchenSpeaker(locks, 'restaurant-1', (state) => second.push(state));

    await Promise.resolve();
    expect(first).toContain('leader');
    expect(second).toContain('busy');

    releaseFirst();
    await Promise.resolve();
    expect(first.at(-1)).toBe('inactive');
    releaseSecond();
  });

  it('retries after the active tab releases its lock', async () => {
    vi.useFakeTimers();
    let occupied = false;
    const locks: NonNullable<Parameters<typeof claimKitchenSpeaker>[0]> = {
      async request(_name, _options, callback) {
        if (occupied) return callback(null);
        occupied = true;
        try { return await callback({}); }
        finally { occupied = false; }
      },
    };
    const first: string[] = [];
    const second: string[] = [];
    const releaseFirst = claimKitchenSpeaker(locks, 'restaurant-2', (state) => first.push(state));
    const releaseSecond = claimKitchenSpeaker(locks, 'restaurant-2', (state) => second.push(state));
    await Promise.resolve();
    expect(second.at(-1)).toBe('busy');

    releaseFirst();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(second).toContain('leader');
    releaseSecond();
  });

  it('labels unsupported browsers local-only rather than claiming coordination', () => {
    const states: string[] = [];
    const release = claimKitchenSpeaker(null, 'restaurant-1', (state) => states.push(state));
    expect(states).toEqual(['local-only']);
    release();
    expect(states.at(-1)).toBe('inactive');
  });
});
