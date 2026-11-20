import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';

export const base = process.env.JOURNEY_BASE_URL!;
const bridge = new URL(process.env.JOURNEY_BRIDGE_URL!);
const fixture = JSON.parse(process.env.JOURNEY_FIXTURES!);
type Outlet = {
  id: string; slug: string; item: string; side: string; variant: string; addon: string; extra: string; draft: string;
  tables: Record<string, { id: string; card: string }>;
};
export const { a, b, c, d, e } = fixture.outlets as { a: Outlet; b: Outlet; c: Outlet; d: Outlet; e: Outlet };
// Which seeded identity owns each outlet's counter. The code is a staff-only
// read, so the guest never sees it; the test acts as that outlet's owner.
const OUTLET_ROLE: Record<string, Role> = { a: 'owner', b: 'sibling', c: 'composition', d: 'irp', e: 'unregistered' };
export function outletRole(outlet: Outlet): Role {
  for (const [kind, candidate] of Object.entries({ a, b, c, d, e })) if (candidate.slug === outlet.slug) return OUTLET_ROLE[kind];
  throw new Error('Unknown fixture outlet');
}
type Role = 'owner' | 'manager' | 'cashier' | 'kitchen' | 'waiter' | 'sibling' | 'unassigned'
  | 'composition' | 'unregistered' | 'irp' | 'irpmanager';

// Inspection/fixture changes only. Business operations must go through the UI
// and execute the real application and migrations as anon/authenticated.
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.JOURNEY_DB_URL });
  await client.connect();
  try { return (await client.query<T>(text, values)).rows; } finally { await client.end(); }
}

export async function staffContext(browser: Browser, role: Role, viewport = { width: 1280, height: 900 }): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: base, viewport });
  // Actual Supabase SSR cookie format, with a synthetic session. This does
  // not test sign-in, token issuance, or refresh at the Auth provider.
  await context.addCookies([{
    url: base, name: `sb-${bridge.hostname.split('.')[0]}-auth-token`,
    value: `base64-${Buffer.from(JSON.stringify(fixture.sessions[role])).toString('base64url')}`,
    httpOnly: false, sameSite: 'Lax',
  }]);
  // Provider speech is not part of the order/receipt rehearsal. Block the
  // relay before it reaches the server (as well as external browser traffic).
  await context.addInitScript(() => localStorage.setItem('autodine:kitchen:audio', 'off'));
  await context.route('**/api/tts', route => route.abort());
  return context;
}

export async function venueCode(outlet: Outlet): Promise<string> {
  const response = await fetch(new URL('/rest/v1/rpc/current_verification_code', bridge), {
    method: 'POST', headers: {
      'Content-Type': 'application/json', apikey: process.env.JOURNEY_APP_KEY!,
      Authorization: `Bearer ${fixture.sessions[outletRole(outlet)].access_token}`,
    }, body: JSON.stringify({ p_restaurant_id: outlet.id }),
  });
  expect(response.status).toBe(200);
  return (await response.json())[0].code;
}

export async function fault(rpc: string, mode: 'after-commit' | 'before-query' | 'transient' | 'private-error', count = 1) {
  const response = await fetch(new URL('/__journey', bridge), {
    method: 'POST', headers: { 'x-journey-control': process.env.JOURNEY_CONTROL! },
    body: JSON.stringify({ rpc, mode, count }),
  });
  expect(response.status).toBe(200);
}

export const scan = (page: Page, outlet: Outlet, table: string) => page.goto(`/t/${outlet.tables[table].card}`);
export async function cartCheckout(page: Page) {
  await page.locator('[data-gtab-bar]').getByRole('link', { name: 'Cart' }).click();
  await page.getByRole('link', { name: 'Continue to checkout' }).click();
}
export const place = (page: Page) => page.locator('[data-place-order="dock"]');
/** The development server hydrates after first paint; a click before React is
 * attached is a no-op, so add only while the stored basket is still empty. */
export async function addToCart(page: Page, name: string) {
  const button = page.getByRole('button', { name: `Add ${name}`, exact: true });
  await expect(button).toBeVisible();
  const stored = () => page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('autodine.cart.')));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await button.click();
    await page.waitForTimeout(600);
    if (await stored()) return;
  }
  throw new Error(`Could not add ${name} to the basket`);
}
export async function verify(page: Page, correct: string) {
  // Filling all six digits auto-submits the actual form.
  await page.getByLabel('Six-digit code').fill(correct);
  await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
}

