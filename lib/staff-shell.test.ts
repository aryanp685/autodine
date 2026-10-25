import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DASHBOARD_LINKS } from '@/components/shell-links';

/**
 * The staff shell is not a layout, so nothing in the framework guarantees it.
 *
 * Every screen renders `OwnerPage` itself and every route has its own
 * `loading.tsx`. That buys the shell persistence (a skeleton carries the rail,
 * so a slow navigation never blinks it away) at the cost of two things that can
 * silently drift:
 *
 *   1. a `loading.tsx` that forgets `active` -- the rail is visible but no row
 *      is highlighted while the page loads, then the highlight appears late;
 *   2. a link in the rail whose route file has been moved or renamed.
 *
 * Both are invisible in a unit test of any single screen and both are visible
 * to a person navigating. So they are asserted here, over the file tree.
 */

/** The route each section lives at, and the file that must exist for it. */
const ROUTES: Record<string, { dir: string; key: string }> = {
  overview: { dir: 'app/dashboard', key: 'overview' },
  orders: { dir: 'app/dashboard/orders', key: 'orders' },
  menus: { dir: 'app/dashboard/menus', key: 'menus' },
  import: { dir: 'app/dashboard/menus/import', key: 'import' },
  branding: { dir: 'app/dashboard/branding', key: 'branding' },
  tables: { dir: 'app/dashboard/tables', key: 'tables' },
  reports: { dir: 'app/dashboard/reports', key: 'reports' },
  settings: { dir: 'app/dashboard/settings', key: 'settings' },
  kitchen: { dir: 'app/kitchen', key: 'kitchen' },
  counter: { dir: 'app/cashier', key: 'counter' },
};

describe('the staff shell', () => {
  it('has a page for every destination in the rail', () => {
    for (const link of DASHBOARD_LINKS) {
      const entry = ROUTES[link.key];
      expect(entry, `no audit entry for "${link.key}"`).toBeTruthy();
      expect(existsSync(`${entry.dir}/page.tsx`), `${link.href} has no page`).toBe(true);
    }
  });

  it('keeps the rail highlighted while every staff route loads', () => {
    // A missing `active` here is the late-highlight bug: the skeleton draws the
    // rail with nothing current in it.
    for (const { dir, key } of Object.values(ROUTES)) {
      const loading = `${dir}/loading.tsx`;
      expect(existsSync(loading), `${loading} is missing`).toBe(true);
      const source = readFileSync(loading, 'utf8');
      expect(source, `${loading} should render OwnerLoading`).toContain('OwnerLoading');
      expect(source, `${loading} should pass active="${key}"`).toContain(`active="${key}"`);
    }
  });

  it('marks the current section on the screen itself', () => {
    // The loaded page must agree with its skeleton; two sources of truth for
    // "where am I" is how a rail ends up highlighting the previous screen.
    const screens: Array<[string, string]> = [
      ['components/screens/DashboardScreen.tsx', 'overview'],
      ['components/screens/OrdersScreen.tsx', 'orders'],
      ['components/screens/MenuEditorScreen.tsx', 'menus'],
      ['components/screens/MenuImportScreen.tsx', 'import'],
      ['components/screens/BrandingScreen.tsx', 'branding'],
      ['components/screens/TablesScreen.tsx', 'tables'],
      ['components/screens/ReportsScreen.tsx', 'reports'],
      ['components/screens/SettingsScreen.tsx', 'settings'],
      ['components/screens/KitchenScreen.tsx', 'kitchen'],
    ];

    for (const [file, key] of screens) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} should render <OwnerPage active="${key}">`).toContain(
        `<OwnerPage active="${key}"`,
      );
    }

    /*
     * Counter is the one screen that cannot use OwnerPage. It is a Client
     * Component, and the bar carries a server action for sign-out, so the bar is
     * rendered by the page and passed down as a prop. It therefore re-states the
     * frame by hand -- which is exactly the kind of duplicate that drifts, so it
     * gets its own assertion: the bar must still be told where it is.
     */
    const cashierPage = readFileSync('app/cashier/page.tsx', 'utf8');
    expect(cashierPage).toMatch(/<DashboardBar[\s\S]*active="counter"/);
  });

  it('navigates with the client router, not with a full page load', () => {
    // A staff screen that writes a bare <a href> costs a full reload of the
    // bundle, and the rail is rebuilt from scratch instead of staying put.
    const shell = readFileSync('components/DashboardBar.tsx', 'utf8');
    expect(shell).toContain("from 'next/link'");
    expect(shell).toContain('usePathname');
    // The drawer must close when the route changes, or a phone keeps a sheet
    // over the page it just navigated to.
    expect(shell).toMatch(/useEffect\(\(\) => \{\s*setOpen\(false\);\s*\}, \[pathname\]\)/);
  });
});
