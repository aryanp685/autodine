import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Kitchen } from './KitchenScreen';

/**
 * The kitchen board, rendered the way the server renders it.
 *
 * Effects do not run here, so this is not a test of the announcement itself --
 * lib/announce and lib/speech cover that logic with their own suites. What
 * this guards is the part that only shows up in markup: that the board offers
 * Hindi, that it never claims to be live when it is a demo, and that it does
 * not crash on a blocked caller.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

vi.mock('@/app/kitchen/actions', () => ({
  advanceOrderAction: async () => ({ ok: true, state: 'preparing' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowser: () => null,
}));

describe('Kitchen board', () => {
  it('offers Hindi and English, with Hindi the default', () => {
    const html = renderToStaticMarkup(<Kitchen />);

    expect(html).toContain('हिंदी');
    expect(html).toContain('English');
    // aria-pressed tells a screen reader which one is active; the class is
    // what a person sees.
    expect(html).toMatch(/aria-pressed="true"[^>]*>हिंदी|हिंदी<\/button>/);
  });

  it('says it is a demo board rather than looking live', () => {
    const html = renderToStaticMarkup(<Kitchen />);
    expect(html).toContain('demo mode');
    expect(html).toContain('Demo board · local only');
  });

  it('renders the sample tickets so the layout can be judged', () => {
    const html = renderToStaticMarkup(<Kitchen />);
    expect(html).toContain('Start preparing');
  });

  it('prompts to sign in instead of showing a blank board to a blocked caller', () => {
    const html = renderToStaticMarkup(
      <Kitchen data={{ restaurantName: '', restaurantId: null, tickets: [], blocked: 'signed-out' }} />,
    );

    expect(html).toContain('Sign in');
    expect(html).not.toContain('Demo board · local only');
  });

  it('shows an empty live board as empty, not as a demo', () => {
    const html = renderToStaticMarkup(
      <Kitchen data={{ restaurantName: 'maddi', restaurantId: 'r-1', tickets: [] }} />,
    );

    expect(html).toContain('No open tickets');
    expect(html).not.toContain('Kitchen · demo mode');
  });
});
