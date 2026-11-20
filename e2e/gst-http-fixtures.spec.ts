import { expect, test } from '@playwright/test';

/** Actual Next routes in Chromium with a loopback response fixture. These
 * assertions do not prove PostgREST schema visibility, Auth or hosted RLS. */
const cases = [
  ['fixture-regular5', 'GST 5% included', '₹5.01'],
  ['fixture-regular18', 'GST 18% included', '₹16.03'],
  ['fixture-composition', 'GST collected', '₹0.00'],
] as const;

for (const [index, [slug, taxLabel, taxAmount]] of cases.entries()) {
  test(`keeps saved menu gross and paise in the ${slug} cart and checkout`, async ({ page, context, baseURL }) => {
    await context.addCookies([{
      url: baseURL!, name: 'autodine_table',
      value: encodeURIComponent(JSON.stringify({
        token: String(index + 1).repeat(64), slug, tableLabel: 'Fixture 1', expiresAt: new Date(Date.now() + 3600000).toISOString(),
      })),
    }]);
    await page.addInitScript((slug) => {
      localStorage.setItem(`autodine.cart.${slug}`, JSON.stringify([{ itemId: 'meal', qty: 1 }]));
    }, slug);
    for (const path of ['cart', 'checkout']) {
      expect((await page.goto(`/menu/${path}?s=${slug}`))?.status()).toBe(200);
      const summary = page.locator('dl').first();
      await expect(summary.getByText(taxLabel, { exact: true })).toBeVisible();
      await expect(summary.locator('dd').nth(1)).toHaveText(taxAmount);
      await expect(summary.locator('dd').last()).toHaveText('₹105.11');
      await expect(page.getByText('sample tax', { exact: false })).toHaveCount(0);
    }
    await expect(page.getByText('At the counter', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /pay online/i })).toHaveCount(0);
  });
}

const sharePath = (index: number) => `/receipt-share/${Buffer.alloc(32, index).toString('base64url')}`;

test('shared documents render saved GST amounts and the Composition notice in print media', async ({ page }) => {
  const sheet = page.locator('[data-invoice-sheet]');
  const regular = await page.goto(sharePath(1));
  expect(regular?.headers()['cache-control']).toContain('no-store');
  await page.emulateMedia({ media: 'print' });
  await expect(sheet.getByText('TAX INVOICE', { exact: true })).toBeVisible();
  await expect(sheet.getByText('CGST @ 2.50%')).toBeVisible();
  await expect(sheet.getByText('Service SAC 996331')).toBeVisible();
  await expect(sheet.getByText('01234567890123')).toBeVisible();
  await expect(sheet.getByText('SGST @ 2.50%')).toBeVisible();
  await expect(sheet.getByText('Reverse charge: No')).toBeVisible();
  await expect(sheet.getByText('Place of supply: Maharashtra (27)')).toBeVisible();
  await expect(sheet.locator('[data-invoice-total]')).toHaveText('₹105.00');

  await page.goto(sharePath(2));
  await expect(sheet.getByText('BILL OF SUPPLY', { exact: true })).toBeVisible();
  await expect(sheet.getByText('Service SAC 996331')).toBeVisible();
  await expect(sheet.getByText(/Supplier or authorized representative signature/)).toBeVisible();
  await expect(sheet.getByText('01234567890123')).toBeVisible();
  await expect(sheet.getByText('Composition taxable person, not eligible to collect tax on supplies', { exact: true })).toBeVisible();
  await expect(sheet.getByText(/CGST|SGST|IGST/)).toHaveCount(0);
  await expect(sheet.locator('[data-invoice-total]')).toHaveText('₹105.00');

  await page.goto(sharePath(8));
  await expect(sheet.getByText('BILL OF SUPPLY', { exact: true })).toBeVisible();
  await expect(sheet.getByText(/Historical record — service SAC not recorded/)).toBeVisible();
  await expect(sheet.getByText('Service SAC 996331')).toHaveCount(0);
  await expect(sheet.locator('[data-invoice-total]')).toHaveText('₹105.00');
});

