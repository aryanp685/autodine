// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
  usePathname: () => '/dashboard/subscription/welcome/starter',
  useSearchParams: () => new URLSearchParams(),
}));

import { PlanWelcomeScreen } from './PlanWelcomeScreen';
import { PLAN_PRICES } from '@/lib/billing/catalog';
import type { SubscriptionScreenData } from '@/lib/db/subscription-screen';
import type { PlanId } from '@/lib/plans';

/**
 * The confirmation poll, as behaviour rather than as markup.
 *
 * The browser arrives before the webhook, so the screen re-reads the server
 * itself. It has to stop — on activation, and after a minute of asking — or it
 * becomes a page that hammers the server for as long as the tab is open.
 */
const starter = PLAN_PRICES.find((plan) => plan.id === 'starter')!;
const POLL_MS = 3000;

function data(plan: PlanId | 'trial', expired = false): SubscriptionScreenData {
  return {
    role: 'owner',
    state: {
      accountId: '11111111-1111-1111-1111-111111111111',
      plan,
      planLabel: plan === 'starter' ? 'Starter' : 'Free trial',
      status: plan === 'starter' ? 'active' : 'trialing',
      pricePaise: plan === 'starter' ? starter.paise : null,
      trial: { startedAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-22T00:00:00Z', daysRemaining: 12, running: plan !== 'starter' },
      period: { startedAt: null, expiresAt: null, endsAt: null },
      cancellation: null,
      outlets: { used: 1, limit: 1, unlimited: false, remaining: 0 },
      canWrite: true,
      readOnly: false,
      pastDue: false,
      expired,
      lastPayment: null,
    },
    history: [],
    payments: [],
    catalog: PLAN_PRICES,
    providerConfigured: true,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.refresh.mockReset();
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function render(view: SubscriptionScreenData) {
  await act(async () => {
    root.render(<PlanWelcomeScreen plan={starter} data={view} outlet={null} />);
  });
}

async function tick(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
  }
}

describe('the confirmation poll', () => {
  it('asks the server while the plan is not active, and stops asking after a minute', async () => {
    await render(data('trial'));

    await tick(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    await tick(25);
    // 20 attempts is the ceiling: a tab left open must not poll forever.
    expect(mocks.refresh).toHaveBeenCalledTimes(20);
    expect(host.textContent).toContain('Not confirmed yet');
  });

  it('does not poll at all once the plan is active', async () => {
    await render(data('starter'));

    await tick(10);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('stops polling when a refresh brings the activation back', async () => {
    await render(data('trial'));
    await tick(2);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);

    await render(data('starter'));
    await tick(5);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Payment confirmed');
  });
});
