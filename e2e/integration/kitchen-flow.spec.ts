import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  BASE,
  fixtureTableLabel,
  GUEST_READY,
  STAFF_READY,
  addOneAndCheckout,
  placeOrder,
  scanCard,
  signInOwner,
  skipUnless,
  tokenFromOrderUrl,
} from './flow';
import { announcementCount, announcementTexts, recordAnnouncements } from '../flow-helpers';

/**
 * THE KITCHEN WORKFLOW, END TO END, ON A REAL DEPLOYMENT.
 *
 * Staff authentication (the proxy), an order arriving from a real guest,
 * the board's transitions, the guest-side status following along, real
 * cancellation, and missed-order recovery. Every test places its own order —
 * the board is shared state and tests must not spend each other's tickets.
 *
 * IT WRITES ROWS. Point it at a DISPOSABLE branch database only.
 */

const NEEDS = 'E2E_BASE_URL, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD (+ E2E_QR_TOKEN, E2E_TABLE_CODE, E2E_SLUG for the guest halves)';

/** Place one order as a guest, note used as the ticket's handle on the board. */
async function placeGuestOrder(context: BrowserContext, note: string): Promise<string> {
  const page = await scanCard(context);
  await addOneAndCheckout(page);
  const url = await placeOrder(page, note);
  const token = tokenFromOrderUrl(url);
  expect(token.length).toBeGreaterThanOrEqual(8);
  return url;
}

