import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/subscription/welcome/starter',
  useSearchParams: () => new URLSearchParams(),
}));

import { PlanWelcomeScreen } from './PlanWelcomeScreen';
import { PLAN_PRICES } from '@/lib/billing/catalog';
import { formatBillMoney } from '@/lib/bill';
import type { SubscriptionScreenData } from '@/lib/db/subscription-screen';
import { capabilitiesFor } from '@/lib/plans';

/**
 * The screen a buyer lands on when Cashfree sends them back.
 *
 * The failure available here is congratulating someone who has not paid: the
 * webhook grants the plan, and the browser can arrive before it. So the
 * strings are pinned both ways — the welcome only when the plan is really
 * active, the confirming state otherwise.
 */
const starter = PLAN_PRICES.find((plan) => plan.id === 'starter')!;
const professional = PLAN_PRICES.find((plan) => plan.id === 'professional')!;

function data(overrides: Partial<SubscriptionScreenData['state']> = {}): SubscriptionScreenData {
  return {
    role: 'owner',
    state: {
      accountId: '11111111-1111-1111-1111-111111111111',
      plan: 'trial',
      planLabel: 'Free trial',
      status: 'trialing',
      pricePaise: null,
      trial: { startedAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-22T00:00:00Z', daysRemaining: 12, running: true },
      period: { startedAt: null, expiresAt: null, endsAt: null },
      cancellation: null,
      outlets: { used: 1, limit: 1, unlimited: false, remaining: 0 },
      canWrite: true,
      readOnly: false,
      pastDue: false,
      expired: false,
      lastPayment: null,
      ...overrides,
    },
    history: [],
    payments: [],
    catalog: PLAN_PRICES,
    providerConfigured: true,
  };
}

function activeStarter(): SubscriptionScreenData {
  return data({
    plan: 'starter',
    planLabel: 'Starter',
    status: 'active',
    pricePaise: starter.paise,
    trial: { startedAt: null, endsAt: null, daysRemaining: 0, running: false },
    period: { startedAt: '2026-11-28T00:00:00Z', expiresAt: '2026-12-28T00:00:00Z', endsAt: '2026-12-28T00:00:00Z' },
    lastPayment: {
      amountPaise: starter.paise,
      status: 'succeeded',
      receipt: 'AD-2026-0042',
      paidAt: '2026-11-28T09:00:00Z',
      failureReason: null,
    },
  });
}

function render(view: SubscriptionScreenData, plan = starter) {
  return renderToStaticMarkup(
    <PlanWelcomeScreen plan={plan} data={view} outlet={null} />
  );
}

describe('the plan welcome screen', () => {
  it('congratulates only once the plan is actually active, and names it', () => {
    const html = render(activeStarter());

    expect(html).toContain('Payment confirmed');
    expect(html).toContain('You&#x27;re on Starter.');
    expect(html).toContain(formatBillMoney(starter.paise));
    expect(html).toContain('AD-2026-0042');
    expect(html).toContain('Paid until');
    expect(html).not.toContain('Almost there.');
    expect(html).not.toContain('Confirming payment');
  });

  it('lists the features that are live for the plan, and only those', () => {
    const html = render(activeStarter());
    const live = capabilitiesFor('starter').filter((capability) => capability.state === 'live');
    const planned = capabilitiesFor('starter').filter((capability) => capability.state !== 'live');

    expect(live.length).toBeGreaterThan(0);
    for (const capability of live) {
      expect(html).toContain(capability.label);
    }
    for (const capability of planned) {
      expect(html).not.toContain(capability.label);
    }
    // The outlet allowance comes from the catalog, not from a typed-out number.
    expect(html).toContain('1 outlet');
  });

  it('waits instead of congratulating while the webhook has not landed', () => {
    const html = render(data());

    expect(html).toContain('Confirming payment');
    expect(html).toContain('Almost there.');
    expect(html).toContain('Payment made');
    expect(html).toContain('Plan active');
    expect(html).not.toContain('You&#x27;re on');
    expect(html).not.toContain('Payment confirmed');
  });

  it('does not congratulate a Starter purchase when a different plan is what is active', () => {
    const html = render(
      data({
        plan: 'professional',
        planLabel: 'Professional',
        status: 'active',
        pricePaise: professional.paise,
        period: { startedAt: '2026-11-01T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' },
      })
    );

    expect(html).toContain('Almost there.');
    expect(html).not.toContain('You&#x27;re on Starter.');
  });

  it('treats an expired subscription as not active', () => {
    const html = render(
      data({
        plan: 'starter',
        planLabel: 'Starter',
        status: 'expired',
        expired: true,
        pricePaise: starter.paise,
      })
    );

    expect(html).toContain('Almost there.');
    expect(html).not.toContain('You&#x27;re on Starter.');
  });

  it('points at the real screens a new owner needs next', () => {
    const html = render(activeStarter());

    expect(html).toContain('href="/dashboard/menus"');
    expect(html).toContain('href="/dashboard/tables"');
    expect(html).toContain('href="/dashboard"');
  });
});
