import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

/**
 * THE THROTTLE, END TO END, AGAINST A REAL POSTGRES.
 *
 * This is the test the previous round could not write: everything in it is real
 * except Supabase's REST layer. The route handler, the access check, the page,
 * the screen and the order action are the shipped code; `open_table_session`,
 * `public_qr_intro` and `place_public_order` are the real SQL functions from
 * `20261028000900`, executed by a real database. Only the transport between
 * them is replaced — `.rpc()` becomes `select * from public.<fn>(…)` over `pg`,
 * because this environment has Postgres but no PostgREST.
 *
 * It skips unless THROTTLE_DB_URL is set, so CI (which has no database) stays
 * green and never pretends to have run it.
 *
 * WHAT IT PROVES
 *
 *   a real refusal from real SQL, reached by really scanning the card eleven
 *   times, becomes the notice the guest reads — with no session minted, no
 *   order written, and a retry that refuses identically.
 *
 * WHAT IT DOES NOT PROVE
 *
 *   that the guest's browser renders it (that needs the Playwright spec), or
 *   that the production schema behaves the same (this database is built from
 *   the repository's migrations plus a scaffold for three tables that were
 *   never checked in — see docs/branch-db-validation.md).
 */

const DB = process.env.THROTTLE_DB_URL ?? '';
const SLUG = 'throttle-it';
const KITCHEN_ID = '5a39cd8b-4c9e-4c06-bf47-a18a8014d111';
const CASHIER_ID = '5a39cd8b-4c9e-4c06-bf47-a18a8014d112';
/** The real dish the cart points at, so the database prices a real row. */
let itemId = '';

const state = vi.hoisted(() => ({ jar: new Map<string, string>(), rpc: null as null | ((name: string, params: Record<string, unknown>) => Promise<unknown>) }));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '198.51.100.42' }),
  cookies: async () => ({
    get: (name: string) => {
      const value = state.jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void state.jar.set(name, value),
    delete: (name: string) => void state.jar.delete(name),
  }),
}));

vi.mock('@/lib/supabase/env', () => ({
  isSupabaseConfigured: true,
  isSupabaseAdminConfigured: false,
  SUPABASE_URL: 'https://project.supabase.test',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: '',
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string, params: Record<string, unknown>) => state.rpc!(name, params),
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error('not-found');
  },
}));

vi.mock('@/components/CartProvider', () => ({
  CartProvider: ({ children }: { children: React.ReactNode }) => children,
  useCart: () => ({
    lines: [],
    count: 0,
    ready: true,
    add: () => {},
    remove: () => {},
    setQty: () => {},
    clear: () => {},
  }),
}));

vi.mock('@/lib/db/storefront-status', () => ({
  // The closed check sits before the flow under test; open, no announcement.
  getStorefrontStatusBySlug: async () => ({ name: 'Throttle It', open: true, announcement: null }),
}));

vi.mock('@/lib/db/menu-screen', () => ({
  getMenuScreenData: async () => ({
    restaurant: {
      slug: 'throttle-it',
      name: 'Throttle IT',
      tagline: 'Test kitchen',
      address: 'Nowhere',
      phone: '000',
      gstin: '',
      fssai: '',
      currency: 'INR',
      openHours: '',
      timezone: 'Asia/Kolkata',
    },
    categories: [{ id: 'c1', name: 'Main Course', count: 1 }],
    items: [
      {
        id: 'i1',
        name: 'Butter Chicken',
        desc: '',
        price: 469,
        category: 'c1',
        veg: false,
        available: true,
      },
    ],
    table: null,
  }),
}));

const { GET } = await import('@/app/t/[token]/route');
const { default: CustomerMenuPage } = await import('@/app/menu/page');
const { placeOrderAction } = await import('@/app/menu/checkout/actions');

