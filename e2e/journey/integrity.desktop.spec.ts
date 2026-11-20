import { expect, test } from '@playwright/test';
import { a, b, cartCheckout, fault, place, scan, sql, tickets, venueCode, verify } from './flow';

test('a checkout tab cannot write after a different table at the same outlet was verified', async ({ page, context }) => {
  await scan(page, a, 'A2');
  await page.getByRole('button', { name: 'Add Journey rice' }).click();
  await cartCheckout(page);
  await verify(page, await venueCode(a));
  await expect(page.locator('input[name=table]')).toHaveValue(a.tables.A2.id);
  const nextTable = await context.newPage();
  await scan(nextTable, a, 'A3');
  await nextTable.goto(`/menu/checkout?s=${a.slug}`);
  await verify(nextTable, await venueCode(a));
  await expect(nextTable.locator('input[name=table]')).toHaveValue(a.tables.A3.id);
  await place(page).click();
  await expect(page.getByText(/the table changed since you opened checkout/i)).toBeVisible();
  expect(await tickets(a, 'A2')).toHaveLength(0);
  expect(await tickets(a, 'A3')).toHaveLength(0);
  expect(await page.evaluate(slug => !!localStorage.getItem(`autodine.cart.${slug}`), a.slug)).toBe(true);
  // Model time passing on the disposable session; no writes from expired access.
  await sql("update table_verification_sessions set expires_at=now()-interval '1 second' where table_id=$1", [a.tables.A3.id]);
  await nextTable.reload();
  await expect(nextTable.getByRole('heading', { name: 'Confirm your table' })).toBeVisible();
  expect(await tickets(a, 'A3')).toHaveLength(0);
});

test('failed code attempts take the existing budget; correct code cannot mint a session during the wait', async ({ page }) => {
  await scan(page, a, 'A10');
  await page.getByRole('button', { name: 'Add Journey rice' }).click();
  await cartCheckout(page);
  const correct = await venueCode(a);
  const wrong = `${(Number(correct[0]) + 1) % 10}${correct.slice(1)}`;
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('Six-digit code').fill(wrong);
    await expect(page).toHaveURL(/[?&]e=wrong/);
    await page.reload(); // A distinct, normal new page view of the same card.
  }
  await page.getByLabel('Six-digit code').fill(await venueCode(a));
  await expect(page.getByText(/too many attempts.*wait/i).first()).toBeVisible();
  expect(await sql('select id from table_verification_sessions where table_id=$1', [a.tables.A10.id])).toHaveLength(0);
  expect(await tickets(a, 'A10')).toHaveLength(0);
});

test('two checkout tabs and a temporary interruption leave one ticket in the sitting', async ({ page, context }) => {
  await scan(page, b, 'B2');
  await page.getByRole('button', { name: 'Add Journey sibling dish' }).click();
  await cartCheckout(page);
  const tab = await context.newPage();
  await tab.goto(page.url());
  await expect(place(page)).toBeEnabled();
  await expect(place(tab)).toBeEnabled();
  await fault('place_public_order_attempt', 'transient');
  await Promise.all([place(page).click(), place(tab).click()]);
  await expect.poll(async () => (await tickets(b, 'B2')).length).toBe(1);
  await expect.poll(async () => [page, tab].some(p => new URL(p.url()).pathname === '/menu/order')).toBe(true);
  await expect.poll(async () => page.evaluate(slug => localStorage.getItem(`autodine.cart.${slug}`) === null, b.slug)).toBe(true);
  const [saved] = await tickets(b, 'B2');
  expect(saved.total_paise).toBe(10511);
  expect(await sql('select id from order_sessions where table_id=$1', [b.tables.B2.id])).toHaveLength(1);
});