test('the shared retail print sheet has the approved identity and no GST fields', async ({ page }) => {
  await page.goto(sharePath(5));
  await page.emulateMedia({ media: 'print' });
  const sheet = page.locator('[data-invoice-sheet]');
  await expect(sheet.getByText('RETAIL BILL / CASH MEMO', { exact: true })).toBeVisible();
  for (const detail of ['RBL/26-27/000001', '01234567890123', 'Phone 07120000000', 'Synthetic test address']) {
    await expect(sheet.getByText(detail, { exact: true })).toBeVisible();
  }
  await expect(sheet.getByText(/GSTIN|CGST|SGST|IGST|Tax amount/)).toHaveCount(0);
});

test('held, voided and malformed receipt links give no document over HTTP', async ({ page }) => {
  for (const path of [sharePath(3), sharePath(4), '/receipt-share/invalid']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'This link is unavailable' })).toBeVisible();
    await expect(page.locator('[data-invoice-sheet]')).toHaveCount(0);
    await expect(page.getByText('GST fixture kitchen')).toHaveCount(0);
  }
});

test('unauthenticated GST export does not download a CSV over HTTP', async ({ request }) => {
  const result = await request.get('/dashboard/reports/export?type=gst', { maxRedirects: 0 });
  expect(result.status()).toBe(307);
  expect(new URL(result.headers().location, result.url()).pathname).toBe('/login');
  expect(result.headers()['content-disposition']).toBeUndefined();
});

const outletA = '00000000-0000-4000-8000-000000000001';
const outletB = '00000000-0000-4000-8000-000000000002';

async function staffFixtureSession(context: import('@playwright/test').BrowserContext, baseURL: string, identity: string | null, outlet = outletA) {
  await context.clearCookies();
  await context.addCookies([
    { url: baseURL, name: 'ad_outlet', value: outlet },
    ...(identity ? [{
      url: baseURL, name: 'sb-127-auth-token',
      value: `base64-${Buffer.from(JSON.stringify({
        access_token: `gst-fixture-token-${identity}`, refresh_token: 'unused-fixture-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url')}`,
    }] : []),
  ]);
}

test('real Settings action rechecks role, write access and selected outlet at submit time', async ({ page, context, baseURL }) => {
  await staffFixtureSession(context, baseURL!, 'owner');
  expect((await page.goto('/dashboard/settings'))?.status()).toBe(200);
  const save = page.getByRole('button', { name: 'Save GST configuration' });
  await expect(save).toBeEnabled();
  const settingsForm = page.locator('form').filter({ has: save });
  await expect(settingsForm.locator('input[name="gstOutletId"]')).toHaveValue(outletA);
  await expect(settingsForm.locator('input[name="configVersion"]')).toHaveValue('1');
  const action = await settingsForm.locator('input[name^="$ACTION_ID_"]').getAttribute('name');
  expect(action).toBeTruthy();
  // Target the real Server Action without relying on whether the UI offers a
  // button to this actor. This is the native multipart form POST protocol.
  const submit = async (identity: string | null, active = outletA, formOutlet = outletA) => {
    await staffFixtureSession(context, baseURL!, identity, active);
    const activationDate = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const response = await page.request.post('/dashboard/settings', {
      multipart: { [action!]: '', gstOutletId: formOutlet, configVersion: '1', billingMode: 'no_gst', noGstSubtype: 'unregistered', fssaiNumber: '01234567890123', offDeclared: 'on', activationDate, confirmActivation:'on', seriesConfirmed:'on', premisesAddress:'1 Synthetic test lane', premisesStateCode:'27', invoicePhone:'07120000000',
        seriesINV:'INV', seriesBOS:'BOS', seriesRBL:'RBL', seriesCN:'CN', seriesDN:'DN' },
      headers: { origin: baseURL! },
      maxRedirects: 0,
    });
    expect([303, 307]).toContain(response.status());
    return new URL(response.headers().location, response.url());
  };
  expect((await submit('owner')).searchParams.get('notice')).toMatch(/No-GST retail billing is on/);
  expect((await submit(null)).pathname).toBe('/login');
  expect((await submit('unassigned')).searchParams.get('error')).toMatch(/not a member/i);
  for (const role of ['manager', 'cashier', 'kitchen']) {
    expect((await submit(role)).searchParams.get('error')).toMatch(/only the outlet owner/i);
  }
  expect((await submit('expired')).searchParams.get('error')).toMatch(/read-only/i);
  expect((await submit('solo', outletB, outletB)).searchParams.get('error')).toMatch(/outlet for this GST form changed/i);
  expect((await submit('owner', outletB)).searchParams.get('error')).toMatch(/outlet for this GST form changed/i);

  await staffFixtureSession(context, baseURL!, 'manager', outletB);
  await page.goto('/dashboard/settings');
  await expect(page.locator('#gst-legal')).toHaveValue('Fixture outlet A Registration');
  await expect(save).toBeDisabled();
  for (const identity of ['cashier', 'kitchen', 'unassigned']) {
    await staffFixtureSession(context, baseURL!, identity);
    await page.goto('/dashboard/settings');
    await expect(save).toHaveCount(0);
    await expect(page.locator('#gst-legal')).toHaveCount(0);
  }
});

