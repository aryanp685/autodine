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
  it('offers one language, not a picker that implies a second one exists', () => {
    const html = renderToStaticMarkup(<Kitchen />);

    expect(html).toContain('हिंदी');
    expect(html).not.toContain('aria-label="Announcement language"');
    expect(html).not.toContain('>English<');
  });

  it('names the voice it will use rather than promising Hindi blindly', () => {
    const html = renderToStaticMarkup(<Kitchen />);

    // Before the effect runs the board is still looking for the voice, and it
    // says so instead of claiming to be ready.
    expect(html).toMatch(/हिंदी · (आवाज़ खोज रहे हैं|तैयार|आवाज़ नहीं)/);
  });

  it('offers the exact sentence it will speak as a test', () => {
    const html = renderToStaticMarkup(<Kitchen />);
    expect(html).toContain('Test announcement');
  });

  it('lets the operator slow the voice down from the board itself', () => {
    const html = renderToStaticMarkup(<Kitchen />);

    for (const label of ['धीमा', 'सामान्य', 'तेज़']) expect(html).toContain(label);
    // One of them is the current setting, and the board says which.
    expect(html).toMatch(/aria-pressed="true"[^<]*>सामान्य</);
  });

  it('does not claim to be speaking when it has said nothing', () => {
    const html = renderToStaticMarkup(<Kitchen />);
    expect(html).not.toContain('Speaking now');
    expect(html).not.toContain('Last announcement');
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

  it('attaches an add-on to the dish it was ordered with, as a tag', () => {
    // The cook reads the dish first and its instructions second. Run together
    // as "Butter Naan · Half · Extra cheese" the add-on reads as part of the
    // dish name and gets missed.
    const html = renderToStaticMarkup(
      <Kitchen
        data={{
          restaurantName: 'maddi',
          restaurantId: 'r-1',
          tickets: [
            {
              id: 'o-1',
              code: 'MA-ABC12',
              table: 'T1',
              placedAt: '7:42 pm',
              placedAtIso: new Date().toISOString(),
              ageMin: 1,
              payment: 'pending',
              state: 'new',
              items: [
                {
                  qty: 1,
                  name: 'Butter Naan',
                  detail: 'Half · Extra cheese · Jain',
                  portion: 'Half',
                  addons: ['Extra cheese', 'Jain'],
                  veg: true,
                },
              ],
              total: 120,
            },
          ],
        }}
      />,
    );

    expect(html).toContain('kb-itemAddon');
    expect(html).toContain('Extra cheese');
    expect(html).toContain('Jain');
    // The portion stays a qualifier on the dish, not a tag.
    expect(html).toContain('· Half');
  });

  it('shows an empty live board as empty, not as a demo', () => {
    const html = renderToStaticMarkup(
      <Kitchen data={{ restaurantName: 'maddi', restaurantId: 'r-1', tickets: [] }} />,
    );

    expect(html).toContain('No open tickets');
    expect(html).not.toContain('Kitchen · demo mode');
  });
});
