import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Cashier } from './CashierScreen';

/* The counter is a client screen: it uses the router to re-read the queue
   after a write. Nothing here asserts navigation, so the router is stubbed. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

/* The server actions reach lib/supabase/admin.ts through the action module.
   These tests render markup; they never call one. */
vi.mock('@/app/cashier/actions', () => ({ recordPaymentAction: async () => ({ ok: true }) }));
vi.mock('@/app/orders/actions', () => ({ cancelStaffOrderAction: async () => ({ ok: true }) }));

/**
 * The counter's three real defects, pinned so they cannot come back.
 *
 * 1. It had no navigation at all -- no bar, no sign-out, no way back.
 * 2. The queue could only ever settle its first row, because the detail panel
 *    was hard-wired to `visible[0]`. Every row is a button now.
 * 3. In demo mode the settle button was disabled with no explanation, so a
 *    preview queue could never be cleared. The button is live again and the
 *    copy says what it did (nothing).
 *
 * Plus the loader's `blocked` flag, which used to be returned and ignored, so
 * a signed-out visitor saw an empty counter and no reason for it.
 */

const nav = <header className="appBar">bar</header>;

describe('Cashier', () => {
  it('renders the bar it is handed by the server page', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} />);
    expect(html).toContain('appBar');
  });

  it('makes every ticket in the queue a real button', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} />);
    const rows = html.match(/class="cash__qBtn"/g) ?? [];
    // The demo queue holds three counter tickets.
    expect(rows.length).toBe(3);
  });

  it('marks the oldest ticket as selected and no other', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} />);
    const pressed = html.match(/class="cash__qBtn" aria-pressed="true"/g) ?? [];
    expect(pressed.length).toBe(1);
    expect(html).toContain('A-1041');
  });

  it('leaves the preview settle button pressable', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} />);
    const cta = html.match(/<button[^>]*class="cash__cta"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(cta).toContain('Record cash ₹1,247');
    expect(cta).not.toContain('disabled');
  });

  it('says the preview records nothing', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} />);
    expect(html).toContain('Nothing is persisted, nothing is charged');
  });

  it('explains a signed-out visitor instead of showing a quiet counter', () => {
    const html = renderToStaticMarkup(
      <Cashier nav={nav} data={{ restaurantName: '', queue: [], blocked: 'signed-out' }} />,
    );
    expect(html).toContain('Sign in to see this screen.');
    expect(html).not.toContain('cash__queue');
    expect(html).not.toContain('outstanding');
  });

  it('tells a member with no restaurant what is missing', () => {
    const html = renderToStaticMarkup(
      <Cashier nav={nav} data={{ restaurantName: '', queue: [], blocked: 'no-membership' }} />,
    );
    expect(html).toContain('No restaurant on this account yet.');
  });

  it('shows an empty live queue as empty rather than as sample data', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} data={{ restaurantName: 'Kabir', queue: [] }} />);
    expect(html).toContain('Queue clear');
    expect(html).not.toContain('A-1041');
  });
});