/** A fresh guest render must reflect the committed kitchen transition. */
async function reloadGuestUntilStep(page: Page, label: string) {
  await expect
    .poll(
      async () => {
        await page.reload({ waitUntil: 'domcontentloaded' });
        return page.locator('[data-placed-step="now"]').innerText();
      },
      { timeout: 15_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toContain(label);
}

test.describe('kitchen — real database', () => {
  test.skip(!STAFF_READY, skipUnless(false, NEEDS));

  test('staff authentication: no session, no board', async ({ context }) => {
    const anon = await context.newPage();
    await anon.goto(`${BASE}/kitchen`);
    // The proxy is the door. Signed out means the login page, not a board
    // with real orders on it.
    await expect(anon).toHaveURL(/\/login/, { timeout: 20_000 });

    const owner = await signInOwner(context);
    await owner.goto(`${BASE}/kitchen`);
    await expect(owner.locator('#app-rail')).toBeVisible();
  });

  test('a real order lands on the board with its table, items, quantities and note', async ({
    context,
  }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    await placeGuestOrder(context, 'e2e: less chilli in the gravy');

    const board = await signInOwner(context);
    await board.goto(`${BASE}/kitchen`);

    const ticket = board.locator('article[data-state="new"]', {
      hasText: 'e2e: less chilli in the gravy',
    });
    await expect(ticket).toBeVisible({ timeout: 45_000 });
    await expect(ticket).toContainText(/×/); // quantities per line
    await expect(ticket).toContainText(new RegExp(fixtureTableLabel(), 'i')); // synthetic fixture table
  });

  test('Preparing → Ready → Served, and the guest watches it happen', async ({ context }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    const guestUrl = await placeGuestOrder(context, 'e2e: status sync ticket');

    // The guest's own page — the thing that must follow the kitchen.
    const guest = await context.newPage();
    await guest.goto(guestUrl);
    await expect(guest.locator('[data-placed-step="now"]')).toContainText('Sent to the kitchen', {
      timeout: 20_000,
    });

    const board = await signInOwner(context);
    await board.goto(`${BASE}/kitchen`);
    const ticket = board.locator('article[data-state="new"]', {
      hasText: 'e2e: status sync ticket',
    });
    await expect(ticket).toBeVisible({ timeout: 45_000 });

    await ticket.getByRole('button', { name: 'Start preparing' }).click();
    const preparing = board.locator('article[data-state="preparing"]', {
      hasText: 'e2e: status sync ticket',
    });
    await expect(preparing).toBeVisible({ timeout: 45_000 });
    await reloadGuestUntilStep(guest, 'Being cooked');

    await preparing.getByRole('button', { name: 'Mark ready' }).click();
    const ready = board.locator('article[data-state="ready"]', {
      hasText: 'e2e: status sync ticket',
    });
    await expect(ready).toBeVisible({ timeout: 45_000 });
    await reloadGuestUntilStep(guest, 'Ready to serve');

    await ready.getByRole('button', { name: 'Mark served' }).click();
    await expect(
      board.locator('article[data-state="served"]', { hasText: 'e2e: status sync ticket' }),
    ).toBeVisible({ timeout: 20_000 });
    await reloadGuestUntilStep(guest, 'Served');
  });

  test('a kitchen cancellation reaches the guest as cancelled', async ({ context }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    const guestUrl = await placeGuestOrder(context, 'e2e: cancel me from the pass');

    const guest = await context.newPage();
    await guest.goto(guestUrl);

    const board = await signInOwner(context);
    await board.goto(`${BASE}/kitchen`);
    const ticket = board.locator('article[data-state="new"]', {
      hasText: 'e2e: cancel me from the pass',
    });
    await expect(ticket).toBeVisible({ timeout: 45_000 });

    await ticket.getByRole('button', { name: /Cancel order for/ }).click();
    await board.getByRole('button', { name: 'Yes, cancel' }).click();
    await expect(ticket).toHaveCount(0, { timeout: 20_000 });

    // The placed screen preserves an editable bill while it is new; refresh it
    // after cancellation to read the persisted terminal status without wiping
    // a guest's in-progress edits during ordinary polling.
    await guest.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      guest.getByText('This order was cancelled, so nothing is being cooked and nothing is owed.'),
    ).toBeVisible();
    await expect(guest.getByText(/^Nothing is being cooked and nothing is owed\./)).toBeVisible();
  });

  test('orders that arrive while the board cannot speak are kept and replayable', async ({
    context,
  }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));

    // Mute FIRST: the order then arrives into a board that cannot read it out,
    // which is exactly the state the missed queue exists for. The announcement
    // recorder must be installed before the board document loads, so it goes
    // on between sign-in and the board itself.
    const board = await signInOwner(context);
    await recordAnnouncements(board);
    await board.goto(`${BASE}/kitchen`);
    const audioToggle = board.getByRole('button', { name: /^Kitchen audio (on|off)$/ });
    if ((await audioToggle.getAttribute('aria-pressed')) === 'true') await audioToggle.click();
    await expect(audioToggle).toHaveAttribute('aria-pressed', 'false');

    await placeGuestOrder(context, 'e2e: arrived while muted');

    // The banner counts what was not read out, and keeps the orders below.
    await expect(
      board.getByText(/have not been read out\.|has not been read out\./),
    ).toBeVisible({ timeout: 45_000 });
    await expect(board.getByRole('button', { name: 'Read them out' })).toBeVisible();
    await expect(board.getByRole('button', { name: 'Dismiss' })).toBeVisible();

    // Reading them out is the recovery: put the voice back on, ask for the
    // replay, and the announcements fire now.
    await audioToggle.click();
    await expect(audioToggle).toHaveAttribute('aria-pressed', 'true');
    await board.getByRole('button', { name: 'Read them out' }).click();
    await expect
      .poll(() => announcementCount(board), { timeout: 15_000 })
      .toBeGreaterThan(0);
  });

  test('a new order is announced once — a refresh re-announces nothing', async ({ context }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));

    const board = await signInOwner(context);
    await recordAnnouncements(board);
    await board.goto(`${BASE}/kitchen`);
    // Opening the board does not read out what was already there.
    await board.waitForTimeout(2000);
    expect(await announcementCount(board)).toBe(0);

    await placeGuestOrder(context, 'e2e: announce me exactly once');

    await expect
      .poll(() => announcementCount(board), {
        timeout: 45_000,
        message: 'the new order was never announced',
      })
      .toBeGreaterThan(0);
    // One order is spoken in several sentence segments. Wait for the
    // announcement to finish, then prove no exact segment was replayed; a raw
    // length comparison falsely called the final sentence of one order a
    // duplicate when the first snapshot landed mid-utterance.
    await board.waitForTimeout(5000);
    const spoken = await announcementTexts(board);
    expect(spoken.length).toBeGreaterThan(0);
    expect(new Set(spoken).size, 'an utterance was repeated').toBe(spoken.length);

    // A refresh re-reads the board — and what was seen stays seen.
    await board.reload();
    await board.waitForTimeout(2500);
    expect(await announcementCount(board), 'a refresh re-announced the board').toBe(0);
  });
});
