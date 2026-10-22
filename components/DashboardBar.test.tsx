import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardBar } from './DashboardBar';
import { DASHBOARD_LINKS, SHELL_GROUPS } from './shell-links';

// The sign-out control is a server action, and the action module imports
// `server-only`, which vitest cannot resolve. The action is not what these
// tests are about -- only that the control is there.
vi.mock('@/app/auth/actions', () => ({ signOutAction: async () => undefined }));

/**
 * The shell is on every staff screen, so a mistake here is a mistake on every
 * staff screen.
 *
 * The two failures worth guarding against are the ones that came from the old
 * horizontal strip: a destination that exists in the data but never renders
 * (the row scrolled sideways and the ninth link sat off screen), and a
 * `loading.tsx` that renders the shell without knowing which screen is
 * arriving, which used to light up the wrong tab for the length of a fetch.
 */

const OUTLET = {
  outlets: [
    { id: 'r1', name: 'Copper Pot', role: 'owner' },
    { id: 'r2', name: 'Copper Pot Baner', role: 'manager' },
  ],
  activeId: 'r1',
};

function html(props: Parameters<typeof DashboardBar>[0] = {}) {
  return renderToStaticMarkup(<DashboardBar {...props} />);
}

describe('DashboardBar', () => {
  it('renders every destination exactly once', () => {
    const out = html({ active: 'overview' });

    for (const link of DASHBOARD_LINKS) {
      const count = out.split(`href="${link.href}"`).length - 1;
      expect(count, `${link.label} (${link.href}) should appear once`).toBe(1);
    }
  });

  it('marks the current screen for assistive technology, not only with colour', () => {
    const out = html({ active: 'reports' });

    expect(out).toContain('aria-current="page"');
    // One current page, never several.
    expect(out.split('aria-current="page"').length - 1).toBe(1);
    // And it is the right one: the aria-current sits on the Reports link.
    const at = out.indexOf('aria-current="page"');
    const around = out.slice(Math.max(0, at - 400), at + 200);
    expect(around).toContain('href="/dashboard/reports"');
  });

  /**
   * A skeleton renders before the router knows which screen it is paying for.
   * Claiming "Overview" would be a lie told at exactly the moment the user is
   * waiting to find out where they are.
   */
  it('claims no current page when it is not told which one', () => {
    const out = html();
    expect(out).not.toContain('aria-current="page"');
  });

  it('names the venue and the caller\'s role at the foot of the rail', () => {
    const out = html({ active: 'overview', outlet: OUTLET });

    expect(out).toContain('Copper Pot');
    expect(out).toContain('owner');
    expect(out).toContain('CP');
  });

  /**
   * With one outlet there is nothing to switch between, so the picker is not
   * rendered -- the venue name is already at the foot of the rail, and printing
   * it twice in a 232px column reads as a bug.
   */
  it('hides the outlet picker when there is only one outlet', () => {
    const single = { outlets: [OUTLET.outlets[0]], activeId: 'r1' };
    expect(html({ active: 'overview', outlet: single })).not.toContain('pg__outletSelect');
    expect(html({ active: 'overview', outlet: OUTLET })).toContain('pg__outletSelect');
  });

  it('offers a way out only where somebody is signed in', () => {
    expect(html({ active: 'overview' })).toContain('Sign out');
    expect(html({ active: 'overview', signOut: false })).not.toContain('Sign out');
  });

  /**
   * The drawer on a phone needs a way to be opened and a way to be dismissed.
   * Both are real buttons with names: an icon-only control with no accessible
   * label is unusable with a screen reader.
   */
  it('gives the drawer an opener and a closer, both labelled', () => {
    const out = html({ active: 'overview' });

    expect(out).toContain('aria-controls="app-rail"');
    expect(out).toContain('id="app-rail"');
    expect(out).toContain('aria-label="Close navigation"');
    expect(out).toContain('type="submit"');
  });

  it('groups the destinations so the rail reads as a product, not a list', () => {
    const out = html({ active: 'overview' });

    for (const group of SHELL_GROUPS) {
      expect(out).toContain(group.name);
    }
  });

  it('keeps "Go to" honest: it lists real destinations and nothing else', () => {
    const out = html({ active: 'overview' });

    expect(out).toContain('aria-label="Go to a screen"');
    // Closed to begin with. A panel that is open on arrival covers the page.
    expect(out).not.toContain('role="listbox"');
  });
});
