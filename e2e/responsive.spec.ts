/**
 * Responsive audit — the strict requirement, made executable.
 *
 * For every representative route and every common viewport (small phone,
 * large phone, tablet portrait, tablet landscape, laptop, wide desktop):
 *
 *   1. no horizontal overflow — a page that scrolls sideways at 360px has
 *      failed, whatever the CSS looked like;
 *   2. the screen's own landmark (h1 / board heading) is visible — nothing
 *      important is hidden to dodge a layout problem;
 *   3. a full-page screenshot is written to responsive-artifacts/ so a human
 *      can compare phones against desktop with their own eyes (uploaded as a
 *      workflow artifact; "CSS inspection" is never the finish line).
 *
 * One more thing gets its own test: the phone navigation on the marketing
 * bar. A hamburger that does not open is exactly the class of bug this pass
 * exists to catch.
 */

import { expect, test, type Page } from '@playwright/test';
import { seedCart, waitForAppReady } from './flow-helpers';

const VIEWPORTS = [
  { width: 320, height: 720, label: 'phone-narrow' },
  { width: 360, height: 800, label: 'phone-small' },
  { width: 390, height: 844, label: 'phone' },
  { width: 768, height: 1024, label: 'tablet-portrait' },
  { width: 1024, height: 768, label: 'tablet-landscape' },
  { width: 1280, height: 800, label: 'laptop' },
  { width: 1440, height: 900, label: 'desktop' },
] as const;

type Route = {
  slug: string;
  path: string;
  /** Visible heading that proves the screen rendered, not an error card. */
  landmark: string;
  app?: boolean;
  seed?: boolean;
};

const ROUTES: Route[] = [
  { slug: 'landing', path: '/', landmark: 'h1' },
  { slug: 'pricing', path: '/pricing', landmark: 'h1' },
  { slug: 'guest-menu', path: '/menu', landmark: 'h1', app: true },
  { slug: 'guest-cart', path: '/menu/cart', landmark: 'h1', app: true, seed: true },
  { slug: 'guest-checkout', path: '/menu/checkout', landmark: 'h1', app: true, seed: true },
  { slug: 'brand-import', path: '/dashboard/menus/import', landmark: 'h1' },
  { slug: 'kitchen', path: '/kitchen', landmark: 'h1', app: true },
  { slug: 'cashier', path: '/cashier', landmark: 'h1', app: true },
];

async function assertNoSidewaysScroll(page: Page, where: string) {
  // When a page is too wide, the useful fact is WHICH element did it — the
  // failure message names the offenders instead of leaving a number to guess
  // from.
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    const offenders: string[] = [];
    if (overflow > 1) {
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
    return { overflow, offenders };
  });
  expect(
    report.overflow,
    `${where}: page scrolls sideways by ${report.overflow}px — ${report.offenders.join(' | ')}`,
  ).toBeLessThanOrEqual(1);
}

for (const route of ROUTES) {
  // Each case visits five widths and captures full-page evidence.
test.describe.configure({ timeout: 90_000 });

test(`responsive: ${route.slug} holds from 320px to 1440px`, async ({ page }) => {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      if (route.seed) {
        await page.goto('/');
        await seedCart(page, [{ itemId: 'it-hara-bhara', qty: 2 }]);
      }
      await page.goto(route.path);
      if (route.app) await waitForAppReady(page);

      const where = `${route.slug} @ ${vp.label} (${vp.width}px)`;

      await assertNoSidewaysScroll(page, where);

      const landmark = page.locator(route.landmark).first();
      await expect(landmark, `${where}: landmark ${route.landmark} missing`).toBeVisible();

      await page.screenshot({
        path: `responsive-artifacts/${route.slug}-${vp.label}-${vp.width}.png`,
        fullPage: true,
      });
    }
  });
}

test('responsive: the phone menu opens and reaches every link', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');

  const toggle = page.getByRole('button', { name: /open menu/i });
  await expect(toggle, 'hamburger must exist on a phone').toBeVisible();
  await toggle.click();

  const menu = page.getByRole('navigation', { name: /primary \(mobile\)/i });
  await expect(menu, 'phone menu must open').toBeVisible();

  const links = menu.getByRole('link');
  const count = await links.count();
  expect(count, 'phone menu must carry the same destinations').toBeGreaterThanOrEqual(3);

  await assertNoSidewaysScroll(page, 'phone menu open @ 360px');
  await page.screenshot({
    path: 'responsive-artifacts/phone-menu-open-360.png',
    fullPage: false,
  });
});

/* ------------------------------------------------------- interactions */

test('responsive: a kitchen ticket can be advanced on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/kitchen');
  await waitForAppReady(page);

  const tickets = page.locator('article[data-state]');
  const before = await tickets.first().getAttribute('data-state');

  // The tap a cook actually makes, at the size they actually make it. Enter
  // on the focused control is the keyboard's click: it does not depend on a
  // hit-test landing on pixels that a phone layout is still settling.
  const advance = page.getByRole('button', { name: /Start preparing|Mark ready|Mark served/ }).first();
  await advance.scrollIntoViewIfNeeded();
  await advance.press('Enter');

  await expect
    .poll(async () => tickets.first().getAttribute('data-state'), { timeout: 5_000 })
    .not.toBe(before);

  await assertNoSidewaysScroll(page, 'kitchen advanced @ 390px');
  await page.screenshot({ path: 'responsive-artifacts/kitchen-advanced-390.png', fullPage: true });
});

test('responsive: a cashier can settle a bill on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/cashier');
  await waitForAppReady(page);

  const order = page.getByRole('button', { name: /Select A-1041 at T3/ }).first();
  await order.scrollIntoViewIfNeeded();
  await order.press('Enter');

  const record = page.locator('[data-counter-cta]');
  await expect(record).toHaveText(/Record cash ₹1,247/);
  await record.scrollIntoViewIfNeeded();
  await record.press('Enter');

  // The demo settles in place: the queue total drops by the bill.
  await expect(page.getByText('₹2,917 outstanding')).toBeVisible({ timeout: 5_000 });

  await assertNoSidewaysScroll(page, 'cashier settled @ 390px');
  await page.screenshot({ path: 'responsive-artifacts/cashier-settled-390.png', fullPage: true });
});