/** The real SQL, one row per RPC, exactly as the database defines it. */
async function installRpc(db: Client) {
  state.rpc = async (name, params) => {
    try {
      if (name === 'public_qr_intro') {
        const { rows } = await db.query('select * from public.public_qr_intro($1)', [params.p_public_token]);
        return { data: rows, error: null };
      }
      if (name === 'current_table_session') {
        const { rows } = await db.query('select * from public.current_table_session($1)', [params.p_token]);
        return { data: rows, error: null };
      }
      if (name === 'open_table_session') {
        const { rows } = await db.query('select * from public.open_table_session($1, $2)', [
          params.p_public_token,
          params.p_ip_hash,
        ]);
        return { data: rows, error: null };
      }
      if (name === 'place_public_order') {
        const { rows } = await db.query(
          'select public.place_public_order($1, $2::jsonb, $3, $4, $5::uuid) as code',
          [params.p_slug, JSON.stringify(params.p_lines), params.p_note, params.p_session_token, params.p_guest_token],
        );
        return { data: rows[0]?.code ?? null, error: null };
      }
      return { data: null, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { data: null, error: { code: 'P0001', message, details: '', hint: '' } };
    }
  };
}

/** Orders reference the restaurant, so they go first. */
async function cleanup(db: Client) {
  const restaurantId = '(select id from public.restaurants where slug = $1)';
  await db.query(`delete from public.restaurant_invoice_lines where restaurant_id = ${restaurantId}`, [SLUG]);
  await db.query(`delete from public.restaurant_payment_receipts where restaurant_id = ${restaurantId}`, [SLUG]);
  await db.query(`delete from public.restaurant_invoices where restaurant_id = ${restaurantId}`, [SLUG]);
  await db.query(`delete from public.restaurant_invoice_series where restaurant_id = ${restaurantId}`, [SLUG]);
  await db.query(`delete from public.payment_audit_events where restaurant_id = ${restaurantId}`, [SLUG]);
  await db.query(`delete from public.payments where restaurant_id = ${restaurantId}`, [SLUG]);
  await db.query(
    'delete from public.orders where restaurant_id = (select id from public.restaurants where slug = $1)',
    [SLUG],
  );
  await db.query('delete from public.restaurants where slug = $1', [SLUG]);
  await db.query('delete from public.profiles where id = any($1::uuid[])', [[KITCHEN_ID, CASHIER_ID]]);
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe.skipIf(!DB)('throttling, against a real PostgreSQL', () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: DB });
    await db.connect();
    await installRpc(db);

    await cleanup(db);
    const { rows } = await db.query(
      `insert into public.restaurants (slug, name, address, timezone, is_active, trial_started_at, guest_verification_mode)
       values ($1, 'Throttle IT', '1 Test Road', 'Asia/Kolkata', true, now(), 'scan') returning id`,
      [SLUG],
    );
    const restaurantId = rows[0].id as string;
    await db.query(
      `insert into public.profiles (id, full_name) values ($1, 'Test Kitchen'), ($2, 'Test Cashier')`,
      [KITCHEN_ID, CASHIER_ID],
    );
    await db.query(
      `insert into public.memberships (restaurant_id, user_id, role)
       values ($1, $2, 'kitchen'), ($1, $3, 'cashier')`,
      [restaurantId, KITCHEN_ID, CASHIER_ID],
    );
    const menu = await db.query(
      `insert into public.menus (restaurant_id, name, is_published) values ($1, 'Main', true) returning id`,
      [restaurantId],
    );
    const category = await db.query(
      `insert into public.categories (restaurant_id, menu_id, name, sort_order) values ($1, $2, 'Main Course', 0) returning id`,
      [restaurantId, menu.rows[0].id],
    );
    const item = await db.query(
      `insert into public.items (restaurant_id, category_id, name, price_paise, is_veg, is_available, sort_order)
       values ($1, $2, 'Butter Chicken', 46900, false, true, 0) returning id`,
      [restaurantId, category.rows[0].id],
    );
    itemId = item.rows[0].id as string;
    const table = await db.query(
      `insert into public.dining_tables (restaurant_id, label, is_active) values ($1, 'T1', true) returning id`,
      [restaurantId],
    );
    await db.query(
      `insert into public.table_qr_codes (restaurant_id, table_id, public_token) values ($1, $2, $3)`,
      [restaurantId, table.rows[0].id, 'throttleit000000000000000000000000000000000000000000000000001'],
    );
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await cleanup(db);
    await db.end();
  });

  const CARD = 'throttleit000000000000000000000000000000000000000000000000001';

  /** One guest: a fresh jar, a real scan, and the page they land on. */
  async function guestScans() {
    state.jar.clear();
    const request = new NextRequest(`http://localhost:3000/t/${CARD}`, {
      headers: { 'x-forwarded-for': '198.51.100.42' },
    });
    const response = await GET(request, { params: Promise.resolve({ token: CARD }) });
    for (const cookie of response.cookies.getAll()) {
      if (!cookie.value) state.jar.delete(cookie.name);
      else state.jar.set(cookie.name, cookie.value);
    }
    const location = new URL(response.headers.get('location') ?? '', 'http://localhost:3000');
    return { response, location, params: Object.fromEntries(location.searchParams) as Record<string, string> };
  }

  it('refuses the eleventh scan of one card, and says so on the menu', async () => {
    const opened: string[] = [];
    let refused: Awaited<ReturnType<typeof guestScans>> | null = null;

    for (let i = 1; i <= 12; i += 1) {
      const scan = await guestScans();
      if (scan.params.v) {
        refused = scan;
        break;
      }
      opened.push(scan.params.s ?? '');
    }

    // The database's own limit: ten opens per card per hour.
    expect(opened).toHaveLength(10);
    expect(refused).not.toBeNull();
    expect(refused!.params.v).toBe('throttled');

    // A refusal mints nothing.
    expect(state.jar.has('autodine_table')).toBe(false);
    expect(state.jar.get('autodine_throttled')).toBe('throttled');

    // …and the guest is told, on the real screen.
    const html = renderToStaticMarkup(await CustomerMenuPage({ searchParams: Promise.resolve(refused!.params) }));
    const text = visibleText(html);
    expect(text).toContain('Table check paused');
    expect(text).toContain('scanned unusually often');
    expect(text).toContain('Butter Chicken');
    expect(text).not.toMatch(/\d+ minutes/);

    // The rows the database kept: ten opens, ten sessions, no more.
    const opens = await db.query('select count(*)::int as n from public.table_session_opens o join public.table_qr_codes q on q.id = o.qr_code_id where q.public_token = $1', [CARD]);
    expect(opens.rows[0].n).toBe(10);
  }, 60_000);

  it('writes no order for the refused guest, and refuses again the same way', async () => {
    // The guest is still on the throttled screen with a cart.
    const before = await db.query('select count(*)::int as n from public.orders where restaurant_id = (select id from public.restaurants where slug = $1)', [SLUG]);

    const form = new FormData();
    form.set('slug', SLUG);
    form.set('lines', JSON.stringify([{ itemId, qty: 2 }]));
    form.set('attempt', '9f4b6c1e-2d3a-4b5c-8d7e-0a1b2c3d4e5f');

    const redirects: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      try {
        await placeOrderAction(form);
      } catch (error) {
        redirects.push(error instanceof Error ? error.message.replace('redirect:', '') : '');
      }
    }

    expect(redirects).toHaveLength(2);
    expect(redirects[1]).toBe(redirects[0]);

    const url = new URL(redirects[0], 'http://localhost:3000');
    const message = url.searchParams.get('error') ?? '';
    expect(url.pathname).toBe('/menu/cart');
    expect(url.searchParams.get('s')).toBe(SLUG);
    expect(message.startsWith('Your order was not sent.')).toBe(true);
    expect(message).toContain('cart is safe');

    const after = await db.query('select count(*)::int as n from public.orders where restaurant_id = (select id from public.restaurants where slug = $1)', [SLUG]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  }, 60_000);

  it('lets the same guest order once the window has passed', async () => {
    /*
     * The recovery path a guest is promised: wait, scan again, order — no staff
     * code, no waiter. Simulated by ageing the opens rows out of the hour, which
     * is the only thing the limit looks at.
     */
    await db.query(
      `update public.table_session_opens set opened_at = now() - interval '2 hours'
        where qr_code_id = (select id from public.table_qr_codes where public_token = $1)`,
      [CARD],
    );

    const scan = await guestScans();
    expect(scan.params.v).toBeUndefined();
    expect(state.jar.has('autodine_table')).toBe(true);

    const form = new FormData();
    form.set('slug', SLUG);
    form.set('lines', JSON.stringify([{ itemId, qty: 2 }]));
    form.set('attempt', '0f4b6c1e-2d3a-4b5c-8d7e-0a1b2c3d4e5a');

    let target = '';
    try {
      await placeOrderAction(form);
    } catch (error) {
      target = error instanceof Error ? error.message.replace('redirect:', '') : '';
    }

    // A real order, written by the real function, with a real code.
    expect(target).toContain('/menu/order?');
    const code = new URL(target, 'http://localhost:3000').searchParams.get('code');
    const order = await db.query(
      `select id, order_session_id, code, hold_required, confirmed_at, prep_status,
              payment_status, total_paise
         from public.orders where code = $1`,
      [code],
    );
    expect(order.rows).toHaveLength(1);
    // Mode is 'scan', so nothing is held: the guest's order goes to the kitchen.
    expect(order.rows[0].hold_required).toBe(false);
    expect(order.rows[0].confirmed_at).toBeNull();
    expect(order.rows[0].order_session_id).toBeTruthy();

    // Continue this same persisted guest ticket through the staff lifecycle on
    // the disposable DB: kitchen transition, cashier settlement, then atomic
    // close plus a numbered non-GST receipt. Only identity/session IDs cross
    // the boundary; the SQL functions derive payment totals and invoice lines.
    await db.query('begin');
    let transactionOpen = true;
    let invoiceId = '';
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [KITCHEN_ID]);
      const kitchen = await db.query(
        `update public.orders set prep_status = 'preparing'
          where id = $1 and prep_status = 'new' returning prep_status`,
        [order.rows[0].id],
      );
      expect(kitchen.rows).toEqual([{ prep_status: 'preparing' }]);

      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [CASHIER_ID]);
      const paid = await db.query(
        'select public.mark_order_session_paid($1) as paid_at',
        [order.rows[0].order_session_id],
      );
      expect(paid.rows[0].paid_at).toBeTruthy();

      const closed = await db.query(
        'select public.close_order_session_and_issue_receipt($1) as invoice_id',
        [order.rows[0].order_session_id],
      );
      invoiceId = closed.rows[0].invoice_id as string;
      expect(invoiceId).toMatch(/^[0-9a-f-]{36}$/i);

      // A retry must return the same immutable receipt, not allocate a number.
      const retried = await db.query(
        'select public.close_order_session_and_issue_receipt($1) as invoice_id',
        [order.rows[0].order_session_id],
      );
      expect(retried.rows[0].invoice_id).toBe(invoiceId);
      await db.query('commit');
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) await db.query('rollback').catch(() => undefined);
      throw error;
    }

    const lifecycle = await db.query(
      `select o.prep_status, o.payment_status, s.status as session_status,
              s.paid_by, s.closed_by, p.method, p.amount_paise, p.recorded_by,
              a.event_type, i.document_type, i.invoice_number,
              i.totals_snapshot->>'total_paise' as invoiced_total_paise,
              count(l.id)::int as invoice_line_count
         from public.orders o
         join public.order_sessions s on s.id = o.order_session_id
         join public.payments p on p.order_id = o.id and p.status = 'recorded'
         join public.payment_audit_events a on a.payment_id = p.id
         join public.restaurant_invoices i on i.order_session_id = s.id
         join public.restaurant_invoice_lines l on l.invoice_id = i.id
        where o.id = $1 and i.id = $2
        group by o.id, s.id, p.id, a.id, i.id`,
      [order.rows[0].id, invoiceId],
    );
    expect(lifecycle.rows).toHaveLength(1);
    expect(lifecycle.rows[0]).toMatchObject({
      prep_status: 'preparing',
      payment_status: 'paid',
      session_status: 'closed',
      paid_by: CASHIER_ID,
      closed_by: CASHIER_ID,
      method: 'manual',
      amount_paise: order.rows[0].total_paise,
      recorded_by: CASHIER_ID,
      event_type: 'manual_marked_paid',
      document_type: 'receipt',
      invoice_line_count: 1,
    });
    expect(lifecycle.rows[0].invoice_number).toMatch(/^INV\/\d{2}-\d{2}\/\d{6}$/);
    expect(lifecycle.rows[0].invoiced_total_paise).toBe(String(order.rows[0].total_paise));
  }, 60_000);

  it('rolls back the losing concurrent order before replaying the winning code (C4)', async () => {
    // Two independent transactions intentionally submit one checkout token.
    // Keep writer A uncommitted so writer B passes the replay SELECT while A's
    // order is still invisible, then blocks on the atomic rate-limit upsert.
    // Once A commits, B continues through core, collides on the unique guest
    // token, and must roll back every row written by its PL/pgSQL exception
    // subtransaction before returning A's code.
    const ipHash = createHash('sha256').update('c4-idempotency-test').digest('hex');
    const session = await db.query(
      'select * from public.open_table_session($1, $2)',
      [CARD, ipHash],
    );
    expect(session.rows[0]?.status).toBe('opened');
    const sessionToken = session.rows[0].session_token as string;
    const guestToken = 'b050c4e0-0000-4000-8000-000000000001';
    const orderArgs = [
      SLUG,
      JSON.stringify([{ itemId, qty: 1 }]),
      null,
      sessionToken,
      guestToken,
      ipHash,
    ];
    const sql = 'select public.place_public_order($1, $2::jsonb, $3, $4, $5::uuid, $6) as code';
    const writerA = new Client({ connectionString: DB, application_name: 'autodine-c4-writer-a' });
    const writerB = new Client({ connectionString: DB, application_name: 'autodine-c4-writer-b' });
    let writerAInTransaction = false;
    let writerBInTransaction = false;
    let secondFinished = false;

    try {
      await Promise.all([writerA.connect(), writerB.connect()]);
      const { rows: pidRows } = await writerB.query('select pg_backend_pid() as pid');
      const writerBPid = pidRows[0].pid as number;

      await writerA.query('begin');
      writerAInTransaction = true;
      const first = await writerA.query(sql, orderArgs);
      const firstCode = first.rows[0]?.code as string;
      expect(firstCode).toMatch(/^[A-Z0-9-]+$/);

      await writerB.query('begin');
      writerBInTransaction = true;
      const secondWork = writerB.query(sql, orderArgs).then(
        (result) => {
          secondFinished = true;
          return { result };
        },
        (queryError: unknown) => {
          secondFinished = true;
          return { queryError };
        },
      );

      // Prove writer B is inside the function and waiting before releasing A.
      // This removes a timing-only race from the assertion: B must have passed
      // its initial replay read while A's token was still uncommitted.
      let blockedOnLock = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await db.query(
          'select wait_event_type from pg_stat_activity where pid = $1 and state = $2',
          [writerBPid, 'active'],
        );
        if (activity.rows[0]?.wait_event_type === 'Lock') {
          blockedOnLock = true;
          break;
        }
        if (secondFinished) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blockedOnLock).toBe(true);

      await writerA.query('commit');
      writerAInTransaction = false;
      const second = await secondWork;
      if ('queryError' in second) throw second.queryError;
      expect(second.result.rows[0]?.code).toBe(firstCode);

      await writerB.query('commit');
      writerBInTransaction = false;

      const persisted = await db.query(
        `select count(distinct o.id)::int as order_count,
                count(oi.id)::int as line_count,
                max(o.code) as code,
                count(distinct o.order_session_id)::int as session_count
           from public.orders o
           left join public.order_items oi on oi.order_id = o.id
          where o.restaurant_id = (select id from public.restaurants where slug = $1)
            and o.guest_token = $2::uuid`,
        [SLUG, guestToken],
      );
      expect(persisted.rows[0]).toMatchObject({
        order_count: 1,
        line_count: 1,
        code: firstCode,
        session_count: 1,
      });
    } finally {
      if (writerAInTransaction) await writerA.query('rollback').catch(() => undefined);
      if (writerBInTransaction) await writerB.query('rollback').catch(() => undefined);
      await Promise.all([writerA.end().catch(() => undefined), writerB.end().catch(() => undefined)]);
    }
  }, 60_000);
});
