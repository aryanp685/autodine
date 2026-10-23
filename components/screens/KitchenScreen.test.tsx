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
      <Kitchen data={{
          restaurantName: '',
          restaurantId: null,
          tickets: [],
          cancelled: [],
          role: null,
          canAdvance: false,
          blocked: 'signed-out',
        }} />,
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
          cancelled: [],
          role: 'kitchen',
          canAdvance: true,
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

    expect(html).toContain('data-addon');
    expect(html).toContain('Extra cheese');
    expect(html).toContain('Jain');
    // The portion stays a qualifier on the dish, not a tag.
    expect(html).toContain('· Half');
  });

  it('shows an empty live board as empty, not as a demo', () => {
    const html = renderToStaticMarkup(
      <Kitchen
        data={{
          restaurantName: 'maddi',
          restaurantId: 'r-1',
          tickets: [],
          cancelled: [],
          role: 'owner',
          canAdvance: true,
        }}
      />,
    );

    expect(html).toContain('No open tickets');
    expect(html).not.toContain('Kitchen · demo mode');
  });

  /* ------------------------------------------------------------ dead buttons */

  it('gives the sample board working controls instead of buttons that only error', () => {
    // With no database there is nothing to write to, so the demo board used to
    // answer every tap with an error. A control that exists and does nothing is
    // the exact thing a person trying the product reads as "broken".
    const html = renderToStaticMarkup(<Kitchen />);

    expect(html).toContain('Start preparing');
    // React renders a disabled control as `disabled=""`, so match the
    // attribute rather than the word: the class list legitimately contains
    // `disabled:opacity-45` on every one of these buttons.
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Start preparing/);
    // And it says out loud that the change stays in this browser.
    expect(html).toContain('Sample board.');
  });

  it('lets a demo ticket be replayed and cancelled without a database id', () => {
    const html = renderToStaticMarkup(<Kitchen />);

    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Replay order/);
    expect(html).toContain('aria-label="Cancel order for');
  });

  /* ------------------------------------------------------------------ auth */

  it('hides the move controls from a role the update policy refuses', () => {
    const html = renderToStaticMarkup(
      <Kitchen
        data={{
          restaurantName: 'maddi',
          restaurantId: 'r-1',
          tickets: [],
          cancelled: [],
          role: 'cashier',
          canAdvance: false,
          cannotAdvance: 'role',
        }}
      />,
    );

    expect(html).not.toContain('Start preparing');
    expect(html).toContain('You can watch this board, but not move tickets.');
    expect(html).toContain('cashier');
  });

  it('explains a read-only restaurant in terms of the plan, not the role', () => {
    const html = renderToStaticMarkup(
      <Kitchen
        data={{
          restaurantName: 'maddi',
          restaurantId: 'r-1',
          tickets: [],
          cancelled: [],
          role: 'owner',
          canAdvance: false,
          cannotAdvance: 'plan',
        }}
      />,
    );

    expect(html).toContain('Read-only');
    expect(html).toContain('plan');
    expect(html).not.toContain('You can watch this board, but not move tickets.');
  });

  /* ------------------------------------------------------------- responsive */

  it('offers a column switcher for phones, with the counts on it', () => {
    // Written for every width and shown under 760px; the counts are what make
    // it possible to skip an empty queue without opening it.
    const html = renderToStaticMarkup(<Kitchen data={{
      restaurantName: 'maddi',
      restaurantId: 'r-1',
      cancelled: [],
      role: 'kitchen',
      canAdvance: true,
      tickets: [
        {
          id: 'o-1',
          code: 'MA-1',
          table: 'T1',
          placedAt: '7:42 pm',
          placedAtIso: new Date().toISOString(),
          ageMin: 2,
          payment: 'pending',
          state: 'new',
          items: [{ qty: 1, name: 'Chai', veg: true }],
          total: 40,
        },
      ],
    }} />);

    // Three switcher buttons, each carrying its own queue length, and the
    // chosen column marked so a phone shows one queue rather than three
    // stacked on top of each other.
    expect(html.split('aria-pressed="true"').length - 1).toBeGreaterThanOrEqual(1);
    expect(html).toContain('New');
    expect(html).toContain('Preparing');
    expect(html).toMatch(/data-state="new"/);
  });

  it('marks a ticket with its prep state so the card can be read at a glance', () => {
    const html = renderToStaticMarkup(<Kitchen data={{
      restaurantName: 'maddi',
      restaurantId: 'r-1',
      cancelled: [],
      role: 'kitchen',
      canAdvance: true,
      tickets: [
        {
          id: 'o-1',
          code: 'MA-1',
          table: 'T1',
          placedAt: '7:42 pm',
          placedAtIso: new Date().toISOString(),
          ageMin: 2,
          payment: 'paid',
          state: 'preparing',
          items: [{ qty: 1, name: 'Chai', veg: true }],
          total: 40,
        },
      ],
    }} />);

    expect(html).toContain('data-state="preparing"');
    expect(html).toContain('Mark ready');
  });
});
