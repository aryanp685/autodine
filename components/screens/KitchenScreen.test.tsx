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
  // The board now renders the shared staff shell, and the rail reads the
  // current path to close itself after a tap. Without this the whole screen
  // throws before it can be asserted on.
  usePathname: () => '/kitchen',
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

  /*
   * THE SHELL CONTRACT
   *
   * The board used to be a full-screen wall display: no rail, no venue, and a
   * single "Dashboard" link as the only way out. These two tests are the ones
   * that would have caught that, and they are the reason it cannot come back
   * quietly.
   */
  it('renders inside the shared staff shell with Kitchen marked current', () => {
    const html = renderToStaticMarkup(<Kitchen />);

    // The rail, and the destinations that live in it.
    expect(html).toContain('id="app-rail"');
    expect(html).toContain('href="/dashboard/orders"');
    expect(html).toContain('href="/cashier"');

    // Kitchen is the current page, not just a link that happens to be there.
    expect(html).toContain('data-nav="kitchen" data-nav-active="true"');
    expect(html).toContain('aria-current="page"');
  });

  it('does not fall back to the old full-screen escape hatch', () => {
    const html = renderToStaticMarkup(<Kitchen />);

    // The lone "Dashboard" button existed because there was no rail. With the
    // rail present it is a second, worse way to do the same thing.
    expect(html).not.toMatch(/>Dashboard<\/a>/);
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

/**
 * The board after the 2026-10-24 pass.
 *
 * The kitchen is the one screen a cook works with wet hands at arm's length,
 * and it had the least consistent controls in the product: a flat band of eight
 * pills in five shapes, a 36px "44px" button, and an emoji standing in for an
 * icon.
 */
describe('Kitchen board, the redesign', () => {
  const live = (over: Partial<Parameters<typeof Kitchen>[0]['data'] & object> = {}) =>
    renderToStaticMarkup(
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
          ...over,
        }}
      />,
    );

  const soundDesk = (html: string) => {
    const at = html.indexOf('aria-label="Announcements"');
    return html.slice(at, html.indexOf('</section>', at));
  };

  it('keeps the sound desk on the shared control geometry', () => {
    const desk = soundDesk(live());

    // Controls, not the status tags beside them: a tag is a pill on purpose.
    const buttons = desk.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(2);
    for (const tag of buttons) {
      expect(tag).not.toContain('rounded-full');
      expect(tag).not.toMatch(/\bh-8\b/);
    }
    expect(desk).toContain('rounded-[10px]');
  });

  it('makes the audio state one button instead of a pill with a link inside', () => {
    const desk = soundDesk(live());

    // One element to press, carrying its own pressed state.
    const at = desk.indexOf('Kitchen audio');
    const button = desk.slice(desk.lastIndexOf('<button', at), desk.indexOf('>', at) + 1);
    expect(button).toContain('aria-pressed=');
    expect(desk).toMatch(/Kitchen audio (on|off)/);
    // The old markup nested a text button inside a styled div, so the visible
    // control and the clickable one were different elements.
    expect(desk).not.toContain('>Turn off<');
  });

  it('draws the switch it toggles, at the same size as the menu switch', () => {
    const desk = soundDesk(live());
    expect(desk).toContain('h-[22px] w-[38px]');
    expect(desk).toContain('aria-hidden="true"');
  });

  it('gives the one tap that moves a ticket a 44px target, and everything else 36px', () => {
    const html = live();

    const advance = html.slice(html.indexOf('Start preparing') - 400, html.indexOf('Start preparing'));
    expect(advance).toContain('h-11');
    expect(advance).not.toContain('rounded-full');

    const at = html.indexOf('aria-label="Replay order');
    const replay = html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at) + 1);
    expect(replay).toContain('h-9');
    expect(replay).not.toContain('rounded-full');
  });

  it('uses an icon for replay rather than an emoji the device gets to choose', () => {
    const html = live();
    expect(html).not.toContain('🔊');
    const at = html.indexOf('aria-label="Replay order');
    expect(html.slice(at, at + 600)).toContain('<svg');
  });

  it('marks each card with the colour of the stage it is in', () => {
    const html = live();
    expect(html).toContain('data-stage-edge="new"');

    const preparing = live({
      tickets: [
        {
          id: 'o-2',
          code: 'MA-2',
          table: 'T2',
          placedAt: '7:50 pm',
          placedAtIso: new Date().toISOString(),
          ageMin: 5,
          payment: 'paid',
          state: 'preparing',
          items: [{ qty: 1, name: 'Chai', veg: true }],
          total: 40,
        },
      ],
    });
    expect(preparing).toContain('data-stage-edge="preparing"');
  });

  it('draws its notices as the same strip the rest of the product uses', () => {
    const html = renderToStaticMarkup(<Kitchen />);
    const at = html.indexOf('Sample board.');
    const from = html.lastIndexOf('<div', at);
    const opening = html.slice(from, html.indexOf('>', from) + 1);

    expect(opening).toContain('rounded-[14px]');
    expect(opening).not.toContain('rounded-full');
  });

  it('tells the reader which age is late, not only colours it', () => {
    // Age stays a number in every state; the colour is a second signal, never
    // the only one.
    const html = live();
    expect(html).toContain('2 min');
  });
});
