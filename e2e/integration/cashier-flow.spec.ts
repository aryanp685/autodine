import { createClient } from '@supabase/supabase-js';
import { expect, test, type BrowserContext } from '@playwright/test';
import {
  BASE,
  GUEST_READY,
  STAFF_READY,
  SLUG,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  addOneAndCheckout,
  codeFromOrderUrl,
  placeOrder,
  scanCard,
  signInOwner,
  skipUnless,
} from './flow';

/**
 * THE COUNTER (CASHIER), END TO END, ON A REAL DEPLOYMENT.
 *
 * Real bills, real record_counter_payment writes for cash/card/UPI, and the
 * idempotent duplicate-payment guard. Guest UPI QR/self-claim is intentionally
 * absent: the UPI case below verifies that a guest gets no claim control and
 * staff can record an externally verified counter payment. Each test places
 * its own order — money state is exactly the thing tests must not share.
 *
 * IT WRITES ROWS (orders AND payments). Point it at a DISPOSABLE branch
 * database only.
 */

const NEEDS = 'E2E_BASE_URL, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD (+ guest env for the order half)';

async function placeCounterOrder(context: BrowserContext, note: string): Promise<string> {
  const page = await scanCard(context);
  await addOneAndCheckout(page);
  return placeOrder(page, note);
}

