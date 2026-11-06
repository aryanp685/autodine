import { describe, expect, it } from 'vitest';

import { describeRateLimited, rateLimitWaitSeconds } from './place-order-failure';

describe('rateLimitWaitSeconds', () => {
  it('reads the wait out of the database refusal sentence', () => {
    expect(rateLimitWaitSeconds('Too many orders right now. Please wait 42 seconds and try again.')).toBe(42);
    expect(rateLimitWaitSeconds('Too many orders right now. Please wait 60 seconds and try again.')).toBe(60);
  });

  it('returns null for anything else rather than inventing a number', () => {
    expect(rateLimitWaitSeconds('The kitchen is on fire')).toBeNull();
    expect(rateLimitWaitSeconds('')).toBeNull();
    expect(rateLimitWaitSeconds(null)).toBeNull();
    expect(rateLimitWaitSeconds(undefined)).toBeNull();
    expect(rateLimitWaitSeconds('wait many seconds')).toBeNull();
    expect(rateLimitWaitSeconds('wait 0 seconds')).toBeNull();
  });
});

describe('describeRateLimited', () => {
  it('carries the wait and says nothing was charged', () => {
    const text = describeRateLimited(42);
    expect(text).toContain('42 seconds');
    expect(text).toContain('nothing was charged');
  });

  it('clamps nonsense to a readable wait', () => {
    expect(describeRateLimited(-5)).toContain('about 2 seconds');
    expect(describeRateLimited(999999)).toContain('3600 seconds');
    expect(describeRateLimited(null)).toContain('60 seconds');
    expect(describeRateLimited(undefined)).toContain('60 seconds');
    expect(describeRateLimited(Number.NaN)).toContain('60 seconds');
  });
});
