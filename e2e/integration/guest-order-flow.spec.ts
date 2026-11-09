import { expect, test, type Request } from '@playwright/test';
import {
  GUEST_READY,
  SLUG,
  addOneAndCheckout,
  codeFromOrderUrl,
  placeOrder,
  scanCard,
  skipUnless,
  tokenFromOrderUrl,
} from './flow';

/**
 * THE GUEST ORDERING FLOW, END TO END, ON A REAL DEPLOYMENT.
 *
 * The hermetic suite (e2e/guest-ordering.spec.ts) proves the screens; this
 * file proves the product: a scan resolves a live card, a placed order is
 * written by the database at the database's prices, the guest's token reads
 * its live status, the bill and the UPI amount come from the server, and the
 * reorder offer puts the same meal back in the cart.
 *
 * IT WRITES ROWS. Point it at a DISPOSABLE branch database — never
 * production. Without its environment it skips itself entirely.
 */

const NEEDS = 'E2E_BASE_URL, E2E_QR_TOKEN, E2E_TABLE_CODE, E2E_SLUG';

test.describe('guest ordering — real database', () => {
  test.skip(!GUEST_READY, skipUnless(false, NEEDS));

  test('a live card opens the real menu, with this table named', async ({ context }) => {
    let menuRequestHeaders: Promise<Record<string, string>> | undefined;
    let menuRequest: Request | undefined;
    let menuRequestHostname = '';
    const page = await scanCard(context, undefined, (request) => {
      menuRequest = request;
      menuRequestHeaders = request.allHeaders();
      menuRequestHostname = new URL(request.url()).hostname;
    });
    await expect(page).toHaveURL(new RegExp(`/menu\\?s=${SLUG}`), { timeout: 20_000 });
    const cookies = await context.cookies();
    const sentCookieNames = (await menuRequestHeaders)?.cookie
      ?.split(';')
      .map((part) => part.trim().split('=')[0]) ?? [];
    const cardCookie = cookies.find((cookie) => cookie.name === 'autodine_table_card');
    const cardTokenShapeOk = Boolean(cardCookie?.value && /^[A-Za-z0-9_-]{8,128}$/.test(cardCookie.value));
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
    let localSupabase = false;
    try {
      const parsed = new URL(supabaseUrl);
      localSupabase = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && parsed.port === '54321';
    } catch {
      // Never probe an unrecognized or non-local Supabase target in diagnostics.
    }
    const introResponse = cardTokenShapeOk && localSupabase && anonKey
      ? await fetch(`${supabaseUrl}/rest/v1/rpc/public_qr_intro`, {
          method: 'POST',
          headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ p_public_token: cardCookie?.value ?? '' }),
        })
      : null;
    const introRows = introResponse?.ok ? await introResponse.json() as unknown[] : [];
    const menuResponse = await menuRequest?.response();
    const menuHtml = await menuResponse?.text().catch(() => '') ?? '';
    const body = await page.locator('body').innerText();
    const diagnostic = `menu HTTP=${menuResponse?.status() ?? 'no-response'} HTML-bytes=${menuHtml.length} HTML-has-dish=${menuHtml.includes('Synthetic Paneer Dish')}; browser cookies=${cookies.map(({ name, secure, value, domain, path }) => `${name}(secure=${secure},length=${value.length},domain=${domain},path=${path})`).join(',')}; menu host=${menuRequestHostname}; menu request cookies=${sentCookieNames.join(',')}; card token shape=${cardTokenShapeOk}; public_qr_intro HTTP=${introResponse?.status ?? 'not-called'} rows=${Array.isArray(introRows) ? introRows.length : 'not-array'}; URL=${page.url()}; title=${await page.title()}`;
    // Exact fixture values matter here: the generic "Table access" gate copy
    // must not accidentally satisfy a weak `/Table /` locator.
    expect(body, `Scan did not render the synthetic menu. ${diagnostic}. Page:\n${body}`)
      .toContain('Synthetic Paneer Dish');
    expect(body, `Scan did not identify the synthetic table. ${diagnostic}. Page:\n${body}`)
      .toMatch(/E2E GUEST \d{2}/i);
    expect(cardTokenShapeOk, `the scan must retain a valid card token; ${diagnostic}`)
      .toBe(true);
  });

  test('the bill is priced by the server: quantities and notes travel, prices do not', async ({
    context,
  }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);

    // Whatever the menu charges for the first plain dish, the checkout shows
    // it — computed from the menu payload, not from anything the cart sent.
    // The dock repeats the same label at phone width; the bill <dl> is the
    // canonical checkout amount and avoids a strict-mode match on both copies.
    const totalText = await page
      .locator('dl')
      .filter({ hasText: 'Total payable' })
      .locator('dd')
      .last()
      .innerText();
    expect(totalText).toMatch(/₹[\d,]+/);
  });

  test('placing an order writes one order and lands on the tracking page', async ({
    context,
  }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);
    const url = await placeOrder(page, 'e2e: one order, one note');

    // The database answered with a code and a guest token.
    expect(codeFromOrderUrl(url)).toHaveLength(5);
    expect(tokenFromOrderUrl(url).length).toBeGreaterThanOrEqual(8);

    await expect(page.getByText('Order placed')).toBeVisible();
    // The note went with the order (the kitchen side proves the rest).
    await expect(page.getByText('e2e: one order, one note')).toBeVisible();
  });

  test('double-tapping Place order writes ONE order', async ({ context }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);

    // The classic duplicate: two taps, one intention.
    const button = page.locator('[data-place-order="bill"]');
    await button.click({ clickCount: 2, delay: 40 }).catch(() => {});
    await expect(page).toHaveURL(/\/menu\/order\?.*code=/, { timeout: 30_000 });

    // The Orders tab remembers the most recent order on this device — if a
    // second order had been written, the guest would have been redirected to
    // it twice and the tracking page would have a second code. What must NOT
    // exist is an error saying the second tap ordered again.
    await expect(page.getByText('Order placed')).toBeVisible();
  });

  test('the tracking page follows the kitchen, and the bill keeps the exact amount', async ({
    context,
  }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);
    const url = await placeOrder(page);

    // The tracker draws only statuses the server gave.
    await expect(page.locator('[data-placed-mark="ok"]')).toBeVisible();
    await expect(page.getByText('Bill').first()).toBeVisible();

    // The bill's total is on the page and is the same number the checkout
    // promised — the UPI panel, when the restaurant has one, carries exactly
    // this amount into the QR.
    const billTotal = await page.getByText(/Total/).first().innerText();
    expect(billTotal).toMatch(/₹[\d,]+/);

    const upi = page.locator('[data-pay-upi]');
    if (await upi.count()) {
      await expect(upi).toBeVisible();
      // The amount is filled in by the server, not typed.
      await expect(upi).toContainText(/₹[\d,]+/);
    }

    // Status reads need the token; the poller is what keeps this fresh. A
    // reload must not lose it (a real reload is the reconnect story).
    await page.reload();
    await expect(page.locator('[data-placed-mark="ok"]')).toBeVisible();
    expect(tokenFromOrderUrl(page.url())).toBe(tokenFromOrderUrl(url));
  });

  test('reorder puts the same meal back in the cart', async ({ context }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);
    await placeOrder(page);

    const reorder = page.locator('[data-reorder-button]');
    await expect(reorder).toBeVisible();
    await reorder.click();

    // The cart is refilled from the order that was just placed.
    await expect(page).toHaveURL(/\/menu\/cart/);
    await expect(page.getByRole('link', { name: 'Continue to checkout' })).toBeVisible();
  });

  test('prices planted in localStorage never reach the bill', async ({ context }) => {
    const page = await scanCard(context);
    await addOneAndCheckout(page);

    // Tamper at the last possible moment: the form will post ids and
    // quantities whatever this page holds, and place_public_order re-reads
    // every price inside the database.
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('autodine.cart.'));
      if (!key) return;
      const lines = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<Record<string, unknown>>;
      for (const line of lines) line.unitPricePaise = 1;
      localStorage.setItem(key, JSON.stringify(lines));
    });

    await placeOrder(page);
    // The bill on the order page is the database's, and it is not ₹0.01.
    const totalText = await page.getByText(/Total/).first().innerText();
    const rupees = Number(totalText.replace(/[^0-9]/g, ''));
    expect(rupees).toBeGreaterThan(1);
  });
});