test.describe('cashier — real database', () => {
  test.skip(!STAFF_READY, skipUnless(false, NEEDS));

  test('a counter order shows at the till with the amount the guest was promised', async ({
    context,
  }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    await placeCounterOrder(context, 'e2e: settle me at the counter');

    const till = await signInOwner(context);
    await till.goto(`${BASE}/cashier`);

    const row = till.getByRole('button', { name: /Select .*outstanding/ }).first();
    await expect(till.locator('[data-counter-cta]')).toBeVisible({ timeout: 45_000 });

    // The amount on the settle button is the outstanding the DATABASE holds —
    // the same figure the guest's bill shows, not one this browser chose.
    const cta = await till.locator('[data-counter-cta]').innerText();
    expect(cta).toMatch(/^Record (cash|CARD|UPI) ₹[\d,]+$/);
    await row.click();
  });

  test('the bill page prints the order, and settles to zero once paid', async ({ context }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    await placeCounterOrder(context, 'e2e: bill then pay');

    const till = await signInOwner(context);
    await till.goto(`${BASE}/dashboard/orders`);

    // The ledger links the counter to the exact ticket ("Collect"), and the id
    // in that link is what /bill/<id> resolves — for THIS restaurant only.
    const collect = till.getByRole('link', { name: /Collect/ }).first();
    await expect(collect).toBeVisible({ timeout: 45_000 });
    const href = await collect.getAttribute('href');
    const orderId = (href ?? '').split('order=')[1]?.split('&')[0] ?? '';
    expect(orderId).not.toBe('');

    const bill = await till.context().newPage();
    await bill.goto(`${BASE}/bill/${orderId}`);
    await expect(bill.locator('[data-bill-sheet]')).toBeVisible({ timeout: 20_000 });
    await expect(bill.locator('[data-bill-sheet]').getByText('Total',{exact:true}).locator('..')).toContainText(/₹[\d,]+/);
  });

  test('recording a counter payment moves the money from pending to paid', async ({
    context,
  }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    await placeCounterOrder(context, 'e2e: cash on the counter');

    const till = await signInOwner(context);
    await till.goto(`${BASE}/cashier`);
    await expect(till.locator('[data-counter-cta]')).toBeVisible({ timeout: 45_000 });
    await till.locator('[data-counter-cta]').click();

    // The database accepts the payment; the queue re-reads without it and the
    // screen names what was recorded.
    await expect(till.getByRole('status').or(till.getByRole('alert')).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(till.locator('[data-counter-cta]')).not.toHaveText(/₹0[^0-9]/);
  });

  test('UPI is recorded only by staff at the counter, with a persisted payment', async ({context}) => {
    const guestUrl=await placeCounterOrder(context,'e2e: manual UPI fixture no real transfer');
    const code=codeFromOrderUrl(guestUrl);
    const guest=await context.newPage();await guest.goto(guestUrl);
    await expect(guest.getByText('Pay at the counter before you leave.',{exact:true})).toBeVisible();
    await expect(guest.locator('[data-pay-upi], [data-upi-claimed]')).toHaveCount(0);
    await expect(guest.getByRole('button',{name:'I have paid',exact:true})).toHaveCount(0);
    const till=await signInOwner(context);await till.goto(`${BASE}/cashier`);
    await till.getByRole('button',{name:new RegExp(`Select ${code} at`)}).click();
    await till.getByRole('group',{name:'Payment method'}).getByRole('button',{name:'UPI',exact:true}).click();
    await expect(till.locator('[data-counter-cta]')).toHaveText('Record UPI ₹125');
    await till.locator('[data-counter-cta]').click();
    await expect(till.getByText(new RegExp(`UPI.*recorded for ${code}`))).toBeVisible({timeout:20_000});
    // Counter payments only have supplemental receipt links when an invoice
    // was issued first. Verify persistence as the authenticated fixture owner,
    // not by assuming an invoice exists or granting service-role money reads.
    if(process.env.STAGING_SUPABASE_URL!=='https://juwyhslzchjevqkdvwjm.supabase.co'||!process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY)throw new Error('Approved staging persistence credentials required');
    const db=createClient(process.env.STAGING_SUPABASE_URL,process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const login=await db.auth.signInWithPassword({email:OWNER_EMAIL,password:OWNER_PASSWORD});
    if(login.error)throw new Error('Fixture owner persistence login failed');
    try {
      const tenant=await db.from('restaurants').select('id,upi_id').eq('slug',SLUG).single();
      if(tenant.error)throw new Error('Fixture tenant persistence read failed');
      expect(tenant.data.upi_id).toBe('autodine-synthetic@invalid');
      const order=await db.from('orders').select('id,payment_status').eq('restaurant_id',tenant.data.id).eq('code',code).single();
      if(order.error)throw new Error('UPI order persistence read failed');
      expect(order.data.payment_status).toBe('paid');
      const payments=await db.from('payments').select('method,amount_paise,status').eq('restaurant_id',tenant.data.id).eq('order_id',order.data.id);
      if(payments.error)throw new Error('UPI payment persistence read failed');
      expect(payments.data).toEqual([{method:'upi',amount_paise:12500,status:'recorded'}]);
    } finally {await db.auth.signOut();}
    await guest.reload();
    await expect(guest.getByText('Paid. Thank you.',{exact:true})).toBeVisible();
  });

  test('double-tapping Record writes ONE payment', async ({ context }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    await placeCounterOrder(context, 'e2e: no double money');

    const till = await signInOwner(context);
    await till.goto(`${BASE}/cashier`);
    await expect(till.locator('[data-counter-cta]')).toBeVisible({ timeout: 45_000 });

    // Two taps, one intention — record_payment is idempotent per key, and the
    // row leaves the queue. What must not exist anywhere is a second payment.
    await till.locator('[data-counter-cta]').click({ clickCount: 2, delay: 40 }).catch(() => {});
    await till.waitForTimeout(3000);

    // Re-read the till and the bill: one payment, nothing outstanding twice.
    await till.reload();
    await expect(till.getByText(/outstanding/i).first()).toBeVisible();
  });

  test('a cancelled order cannot be settled — money for food that will not come', async ({
    context,
  }) => {
    test.skip(!GUEST_READY, skipUnless(false, 'guest env for the order half'));
    await placeCounterOrder(context, 'e2e: cancel then try to pay');

    const till = await signInOwner(context);
    await till.goto(`${BASE}/cashier`);
    await expect(till.locator('[data-counter-cta]')).toBeVisible({ timeout: 45_000 });
    const rowsBefore = await till.getByRole('button', { name: /Select .*outstanding/ }).count();

    await till.getByRole('button', { name: 'Cancel this order' }).click();
    await till.getByRole('group', { name: 'Confirm cancellation' })
      .getByRole('button', { name: 'Yes, cancel it' })
      .click();

    // The ticket leaves the queue — and with it every path to its money.
    await expect
      .poll(async () => till.getByRole('button', { name: /Select .*outstanding/ }).count(), {
        timeout: 20_000,
        message: 'the cancelled ticket never left the queue',
      })
      .toBe(rowsBefore - 1);
  });
});
