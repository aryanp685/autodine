/**
 * Database-level role boundary for order and line reads.
 *
 * Runs only against scripts/verify-database.mjs's disposable database. All API
 * probes use the actual anon/authenticated PostgreSQL roles plus an auth.uid()
 * claim, matching PostgREST's privilege/RLS behavior. No hosted project is used.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const URL_VALUE = process.env.READINESS_DB_URL || '';
const PGRST_BIN = process.env.PGRST_BIN || '';
if (URL_VALUE) {
  const url = new URL(URL_VALUE);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)) {
    throw new Error('Order-read tests require a locally-created disposable autodine_check_* database');
  }
}

type Fixture = {
  restaurant: string;
  slug: string;
  otherRestaurant: string;
  owner: string;
  manager: string;
  cashier: string;
  kitchen: string;
  outsider: string;
  order: string;
  otherOrder: string;
  guestToken: string;
};

let db: Client;

async function asRole<T>(role: 'anon' | 'authenticated', user: string | null, work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? '']);
    await db.query(`set local role ${role}`);
    return await work();
  } finally {
    await db.query('rollback');
  }
}

async function asRoleCommitted<T>(role: 'anon' | 'authenticated', user: string | null, work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? '']);
    await db.query(`set local role ${role}`);
    const result = await work();
    await db.query('commit');
    return result;
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

const staff = <T>(user: string, work: () => Promise<T>) => asRole('authenticated', user, work);
const guest = <T>(work: () => Promise<T>) => asRole('anon', null, work);
const guestCommitted = <T>(work: () => Promise<T>) => asRoleCommitted('anon', null, work);

async function createOrder(restaurantId: string, code: string, token: string): Promise<string> {
  const order = (await db.query(
    `insert into public.orders
       (restaurant_id, code, customer_note, payment_status,
        subtotal_paise, discount_paise, tax_paise, total_paise, guest_token)
     values ($1,$2,'No onion','pending',12500,0,0,12500,$3)
     returning id`,
    [restaurantId, code, token],
  )).rows[0].id as string;
  await db.query(
    `insert into public.order_items(order_id,name_snapshot,unit_price_paise,qty)
     values ($1,'Boundary test dish',12500,1)`,
    [order],
  );
  return order;
}

async function fixture(): Promise<Fixture> {
  const [owner, manager, cashier, kitchen, outsider] = Array.from({ length: 5 }, () => randomUUID());
  const otherOwner = randomUUID();
  await db.query('insert into public.profiles(id) select unnest($1::uuid[])', [[owner, manager, cashier, kitchen, outsider, otherOwner]]);

  const slug = `order-boundary-${randomUUID()}`;
  const restaurant = (await db.query(
    `insert into public.restaurants(slug,name,address,tax_rate_bps)
     values ($1,'Order boundary fixture','Disposable test data',0) returning id`,
    [slug],
  )).rows[0].id as string;
  const otherRestaurant = (await db.query(
    `insert into public.restaurants(slug,name,address,tax_rate_bps)
     values ($1,'Other order boundary fixture','Disposable test data',0) returning id`,
    [`order-boundary-other-${randomUUID()}`],
  )).rows[0].id as string;

  await db.query(
    `insert into public.memberships(restaurant_id,user_id,role) values
       ($1,$2,'owner'),($1,$3,'manager'),($1,$4,'cashier'),($1,$5,'kitchen'),
       ($6,$7,'owner')`,
    [restaurant, owner, manager, cashier, kitchen, otherRestaurant, otherOwner],
  );

  const guestToken = randomUUID();
  const order = await createOrder(restaurant, 'BOUNDARY-1', guestToken);
  const otherOrder = await createOrder(otherRestaurant, 'BOUNDARY-2', randomUUID());
  return { restaurant, slug, otherRestaurant, owner, manager, cashier, kitchen, outsider, order, otherOrder, guestToken };
}

describe.skipIf(!URL_VALUE)('role-scoped order read boundary', () => {
  let f: Fixture;

  beforeAll(async () => {
    db = new Client({ connectionString: URL_VALUE });
    await db.connect();
    f = await fixture();
  }, 30000);
  afterAll(async () => { if (db) await db.end(); });

  it('removes API-role table-wide finance and guest-token SELECT while preserving the operational projection', async () => {
    expect((await db.query("select has_table_privilege('authenticated','public.orders','SELECT') allowed")).rows[0].allowed).toBe(false);
    expect((await db.query("select has_table_privilege('anon','public.orders','SELECT') allowed")).rows[0].allowed).toBe(false);
    expect((await db.query("select has_column_privilege('authenticated','public.orders','code','SELECT') allowed")).rows[0].allowed).toBe(true);
    for (const column of ['payment_status', 'subtotal_paise', 'discount_paise', 'tax_paise', 'total_paise', 'guest_token']) {
      expect((await db.query('select has_column_privilege($1,$2,$3,\'SELECT\') allowed', [
        'authenticated', 'public.orders', column,
      ])).rows[0].allowed, `authenticated can select orders.${column}`).toBe(false);
      expect((await db.query('select has_column_privilege($1,$2,$3,\'SELECT\') allowed', [
        'anon', 'public.orders', column,
      ])).rows[0].allowed, `anon can select orders.${column}`).toBe(false);
    }
    expect((await db.query("select has_column_privilege('authenticated','public.order_items','name_snapshot','SELECT') allowed")).rows[0].allowed).toBe(true);
    expect((await db.query("select has_column_privilege('authenticated','public.order_items','unit_price_paise','SELECT') allowed")).rows[0].allowed).toBe(false);
  });

  it('lets Kitchen read operational order/line fields but rejects money, payment state and guest credentials', async () => {
    const order = await staff(f.kitchen, () => db.query(
      'select id,restaurant_id,code,customer_note,prep_status from public.orders where id=$1', [f.order],
    ));
    expect(order.rows).toEqual([{
      id: f.order,
      restaurant_id: f.restaurant,
      code: 'BOUNDARY-1',
      customer_note: 'No onion',
      prep_status: 'new',
    }]);

    for (const column of ['payment_status', 'total_paise', 'guest_token']) {
      await expect(staff(f.kitchen, () => db.query(
        `select ${column} from public.orders where id=$1`, [f.order],
      ))).rejects.toMatchObject({ code: '42501' });
    }
    const item = await staff(f.kitchen, () => db.query(
      'select order_id,name_snapshot,qty from public.order_items where order_id=$1', [f.order],
    ));
    expect(item.rows).toEqual([{ order_id: f.order, name_snapshot: 'Boundary test dish', qty: 1 }]);
    await expect(staff(f.kitchen, () => db.query(
      'select unit_price_paise from public.order_items where order_id=$1', [f.order],
    ))).rejects.toMatchObject({ code: '42501' });
  });

  it('exposes finance projections only to Owner, Manager and Cashier; no projection contains guest_token', async () => {
    const views = await db.query(`select c.relname,c.relkind,c.reloptions
      from pg_catalog.pg_class c
      where c.oid in ('public.orders_finance'::regclass,'public.order_items_finance'::regclass)`);
    expect(Object.fromEntries(views.rows.map((view) => [view.relname, { kind: view.relkind, options: view.reloptions }]))).toEqual({
      orders_finance: { kind: 'v', options: ['security_barrier=true'] },
      order_items_finance: { kind: 'v', options: ['security_barrier=true'] },
    });

    for (const user of [f.owner, f.manager, f.cashier]) {
      const orders = await staff(user, () => db.query(
        'select id,payment_status,total_paise from public.orders_finance where id=$1', [f.order],
      ));
      expect(orders.rows).toEqual([{ id: f.order, payment_status: 'pending', total_paise: '12500' }]);
      const items = await staff(user, () => db.query(
        'select order_id,unit_price_paise from public.order_items_finance where order_id=$1', [f.order],
      ));
      expect(items.rows).toEqual([{ order_id: f.order, unit_price_paise: '12500' }]);
    }

    for (const user of [f.kitchen, f.outsider]) {
      expect((await staff(user, () => db.query(
        'select id,payment_status,total_paise from public.orders_finance where id=$1', [f.order],
      ))).rows).toEqual([]);
      expect((await staff(user, () => db.query(
        'select order_id,unit_price_paise from public.order_items_finance where order_id=$1', [f.order],
      ))).rows).toEqual([]);
    }

    expect((await db.query(`select column_name from information_schema.columns
      where table_schema='public' and table_name in ('orders_finance','order_items_finance')
        and column_name='guest_token'`)).rows).toEqual([]);
    await expect(guest(() => db.query('select id from public.orders'))).rejects.toMatchObject({ code: '42501' });
    await expect(guest(() => db.query('select id from public.order_items'))).rejects.toMatchObject({ code: '42501' });
    await expect(guest(() => db.query('select id from public.orders_finance'))).rejects.toMatchObject({ code: '42501' });
    await expect(guest(() => db.query('select id from public.order_items_finance'))).rejects.toMatchObject({ code: '42501' });
  });

  it('allows anon to call get_public_order only with the matching slug, code and guest token', async () => {
    expect((await db.query("select has_function_privilege('anon','public.get_public_order(text,text,uuid)','EXECUTE') allowed")).rows[0].allowed).toBe(true);
    expect((await db.query("select prosecdef, proconfig from pg_catalog.pg_proc where oid='public.get_public_order(text,text,uuid)'::regprocedure")).rows[0]).toEqual({
      prosecdef: true,
      proconfig: ['search_path=public, pg_temp'],
    });

    const valid = await guest(() => db.query(
      'select public.get_public_order($1,$2,$3) value', [f.slug, 'BOUNDARY-1', f.guestToken],
    ));
    expect(valid.rows[0].value).toMatchObject({
      id: f.order,
      code: 'BOUNDARY-1',
      payment_status: 'pending',
      total_paise: 12500,
      lines: [{ name: 'Boundary test dish', qty: 1, unit_price_paise: 12500 }],
    });
    expect(valid.rows[0].value).not.toHaveProperty('guest_token');

    for (const [slug, code, token] of [
      [f.slug, 'BOUNDARY-1', randomUUID()],
      [f.slug, 'BOUNDARY-2', f.guestToken],
      [`${f.slug}-wrong`, 'BOUNDARY-1', f.guestToken],
    ]) {
      const denied = await guest(() => db.query(
        'select public.get_public_order($1,$2,$3) value', [slug, code, token],
      ));
      expect(denied.rows[0].value).toBeNull();
    }
    const nullToken = await guest(() => db.query(
      'select public.get_public_order($1,$2,null) value', [f.slug, 'BOUNDARY-1'],
    ));
    expect(nullToken.rows[0].value).toBeNull();
  });

  it('keeps row access tenant-scoped through both the safe base table and the finance views', async () => {
    expect((await staff(f.outsider, () => db.query(
      'select id from public.orders where id=$1', [f.order],
    ))).rows).toEqual([]);
    expect((await staff(f.owner, () => db.query(
      'select id from public.orders_finance where id=$1', [f.otherOrder],
    ))).rows).toEqual([]);
    expect((await staff(f.owner, () => db.query(
      'select order_id from public.order_items_finance where order_id=$1', [f.otherOrder],
    ))).rows).toEqual([]);
  });

  it('does not publish raw order or waiter-call rows, or retain FULL replica identity', async () => {
    expect((await db.query(`select count(*)::int n from pg_catalog.pg_publication_tables
      where schemaname='public' and tablename in ('orders','table_waiter_calls')`)).rows[0].n).toBe(0);
    for (const table of ['orders', 'table_waiter_calls']) {
      expect((await db.query(`select relreplident from pg_catalog.pg_class
        where oid=($1::text)::regclass`, [`public.${table}`])).rows[0].relreplident).toBe('d');
    }
  });

  it('does not let Kitchen infer settlement through ordinary cancellation', async () => {
    const signature = 'public.cancel_order(uuid,uuid,text)';
    expect((await db.query('select has_function_privilege(\'anon\',$1,\'EXECUTE\') allowed', [signature])).rows[0].allowed).toBe(true);
    expect((await db.query('select has_function_privilege(\'authenticated\',$1,\'EXECUTE\') allowed', [signature])).rows[0].allowed).toBe(true);
    expect((await db.query(`select prosecdef,proconfig from pg_catalog.pg_proc
      where oid='public.cancel_order(uuid,uuid,text)'::regprocedure`)).rows[0]).toEqual({
      prosecdef: true,
      proconfig: ['search_path=public, pg_temp'],
    });

    const paidOrder = await createOrder(f.restaurant, 'BOUNDARY-PAID', randomUUID());
    await db.query("update public.orders set payment_status='paid' where id=$1", [paidOrder]);

    for (const orderId of [f.order, paidOrder]) {
      await expect(staff(f.kitchen, () => db.query(
        'select public.cancel_order($1,null,null)', [orderId],
      ))).rejects.toMatchObject({ code: '42501', message: expect.not.stringMatching(/paid|payment/i) });
    }

    const allowed = await staff(f.cashier, () => db.query(
      'select public.cancel_order($1,null,null) result', [f.order],
    ));
    expect(allowed.rows[0].result).toMatchObject({ status: 'cancelled', already: false });
  });

  it('preserves guest-token cancellation but enforces the restaurant write gate for every caller', async () => {
    await expect(guest(() => db.query(
      'select public.cancel_order($1,$2,null)', [f.order, randomUUID()],
    ))).rejects.toMatchObject({ code: 'P0001', message: 'That order could not be found.' });
    expect((await db.query('select prep_status from public.orders where id=$1', [f.order])).rows[0].prep_status).toBe('new');

    await db.query(
      "update public.restaurants set trial_started_at=now()-interval '25 days' where id=$1",
      [f.restaurant],
    );
    expect((await db.query('select public.restaurant_can_write($1) can_write', [f.restaurant])).rows[0].can_write).toBe(false);

    for (const cancel of [
      () => staff(f.cashier, () => db.query('select public.cancel_order($1,null,null)', [f.order])),
      () => guest(() => db.query('select public.cancel_order($1,$2,null)', [f.order, f.guestToken])),
    ]) {
      await expect(cancel()).rejects.toMatchObject({
        code: 'P0001',
        message: expect.stringMatching(/read-only/i),
      });
    }
    expect((await db.query('select prep_status from public.orders where id=$1', [f.order])).rows[0].prep_status).toBe('new');

    await db.query('update public.restaurants set trial_started_at=now() where id=$1', [f.restaurant]);
    expect((await db.query('select public.restaurant_can_write($1) can_write', [f.restaurant])).rows[0].can_write).toBe(true);
    const cancelled = await guestCommitted(() => db.query(
      'select public.cancel_order($1,$2,null) result', [f.order, f.guestToken],
    ));
    expect(cancelled.rows[0].result).toMatchObject({ status: 'cancelled', already: false });

    await db.query(
      "update public.restaurants set trial_started_at=now()-interval '25 days' where id=$1",
      [f.restaurant],
    );
    const retry = await guest(() => db.query(
      'select public.cancel_order($1,$2,null) result', [f.order, f.guestToken],
    ));
    expect(retry.rows[0].result).toMatchObject({ status: 'cancelled', already: true });
  });

  it('keeps guest line edits token-bound and write-gated, and denies Kitchen before payment-state checks', async () => {
    const edit = await fixture();
    await db.query('update public.restaurants set trial_started_at=now() where id=$1', [edit.restaurant]);
    const lineId = (await db.query(
      'select id from public.order_items where order_id=$1', [edit.order],
    )).rows[0].id as string;
    const signature = 'public.set_order_line_quantities(uuid,jsonb,uuid)';
    expect((await db.query('select has_function_privilege(\'anon\',$1,\'EXECUTE\') allowed', [signature])).rows[0].allowed).toBe(true);
    expect((await db.query('select has_function_privilege(\'authenticated\',$1,\'EXECUTE\') allowed', [signature])).rows[0].allowed).toBe(true);
    expect((await db.query(`select prosecdef, proconfig from pg_catalog.pg_proc
      where oid='public.set_order_line_quantities(uuid,jsonb,uuid)'::regprocedure`)).rows[0]).toEqual({
      prosecdef: true,
      proconfig: ['search_path=public, pg_temp'],
    });

    const payload = (qty: number) => JSON.stringify([{ line_id: lineId, qty }]);
    const changed = await guestCommitted(() => db.query(
      'select public.set_order_line_quantities($1,$2::jsonb,$3) result',
      [edit.order, payload(2), edit.guestToken],
    ));
    expect(changed.rows[0].result).toMatchObject({ subtotal_paise: 25000, total_paise: 25000, lines: 1 });
    expect((await db.query('select qty from public.order_items where id=$1', [lineId])).rows[0].qty).toBe(2);

    await expect(guest(() => db.query(
      'select public.set_order_line_quantities($1,$2::jsonb,$3)',
      [edit.order, payload(3), randomUUID()],
    ))).rejects.toMatchObject({ code: 'P0001', message: 'That order could not be found.' });
    expect((await db.query('select qty from public.order_items where id=$1', [lineId])).rows[0].qty).toBe(2);

    await db.query(
      "update public.restaurants set trial_started_at=now()-interval '25 days' where id=$1",
      [edit.restaurant],
    );
    await expect(guest(() => db.query(
      'select public.set_order_line_quantities($1,$2::jsonb,$3)',
      [edit.order, payload(3), edit.guestToken],
    ))).rejects.toMatchObject({ code: 'P0001', message: expect.stringMatching(/read-only/i) });
    expect((await db.query('select qty from public.order_items where id=$1', [lineId])).rows[0].qty).toBe(2);
    await db.query('update public.restaurants set trial_started_at=now() where id=$1', [edit.restaurant]);

    const pending = (await db.query(`insert into public.payments
      (restaurant_id,order_id,method,status,amount_paise)
      values ($1,$2,'online','pending',25000) returning id`, [edit.restaurant, edit.order])).rows[0].id;
    await expect(guest(() => db.query(
      'select public.set_order_line_quantities($1,$2::jsonb,$3)',
      [edit.order, payload(3), edit.guestToken],
    ))).rejects.toMatchObject({ code: 'P0001', message: expect.stringMatching(/online payment is in progress/i) });
    await db.query('delete from public.payments where id=$1', [pending]);
    expect((await db.query('select qty from public.order_items where id=$1', [lineId])).rows[0].qty).toBe(2);

    for (const user of [edit.owner, edit.manager, edit.cashier]) {
      await staff(user, () => db.query(
        'select public.set_order_line_quantities($1,$2::jsonb,null)',
        [edit.order, payload(2)],
      ));
    }

    const unpaidKitchenOrder = await createOrder(edit.restaurant, 'EDIT-KITCHEN-PENDING', randomUUID());
    const paidKitchenOrder = await createOrder(edit.restaurant, 'EDIT-KITCHEN-PAID', randomUUID());
    await db.query("update public.orders set payment_status='paid' where id=$1", [paidKitchenOrder]);
    const unpaidLine = (await db.query('select id from public.order_items where order_id=$1', [unpaidKitchenOrder])).rows[0].id as string;
    const paidLine = (await db.query('select id from public.order_items where order_id=$1', [paidKitchenOrder])).rows[0].id as string;
    for (const [orderId, line] of [[unpaidKitchenOrder, unpaidLine], [paidKitchenOrder, paidLine]]) {
      await expect(staff(edit.kitchen, () => db.query(
        'select public.set_order_line_quantities($1,$2::jsonb,null)',
        [orderId, JSON.stringify([{ line_id: line, qty: 2 }])],
      ))).rejects.toMatchObject({
        code: '42501',
        message: expect.not.stringMatching(/paid|payment|online/i),
      });
    }
  });

  describe.skipIf(!PGRST_BIN)('direct local PostgREST access', () => {
    let server: ChildProcess | null = null;
    let origin = '';
    let jwtSecret = '';
    let serverLogs = '';

    function jwt(role: 'anon' | 'authenticated', user?: string): string {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const header = encode({ alg: 'HS256', typ: 'JWT' });
      const issuedAt = Math.floor(Date.now() / 1000);
      const payload = encode({ role, sub: user ?? '', iat: issuedAt, exp: issuedAt + 300 });
      const unsigned = `${header}.${payload}`;
      const signature = createHmac('sha256', jwtSecret).update(unsigned).digest('base64url');
      return `${unsigned}.${signature}`;
    }

    async function unusedPort(): Promise<number> {
      const probe = net.createServer();
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', resolve);
      });
      const address = probe.address();
      if (!address || typeof address === 'string') throw new Error('Could not allocate a local PostgREST port.');
      await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
      return address.port;
    }

    async function request(path: string, token: string, init: RequestInit = {}): Promise<Response> {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${token}`);
      headers.set('accept', 'application/json');
      return fetch(new URL(path, origin), { ...init, headers });
    }

    beforeAll(async () => {
      const database = new URL(URL_VALUE);
      const databaseName = database.pathname.slice(1);
      const password = randomUUID().replaceAll('-', '');
      jwtSecret = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
      await db.query(`alter role authenticator with login noinherit password '${password}'`);
      await db.query('grant anon, authenticated, service_role to authenticator');

      const port = await unusedPort();
      origin = `http://127.0.0.1:${port}`;
      const databaseHost = database.hostname.replace(/^\\[|\\]$/g, '');
      const databasePort = database.port || '5432';
      server = spawn(PGRST_BIN, [], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PGRST_DB_URI: `postgres://authenticator:${password}@${databaseHost}:${databasePort}/${databaseName}`,
          PGRST_DB_SCHEMAS: 'public',
          PGRST_DB_ANON_ROLE: 'anon',
          PGRST_DB_EXTRA_SEARCH_PATH: 'public',
          PGRST_JWT_SECRET: jwtSecret,
          PGRST_SERVER_HOST: '127.0.0.1',
          PGRST_SERVER_PORT: String(port),
          PGRST_LOG_LEVEL: 'info',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      server.stdout?.on('data', (chunk: Buffer) => { serverLogs += chunk.toString(); });
      server.stderr?.on('data', (chunk: Buffer) => { serverLogs += chunk.toString(); });

      const deadline = Date.now() + 20_000;
      let startupError: Error | undefined;
      server.once('error', (error) => { startupError = error; });
      while (Date.now() < deadline) {
        if (startupError) throw startupError;
        if (server.exitCode !== null) throw new Error(`PostgREST exited during startup: ${serverLogs.slice(-2000)}`);
        try {
          const response = await fetch(`${origin}/`, { headers: { accept: 'application/openapi+json' } });
          if (response.ok) return;
        } catch {
          // The local listener is not ready yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`PostgREST did not become ready: ${serverLogs.slice(-2000)}`);
    }, 30000);

    afterAll(async () => {
      if (!server) return;
      const child = server;
      server = null;
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 3000);
        child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    });

    it('exposes no anonymous direct order or finance rows, but keeps the token-bound guest RPC', async () => {
      const anonToken = jwt('anon');
      for (const path of [
        `/orders?select=id&id=eq.${f.order}`,
        `/order_items?select=id&order_id=eq.${f.order}`,
        `/orders_finance?select=id&id=eq.${f.order}`,
        `/order_items_finance?select=id&order_id=eq.${f.order}`,
      ]) {
        const response = await request(path, anonToken);
        const body = await response.text();
        expect(response.status, path).toBeGreaterThanOrEqual(400);
        expect(body).not.toContain(f.order);
        expect(body).not.toContain(f.guestToken);
      }

      const valid = await request('/rpc/get_public_order', anonToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ p_slug: f.slug, p_code: 'BOUNDARY-1', p_token: f.guestToken }),
      });
      expect(valid.status).toBe(200);
      const order = await valid.json();
      expect(order).toMatchObject({ id: f.order, code: 'BOUNDARY-1', payment_status: 'pending' });
      expect(order).not.toHaveProperty('guest_token');

      const wrongToken = await request('/rpc/get_public_order', anonToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ p_slug: f.slug, p_code: 'BOUNDARY-1', p_token: randomUUID() }),
      });
      expect(wrongToken.status).toBe(200);
      expect(await wrongToken.json()).toBeNull();

      await db.query('update public.restaurants set trial_started_at=now() where id=$1', [f.restaurant]);
      const lineId = (await db.query(
        'select id from public.order_items where order_id=$1', [f.order],
      )).rows[0].id;
      const edit = await request('/rpc/set_order_line_quantities', anonToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_order_id: f.order,
          p_lines: [{ line_id: lineId, qty: 1 }],
          p_guest_token: f.guestToken,
        }),
      });
      expect(edit.status).toBe(200);
      expect(await edit.json()).toMatchObject({ subtotal_paise: 12500, total_paise: 12500, lines: 1 });

      const deniedEdit = await request('/rpc/set_order_line_quantities', anonToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_order_id: f.order,
          p_lines: [{ line_id: lineId, qty: 2 }],
          p_guest_token: randomUUID(),
        }),
      });
      expect(deniedEdit.status).toBeGreaterThanOrEqual(400);
      expect(await deniedEdit.text()).not.toContain(f.order);
      expect((await db.query('select qty from public.order_items where id=$1', [lineId])).rows[0].qty).toBe(1);
    });

    it('enforces finance-view role checks and operational-only direct PostgREST columns', async () => {
      const financePath = `/orders_finance?select=id,payment_status,total_paise&restaurant_id=eq.${f.restaurant}&id=eq.${f.order}`;
      const financeItemPath = `/order_items_finance?select=order_id,unit_price_paise&order_id=eq.${f.order}`;
      for (const user of [f.owner, f.manager, f.cashier]) {
        const response = await request(financePath, jwt('authenticated', user));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([{ id: f.order, payment_status: 'pending', total_paise: 12500 }]);
        const lineResponse = await request(financeItemPath, jwt('authenticated', user));
        expect(lineResponse.status).toBe(200);
        expect(await lineResponse.json()).toEqual([{ order_id: f.order, unit_price_paise: 12500 }]);
      }

      const kitchenToken = jwt('authenticated', f.kitchen);
      const operational = await request(
        `/orders?select=id,code,prep_status&id=eq.${f.order}`,
        kitchenToken,
      );
      expect(operational.status).toBe(200);
      expect(await operational.json()).toEqual([{ id: f.order, code: 'BOUNDARY-1', prep_status: 'new' }]);

      const kitchenFinance = await request(financePath, kitchenToken);
      expect(kitchenFinance.status).toBe(200);
      expect(await kitchenFinance.json()).toEqual([]);
      const kitchenMoney = await request(`/orders?select=id,payment_status&id=eq.${f.order}`, kitchenToken);
      expect(kitchenMoney.status).toBeGreaterThanOrEqual(400);
      expect((await kitchenMoney.text())).not.toContain('pending');

      const outsider = await request(financePath, jwt('authenticated', f.outsider));
      expect(outsider.status).toBe(200);
      expect(await outsider.json()).toEqual([]);
    });
  });
});