test('Settings has only two modes and only hotel restaurants see the qualification routes', async ({ page, context, baseURL }) => {
  await staffFixtureSession(context, baseURL!, 'owner');
  await page.goto('/dashboard/settings');
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Save GST configuration' }) });
  await expect(form.locator('[name="billingMode"]')).toHaveCount(2);
  await expect(form.locator('[name="regularProfile"]')).toHaveCount(0);
  await expect(form.locator('[name="fssaiNumber"]')).toHaveAttribute('pattern', '[0-9]{14}');
  await expect(form.locator('[name="premisesBasis"]')).toHaveCount(0);
  await form.locator('[name="businessType"]').selectOption('hotel');
  await form.locator('[name="premisesBasis"]').selectOption('room_supply');
  await expect(form.locator('[name="roomSupplyValueRupees"]')).toBeVisible();
  await form.locator('[name="premisesBasis"]').selectOption('opt_in');
  await expect(form.locator('[name="premisesFiledOn"]')).toBeVisible();
  await form.locator('[name="billingMode"][value="no_gst"]').check();
  await expect(form.locator('[name="noGstSubtype"]')).toHaveCount(2);
  await expect(form.locator('[name="gstin"]')).toHaveCount(0);
  await form.locator('[name="noGstSubtype"][value="composition"]').check();
  await expect(form.locator('[name="gstin"]')).toBeVisible();
  await expect(form.locator('[name="compositionAcknowledged"]')).toBeVisible();
  await expect(form.getByLabel('Service SAC')).toBeVisible();
  await expect(form.getByLabel('Service SAC')).toHaveAttribute('required','');
});

test('GST CSV authorizes the selected membership and ignores an unowned outlet request', async ({ context, baseURL }) => {
  const path = `/dashboard/reports/export?type=gst&restaurant_id=${outletB}`;
  for (const role of ['unassigned', 'cashier', 'kitchen']) {
    await staffFixtureSession(context, baseURL!, role);
    const response = await context.request.get(path);
    expect(response.status()).toBe(403);
    expect(response.headers()['content-disposition']).toBeUndefined();
  }
  for (const role of ['solo', 'manager']) {
    await staffFixtureSession(context, baseURL!, role, outletB);
    const response = await context.request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['content-disposition']).toMatch(/attachment; filename="autodine-gst-/);
    const csv = await response.text();
    expect(csv).toContain('Regular GST tax invoice,Issued,5,1,210.22,200.21,5.01,5.00,0.00,-0.01,0,26-27,INV');
    expect(csv).toContain('Retail bill / cash memo,Voided,,1,105.00,,,,,,0,26-27,RBL');
  }
});

test('B2B public copy uses saved buyer and outlet POS; custom retail prefix keeps its document title', async ({ page }) => {
  await page.emulateMedia({ media:'print' });
  await page.goto(sharePath(6));
  const sheet = page.locator('[data-invoice-sheet]');
  await expect(sheet.getByText('Synthetic registered buyer')).toBeVisible();
  await expect(sheet.getByText('1 Synthetic Buyer Lane')).toBeVisible();
  await expect(sheet.getByText('Synthetic City 560001')).toBeVisible();
  await expect(sheet.getByText(/08020112233|synthetic-buyer@fixture.invalid/)).toHaveCount(0);
  await expect(sheet.getByText('CGST @ 2.50%')).toBeVisible();
  await page.goto(sharePath(7));
  await expect(sheet.getByText('RETAIL BILL / CASH MEMO', {exact:true})).toBeVisible();
  await expect(sheet.getByText('RX2/26-27/000001',{exact:true})).toBeVisible();
});

