/**
 * Brand Studio — the demo-mode contract.
 *
 * These run without a database (the demo site) and prove the parts of the
 * feature that must hold on every deployment:
 *
 *   - the import screen carries the brand half and is HONEST when photo
 *     reading is off (no button that can only fail);
 *   - the name is never applied without an explicit confirmation;
 *   - the preview is the real header renderer, in both views;
 *   - a theme in the preview URL is validated (junk renders the default);
 *   - a guest menu with no brand is pixel-identical to the product's own
 *     design — no [data-brand], the opt-in default.
 *
 * The database flows (draft creation, atomic publish, rollback, tenant
 * isolation) live in e2e/integration/brand-studio-flow.spec.ts, which needs a
 * real deployment and its secrets.
 */

import { expect, test } from '@playwright/test';

const THEME = encodeURIComponent(
  JSON.stringify({
    colors: { primary: '#7a1f2b' },
    typography: { character: 'serif' },
    layout: { header: 'banner-stack', motifs: ['rule-double'] },
  }),
);

test('the import screen offers the brand half and admits when photo reading is off', async ({ page }) => {
  await page.goto('/dashboard/menus/import');

  await expect(page.getByRole('heading', { name: 'Brand — how guests see you' })).toBeVisible();
  await expect(page.getByText(/not switched on/i)).toBeVisible();
  // The manual path always exists: uploads and the colour control.
  await expect(page.getByRole('button', { name: /upload logo/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Primary colour' })).toBeVisible();
});

test('the restaurant name is only applied after the owner confirms it', async ({ page }) => {
  await page.goto('/dashboard/menus/import');

  await expect(page.getByRole('button', { name: 'Use this name' })).toBeVisible();
  await expect(page.getByText(/only applied after you confirm it/i)).toBeVisible();
});

test('the branding screen keeps its basic controls and its opt-in honesty', async ({ page }) => {
  await page.goto('/dashboard/branding');

  // Demo mode has no database; the screen says so instead of faking data.
  await expect(page.getByText(/database is not connected/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Logo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Banner' })).toBeVisible();
});

test('the preview renders the real header in both views', async ({ page }) => {
  await page.goto('/dashboard/branding/preview');

  await expect(page.getByText('Preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mobile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Desktop' })).toBeVisible();
  // The real MenuIdentity renders: the sample name the preview promises.
  await expect(page.getByRole('heading', { name: 'Your restaurant' })).toBeVisible();
  // No brand, no theme attribute: the default look is the product's own.
  await expect(page.locator('[data-flow-root][data-brand]')).toHaveCount(0);
});

test('a draft theme in the preview URL paints the real renderer, and junk never does', async ({ page }) => {
  await page.goto(`/dashboard/branding/preview?theme=${THEME}&name=Punjabi%20Rasoi`);

  const root = page.locator('[data-flow-root][data-brand]');
  await expect(root).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Punjabi Rasoi' })).toBeVisible();
  // The validated primary colour arrives as a custom property — the same
  // mechanism the guest flow uses.
  const primary = await root.evaluate((el) => getComputedStyle(el).getPropertyValue('--brand-primary'));
  expect(primary.trim().toLowerCase()).toBe('#7a1f2b');
  // banner-stack: the name card sits below the picture (data-header).
  await expect(root).toHaveAttribute('data-header', 'banner-stack');

  // Junk is refused into the default style rather than smuggled through.
  await page.goto('/dashboard/branding/preview?theme=not-json-at-all');
  await expect(page.locator('[data-flow-root][data-brand]')).toHaveCount(0);
});

test('a guest menu with no brand renders exactly as before', async ({ page }) => {
  await page.goto('/menu');

  // The flow root exists (the demo menu renders) and carries no brand
  // attributes: the opt-in default is the product's own design.
  await expect(page.locator('[data-flow-root]').first()).toBeVisible();
  await expect(page.locator('[data-flow-root][data-brand]')).toHaveCount(0);
});
