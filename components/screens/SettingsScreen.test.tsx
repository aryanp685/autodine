import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The markup an owner, a cashier, a signed-out visitor and a database-less
 * deployment actually get from Settings.
 *
 * The actions are stubbed: a 'use server' module cannot be imported outside
 * Next's build, and what is under test here is which controls appear, what
 * they say, and what they refuse to claim.
 */

const mocks = vi.hoisted(() => ({
  action: (name: string) => {
    const fn = () => {};
    Object.defineProperty(fn, 'name', { value: name });
    return fn;
  },
}));

vi.mock('@/app/dashboard/settings/actions', () => ({
  saveDetailsAction: mocks.action('saveDetailsAction'),
  saveTaxAction: mocks.action('saveTaxAction'),
  saveOnlinePaymentsAction: mocks.action('saveOnlinePaymentsAction'),
  saveUpiAction: mocks.action('saveUpiAction'),
}));

import { SettingsScreen } from './SettingsScreen';
import type { SettingsScreenData } from '@/lib/db/settings-screen';

function data(over: Partial<SettingsScreenData> = {}): SettingsScreenData {
  return {
    role: 'owner',
    canEdit: true,
    details: {
      name: 'Maddi',
      tagline: 'Bombay street food',
      address: '12 Baner Road, Pune',
      phone: '+91 98765 43210',
      gstin: '22AAAAA0000A1Z5',
      slug: 'maddi',
    },
    taxRateBps: 1800,
    onlinePaymentsEnabled: false,
    upiId: '',
    upiPayeeName: '',
    timezone: 'Asia/Kolkata',
    publicMenuUrl: 'https://autodine.example/menu?s=maddi',
    publicMenuSvg: '<svg role="img" aria-label="QR"></svg>',
    publishedMenus: 1,
    totalMenus: 1,
    outlets: [{ id: 'r-1', name: 'Maddi', role: 'owner' }],
    activeOutletId: 'r-1',
    ...over,
  };
}

