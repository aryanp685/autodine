import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { OutletSwitcher } from './OutletSwitcher';

/**
 * The switcher is the only control that changes what every other screen shows,
 * so the two states have to be clearly different: nothing to switch between
 * means no select at all, and a real choice means a plain form that still
 * works if the script does not run.
 */

const maddi = { id: 'r-1', name: 'Maddi', role: 'owner' };
const baner = { id: 'r-2', name: 'Maddi Baner', role: 'manager' };

describe('OutletSwitcher', () => {
  it('renders the name as text when the account has one outlet', () => {
    const html = renderToStaticMarkup(<OutletSwitcher outlets={[maddi]} activeId="r-1" next="/dashboard/menus" />);

    expect(html).toContain('Maddi');
    // A one-option select looks broken and invites a click that does nothing.
    expect(html).not.toContain('<select');
  });

  it('offers every outlet, with the active one selected, when there are several', () => {
    const html = renderToStaticMarkup(
      <OutletSwitcher outlets={[maddi, baner]} activeId="r-2" next="/dashboard/reports" />,
    );

    expect(html).toContain('<select');
    expect(html).toContain('value="r-1"');
    expect(html).toContain('value="r-2"');
    expect(html).toContain('Maddi Baner');
    // The active outlet is the one shown, not the first in the list.
    expect(html).toMatch(/<option[^>]*value="r-2"[^>]*selected/);
  });

  it('posts to the switch handler with a same-site return path, and works without JavaScript', () => {
    const html = renderToStaticMarkup(
      <OutletSwitcher outlets={[maddi, baner]} activeId="r-1" next="/dashboard/orders" />,
    );

    expect(html).toContain('method="post"');
    expect(html).toContain('action="/dashboard/outlet"');
    expect(html).toContain('name="next"');
    expect(html).toContain('value="/dashboard/orders"');
    // <noscript> fallback: a select cannot submit itself without a script.
    expect(html).toContain('<noscript>');
    expect(html).toContain('Switch');
  });

  it('renders nothing at all with no outlets, rather than an empty select', () => {
    expect(renderToStaticMarkup(<OutletSwitcher outlets={[]} activeId="" next="/dashboard" />)).toBe('');
  });
});
