import { describe, expect, it } from 'vitest';
import {
  BILLING,
  DIFFERENCES,
  LIVE,
  NOT_CONNECTED,
  PLANS,
  capabilitiesFor,
  liveCountFor,
} from './plans';

/**
 * The plans file is the pricing page's only source of truth, so these tests
 * are about consistency rather than behaviour: a claim cannot appear here in
 * two shapes, and the page cannot advertise something the build does not do.
 */
describe('plans', () => {
  it('has three tiers, in ascending price, with one recommendation', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['starter', 'professional', 'business']);
    expect(PLANS[0].price).toBeLessThan(PLANS[1].price);
    expect(PLANS[1].price).toBeLessThan(PLANS[2].price);
    expect(PLANS.filter((p) => p.recommended)).toHaveLength(1);
  });

  it('keeps the live list true to the build: only capabilities that work', () => {
    // Everything currently shipped belongs to every plan. Gating it would be a
    // product decision with a code change behind it, not a copy change.
    for (const capability of LIVE) {
      expect(capability.state).toBe('live');
      expect(capability.tiers).toBe('all');
    }
  });

  it('marks every tier difference as planned, because none of them exists yet', () => {
    for (const difference of DIFFERENCES) {
      expect(difference.state).toBe('planned');
      expect(Array.isArray(difference.tiers)).toBe(true);
      expect((difference.tiers as string[]).length).toBeGreaterThan(0);
    }
  });

  it('gives every capability a tier that is a real plan', () => {
    const ids = PLANS.map((p) => p.id);
    for (const capability of [...LIVE, ...DIFFERENCES]) {
      if (capability.tiers === 'all') continue;
      for (const tier of capability.tiers) expect(ids).toContain(tier);
    }
  });

  it('never claims a capability twice under different ids', () => {
    const ids = [...LIVE, ...DIFFERENCES].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds each plan’s list from the shared capabilities plus its own', () => {
    expect(capabilitiesFor('starter').every((c) => c.tiers === 'all')).toBe(true);
    expect(liveCountFor('starter')).toBe(LIVE.length);
    expect(liveCountFor('business')).toBe(LIVE.length);

    const businessOnly = capabilitiesFor('business').filter(
      (c) => c.tiers !== 'all' && !c.tiers.includes('starter'),
    );
    expect(businessOnly.map((c) => c.id)).toContain('outlets');
  });

  it('states that billing is not connected, and says so once', () => {
    expect(BILLING.connected).toBe(false);
    expect(BILLING.trialDays).toBe(10);
    expect(BILLING.note).toMatch(/not on sale/i);
  });

  it('lists what is missing as plainly as what is present', () => {
    expect(NOT_CONNECTED.map((n) => n.id)).toEqual(['payments', 'billing', 'messages']);
    for (const item of NOT_CONNECTED) expect(item.detail.length).toBeGreaterThan(20);
  });
});
