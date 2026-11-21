import { expect, test } from '@playwright/test';
import { RAIL, expectShell, railLink, trackDocumentLoads, waitForHydration } from './shell';

/**
 * The laptop shell: a fixed 244px rail that must never flicker.
 *
 * The unit suite proves the rail is in the markup. These tests prove the thing
 * a person actually asked for -- that it is still there while they move
 * between screens, that Back and Forward work, and that a reload lands on the
 * same screen inside the same navigation.
 */

test('Kitchen renders inside the shell, with the rail on screen', async ({ page }) => {
  await page.goto('/kitchen');

  await expectShell(page, 'kitchen');

  // On a laptop the rail is a fixed column at the left edge -- visible, not
  // merely present in the DOM.
  const rail = await page.locator(RAIL).boundingBox();
  expect(rail).not.toBeNull();
  expect(Math.round(rail!.x)).toBe(0);
  expect(Math.round(rail!.width)).toBe(244);
  expect(rail!.height).toBeGreaterThan(700);

  // And the board itself loaded, so this is not an empty shell.
  await expect(railLink(page, 'Kitchen')).toBeVisible();
  await expect(page.locator('main')).not.toBeEmpty();
});

test('clicking Kitchen keeps the shell and never reloads the document', async ({ page }) => {
  await page.goto('/dashboard');
  await expectShell(page, 'overview');

  await waitForHydration(page);
  const documentLoads = trackDocumentLoads(page);

  await railLink(page, 'Kitchen').click();

  await expect(page).toHaveURL(/\/kitchen$/);
  await expectShell(page, 'kitchen');
  expect(documentLoads, 'a client navigation must not reload the document').toEqual([]);
});

test('Back and Forward move between screens without reloading', async ({ page }) => {
  await page.goto('/dashboard');
  await expectShell(page, 'overview');
  await waitForHydration(page);

  await railLink(page, 'Kitchen').click();
  await expectShell(page, 'kitchen');

  const documentLoads = trackDocumentLoads(page);

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expectShell(page, 'overview');

  await page.goForward();
  await expect(page).toHaveURL(/\/kitchen$/);
  await expectShell(page, 'kitchen');

  expect(documentLoads, 'Back/Forward must stay inside the SPA').toEqual([]);
});

test('a reload of Kitchen comes back to the same screen inside the same shell', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await railLink(page, 'Kitchen').click();
  await expectShell(page, 'kitchen');

  await page.reload();

  await expect(page).toHaveURL(/\/kitchen$/);
  await expectShell(page, 'kitchen');
  const rail = await page.locator(RAIL).boundingBox();
  expect(Math.round(rail!.width)).toBe(244);
});

test('a direct URL is the same screen as arriving by click', async ({ page }) => {
  // Cut-and-paste, a bookmark, or a link from a chat: no history, no referrer.
  const response = await page.goto('/kitchen');
  expect(response?.status()).toBeLessThan(400);
  await expectShell(page, 'kitchen');
});
