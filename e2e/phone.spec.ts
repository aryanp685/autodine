import { expect, test } from '@playwright/test';
import { RAIL, expectShell, railLink } from './shell';

/**
 * The same shell at 390px, where the rail becomes a bottom sheet.
 *
 * The requirement is "mobile navigation works", which in this product means:
 * the drawer opens from the top bar, the destinations are the same ones, a
 * choice closes it, and Escape gets out of it.
 */

test('the rail is a closed drawer, and Menu opens it', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator(RAIL)).toHaveCount(1);
  await expect(page.locator(RAIL)).toHaveAttribute('data-rail-open', 'false');

  /* Closed means off the bottom of the screen, not merely dimmed.
   *
   * Polled rather than measured once. A single `boundingBox()` right after
   * `goto` can land in the frame between the first paint and the stylesheet
   * that positions the sheet, which produced a red run every fourth or fifth
   * time with nothing wrong in the product. The assertion is unchanged; only
   * the eagerness is. */
  await expect
    .poll(async () => (await page.locator(RAIL).boundingBox())?.y ?? -1, {
      message: 'the closed drawer never settled below the fold',
    })
    .toBeGreaterThanOrEqual(843);

  const menu = page.getByRole('button', { name: 'Menu' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');

  await menu.click();

  await expect(page.locator(RAIL)).toHaveAttribute('data-rail-open', 'true');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');

  // The rail is now on screen, and it is the same one.
  const open = await page.locator(RAIL).boundingBox();
  expect(open!.y).toBeLessThan(844);
});

test('choosing Kitchen from the drawer navigates and closes the drawer', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator(RAIL)).toHaveAttribute('data-rail-open', 'true');

  await railLink(page, 'Kitchen').click();

  await expect(page).toHaveURL(/\/kitchen$/);
  await expectShell(page, 'kitchen');
  // A drawer left open over the screen the person just asked for reads as
  // "nothing happened".
  await expect(page.locator(RAIL)).toHaveAttribute('data-rail-open', 'false');
});

test('Escape closes the drawer', async ({ page }) => {
  await page.goto('/kitchen');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator(RAIL)).toHaveAttribute('data-rail-open', 'true');

  await page.keyboard.press('Escape');

  await expect(page.locator(RAIL)).toHaveAttribute('data-rail-open', 'false');
});

test('the content is not pushed off a 390px screen by a desktop offset', async ({ page }) => {
  // The rail was once 232px here and 244px there; a leftover `pl-[244px]` below
  // `lg` would narrow the content on a phone.
  await page.goto('/dashboard');
  const main = page.locator('main').first();
  await expect(main).toBeVisible();

  // Same reason as the drawer above: one measurement can catch the layout
  // mid-hydration. Polling keeps the two assertions and stops the flake.
  await expect
    .poll(async () => Math.round((await main.boundingBox())?.x ?? -1), {
      message: 'the content never settled at the left edge',
    })
    .toBeLessThan(40);

  const box = await main.boundingBox();
  expect(box!.width).toBeGreaterThan(330);
});
