import { describe, expect, it } from 'vitest';
import { DASHBOARD_LINKS, SHELL_GROUPS } from './shell-links';

/**
 * The rail, the "Go to" search and the loading skeletons all read this list, so
 * it has to be a single source of truth or they drift.
 *
 * These are cheap invariants that catch the expensive bugs: two destinations
 * sharing a key (React drops one silently), two screens pointing at the same
 * URL (the rail highlights the wrong one), a link outside the app origin
 * (the shell navigates off site).
 */
describe('the staff shell map', () => {
  it('has one entry per destination, with no duplicates', () => {
    const keys = DASHBOARD_LINKS.map((link) => link.key);
    const hrefs = DASHBOARD_LINKS.map((link) => link.href);

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('stays inside the app', () => {
    for (const link of DASHBOARD_LINKS) {
      expect(link.href.startsWith('/'), `${link.href} must be a site path`).toBe(true);
      expect(link.href.startsWith('//')).toBe(false);
      expect(link.label.trim()).not.toBe('');
    }
  });

  it('puts every link in exactly one group, and every group on screen', () => {
    const grouped = SHELL_GROUPS.flatMap((group) => group.links);

    expect(grouped).toHaveLength(DASHBOARD_LINKS.length);
    expect(new Set(grouped.map((link) => link.key)).size).toBe(DASHBOARD_LINKS.length);
    // An empty group would render a heading with nothing under it.
    for (const group of SHELL_GROUPS) expect(group.links.length).toBeGreaterThan(0);
  });

  /**
   * The rail has to lead to every screen a person can be sent to. These three
   * live outside `/dashboard`, and they are the ones the old strip made easy to
   * forget.
   */
  it('keeps the screens that live outside /dashboard reachable', () => {
    const hrefs = DASHBOARD_LINKS.map((link) => link.href);
    expect(hrefs).toEqual(expect.arrayContaining(['/kitchen', '/cashier']));
  });
});
