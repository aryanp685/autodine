/**
 * The owner surface, at every viewport — on a real deployment, behind a real
 * sign-in.
 *
 * The hermetic responsive audit cannot reach these routes: the dashboard,
 * the menu editor, the ledger, the floor plan, the reports, the branding and
 * the settings all sit behind authentication, and inventing a demo login for
 * them would weaken exactly the control the product is built on. So this
 * sweep lives with the integration tests: discoverable always, verified when
 * the E2E_* environment exists.
 *
 * Same contract as the hermetic audit: no sideways scrolling, the page's own
 * heading visible, and a screenshot per route and viewport so the result can
 * be judged with eyes.
 */

import { expect, test, type Page } from '@playwright/test';
import { BASE, OWNER_EMAIL, OWNER_PASSWORD, signInOwner, skipUnless } from './flow';

const READY = Boolean(BASE && OWNER_EMAIL && OWNER_PASSWORD);
const NEEDS = 'E2E_BASE_URL, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD';

const VIEWPORTS = [
  { width: 320, height: 720, label: 'phone-narrow' },
  { width: 360, height: 800, label: 'phone-small' },
  { width: 390, height: 844, label: 'phone' },
  { width: 768, height: 1024, label: 'tablet-portrait' },
  { width: 1024, height: 768, label: 'tablet-landscape' },
  { width: 1280, height: 800, label: 'laptop' },
] as const;

const ROUTES: Array<{ slug: string; path: string }> = [
  { slug: 'overview', path: '/dashboard' },
  { slug: 'menus', path: '/dashboard/menus' },
  { slug: 'orders', path: '/dashboard/orders' },
  { slug: 'tables', path: '/dashboard/tables' },
  { slug: 'reports', path: '/dashboard/reports' },
  { slug: 'branding', path: '/dashboard/branding' },
  { slug: 'settings', path: '/dashboard/settings' },
];

async function assertNoSidewaysScroll(page: Page, where: string) {
  // When a page is too wide, the useful fact is WHICH element did it — the
  // failure message names the offenders instead of leaving a number to guess
  // from.
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    const offenders: string[] = [];
    const layoutChain: string[] = [];
    if (overflow > 1) {
      const table = document.querySelector('[data-menu-items]');
      let ancestor = table as HTMLElement | null;
      for (let depth = 0; ancestor && depth < 7; depth += 1, ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const rect = ancestor.getBoundingClientRect();
        layoutChain.push(
          `${ancestor.tagName.toLowerCase()}${ancestor.className ? `.${String(ancestor.className).trim().split(/\s+/).slice(0, 3).join('.')}` : ''}` +
            ` x=${Math.round(rect.x)} w=${Math.round(rect.width)} scroll=${ancestor.scrollWidth}/${ancestor.clientWidth}` +
            ` overflowX=${style.overflowX} maxW=${style.maxWidth} minW=${style.minWidth}`,
        );
      }
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.right > doc.clientWidth + 1 && r.width > 0 && r.height > 0) {
          const cls =
            typeof el.className === 'string' && el.className.trim()
              ? `.${el.className.trim().split(/\s+/).slice(0, 4).join('.')}`
              : '';
          offenders.push(`${el.tagName.toLowerCase()}${cls} right=${Math.round(r.right)}`);
        }
        if (offenders.length >= 4) break;
      }
    }
    return { overflow, offenders, layoutChain };
  });
  expect(
    report.overflow,
    `${where}: page scrolls sideways by ${report.overflow}px — ${report.offenders.join(' | ')} — ${report.layoutChain.join(' → ')}`,
  ).toBeLessThanOrEqual(1);
}

for (const route of ROUTES) {
  test(`owner responsive: ${route.slug} holds from 320px to 1280px`, async ({ browser }) => {
    test.skip(!READY, skipUnless(READY, NEEDS));

    const context = await browser.newContext({ baseURL: BASE });
    try {
      await signInOwner(context);
      const page = await context.newPage();

      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(route.path);
        const where = `${route.slug} @ ${vp.label} (${vp.width}px)`;

        await assertNoSidewaysScroll(page, where);
        await expect(page.locator('h1').first(), `${where}: page heading missing`).toBeVisible();

        await page.screenshot({
          path: `responsive-artifacts/owner-${route.slug}-${vp.label}-${vp.width}.png`,
          fullPage: true,
        });
      }
    } finally {
      await context.close();
    }
  });
}
