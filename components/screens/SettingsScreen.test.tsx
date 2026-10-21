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
    expect(html).toContain('Publish a menu first');
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
      expect(html).toContain('no gateway keys');
    });

    it('says nothing is missing when the switch is on and the server has keys', () => {
      const html = renderToStaticMarkup(
        <SettingsScreen data={data({ onlinePaymentsEnabled: true })} gatewayConfigured />,
      );

      expect(html).not.toContain('no gateway keys');
    });

    it('explains that a configured server still shows the counter until the box is ticked', () => {
      const html = renderToStaticMarkup(
        <SettingsScreen data={data({ onlinePaymentsEnabled: false })} gatewayConfigured />,
      );

      expect(html).toContain('pay at the counter');
    });
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
    expect(html).toContain('open now');
    expect(html).toContain('action="/dashboard/outlet/new"');
  });

  it('offers no add-outlet form to a role that cannot own one', () => {
    const html = renderToStaticMarkup(<SettingsScreen data={data({ role: 'cashier', canEdit: false })} />);

    expect(html).toContain('Outlets');
    expect(html).not.toContain('action="/dashboard/outlet/new"');
    expect(html).toContain('Only an owner can add an outlet');
  });
});
