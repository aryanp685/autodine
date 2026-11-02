import { expect, test } from '@playwright/test';
import { announcementCount, recordAnnouncements } from './flow-helpers';

/**
 * THE KITCHEN BOARD, IN A BROWSER.
 *
 * The sample board (lib/demo-data.ts) is the fixture: five tickets in every
 * state the pass knows — New, Preparing, Ready, Served — with tables, item
 * quantities, a special instruction and a payment chip. Demo mode keeps the
 * board's moves in this browser (demoState), which is exactly enough to prove
 * the controls, the states and the voice rules at the DOM level.
 *
 * WHAT LIVES IN e2e/integration/kitchen-flow.spec.ts INSTEAD
 *
 * Staff authentication (the proxy), orders arriving from real guests, the
 * guest-side status synchronisation, real cancellations, and missed-order
 * recovery after a disconnect. Those need a deployment and accounts; they
 * skip themselves without one.
 */

test.describe('incoming orders are readable at a glance', () => {
  test('a ticket shows the table, every item with its quantity, and the note in full', async ({
    page,
  }) => {
    await page.goto('/kitchen');

    const ticket = page.locator('article[data-state="new"]', { hasText: 'T7' });
    await expect(ticket).toHaveCount(1);

    // Table and order code.
    await expect(ticket).toContainText('T7');
    await expect(ticket).toContainText('A-1042');

    // Every line, with the quantity that was ordered.
    await expect(ticket).toContainText('1×');
    await expect(ticket).toContainText('Butter Chicken');
    await expect(ticket).toContainText('Regular · Hot · Butter naan');
    await expect(ticket).toContainText('2×');
    await expect(ticket).toContainText('Butter Naan');
    await expect(ticket).toContainText('Mango Lassi');

    // The guest's instruction is on the card in full — not truncated, and not
    // lost in a tooltip.
    await expect(ticket).toContainText('Ring the bell — no onion in the gravy.');
  });

  test('payment state is on the ticket: paid online vs pay at counter', async ({ page }) => {
    await page.goto('/kitchen');

    await expect(
      page.locator('article[data-state="new"]', { hasText: 'T7' }),
    ).toContainText('UPI · paid online');
    await expect(
      page.locator('article[data-state="preparing"]', { hasText: 'T3' }),
    ).toContainText('Pay at counter');
  });
});

test.describe('Preparing → Ready → Served', () => {
  test('one tap moves a ticket forward, and only forward', async ({ page }) => {
    await page.goto('/kitchen');

    // New → Preparing.
    const start = page
      .locator('article[data-state="new"]', { hasText: 'T7' })
      .getByRole('button', { name: 'Start preparing' });
    await start.click();
    await expect(page.locator('article[data-state="preparing"]', { hasText: 'T7' })).toHaveCount(1);
    await expect(page.locator('article[data-state="new"]', { hasText: 'T7' })).toHaveCount(0);

    // Preparing → Ready.
    await page
      .locator('article[data-state="preparing"]', { hasText: 'T7' })
      .getByRole('button', { name: 'Mark ready' })
      .click();
    await expect(page.locator('article[data-state="ready"]', { hasText: 'T7' })).toHaveCount(1);

    // Ready → Served, which is the end of the line: no further action, and no
    // cancel on food that has already gone out.
    const served = page.locator('article[data-state="served"]', { hasText: 'T7' });
    await page
      .locator('article[data-state="ready"]', { hasText: 'T7' })
      .getByRole('button', { name: 'Mark served' })
      .click();
    await expect(served).toHaveCount(1);
    await expect(served.getByRole('button', { name: 'Start preparing' })).toHaveCount(0);
    await expect(served.getByRole('button', { name: 'Mark ready' })).toHaveCount(0);
    await expect(served.getByRole('button', { name: 'Mark served' })).toHaveCount(0);
    await expect(served.getByRole('button', { name: 'Cancel order for T7' })).toHaveCount(0);
  });

  test('a moved ticket leaves its column behind empty and honest', async ({ page }) => {
    await page.goto('/kitchen');

    await page
      .locator('article[data-state="new"]', { hasText: 'T7' })
      .getByRole('button', { name: 'Start preparing' })
      .click();

    // The New column is now empty and says so — an empty column that looks
    // broken is how a cook learns to distrust the board.
    await expect(page.locator('article[data-state="new"]')).toHaveCount(0);
    await expect(page.getByText('Nothing here').first()).toBeVisible();
  });
});

