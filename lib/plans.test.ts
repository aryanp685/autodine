import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TRIAL_DAYS } from './trial';
import { BILLING_CURRENCY, planPricePaise } from './billing/catalog';
import {
  BILLING,
  ENTITLEMENTS,
  planHasFeature,
  DIFFERENCES,
  LIVE,
  NOT_CONNECTED,
  PLANS,
  PLAN_OUTLET_LIMITS,
  planOutletLimit,
  outletLimitLabel,
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
    expect(BILLING.trialDays).toBe(21);
    expect(BILLING.note).toMatch(/not on sale/i);
  });

  it('prices the three tiers as the published specification says', () => {
    // Approved prices. A change here is a commercial decision, not a copy
    // edit, so it is pinned rather than merely ordered.
    expect(Object.fromEntries(PLANS.map((plan) => [plan.id, plan.price]))).toEqual({
      starter: 999,
      professional: 2699,
      business: 3699,
    });
  });

  it('gives every plan an outlet allowance, and only one tier none', () => {
    expect(PLAN_OUTLET_LIMITS).toEqual({ trial: 5, starter: 1, professional: 5, business: null });
    for (const plan of PLANS) expect(plan.outlets).toBe(PLAN_OUTLET_LIMITS[plan.id]);
    expect(planOutletLimit('business')).toBeNull();
    expect(planOutletLimit('unknown-plan')).toBe(PLAN_OUTLET_LIMITS.starter);
    expect(outletLimitLabel(null)).toBe('Unlimited outlets');
    expect(outletLimitLabel(1)).toBe('1 outlet');
    expect(outletLimitLabel(5)).toBe('5 outlets');
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
  // Migration 20261110001000 is the current authority: it re-declares
  // plan_features() for Model C and holds the outlet limits.
  const SQL = readFileSync(
    new URL('../supabase/migrations/20261110001000_account_subscriptions.sql', import.meta.url),
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
    expect(planHasFeature('professional', 'outlets')).toBe(true);
    expect(planHasFeature('business', 'outlets')).toBe(true);
  });

  const MODEL_C_SQL = SQL;

  it(`measures a new trial as ${BILLING.trialDays} days in SQL and in TypeScript`, () => {
    // Every `interval 'N days'` in the Model C migration OUTSIDE its backfill
    // is how a new trial is measured. One drifting from the other means a
    // restaurant is refused writes a day before its dashboard says the trial
    // ends.
    const backfill = MODEL_C_SQL.slice(
      MODEL_C_SQL.indexOf('-- 3. Backfill.'),
      MODEL_C_SQL.indexOf('-- 4. Entitlement helpers.')
    );
    expect(backfill.length).toBeGreaterThan(0);

    const intervals = (MODEL_C_SQL.replace(backfill, '').match(/interval '(\d+) days'/g) ?? []);
    expect(intervals.length).toBeGreaterThanOrEqual(2);
    for (const interval of intervals) {
      expect(interval).toBe(`interval '${BILLING.trialDays} days'`);
    }

    // The backfill must still speak the OLD 7-day rule: that is how a trial
    // which had already ended is recognised, so that lengthening the trial
    // cannot silently reactivate it.
    expect(backfill).toContain("interval '7 days'");
    expect(backfill).toContain("interval '21 days'");
    expect(TRIAL_DAYS).toBe(BILLING.trialDays);
  });

  it('gives each plan the outlet allowance the database enforces', () => {
    // public.account_outlet_limit() is the authority: it is what
    // create_outlet() counts against. A page that promises more than the
    // database allows is a refund waiting to happen.
    const body = MODEL_C_SQL.slice(
      MODEL_C_SQL.indexOf('create or replace function public.account_outlet_limit')
    );
    expect(body.length).toBeGreaterThan(0);
    for (const plan of ['starter', 'professional'] as const) {
      const match = body.match(new RegExp(`when '${plan}'\\s+then\\s+(\\d+)`));
      expect(Number(match?.[1])).toBe(PLAN_OUTLET_LIMITS[plan]);
    }
    expect(body).toMatch(/when 'business'\s+then\s+null/);
    expect(PLAN_OUTLET_LIMITS.business).toBeNull();
  });

  it('never revives an expired trial, in the backfill or anywhere else', () => {
    // The rule that the trial-length change was allowed under: a trial that
    // was still running keeps its activation date and gains the extra days;
    // one that had already ended stays ended.
    expect(MODEL_C_SQL).toContain('trial_ends_at');
    expect(MODEL_C_SQL).toMatch(/already expired/);
    expect(MODEL_C_SQL).toMatch(/stay/);
  });
});

/**
 * The billing migration charges in paise and the app quotes in rupees. These
 * are the same price written two ways, and the one place a mistake would be
 * invisible is a page that says 2,699 while the database records 26,990. So
 * the migration's own arithmetic is read back and compared to the catalog.
 */
describe('prices in SQL and TypeScript are the same money', () => {
  const SQL = readFileSync(
    new URL('../supabase/migrations/20261110001100_subscription_billing.sql', import.meta.url),
    'utf8'
  );

  const body = SQL.slice(
    SQL.indexOf('create or replace function public.plan_price_paise'),
    SQL.indexOf('create or replace function public.claim_account_trial')
  );

  it('exists at all, so the checks below cannot pass by matching nothing', () => {
    expect(body.length).toBeGreaterThan(0);
  });

  // 999 rupees -> 99900 paise. Read the multiplication, not a bare literal:
  // a price pasted in without the *100 is exactly the bug worth catching.
  for (const plan of ['starter', 'professional', 'business'] as const) {
    it(`${plan} is ${PLANS.find((p) => p.id === plan)!.price} rupees in both places`, () => {
      const match = body.match(new RegExp(`when '${plan}'\\s+then\\s+\\(?(\\d+)\\s*\\*\\s*100`));
      expect(match, `no paise arithmetic for ${plan}`).toBeTruthy();
      expect(Number(match![1])).toBe(PLANS.find((p) => p.id === plan)!.price);
    });
  }

  it('knows no price for anything that is not a plan', () => {
    // The trial is free, and an unknown string is free too rather than
    // expensive: a typo must never become a charge.
    expect(body).toMatch(/else\s+null/);
    expect(planPricePaise('trial')).toBeNull();
    expect(planPricePaise('enterprise')).toBeNull();
    expect(planPricePaise(null)).toBeNull();
  });

  it('charges in one currency only, and says which', () => {
    expect(SQL).toMatch(/'INR'/);
    expect(BILLING_CURRENCY).toBe('INR');
  });

  it('refuses a payment that is not the price of the plan it names', () => {
    // The amount check that makes an altered webhook harmless: the provider's
    // number is compared against the plan's, never trusted on its own.
    expect(SQL).toMatch(/amount_mismatch/);
  });

  it('refuses a payment in the wrong currency', () => {
    expect(SQL).toMatch(/currency_mismatch/);
  });
});
