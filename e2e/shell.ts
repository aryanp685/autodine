import { expect, type Page } from '@playwright/test';

/**
 * Shared helpers for the browser tests. No assertions about taste: these are
 * the shell's promises, expressed as DOM facts.
 */

export const RAIL = '#app-rail';

/** The rail, once, with exactly one current row -- the whole shell contract. */
export async function expectShell(page: Page, section: string) {
  await expect(page.locator(RAIL)).toHaveCount(1);
  await expect(page.locator('main')).toHaveCount(1);

  const current = page.locator('[data-nav-active="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAttribute('data-nav', section);
  await expect(current).toHaveAttribute('aria-current', 'page');
}

/**
 * Wait until React has taken over.
 *
 * WHY THIS IS NOT A `waitForTimeout`
 *
 * A `next/link` only navigates on the client once it is hydrated. Clicking
 * before that turns the anchor into a normal link and the page reloads -- which
 * would make the "does not reload" test fail for a reason that has nothing to
 * do with the bug it is meant to catch. React marks the host node it controls,
 * and that mark is the honest signal that a click is handled by the router
 * rather than by the browser.
 */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(
    () => {
      const link = document.querySelector('[data-nav="kitchen"]');
      if (!link) return false;
      return Object.keys(link).some(
        (key) => key.startsWith('__reactProps') || key.startsWith('__reactFiber'),
      );
    },
    undefined,
    { timeout: 15_000 },
  );
}

/**
 * Full-page loads from here on.
 *
 * `resourceType === 'document'` is a top-level navigation. A client-side route
 * change is a fetch plus a history entry and produces none, so an empty array
 * after a click is proof that the shell was patched in place rather than
 * re-downloaded.
 */
export function trackDocumentLoads(page: Page): string[] {
  const loaded: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'document') loaded.push(request.url());
  });
  return loaded;
}

/**
 * A destination in the rail.
 *
 * Scoped to the rail on purpose: `getByRole('link', { name })` matches a
 * substring, and a screen may legitimately contain another link whose name
 * mentions the same word ("Kitchen display", for instance). The rail is what
 * this suite is about.
 */
export function railLink(page: Page, name: string) {
  return page.locator(RAIL).getByRole('link', { name });
}
