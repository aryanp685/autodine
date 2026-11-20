import { expect, test, type Page } from '@playwright/test';
import { counterAttemptKey } from '../../lib/counter-attempt';
import { a, cartCheckout, fault, payments, place, scan, staffContext, tickets, venueCode, verify } from './flow';

async function orderRice(page: Page, table: string) {
  await scan(page, a, table);
  await page.getByRole('button', { name: 'Add Journey rice' }).click();
  await cartCheckout(page);
  await verify(page, await venueCode(a));
  await place(page).click();
  await expect(page).toHaveURL(/\/menu\/order\?/);
  const saved = await tickets(a, table);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ total_paise: 4201, payment_status: 'pending' });
  return saved[0];
}

async function holdRecording(page: Page) {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname === '/cashier', async route => {
    if (route.request().method() === 'POST') await gate;
    await route.continue();
  });
  return { release };
}

const cash = (page: Page) => page.getByRole('button', { name: /Record cash.*42\.01/ });
const original = (page: Page, id: string) => page.evaluate(key => localStorage.getItem(key), counterAttemptKey(a.id, id));

test('a saved quantity change cannot turn a stale amount into a different recorded tender', async ({ page, browser }) => {
  const ticket = await orderRice(page, 'A6');
  const context = await staffContext(browser, 'cashier');
  try {
    const desk = await context.newPage();
    await desk.goto(`/cashier?order=${ticket.id}`);
    const held = await holdRecording(desk);
    let before: string | null;
    try {
      await cash(desk).click();
      await expect(desk.getByRole('button', { name: 'Recording…' })).toBeDisabled();
      await expect.poll(() => original(desk, ticket.id)).not.toBeNull();
      before = await original(desk, ticket.id);
      expect(JSON.parse(before!)).toMatchObject({ method: 'cash', amountPaise: 4201 });
      await page.getByRole('button', { name: 'One more Journey rice' }).click();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect.poll(async () => (await tickets(a, 'A6'))[0].total_paise).toBe(8402);
    } finally { held.release(); }

    await expect(desk.getByText(/^Payment was not recorded by this request/)).toBeVisible();
    expect(await payments(ticket)).toHaveLength(0);
    await desk.reload();
    await expect(desk.getByRole('heading', { name: '₹84.02', exact: true })).toBeVisible();
    await expect(desk.getByText(/saved a Cash recording for ₹42\.01/i)).toBeVisible();
    await desk.getByRole('button', { name: 'Check original recording' }).click();
    await expect(desk.getByText(/^Recording could not be verified/)).toBeVisible();
    expect(await original(desk, ticket.id)).toBe(before!);
    expect(await payments(ticket)).toHaveLength(0);
  } finally { await context.close(); }
});

test('two cashier tabs cannot send two recordings, or change the original method while a write waits', async ({ page, browser }) => {
  const ticket = await orderRice(page, 'A7');
  const context = await staffContext(browser, 'cashier');
  try {
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto(`/cashier?order=${ticket.id}`);
    await second.goto(`/cashier?order=${ticket.id}`);
    await second.getByRole('button', { name: 'Card', exact: true }).click();
    await expect(second.getByRole('button', { name: /Record CARD.*42\.01/ })).toBeEnabled();
    let secondWrites = 0;
    await second.route(url => url.pathname === '/cashier', async route => {
      if (route.request().method() === 'POST') secondWrites++;
      await route.continue();
    });
    const held = await holdRecording(first);
    try {
      await cash(first).click();
      await expect(second.getByText(/saved a Cash recording for ₹42\.01/i)).toBeVisible();
      const saved = await original(first, ticket.id);
      await second.getByRole('button', { name: 'Retry original recording' }).click();
      await expect(second.getByText(/^Another tab is checking this ticket/)).toBeVisible();
      expect(await original(second, ticket.id)).toBe(saved);
      expect(secondWrites).toBe(0);
      expect(await payments(ticket)).toHaveLength(0);
    } finally { held.release(); }
    await expect(first.getByText(/CASH ₹42\.01 recorded/)).toBeVisible();
    expect(await payments(ticket)).toEqual([{ method: 'cash', amount_paise: 4201, status: 'recorded', provider: 'counter', event_type: 'cash_collected' }]);
    await second.reload();
    await expect(second.getByText(/^This ticket is no longer in the counter queue/)).toBeVisible();
    await expect(second.locator('[data-counter-cta]:enabled')).toHaveCount(0);
    expect(await original(second, ticket.id)).toBeNull();
    expect(secondWrites).toBe(0);
  } finally { await context.close(); }
});

test('a different saved tender does not confirm an unresolved recording for a now-paid ticket', async ({ page, browser }) => {
  const ticket = await orderRice(page, 'A8');
  const counter = await staffContext(browser, 'cashier');
  const otherCounter = await staffContext(browser, 'manager');
  try {
    const desk = await counter.newPage();
    await desk.goto(`/cashier?order=${ticket.id}`);
    await desk.getByRole('button', { name: 'Card', exact: true }).click();
    await fault('record_counter_payment', 'before-query');
    await desk.getByRole('button', { name: /Record CARD.*42\.01/ }).click();
    await expect(desk.getByText(/^Recording could not be verified/)).toBeVisible();
    const unresolved = await original(desk, ticket.id);
    expect(JSON.parse(unresolved!)).toMatchObject({ method: 'card', amountPaise: 4201 });
    expect(await payments(ticket)).toHaveLength(0);

    // The second synthetic terminal verifies a different tender. Only that
    // payment exists, even though ticket and total match the first attempt.
    const other = await otherCounter.newPage();
    await other.goto(`/cashier?order=${ticket.id}`);
    await cash(other).click();
    await expect(other.getByText(/CASH ₹42\.01 recorded/)).toBeVisible();
    await desk.reload();
    await desk.getByRole('button', { name: 'Check original recording' }).click();
    await expect(desk.getByText(/^Recording could not be verified/)).toBeVisible();
    await expect(desk.getByText(/CARD ₹42\.01 recorded/)).toHaveCount(0);
    await expect(desk.locator('[data-counter-cta]:enabled')).toHaveCount(0);
    expect(await original(desk, ticket.id)).toBe(unresolved);
    expect(await payments(ticket)).toEqual([{ method: 'cash', amount_paise: 4201, status: 'recorded', provider: 'counter', event_type: 'cash_collected' }]);
  } finally { await counter.close(); await otherCounter.close(); }
});

test('without a browser lock or durable attempt storage the cashier cannot send a tender', async ({ page, browser }) => {
  const ticket = await orderRice(page, 'A9');
  const context = await staffContext(browser, 'cashier');
  try {
    const noLock = await context.newPage();
    await noLock.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
    await noLock.goto(`/cashier?order=${ticket.id}`);
    await expect(cash(noLock)).toBeDisabled();
    await expect(noLock.getByText(/browser storage are required to record payment/)).toBeVisible();

    const noStorage = await context.newPage();
    await noStorage.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('ad_counter:')) throw new DOMException('Synthetic storage quota', 'QuotaExceededError');
        return setItem.call(this, key, value);
      };
    });
    let sent = 0;
    await noStorage.route(url => url.pathname === '/cashier', async route => {
      if (route.request().method() === 'POST') sent++;
      await route.continue();
    });
    await noStorage.goto(`/cashier?order=${ticket.id}`);
    await cash(noStorage).click();
    await expect(noStorage.getByText(/^Recording could not be verified/)).toBeVisible();
    expect(sent).toBe(0);
    expect(await original(noStorage, ticket.id)).toBeNull();
    expect(await payments(ticket)).toHaveLength(0);
  } finally { await context.close(); }
});
