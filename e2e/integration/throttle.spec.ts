import { expect, test } from '@playwright/test';

/**
 * A REAL THROTTLE, IN A REAL BROWSER, AGAINST A REAL DATABASE.
 *
 * WHY THIS IS NOT IN THE MAIN SUITE
 *
 * The hermetic suite runs with no Supabase environment at all, so
 * `open_table_session` is never called and `limited` is unreachable. Adding a
 * query parameter to fake it would test the parameter.
 *
 * WHAT IT DOES
 *
 * Scans one live card from a fresh browser context each time — a new context has
 * no cookies, so every scan is a new guest and every scan asks the database to
 * mint a session. The limit is ten opens per card per hour (and twenty per
 * address), so within a couple of dozen attempts the database must start
 * answering `limited`. The test then checks what the guest actually sees.
 *
 * IT WRITES ROWS. `table_session_opens` gains up to two dozen. That is fine on a
 * branch database and unacceptable on production, which is why this never runs
 * automatically.
 *
 * REQUIRES
 *
 *   E2E_BASE_URL   an environment with 20261028000900 applied
 *   E2E_QR_TOKEN   a live card whose restaurant is in 'scan' or 'scan_confirm'
 *                  mode (dashboard → Settings → verification)
 *
 * If a card's hour is already spent, the limit is simply reached sooner — that
 * only makes the test pass faster. If the card is on a code-mode restaurant,
 * the scan never mints and the test fails with that explanation.
 */

const TOKEN = process.env.E2E_QR_TOKEN ?? '';

test.describe('a card scanned too often', () => {
  test.skip(!TOKEN, 'set E2E_QR_TOKEN to a live card on a scan-mode restaurant');

  test('is refused by the database, and the guest is told on the menu itself', async ({ browser }) => {
    let refused = false;
    let lastUrl = '';
    let page;

    for (let attempt = 1; attempt <= 25; attempt += 1) {
      // A fresh context is a fresh guest: no table session, no flags.
      const context = await browser.newContext();
      page = await context.newPage();
      await page.goto(`/t/${TOKEN}`, { waitUntil: 'domcontentloaded' });

      lastUrl = page.url();
      if (lastUrl.includes('v=throttled')) {
        refused = true;
        break;
      }

      await context.close();
    }

    // Ten opens per card, twenty per address, so 25 attempts cannot all pass.
    expect(refused, `no refusal in 25 scans; last address ${lastUrl}`).toBe(true);

    const notice = page!.getByRole('status').filter({ hasText: 'Table check paused' });
    await expect(notice).toBeVisible();

    // What the guest is owed: why, and what to do next.
    const text = (await notice.innerText()).toLowerCase();
    expect(text).toContain('scanned unusually often');
    expect(text).toContain('order with staff');

    // A throttled guest in a scan-mode restaurant has no code to type, so the
    // screen must not send them to a form that cannot help them.
    expect(text).not.toContain('enter the code');
    expect(text).not.toContain('ask a waiter');

    // Nothing has been ordered, and nothing may say otherwise.
    const body = (await page!.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('order placed');
    expect(body).not.toContain('order confirmed');
    expect(body).not.toContain('sent to the kitchen');

    // And the menu is still readable — browsing was never the problem. The
    // notice only ever renders inside the menu screen, so its presence plus the
    // /menu address is the proof that the guest was not dumped on a gate.
    expect(page!.url()).toContain('/menu?s=');
    // The cart dock exists only on the menu screen, so its presence is the
    // difference between "the notice rendered" and "the guest got a gate page
    // that happens to mention a pause".
    await expect(page!.locator('a[href^="/menu/cart"]').first()).toBeVisible();
  });

  test('carries no retry number unless the database returned one', async ({ browser, baseURL }) => {
    /*
     * Today `open_table_session` returns five columns and no wait time, so the
     * notice must say "a short while" and quote no number. When L1 adds
     * `retry_after_seconds`, the address becomes `v=throttled.<n>` and the
     * sentence gains the minute count — this test then asserts the number it
     * was given, rather than a hard-coded one.
     */
    const context = await browser.newContext();
    const page = await context.newPage();

    for (let attempt = 1; attempt <= 25; attempt += 1) {
      await page.goto(`/t/${TOKEN}`, { waitUntil: 'domcontentloaded' });
      if (page.url().includes('v=throttled')) break;

      // Same browser, cleared cookies: the guest, not the card budget, is what
      // the loop varies; the opens table keeps counting either way.
      await context.clearCookies();
    }

    const flag = new URL(page.url(), baseURL).searchParams.get('v') ?? '';
    const notice = page.getByRole('status').filter({ hasText: 'Table check paused' });
    await expect(notice).toBeVisible();
    const text = await notice.innerText();

    const seconds = flag.startsWith('throttled.') ? Number(flag.slice('throttled.'.length)) : null;

    if (seconds && Number.isFinite(seconds) && seconds > 0) {
      const minutes = Math.ceil(seconds / 60);
      expect(text).toContain(`about ${minutes} minutes`);
    } else {
      expect(text).toContain('a short while');
      expect(text).not.toMatch(/\d+ minutes/);
    }

    await context.close();
  });
});
