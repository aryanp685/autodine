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

test('the kitchen board keeps its one tap on a 390px screen', async ({ page }) => {
  /* THE SCREEN IS THE QUEUE, NOT A PREVIEW OF IT.
   *
   * A board opened on a phone shows one column, so every control on a ticket
   * has to fit inside 390px: no horizontal scroll, no button hanging off the
   * right edge, and no shrink-wrapped action that a thumb cannot find. This is
   * the browser-level proof of a layout rule -- the unit tests can only assert
   * the class strings that implement it.
   *
   * The sample board is what demo mode renders, and its tickets are in "New",
   * which is the column a phone opens on. */
  await page.goto('/kitchen');

  const advance = page.getByRole('button', { name: 'Start preparing' }).first();
  await expect(advance).toBeVisible();

  // Nothing is wider than the screen. Polled, because the first frame after
  // hydration can still carry the pre-hydration layout.
  await expect
    .poll(
      async () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      { message: 'the board scrolls sideways on a phone' },
    )
    .toBeLessThanOrEqual(1);

  const box = await advance.boundingBox();
  expect(box, 'the move action has no box').not.toBeNull();
  // Fully inside the viewport, with a pixel of tolerance for sub-pixel layout.
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390.5);
  // And it is the 44px target the board promises, not a 36px one.
  expect(box!.height).toBeGreaterThanOrEqual(43.5);
  // Full width means most of the card, not a label at the right end.
  expect(box!.width).toBeGreaterThan(240);

  // And the ticket itself is readable: nothing inside a card is wider than the
  // card. A flex row that refuses to shrink and a nowrap modifier chip both
  // show up here, and both are the difference between "Extra cheese" and
  // "Extra che".
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('article[data-state]')]
      .map((card) => card.scrollWidth - card.clientWidth)
      .filter((over) => over > 1),
  );
  expect(clipped, 'a ticket card clips its contents').toEqual([]);

  // The special instruction is on the card in full, not truncated to a line.
  await expect(page.locator('article[data-state]').first()).toContainText('no onion in the gravy');
});