describe('SettingsScreen', () => {
  it('shows the saved values and the tax example the bill would charge', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={data()} />);

    expect(html).toContain('value="Maddi"');
    expect(html).toContain('value="maddi"');
    expect(html).toContain('22AAAAA0000A1Z5');
    // 18% on a ₹100 dish, computed with the same rounding as the order.
    expect(html).toContain('₹118');
    expect(html).toContain('₹18');
  });

  it('renders a real, scannable code — not a placeholder chip', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={data()} />);
    expect(html).toContain('aria-label="QR"');
    expect(html).toContain('https://autodine.example/menu?s=maddi');
  });

  it('says so when the code could not be drawn instead of drawing a fake one', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={data({ publicMenuSvg: null })} />);
    expect(html).toContain('could not be drawn');
    expect(html).not.toContain('aria-label="QR"');
  });

  it('warns that a QR on an unpublished menu opens an empty page', () => {
    const html = renderToStaticMarkup(
      <SettingsScreen data={data({ publishedMenus: 0, totalMenus: 2 })} />
    );
    expect(html).toContain('Nothing to show yet');
    expect(html).toContain('Publish one menu');
  });

  it('does not warn when a menu is published', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={data()} />);
    expect(html).not.toContain('Nothing to show yet');
  });

  it('tells everyone when tax is 0%, because that bill silently charges nothing', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={data({ taxRateBps: 0 })} />);
    expect(html).toContain('Tax is 0%');
  });

  it('disables every control for a role that cannot write', () => {
    const html = renderToStaticMarkup(
      <SettingsScreen data={data({ role: 'cashier', canEdit: false })} />
    );

    expect(html).toContain('Read-only for your role');
    expect(html).toContain('cashier');
    // The values are still readable — the tax on a bill is never a mystery.
    expect(html).toContain('value="Maddi"');
    expect(html).toContain('disabled');
    // The confirmation checkbox only exists for someone who could act on it.
    expect(html).not.toContain('name="slugConfirm"');
  });

  describe('online payment', () => {
    it('says the deployment has no keys when the switch is on but the server is not configured', () => {
      // The exact confusion this card exists to stop: an owner ticks the box,
      // sees no pay button on the guest side, and concludes the feature is
      // broken rather than unconfigured.
      const html = renderToStaticMarkup(
        <SettingsScreen data={data({ onlinePaymentsEnabled: true })} gatewayConfigured={false} />,
      );

      expect(html).toContain('Online payment');
      expect(html).toContain('No gateway keys');
    });

    it('shows the missing-keys warning before the box is ticked, not after', () => {
      // The old card only warned once the switch was already on, which meant
      // the first thing an owner did -- tick it, save, see nothing -- was the
      // thing that produced the warning. Now the control is disabled up front.
      const html = renderToStaticMarkup(
        <SettingsScreen data={data({ onlinePaymentsEnabled: false })} gatewayConfigured={false} />,
      );

      expect(html).toContain('No gateway keys on this deployment');
      expect(html).toContain('name="onlinePayments"');
      // Disabled, because there is no key pair for the switch to reach.
      expect(html).toMatch(/disabled=""[^>]*name="onlinePayments"/);
      expect(html).toMatch(/disabled=""[^>]*>\s*Save payment setting/);
    });

    it('leaves the switch usable when the deployment does have keys', () => {
      const html = renderToStaticMarkup(
        <SettingsScreen data={data({ onlinePaymentsEnabled: true })} gatewayConfigured />,
      );

      expect(html).not.toContain('No gateway keys on this deployment');
      // `disabled:` also appears as a Tailwind variant in the class list, so
      // the assertion is on the attribute that actually disables the control.
      expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>\s*Save payment setting/);
    });

    it('says nothing is missing when the switch is on and the server has keys', () => {
      const html = renderToStaticMarkup(
        <SettingsScreen data={data({ onlinePaymentsEnabled: true })} gatewayConfigured />,
      );

      expect(html).not.toContain('No gateway keys');
    });

    it('explains that a configured server still shows the counter until the box is ticked', () => {
      const html = renderToStaticMarkup(
        <SettingsScreen data={data({ onlinePaymentsEnabled: false })} gatewayConfigured />,
      );

      expect(html).toContain('pay at the counter');
    });
  });

  it('gives the public menu link a real copy button and keeps the print card off screen', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={data()} />);

    // Both a link to open and a button to copy: the two things people do
    // with a menu URL.
    expect(html).toContain('href="https://autodine.example/menu?s=maddi"');
    expect(html).toContain('Copy link');
    expect(html).toContain('type="button"');
    // The printed menu card is in the DOM for window.print(), and hidden on
    // screen so Settings does not show a second identical card at the bottom.
    expect(html).toContain('data-print-sheet');
    // ...and it is the only thing that prints.
    expect(html).toContain('print:hidden');
  });

  it('shows the sign-in prompt and no form at all when blocked', () => {
    const html = renderToStaticMarkup(
      <SettingsScreen data={data({ blocked: 'signed-out', canEdit: false })} />
    );

    expect(html).toContain('Sign in to see this screen');
    expect(html).not.toContain('name="taxRate"');
    expect(html).not.toContain('name="name"');
  });

  it('renders a disabled, empty form when the database is not connected', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={null} />);

    expect(html).toContain('The database is not connected');
    expect(html).toContain('disabled');
    // No fictional restaurant may be filled in: this form writes.
    expect(html).not.toContain('value="Saffron');
  });

  it('never prints the demo restaurant into the settings form', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={null} />);
    expect(html).not.toContain('Maddi');
  });

  it('carries the admin error into the page', () => {
    const html = renderToStaticMarkup(
      <SettingsScreen data={data()} error="That web address is already used by another restaurant." />
    );
    expect(html).toContain('Nothing was saved');
    expect(html).toContain('already used by another restaurant');
  });

  it('lists every outlet and marks the one the dashboard is showing', () => {
    const html = renderToStaticMarkup(
      <SettingsScreen
        data={data({
          outlets: [
            { id: 'r-1', name: 'Maddi', role: 'owner' },
            { id: 'r-2', name: 'Maddi Baner', role: 'owner' },
          ],
          activeOutletId: 'r-2',
        })}
      />
    );

    expect(html).toContain('Outlets');
    expect(html).toContain('Maddi');
    expect(html).toContain('Maddi Baner');
    expect(html).toContain('Open now');
    expect(html).toContain('action="/dashboard/outlet/new"');
  });

  it('offers no add-outlet form to a role that cannot own one', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={data({ role: 'cashier', canEdit: false })} />);

    expect(html).toContain('Outlets');
    expect(html).not.toContain('action="/dashboard/outlet/new"');
    expect(html).toContain('Only an owner can add an outlet');
  });
});

/**
 * The save result used to render once, at the top of a page that is five forms
 * tall. Saving the UPI details -- the last form -- wrote its confirmation
 * above the fold, so from where the owner was standing nothing happened at
 * all. The answer now follows them down the page.
 */
describe('Settings, where the save result lands', () => {
  it('pins the notice under the app bar instead of leaving it off-screen', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={data()} notice="Saved the UPI details." />);

    expect(html).toContain('sticky top-14');
    expect(html).toContain('Saved the UPI details.');
  });

  it('pins an error the same way, because a failed save is the one you must see', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={data()} error="That UPI ID is not valid." />);

    expect(html).toContain('sticky top-14');
    expect(html).toContain('Nothing was saved.');
  });

  it('draws no banner at all when there is nothing to report', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={data()} />);
    expect(html).not.toContain('sticky top-14');
  });

  it('puts the QR aside beside the forms from a laptop, not only from 1280', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={data()} />);
    expect(html).toContain('lg:grid-cols-[minmax(0,1fr)_318px]');
  });
});
