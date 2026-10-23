import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TRIAL_DAYS } from './trial';
import {
  BILLING,
  ENTITLEMENTS,
  planHasFeature,
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
    expect(BILLING.trialDays).toBe(7);
    expect(BILLING.note).toMatch(/not on sale/i);
  });

  it('lists what is missing as plainly as what is present', () => {
    expect(NOT_CONNECTED.map((n) => n.id)).toEqual(['payments', 'billing', 'messages']);
    for (const item of NOT_CONNECTED) expect(item.detail.length).toBeGreaterThan(20);
  });
});

/**
 * The matrix exists twice on purpose: once in TypeScript so a screen can label
 * a control, once in SQL so the database can refuse the request. Those two
 * copies disagreeing is the failure mode this block exists to catch — a
 * pricing page that sells "menu import" while the server refuses it, or the
 * reverse, which is worse because nobody notices.
 *
 * The SQL is read as text. It is not parsed: the test looks for the exact
 * `when '<plan>' then array[...]` shape migration 20261026001200 uses, and
 * fails loudly if that shape changes, because a silent regex miss would turn
 * this test into a no-op.
 */
describe('plan matrix cannot drift from the database', () => {
  const SQL = readFileSync(
    new URL(
      '../supabase/migrations/20261026001200_plan_entitlements.sql',
      import.meta.url
    ),
    'utf8'
  );

  const WRITE_GATE_SQL = readFileSync(
    new URL('../supabase/migrations/20261026001100_trial_plans_and_write_gate.sql', import.meta.url),
    'utf8'
  );

  function featuresInSql(plan: string): string[] {
    const match = SQL.match(
      new RegExp(`when '${plan}' then array\\[([\\s\\S]*?)\\]`)
    );
    if (!match) throw new Error(`migration has no feature list for ${plan}`);
    return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }

  for (const plan of ['trial', 'starter', 'professional', 'business'] as const) {
    it(`${plan}: SQL and TypeScript list the same features`, () => {
      expect(featuresInSql(plan).sort()).toEqual([...ENTITLEMENTS[plan]].sort());
    });
  }

  it('denies by default', () => {
    expect(planHasFeature('enterprise', 'menus')).toBe(false);
    expect(planHasFeature('starter', 'outlets')).toBe(false);
    expect(planHasFeature('starter', 'import')).toBe(false);
    expect(planHasFeature('professional', 'outlets')).toBe(false);
    expect(planHasFeature('business', 'outlets')).toBe(true);
  });

  it(`in SQL and in TypeScript, the trial is ${BILLING.trialDays} days`, () => {
    // Both write-gate functions hard-code the interval. One drifting from the
    // other means a restaurant is refused writes a day before its dashboard
    // says the trial ends.
    const intervals = WRITE_GATE_SQL.match(/interval '(\d+) days'/g) ?? [];
    expect(intervals.length).toBeGreaterThanOrEqual(2);
    for (const interval of intervals) {
      expect(interval).toBe(`interval '${BILLING.trialDays} days'`);
    }
    expect(TRIAL_DAYS).toBe(BILLING.trialDays);
  });
});