test('reviewed GST ledger filters and export keep held bills and refunds separate', async ({ page,context,baseURL }) => {
  await staffFixtureSession(context,baseURL!,'manager',outletB);
  const filter = 'from=2026-11-18&through=2026-11-18&series=IX2&audience=B2B';
  expect((await page.goto(`/dashboard/reports/gst?${filter}`))?.status()).toBe(200);
  await expect(page.getByRole('heading',{name:'GST reconciliation'})).toBeVisible();
  await expect(page.getByRole('cell',{name:'IRN hold',exact:true})).toBeVisible();
  await expect(page.getByText('Payment rows marked refunded')).toBeVisible();
  const exportLink = page.getByRole('link',{name:'Download GST ledger CSV'});
  const response = await context.request.get((await exportLink.getAttribute('href'))!);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toMatch(/no-store/);
  const csv = await response.text();
  expect(csv).toContain('gst_tax_invoice,regular,B2B,IRN hold,pending');
  expect(csv).toContain('refunded,issued_sitting,1,65.00');
  const wrongOutlet = await context.request.get(`/dashboard/reports/gst/export?${filter}&outlet=${outletB}`);
  expect(wrongOutlet.status()).toBe(409);
});


test('manager print uses saved B2C note particulars; incomplete historical note stays non-final', async ({page,context,baseURL}) => {
  await staffFixtureSession(context,baseURL!,'manager');
  const note = (end:number) => `/dashboard/invoices/notes/60000000-0000-4000-8000-00000000000${end}`;
  await page.emulateMedia({media:'print'});
  expect((await page.goto(note(5)))?.status()).toBe(200);
  await expect(page.getByText('Saved tax rate: 5%')).toBeVisible();
  await expect(page.getByText('Delivery address: 2 Original Synthetic Handoff Lane')).toBeVisible();
  await expect(page.getByText('Buyer state: Karnataka (29)')).toBeVisible();
  await expect(page.getByText(/Supplier or authorized representative signature/)).toBeVisible();
  await page.goto(note(6));
  await expect(page.getByRole('heading',{name:'Historical GST adjustment'})).toBeVisible();
  await expect(page.getByText(/no printable adjustment is available/)).toBeVisible();
  await expect(page.getByRole('link',{name:'INV/26-27/000001'})).not.toBeVisible();
  await page.emulateMedia({media:'screen'});
  await expect(page.getByRole('link',{name:'INV/26-27/000001'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Print/})).toHaveCount(0);
});