test('recovering an earlier order preserves cart changes and an old confirmation cannot clear them', async ({ page, context }) => {
  await scan(page, b, 'B3');
  await page.getByRole('button', { name: 'Add Journey sibling dish' }).click();
  await cartCheckout(page);
  await page.locator('textarea[name=note]').fill('Original note');
  const checkout = page.url();
  await fault('place_public_order_attempt', 'after-commit');
  await place(page).click();
  await expect(page.getByText(/^We could not confirm that order/)).toBeVisible();
  const edit = await context.newPage();
  await edit.goto(`/menu?s=${b.slug}`);
  await edit.getByRole('button', { name: 'One more Journey sibling dish' }).click();
  await page.reload();
  await expect(page.getByText(/Saved note: Original note/)).toBeVisible();
  await expect(place(page)).toHaveText('Retry same order');
  await place(page).click();
  await expect(page).toHaveURL(/\/menu\/order\?/);
  const oldLink = new URL(page.url());
  oldLink.searchParams.set('placed', '1');
  await page.goto(oldLink.href);
  const qty = () => page.evaluate(slug => JSON.parse(localStorage.getItem(`autodine.cart.${slug}`) ?? '[]')[0]?.qty, b.slug);
  expect(await qty()).toBe(2);
  await page.getByRole('link', { name: 'Order something else' }).click();
  await expect(page).toHaveURL(`/menu?s=${b.slug}`);
  await page.goBack();
  await expect(page).toHaveURL(oldLink.href);
  await page.reload();
  expect(await qty()).toBe(2);
  const [first] = await tickets(b, 'B3');
  expect(first).toMatchObject({ total_paise: 10511, customer_note: 'Original note' });
  await page.goto(checkout);
  await expect(place(page)).not.toHaveText('Retry same order');
  await place(page).click();
  await expect(page).toHaveURL(/\/menu\/order\?/);
  const round = await tickets(b, 'B3');
  expect(round).toHaveLength(2);
  expect(round[1]).toMatchObject({ order_session_id: first.order_session_id, total_paise: 21022 });
});

test('a browser without safe concurrent-tab locking leaves the basket intact and offers staff', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  await scan(page, b, 'B4');
  await page.getByRole('button', { name: 'Add Journey sibling dish' }).click();
  await cartCheckout(page);
  await expect(page.getByText(/cannot safely save or retry an order/)).toBeVisible();
  await expect(page.locator('[data-place-order="bill"]')).toBeDisabled();
  expect(await tickets(b, 'B4')).toHaveLength(0);
  expect(await page.evaluate(slug => !!localStorage.getItem(`autodine.cart.${slug}`), b.slug)).toBe(true);
});


test('a scan-limited card still browses, but drops the old table and cannot submit', async ({ page }) => {
  // Initial rows represent previous table-session opens (not fake orders).
  await sql(`insert into table_session_opens(qr_code_id,ip_hash)
    select q.id, repeat('a',64) from table_qr_codes q cross join generate_series(1,10) where q.table_id=$1 and q.revoked_at is null`, [b.tables.B5.id]);
  await scan(page, b, 'B4');
  await page.getByRole('button', { name: 'Add Journey sibling dish' }).click();
  // The basket write is lock-scheduled; a scan that starts before it lands is
  // testing the navigation race instead of whether a limited card keeps the basket.
  const saved = () => page.evaluate(slug => JSON.parse(localStorage.getItem(`autodine.cart.${slug}`) ?? '[]').length, b.slug);
  await expect.poll(saved).toBe(1);
  await scan(page, b, 'B5');
  await expect(page.locator('[data-throttle-note]')).toBeVisible();
  expect((await page.context().cookies()).some(c => c.name === 'autodine_table')).toBe(false);
  expect(await sql('select id from table_verification_sessions where table_id=$1', [b.tables.B5.id])).toHaveLength(0);
  await page.goto(`/menu/checkout?s=${b.slug}`);
  await expect(place(page)).toHaveCount(0);
  expect(await tickets(b, 'B4')).toHaveLength(0);
  expect(await tickets(b, 'B5')).toHaveLength(0);
  expect(await page.evaluate(slug => !!localStorage.getItem(`autodine.cart.${slug}`), b.slug)).toBe(true);
});

test('a malformed saved attempt cannot be replaced with a new key on reload', async ({ page }) => {
  await scan(page, a, 'A4');
  await page.getByRole('button', { name: 'Add Journey rice' }).click();
  await cartCheckout(page);
  await verify(page, await venueCode(a));
  const key = `ad_checkout:${a.slug}:${a.tables.A4.id}`;
  await page.evaluate(key => localStorage.setItem(key, '{invalid fixture record'), key);
  await page.reload();
  await expect(page.getByText(/cannot safely save or retry an order/)).toBeVisible();
  await expect(page.locator('[data-place-order="bill"]')).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('{invalid fixture record');
  expect(await tickets(a, 'A4')).toHaveLength(0);
});
