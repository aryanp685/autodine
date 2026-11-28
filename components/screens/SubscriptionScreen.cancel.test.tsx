// @vitest-environment jsdom
/**
 * The cancellation, in a real DOM.
 *
 * renderToStaticMarkup cannot check this: the confirm step opens from a press.
 * What is pinned here is the one behaviour the flow was rebuilt for — pressing
 * "Request cancellation" asks, in place, with the date and what survives the
 * cancellation, instead of ending the subscription on the first press — and
 * that "Keep my subscription" leaves the subscription exactly as it was.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SubscriptionScreen } from './SubscriptionScreen';
import { PLAN_PRICES } from '@/lib/billing/catalog';
import type { SubscriptionScreenData } from '@/lib/db/subscription-screen';

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

function data(): SubscriptionScreenData {
  return {
    role: 'owner',
    state: {
      accountId: '11111111-1111-1111-1111-111111111111',
      plan: 'starter',
      planLabel: 'Starter',
      status: 'active',
      pricePaise: 99900,
      trial: { startedAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-22T00:00:00Z', daysRemaining: 0, running: false },
      period: { startedAt: '2026-11-01T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' },
      cancellation: null,
      outlets: { used: 1, limit: 1, unlimited: false, remaining: 0 },
      canWrite: true,
      readOnly: false,
      pastDue: false,
      expired: false,
      lastPayment: null,
    },
    history: [],
    payments: [],
    catalog: PLAN_PRICES,
    providerConfigured: true,
  };
}

function mount(overrides: Partial<SubscriptionScreenData> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<SubscriptionScreen data={{ ...data(), ...overrides }} outlet={null} />);
  });
  mounted.push({ root, container });
  return container;
}

function press(label: string) {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  if (!button) throw new Error(`No button reading "${label}"`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return button;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.body.innerHTML = '';
});

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe('cancelling a subscription', () => {
  it('asks before it ends anything, and names the date and what stays', () => {
    mount();

    // Nothing has happened yet: the first press opens the question.
    expect(document.body.textContent).toContain('Request cancellation');
    expect(document.querySelector('[aria-label="Confirm cancellation"]')).toBeNull();

    press('Request cancellation');

    const panel = document.querySelector('[aria-label="Confirm cancellation"]');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain('End the subscription on 1 Dec 2026?');
    expect(panel!.textContent).toContain('No further charges after that date.');
    expect(panel!.textContent).toContain('Nothing is deleted.');
    expect(panel!.textContent).toContain('Yes, end it on 1 Dec 2026');
  });

  it('lets the owner change their mind, and leaves the subscription active', () => {
    mount();
    press('Request cancellation');

    press('Keep my subscription');

    expect(document.querySelector('[aria-label="Confirm cancellation"]')).toBeNull();
    expect(document.body.textContent).toContain('Request cancellation');
    // Nothing was sent: the screen still reads the subscription it was given.
    expect(document.body.textContent).toContain('Starter · paid until 1 Dec 2026.');
  });

  it('offers no confirmation to somebody who cannot cancel', () => {
    mount({ role: 'manager' });
    expect(document.body.textContent).toContain('Only an owner of this account can change or cancel the plan.');
    expect(document.body.textContent).not.toContain('Request cancellation');
  });
});
