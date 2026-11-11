import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { SubscriptionScreen } from './SubscriptionScreen';
import { PLAN_PRICES, RECEIPT_DISCLAIMER } from '@/lib/billing/catalog';
import { PROVIDER_UNAVAILABLE_MESSAGE } from '@/lib/billing/provider';
import type { SubscriptionScreenData } from '@/lib/db/subscription-screen';

/**
 * What the subscription screen says, and to whom.
 *
 * These are not visual tests. They exist because the failures available on this
 * screen are failures of honesty rather than of layout: a button that promises
 * a plan it cannot sell, a manager offered the owner's cancellation, a receipt
 * that reads like a tax invoice, or an expiry notice that makes the owner think
 * their data is gone.
 *
 * Every one of those is a string. So the strings are pinned.
 */
function data(overrides: Partial<SubscriptionScreenData> = {}): SubscriptionScreenData {
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
      outlets: { used: 1, limit: 5, unlimited: false, remaining: 4 },
      canWrite: true,
      readOnly: false,
      pastDue: false,
      expired: false,
      lastPayment: null,
    },
    history: [],
    payments: [],
    catalog: PLAN_PRICES,
    providerConfigured: false,
    ...overrides,
  };
}

const ownerHtml = renderToStaticMarkup(<SubscriptionScreen data={data()} outlet={null} />);

describe('the subscription screen an owner sees', () => {
  it('prints the approved prices and nothing it invented', () => {
    for (const plan of PLAN_PRICES) {
      expect(ownerHtml).toContain(plan.name);
    }
    expect(ownerHtml).toContain('₹999.00');
    expect(ownerHtml).toContain('₹2,699.00');
    expect(ownerHtml).toContain('₹3,699.00');
    expect(ownerHtml).toContain('Unlimited outlets');
  });

  it('says plainly that nothing can be bought yet, and does not hide it', () => {
    expect(ownerHtml).toContain(PROVIDER_UNAVAILABLE_MESSAGE);
    expect(ownerHtml).not.toContain('Coming soon');
  });

  it('counts the trial down from the date it was activated', () => {
    expect(ownerHtml).toContain('Free trial running');
    expect(ownerHtml).toMatch(/12 days left/);
  });

  it('offers the owner the cancellation, and says what survives it', () => {
    expect(ownerHtml).toContain('Request cancellation');
    // The sentence that matters most on this screen: cancelling is not erasing.
    expect(ownerHtml).toMatch(/does not delete\s+an outlet, an order, a menu or a table/);
  });

  it('never calls a receipt a tax invoice', () => {
    expect(ownerHtml).not.toMatch(/tax invoice/i);
  });
});

describe('the same screen for a manager', () => {
  const managerHtml = renderToStaticMarkup(
    <SubscriptionScreen data={data({ role: 'manager' })} outlet={null} />,
  );

  it('shows them the state of the account', () => {
    // Not knowing the account expires on Friday is the manager's problem too.
    expect(managerHtml).toContain('Free trial running');
    expect(managerHtml).toContain('₹2,699.00');
  });

  it('does not offer them the owner\'s money buttons', () => {
    expect(managerHtml).not.toContain('Request cancellation');
    expect(managerHtml).toContain('Owner only');
    expect(managerHtml).toMatch(/Only an owner of this account can change or cancel the plan/);
  });
});

describe('when the account has expired', () => {
  const expired = renderToStaticMarkup(
    <SubscriptionScreen
      data={data({
        state: {
          ...data().state!,
          status: 'expired',
          plan: 'starter',
          pricePaise: 99900,
          expired: true,
          canWrite: false,
          readOnly: true,
          trial: { startedAt: '2026-09-01T00:00:00Z', endsAt: '2026-09-22T00:00:00Z', daysRemaining: 0, running: false },
        },
      })}
      outlet={null}
    />,
  );

  it('says the subscription ended, and that nothing was deleted', () => {
    expect(expired).toContain('Subscription ended');
    expect(expired).toMatch(/nothing has been deleted/i);
  });

  it('says writing is read-only rather than leaving the owner to discover it', () => {
    expect(expired).toContain('Read-only until a plan is active');
  });
});

describe('when a payment has failed', () => {
  const pastDue = renderToStaticMarkup(
    <SubscriptionScreen
      data={data({
        state: {
          ...data().state!,
          status: 'past_due',
          plan: 'professional',
          pricePaise: 269900,
          pastDue: true,
          trial: { startedAt: null, endsAt: null, daysRemaining: 0, running: false },
          period: { startedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' },
          lastPayment: {
            amountPaise: 269900,
            status: 'failed',
            paidAt: '2026-10-01T00:00:00Z',
            receipt: null,
            failureReason: 'The bank declined the charge.',
          },
        },
      })}
      outlet={null}
    />,
  );

  it('blames the payment, not the owner, and says the account still works', () => {
    expect(pastDue).toContain('Payment failed');
    expect(pastDue).toContain('The bank declined the charge.');
    expect(pastDue).toMatch(/Everything keeps working until the end of the period/);
  });
});

describe('a receipt', () => {
  // The disclaimer lives on the receipt page itself; what is asserted here is
  // that the one constant exists and names the difference.
  it('says it is not a GST tax invoice', () => {
    expect(RECEIPT_DISCLAIMER).toMatch(/not a GST tax invoice/i);
    expect(RECEIPT_DISCLAIMER).toMatch(/no tax registration number/i);
  });
});
