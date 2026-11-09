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
 * IT WRITES ROWS. `table_session_opens` gains up to two dozen. The supported
 * runner provisions a disposable local database; never point this at a branch
 * or production database.
 *
 * REQUIRES
 *
 *   E2E_BASE_URL   the local Next.js process started by scripts/e2e/run-throttle.sh
 *   E2E_QR_TOKEN   the synthetic card seeded into the disposable local database
 *
 * The runner rebuilds the DB for each invocation, so card usage starts fresh.
 * It refuses non-loopback database hosts and never reads production credentials.
 */

const TOKEN = process.env.E2E_QR_TOKEN ?? '';

test.describe('a card scanned too often', () => {
  test.skip(!TOKEN, 'set E2E_QR_TOKEN to a live card on a scan-mode restaurant');

  test('is refused by the database, and the guest is told on the menu itself', async ({ browser }) => {
    let refused = false;
    let lastUrl = '';
    let lastResponseInfo = '';
    let lastCookieInfo = '';
    const clientErrors: string[] = [];
    let page;

    for (let attempt = 1; attempt <= 25; attempt += 1) {
      // A fresh context is a fresh guest: no table session, no flags.
      const context = await browser.newContext();
      page = await context.newPage();
      page.on('pageerror', (error) => clientErrors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') clientErrors.push(message.text()); });
      page.on('requestfailed', (request) => clientErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`));
      const response = await page.goto(`/t/${TOKEN}`, { waitUntil: 'domcontentloaded' });
      lastUrl = page.url();
      lastResponseInfo = `${response?.status() ?? 'no response'} ${response?.headers()['content-type'] ?? ''}`;
      if (lastUrl.includes('v=throttled')) {
        refused = true;
        lastCookieInfo = JSON.stringify((await context.cookies()).map(({ name, domain, secure, sameSite }) => ({ name, domain, secure, sameSite })));
        break;
      }

      // Let the server-rendered menu finish before closing this fresh guest's
      // context; otherwise many abandoned streamed renders can queue behind the
      // real database and make the throttle observation nondeterministic.
      await page.getByText(/^(?:Local E2E dish|Synthetic Paneer Dish)$/).first().waitFor({ state: 'visible', timeout: 30_000 });
      await context.close();
    }

    // Ten opens per card, twenty per address, so 25 attempts cannot all pass.
    expect(refused, `no refusal in 25 scans; last address ${lastUrl}`).toBe(true);

    const notice = page!.locator('[data-throttle-note]');
    await expect(notice, `throttle notice missing at ${page!.url()}; response=${lastResponseInfo}; cookies=${lastCookieInfo}; clientErrors=${clientErrors.join(' || ')}`).toBeVisible({ timeout: 30_000 });

    // Assert the notice itself. Aggregating body.innerText() can race streamed
    // menu updates and is not the user's actual announcement node.
    const text = await notice.innerText();
    const lowerText = text.toLowerCase();
    expect(lowerText).toContain('table check paused');
    expect(lowerText).toContain('scanned unusually often');
    expect(lowerText).toContain('order with staff');

    // A throttled guest in a scan-mode restaurant has no code to type, so the
    // screen must not send them to a form that cannot help them.
    expect(lowerText).not.toContain('enter the code');
    expect(lowerText).not.toContain('ask a waiter');

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
    let lastResponseInfo = '';
    const clientErrors: string[] = [];
    page.on('pageerror', (error) => clientErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') clientErrors.push(message.text()); });
    page.on('requestfailed', (request) => clientErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`));

    for (let attempt = 1; attempt <= 25; attempt += 1) {
      const response = await page.goto(`/t/${TOKEN}`, { waitUntil: 'domcontentloaded' });
      lastResponseInfo = `${response?.status() ?? 'no response'} ${response?.headers()['content-type'] ?? ''}`;
      if (page.url().includes('v=throttled')) break;

      // Same browser, cleared cookies: the guest, not the card budget, is what
      // the loop varies; the opens table keeps counting either way. Wait for
      // this render to finish before starting the next scan.
      await page.getByText(/^(?:Local E2E dish|Synthetic Paneer Dish)$/).first().waitFor({ state: 'visible', timeout: 30_000 });
      await context.clearCookies();
    }

    const flag = new URL(page.url(), baseURL).searchParams.get('v') ?? '';
    const cookieInfo = JSON.stringify((await context.cookies()).map(({ name, domain, secure, sameSite }) => ({ name, domain, secure, sameSite })));
    const notice = page.locator('[data-throttle-note]');
    await expect(notice, `throttle notice missing at ${page.url()}; flag=${flag}; response=${lastResponseInfo}; cookies=${cookieInfo}; clientErrors=${clientErrors.join(' || ')}`).toBeVisible({ timeout: 30_000 });
    const text = await notice.innerText();
    expect(text.toLowerCase()).toContain('table check paused');

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