test('private notes show the original; held notes cannot print and another outlet cannot read them', async ({page,context,baseURL}) => {
  const note = (end: number) => `/dashboard/invoices/notes/60000000-0000-4000-8000-00000000000${end}`;
  await staffFixtureSession(context,baseURL!,'owner');
  expect((await page.goto(note(1)))?.status()).toBe(200);
  await expect(page.getByRole('heading',{name:'CREDIT NOTE'})).toBeVisible();
  await expect(page.getByRole('link',{name:'INV/26-27/000001'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Print / Save PDF'})).toBeVisible();
  await page.goto(note(2));
  await expect(page.getByRole('heading',{name:'Held GST adjustment'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Print|Validate IRP payload/})).toHaveCount(0);
  await page.emulateMedia({media:'print'});
  await expect(page.getByText('Synthetic registered buyer')).not.toBeVisible();
  await expect(page.getByText(/IRN hold — not a final GST document/)).toBeVisible();
  await staffFixtureSession(context,baseURL!,'owner',outletB);
  await page.goto(note(1));
  await expect(page.getByText('Synthetic registered buyer')).toHaveCount(0);
});


test('Owner can submit outlet-bound deferral; Manager has no deferral action', async ({page,context,baseURL}) => {
  await staffFixtureSession(context,baseURL!,'owner');
  await page.goto('/dashboard/settings');
  await expect(page.getByText('Billing onboarding not saved')).toBeVisible();
  await page.getByLabel('Reason to defer onboarding').selectOption('premises');
  await page.getByRole('button',{name:'Record deferral'}).click();
  await expect(page.getByText(/Existing billing rules and documents were not changed/)).toBeVisible();
  await staffFixtureSession(context,baseURL!,'owner',outletB);
  await page.goto('/dashboard/settings');
  // A separate synthetic read model exercises existing-config reload. Real
  // append-only persistence and versioning are checked in PostgreSQL.
  await expect(page.getByText(/did not change the outlet’s existing billing rules/)).toBeVisible();
  const timeline=page.locator('details').filter({hasText:'Recorded deferrals'});
  await timeline.getByText('Recorded deferrals').click();
  await expect(timeline.getByText(/v1 ·.*2026-11-19/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button',{name:'Record deferral'})).toHaveCount(0);
  await staffFixtureSession(context,baseURL!,'manager');
  await page.goto('/dashboard/settings');
  await expect(page.getByRole('button',{name:'Record deferral'})).toHaveCount(0);
});

test('Cashier submits a private direct delivery to an off-table session and Kitchen cannot open the form', async ({page,context,baseURL}) => {
  await staffFixtureSession(context,baseURL!,'kitchen');
  await page.goto('/dashboard/direct-order');
  await expect(page.getByRole('button',{name:'Record ticket'})).toHaveCount(0);
  await expect(page.getByText('99 Synthetic Direct Lane')).toHaveCount(0);
  await staffFixtureSession(context,baseURL!,'cashier');
  await page.goto('/cashier');
  await expect(page.getByRole('button',{name:/Select DSIM01 at Direct delivery, ₹210.22 outstanding/})).toBeVisible();
  await page.getByRole('link',{name:'New takeaway or delivery'}).click();
  const order = page.getByRole('button',{name:'Record ticket'});
  const form = page.locator('form').filter({has:order});
  const attempt = await form.locator('[name="attempt"]').inputValue();
  await form.getByLabel('Fulfilment').selectOption('direct_delivery');
  async function fill(state:string) {
    await form.getByLabel('Destination state').selectOption(state);
    await form.getByLabel('Delivery address (private)',{exact:true}).fill('99 Synthetic Direct Lane');
    await form.getByLabel('Menu item 1').selectOption('61000000-0000-4000-8000-000000000003');
    await form.getByLabel('Qty').fill('2');
    await form.getByRole('checkbox').check();
  }
  await fill('29');
  await order.click();
  await expect(form.getByRole('alert')).toContainText('Only direct same-state service');
  await expect(form.locator('[name="attempt"]')).toHaveValue(attempt);
  await expect(page.getByText('Do not echo this private fixture RPC detail')).toHaveCount(0);
  await expect(form.getByLabel('Fulfilment')).toHaveValue('direct_delivery');
  await expect(form.getByLabel('Delivery address (private)',{exact:true})).toHaveValue('99 Synthetic Direct Lane');
  await form.getByLabel('Destination state').selectOption('27');
  await order.click();
  await expect(page).toHaveURL(/\/dashboard#session-61000000-0000-4000-8000-000000000001$/);
  const direct=page.locator('#session-61000000-0000-4000-8000-000000000001');
  await expect(direct.getByText('Direct delivery',{exact:true})).toBeVisible();
  await expect(direct.getByText('Deliver to 99 Synthetic Direct Lane')).toBeVisible();
  await expect(direct.locator('[data-session-total]')).toHaveText('₹210.22');
  await staffFixtureSession(context,baseURL!,'kitchen');
  await page.goto('/kitchen');
  await expect(page.getByText(/Direct delivery/).first()).toBeVisible();
  await expect(page.getByText('Fixture counter meal',{exact:true})).toBeVisible();
  await expect(page.getByText(/99 Synthetic Direct Lane|₹210\.22/)).toHaveCount(0);
});

test('Account report labels a cancelled sibling and requires switching before viewing it', async ({page,context,baseURL}) => {
  const filters='from=2026-11-18&through=2026-11-18&series=IX2&audience=B2B';
  await staffFixtureSession(context,baseURL!,'owner');
  await page.goto(`/dashboard/reports/gst?${filters}`);
  await expect(page.getByText(/Includes 1 authorized outlet:/)).toBeVisible();
  await page.getByLabel('Outlets',{exact:true}).selectOption('account');
  await page.getByRole('button',{name:'Apply filters'}).click();
  await expect(page.getByText(/Includes 2 authorized outlets:/)).toBeVisible();
  const sibling=page.getByRole('row').filter({hasText:'IX2/26-27/000006'});
  await expect(sibling.getByText('Fixture outlet B · Switch outlet to open')).toBeVisible();
  await expect(sibling.getByText('IRP cancelled')).toBeVisible();
  await expect(sibling.getByRole('link')).toHaveCount(0);
  const exportLink=page.getByRole('link',{name:'Download GST ledger CSV'});
  const response=await context.request.get((await exportLink.getAttribute('href'))!);
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('B2B,IRP cancelled,cancelled');
  await staffFixtureSession(context,baseURL!,'manager');
  await page.goto(`/dashboard/reports/gst?${filters}&scope=account`);
  await expect(page.getByText(/Includes 1 authorized outlet:/)).toBeVisible();
  await expect(page.getByText('IX2/26-27/000006')).toHaveCount(0);
});

test('private delivery prints saved destination and exact paise without a share action', async ({page,context,baseURL}) => {
  const path='/invoice/61000000-0000-4000-8000-000000000004';
  await staffFixtureSession(context,baseURL!,'cashier');
  expect((await page.goto(path))?.status()).toBe(200);
  await expect(page.getByRole('button',{name:'Share receipt text'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Create 24-hour link'})).toHaveCount(0);
  await page.emulateMedia({media:'print'});
  const sheet=page.locator('[data-invoice-sheet]');
  await expect(sheet.getByText('Delivery address: 99 Synthetic Direct Lane',{exact:true})).toBeVisible();
  await expect(sheet.getByText('Maharashtra (27)',{exact:false}).first()).toBeVisible();
  for (const amount of ['₹200.21','₹5.01','₹5.00']) await expect(sheet.getByText(amount,{exact:true})).toBeVisible();
  await expect(sheet.locator('[data-invoice-total]')).toHaveText('₹210.22');
  await staffFixtureSession(context,baseURL!,'owner',outletB);
  await page.goto(path);
  await expect(page.getByRole('heading',{name:'Receipt not found'})).toBeVisible();
  await expect(page.getByText('99 Synthetic Direct Lane')).toHaveCount(0);
});

test('supplemental payment acknowledgement prints and shares only saved receipt evidence', async ({page,context,baseURL}) => {
  await staffFixtureSession(context,baseURL!,'owner');
  await page.addInitScript(() => {
    Object.defineProperty(navigator,'share',{value:async (input:ShareData)=>{ sessionStorage.setItem('fixture-shared-text',input.text ?? ''); }});
  });
  expect((await page.goto('/invoice/payment/61000000-0000-4000-8000-000000000005'))?.status()).toBe(200);
  await page.getByRole('button',{name:'Share receipt',exact:true}).click();
  const text = await page.evaluate(() => sessionStorage.getItem('fixture-shared-text'));
  expect(text).toContain('FSSAI 11234567890123');
  expect(text).toContain('cash · ₹105.11');
  expect(text).toContain('does not replace or change the issued invoice');
  expect(text).not.toContain('01234567890123'); // current configuration holds a different synthetic number
  await page.emulateMedia({media:'print'});
  const sheet=page.locator('[data-payment-receipt]');
  await expect(sheet.getByText('FSSAI 11234567890123')).toBeVisible();
  await expect(sheet.getByText('Saved receipt address')).toBeVisible();
  await expect(sheet.getByText('INV/26-27/000019')).toBeVisible();
  await expect(sheet.getByText(/does not replace or change the issued invoice/)).toBeVisible();
});

test('private note label distinguishes recorded cancellation without enabling print', async ({page,context,baseURL}) => {
  await staffFixtureSession(context,baseURL!,'owner');
  await page.goto('/dashboard/invoices/notes/60000000-0000-4000-8000-000000000004');
  await expect(page.getByRole('heading',{name:'Cancelled GST adjustment'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Print|Validate IRP payload/})).toHaveCount(0);
  await page.emulateMedia({media:'print'});
  await expect(page.getByText('Synthetic registered buyer')).not.toBeVisible();
  await expect(page.getByText(/IRP cancellation recorded/)).toBeVisible();
});

const irpPage='/dashboard/reports/irp';
const irpSourceId='73000000-0000-4000-8000-000000000001';
const irpRouteId='73000000-0000-4000-8000-000000000003';
const irpQueuedId='73000000-0000-4000-8000-000000000004';
const irpUncertainId='73000000-0000-4000-8000-000000000005';

test('owner validates saved IRP particulars, selects an approved simulation route and records work without releasing the source', async ({page,context,baseURL})=>{
  await staffFixtureSession(context,baseURL!,'owner');
  await page.goto(`/invoice/${irpSourceId}`);
  await expect(page.getByText(/IRN pending — not a final tax invoice/)).toBeVisible();
  await expect(page.getByRole('button',{name:/Print \/ Save PDF|Create 24-hour link/})).toHaveCount(0);
  await page.getByRole('button',{name:'Validate IRP payload offline'}).click();
  await expect(page.getByText(/INV-01 payload validated and preparation recorded/)).toBeVisible();
  await page.getByRole('link',{name:'IRP register'}).click();
  await expect(page.getByRole('heading',{name:'E-invoice / IRP register'})).toBeVisible();
  await expect(page.getByText('No live IRP is enabled.')).toBeVisible();
  await page.getByLabel('Approved local route').selectOption(irpRouteId);
  await page.getByRole('button',{name:'Save route'}).click();
  await expect(page.getByRole('status').filter({hasText:'Local route preference saved'})).toBeVisible();
  await page.getByRole('button',{name:'Queue simulation',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`${irpPage}/${irpQueuedId}\\?notice=queued`));
  await expect(page.getByRole('heading',{name:'Queued',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Verified evidence'})).toHaveCount(0);
  await page.getByRole('link',{name:'Open saved invoice'}).click();
  await expect(page.getByText(/not a final tax invoice/)).toBeVisible();
  await expect(page.getByRole('img',{name:/IRP signed QR/})).toHaveCount(0);
  await page.emulateMedia({media:'print'});
  await expect(page.locator('[data-invoice-sheet]')).toBeHidden();
});

test('owner requests lookup on uncertain submission, not a resend or a fabricated acceptance', async ({page,context,baseURL})=>{
  await staffFixtureSession(context,baseURL!,'owner');
  await page.goto(`${irpPage}/${irpUncertainId}`);
  await expect(page.getByRole('heading',{name:'Submission uncertain'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Queue retry'})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Verified evidence'})).toHaveCount(0);
  await page.getByRole('button',{name:'Request lookup'}).click();
  await expect(page.getByRole('heading',{name:'Lookup queued'})).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'No IRN or cancellation was issued'})).toBeVisible();
});

test('IRP register and CSV restrict outlets and staff and disclose no signed/customer material', async ({page,context,baseURL})=>{
  await staffFixtureSession(context,baseURL!,'manager');
  await page.goto(irpPage);
  await expect(page.getByRole('heading',{name:'E-invoice / IRP register'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save route'})).toHaveCount(0);
  await expect(page.getByText(/0 verified active authority/)).toBeVisible();
  await page.goto(`${irpPage}/${irpUncertainId}`);
  await expect(page.getByRole('heading',{name:'Recovery actions'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Request lookup|Queue retry|Queue simulation/})).toHaveCount(0);
  const csv=await page.request.get(`${irpPage}/export?outlet=${outletA}`);
  expect(csv.status()).toBe(200); expect(csv.headers()['cache-control']).toMatch(/private.*no-store/);
  expect(await csv.text()).toContain('"IX9/26-27/000042"');
  expect(await csv.text()).not.toMatch(/signed_qr|29AAAAA0000B1ZW|Simulated buyer|payload/i);
  expect((await page.request.get(`${irpPage}/export?outlet=${outletB}`)).status()).toBe(409);
  await staffFixtureSession(context,baseURL!,'owner',outletB);
  await page.goto(irpPage);
  await expect(page.getByText('Fixture outlet B · Selected outlet only')).toBeVisible();
  await expect(page.getByText('No dispatches on this page.')).toBeVisible();
  await page.goto(`${irpPage}/${irpUncertainId}`);
  await expect(page.getByRole('heading',{name:'Dispatch IX9/26-27/000042'})).toHaveCount(0);
  await staffFixtureSession(context,baseURL!,'cashier');
  expect((await page.request.get(`${irpPage}/export?outlet=${outletA}`)).status()).toBe(403);
  await staffFixtureSession(context,baseURL!,null);
  const denied=await page.request.get(`${irpPage}/export?outlet=${outletA}`,{maxRedirects:0});
  expect([307,401]).toContain(denied.status());
  expect(denied.headers()['content-disposition']).toBeUndefined();
});
