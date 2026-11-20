import { expect, test } from '@playwright/test';
import { a, cartCheckout, place, scan, sql, staffContext, tickets, venueCode, verify } from './flow';

/**
 * The staff socket, end to end through the same origin the browser uses.
 *
 * The fixture is a Phoenix subset over `ws`, not Supabase Realtime: it reads
 * PostgreSQL's commit-gated NOTIFY and re-checks each row through the real RLS
 * projection. What it proves is that a committed change reaches the screen
 * without a reload, that a broken socket degrades instead of pretending, and
 * that the screen recovers. Order contents never travel in the signal.
 */
const control = async (body?: Record<string, unknown>) => {
  const response = await fetch(new URL('/__journey', process.env.JOURNEY_BRIDGE_URL!), {
    method: body ? 'POST' : 'GET',
    headers: { 'x-journey-control': process.env.JOURNEY_CONTROL! },
    body: body ? JSON.stringify(body) : undefined,
  });
  expect(response.status).toBe(200);
  return response.json();
};

test('a committed kitchen change reaches staff over the socket, and a dropped socket recovers', async ({ page, browser }) => {
  await scan(page, a, 'A6');
  await page.getByRole('button', { name: 'Add Journey rice' }).click();
  await cartCheckout(page);
  await verify(page, await venueCode(a));
  await place(page).click();
  await expect(page).toHaveURL(/\/menu\/order\?/);
  const [ticket] = await tickets(a, 'A6');
  expect(ticket.prep_status).toBe('new');

  const desk = await staffContext(browser, 'owner');
  try {
    const staff = await desk.newPage();
    await staff.goto('/kitchen');
    // The seeded Supabase session cookie is what makes this a real browser
    // subscription instead of a server-rendered page with no socket.
    await expect(staff.locator('[data-live-delivery]')).toHaveAttribute('data-live-delivery', 'live', { timeout: 20_000 });
    const card = staff.locator('article[data-state]').filter({ hasText: ticket.code });
    await expect(card).toHaveAttribute('data-state', 'new');
    await staff.evaluate(() => Object.defineProperty(window, '__journeyDocument', { value: 'same', configurable: true }));

    await sql("update orders set prep_status='preparing' where id=$1", [ticket.id]);
    await expect(staff.locator('article[data-state]').filter({ hasText: ticket.code }))
      .toHaveAttribute('data-state', 'preparing', { timeout: 20_000 });
    // The update came through router.refresh(), not a navigation or a reload.
    expect(await staff.evaluate(() => (window as unknown as { __journeyDocument?: string }).__journeyDocument)).toBe('same');
    expect(await control()).toMatchObject({ realtime: { joined: expect.any(Number) } });
    const joined = (await control()).realtime.joined as number;
    expect(joined).toBeGreaterThan(0);

    // A socket that closes without a clean leave must not leave the board
    // claiming to be live; the coordinator degrades, then rejoins by itself.
    expect((await control({ realtime: 'disconnect' })).ok).toBe(true);
    await expect(staff.locator('[data-live-delivery]')).not.toHaveAttribute('data-live-delivery', 'live', { timeout: 20_000 });
    expect((await control({ realtime: 'normal' })).ok).toBe(true);
    await expect(staff.locator('[data-live-delivery]')).toHaveAttribute('data-live-delivery', 'live', { timeout: 30_000 });
    expect((await control()).realtime.joined as number).toBeGreaterThan(joined);

    // And the recovered socket still delivers a later change.
    await sql("update orders set prep_status='ready' where id=$1", [ticket.id]);
    await expect(staff.locator('article[data-state]').filter({ hasText: ticket.code }))
      .toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  } finally {
    await desk.close();
  }
});