type Ticket = { id: string; code: string; order_session_id: string; total_paise: number; tax_paise: number; payment_status: string;
  prep_status: string; customer_note: string | null; hold_required: boolean; confirmed_at: string | null };
export async function tickets(outlet: Outlet, table: string) {
  return sql<Ticket>(`select id,code,order_session_id,total_paise::int,tax_paise::int,payment_status,prep_status,customer_note,hold_required,confirmed_at
    from orders where restaurant_id=$1 and table_id=$2 order by placed_at,id`, [outlet.id, outlet.tables[table].id]);
}
export async function payments(ticket: Ticket) {
  return sql(`select p.method,p.amount_paise::int,p.status,p.provider,e.event_type
    from payments p left join payment_audit_events e on e.payment_id=p.id where p.order_id=$1`, [ticket.id]);
}

export async function prepareAndServe(kitchen: Page, ticket: Pick<Ticket, 'id' | 'code'>, dish: string, note?: string) {
  const card = kitchen.locator('article[data-state]').filter({ hasText: ticket.code });
  await expect(card.getByText(dish, { exact: true })).toBeVisible();
  if (note) await expect(card.getByText(note, { exact: false })).toBeVisible();
  for (const [label, state] of [['Start preparing', 'preparing'], ['Mark ready', 'ready'], ['Mark served', 'served']]) {
    await card.getByRole('button', { name: label }).click();
    await expect.poll(async () => (await sql('select prep_status from orders where id=$1', [ticket.id]))[0]?.prep_status).toBe(state);
    await expect(card).toHaveAttribute('data-state', state);
  }
}

type Buyer = { type: 'consumer' | 'registered'; name: string; address: string; gstin?: string; city?: string; pincode?: string };
export async function finishSitting(staff: Page, ticket: Pick<Ticket, 'order_session_id'>,
  identifyDelivery: boolean | Buyer = false, options: { print?: boolean } = {}) {
  await staff.goto('/dashboard');
  const row = staff.locator(`[data-active-session="${ticket.order_session_id}"]`);
  await expect(row).toBeVisible();
  const buyer: Buyer | null = identifyDelivery === true
    ? { type: 'consumer', name: 'Synthetic Customer', address: '12 Synthetic Billing Lane' }
    : identifyDelivery || null;
  if (buyer) {
    await row.getByRole('button', { name: 'Add buyer details or GSTIN' }).click();
    await row.getByLabel('Buyer type').selectOption(buyer.type);
    await row.getByLabel(buyer.type === 'registered' ? 'Legal name' : 'Buyer name').fill(buyer.name);
    if (buyer.gstin) await row.getByLabel('GSTIN', { exact: true }).fill(buyer.gstin);
    await row.getByLabel('Billing address').fill(buyer.address);
    if (buyer.city) await row.getByLabel('Billing city').fill(buyer.city);
    if (buyer.pincode) await row.getByLabel('Billing PIN').fill(buyer.pincode);
    if (buyer.type === 'consumer') await row.getByLabel('Buyer state').selectOption('27');
  }
  await row.locator('[data-checkout-session]').click();
  await row.getByRole('button', { name: 'Close & issue' }).click();
  await expect(staff).toHaveURL(/\/invoice\/[0-9a-f-]{36}$/);
  const [saved] = await sql(`select i.id,i.invoice_number,i.document_type,i.status,i.irp_status,i.gst_snapshot,i.totals_snapshot,i.payment_snapshot,i.customer_snapshot,
    (s.closed_at is not null) as closed from restaurant_invoices i join order_sessions s on s.id=i.order_session_id
    where i.order_session_id=$1`, [ticket.order_session_id]);
  expect(saved).toMatchObject({ closed: true, status: 'issued' });
  await expect(staff.locator('[data-invoice-sheet]')).toContainText(saved.invoice_number);
  if (options.print !== false) {
    await expect(staff.getByRole('button', { name: 'Print / Save PDF' })).toBeVisible();
    await staff.emulateMedia({ media: 'print' });
    try {
      await expect(staff.locator('[data-invoice-sheet]')).toBeVisible();
    } finally { await staff.emulateMedia({ media: 'screen' }); }
  }
  return saved;
}