test.describe('cancellation', () => {
  test('cancel asks first, and "No" changes nothing', async ({ page }) => {
    await page.goto('/kitchen');

    await page.getByRole('button', { name: 'Cancel order for T7' }).click();

    // Two taps, and the second one is a named question, not a repeat of the
    // first label: "Cancel" next to the move action is one slip from losing a
    // guest's order.
    await expect(page.getByRole('button', { name: 'Yes, cancel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'No' })).toBeVisible();

    await page.getByRole('button', { name: 'No' }).click();
    await expect(page.locator('article[data-state="new"]', { hasText: 'T7' })).toHaveCount(1);
  });

  test('a confirmed cancel removes the ticket from the board', async ({ page }) => {
    await page.goto('/kitchen');

    await page.getByRole('button', { name: 'Cancel order for T7' }).click();
    await page.getByRole('button', { name: 'Yes, cancel' }).click();

    await expect(page.locator('article[data-state="new"]', { hasText: 'T7' })).toHaveCount(0);
    await expect(page.locator('article[data-state]', { hasText: 'A-1042' })).toHaveCount(0);
  });
});

test.describe('voice announcements are never repeated', () => {
  test('the board announces each event once — and a refresh re-announces nothing', async ({
    page,
  }) => {
    await recordAnnouncements(page);
    await page.goto('/kitchen');
    await expect(page.locator('article[data-state="new"]', { hasText: 'T7' })).toBeVisible();

    // Every ticket already on the board is primed as seen: a board that
    // re-reads its own screen must not read the whole queue out loud again.
    await page.waitForTimeout(1500);
    expect(await announcementCount(page), 'opening the board announced old tickets').toBe(0);

    // A move announces once.
    await page
      .locator('article[data-state="new"]', { hasText: 'T7' })
      .getByRole('button', { name: 'Start preparing' })
      .click();
    await expect
      .poll(() => announcementCount(page), { message: 'the move was never announced' })
      .toBeGreaterThan(0);
    const afterMove = await announcementCount(page);

    // …once. Not again a beat later (the queue's duplicate rule), not once per
    // re-render.
    await page.waitForTimeout(1500);
    expect(await announcementCount(page), 'the move was announced twice').toBe(afterMove);

    // A cancellation is its own announcement, once.
    await page.getByRole('button', { name: 'Cancel order for T3' }).click();
    await page.getByRole('button', { name: 'Yes, cancel' }).click();
    await expect
      .poll(() => announcementCount(page), { message: 'the cancel was never announced' })
      .toBeGreaterThan(afterMove);
    const afterCancel = await announcementCount(page);
    await page.waitForTimeout(1500);
    expect(await announcementCount(page), 'the cancel was announced twice').toBe(afterCancel);

    // A refresh re-reads the board from scratch — and says nothing. What was
    // seen stays seen (localStorage), so the kitchen is not shouted at twice
    // for orders it already heard.
    await page.reload();
    await expect(page.locator('article[data-state="new"]', { hasText: 'T7' })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await announcementCount(page), 'a refresh re-announced the board').toBe(0);
  });
});

test.describe('refresh and reconnect', () => {
  test('a reload brings the board back inside the same shell, with its controls', async ({
    page,
  }) => {
    await page.goto('/kitchen');
    await page
      .locator('article[data-state="new"]', { hasText: 'T7' })
      .getByRole('button', { name: 'Start preparing' })
      .click();
    await expect(page.locator('article[data-state="preparing"]', { hasText: 'T7' })).toBeVisible();

    await page.reload();

    // The sample board keeps its state only in this browser; a reload is a
    // fresh read. What must never happen is a dead shell or missing controls:
    // the board comes back complete and tappable.
    await expect(page.locator('#app-rail')).toHaveCount(1);
    const ticket = page.locator('article[data-state="new"]', { hasText: 'T7' });
    await expect(ticket).toBeVisible();
    await expect(ticket.getByRole('button', { name: 'Start preparing' })).toBeEnabled();
    await expect(ticket).toContainText('Ring the bell — no onion in the gravy.');
  });
});
