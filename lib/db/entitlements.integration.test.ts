import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const USER_ONE = '10000000-0000-4000-8000-000000000001';
const USER_TWO = '10000000-0000-4000-8000-000000000002';
const MANAGER_USER = '10000000-0000-4000-8000-000000000003';
const CASHIER_USER = '10000000-0000-4000-8000-000000000004';
const KITCHEN_USER = '10000000-0000-4000-8000-000000000005';
const TRIAL_RESTAURANT = '20000000-0000-4000-8000-000000000001';
const EXPIRED_RESTAURANT = '20000000-0000-4000-8000-000000000002';
const OTHER_RESTAURANT = '20000000-0000-4000-8000-000000000003';
const TRIAL_ITEM = '30000000-0000-4000-8000-000000000001';
const UNAVAILABLE_ITEM = '30000000-0000-4000-8000-000000000002';
const EXPIRED_ITEM = '30000000-0000-4000-8000-000000000003';
const OTHER_ITEM = '30000000-0000-4000-8000-000000000004';
const TRIAL_TABLE = '40000000-0000-4000-8000-000000000001';
const EXPIRED_TABLE = '40000000-0000-4000-8000-000000000002';
const OTHER_TABLE = '40000000-0000-4000-8000-000000000003';
const EXISTING_EXPIRED_ORDER = '50000000-0000-4000-8000-000000000001';
const OTHER_ORDER = '50000000-0000-4000-8000-000000000002';

const migrationPaths = [
  new URL('../../supabase/migrations/20261019000001_init.sql', import.meta.url),
  new URL('../../supabase/migrations/20261019000002_public_read.sql', import.meta.url),
  new URL('../../supabase/migrations/20261019000003_trial_entitlements.sql', import.meta.url),
  new URL('../../supabase/migrations/20261019000004_counter_orders.sql', import.meta.url),
  new URL('../../supabase/migrations/20261019000005_cash_collection.sql', import.meta.url),
];

let db: PGlite;

async function asRole<T>(role: 'anon' | 'authenticated', userId: string, action: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec(`set role ${role}`);
  try {
    return await action();
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);

  for (const path of migrationPaths) {
    await db.exec(readFileSync(path, 'utf8'));
  }

  // Supabase grants baseline table privileges outside migration files. Mirror
  // reads and ordinary CRUD while preserving the explicit write restrictions
  // on orders, order_items, payments and the audit table.
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated;
    grant select, insert, update, delete on
      public.restaurants, public.profiles, public.memberships,
      public.menus, public.categories, public.items, public.item_variants,
      public.dining_tables, public.qr_tokens
      to authenticated;
    grant select on
      public.orders, public.order_items, public.payments, public.payment_audit_events
      to authenticated;
    grant execute on function public.place_order(text, text, jsonb, text)
      to anon, authenticated;
    grant execute on function public.place_counter_order(text, jsonb, text)
      to authenticated;
    grant execute on function public.record_cash_payment(text, uuid, bigint, uuid)
      to authenticated;
  `);

  await db.exec(`
    insert into public.profiles (id, full_name) values
      ('${USER_ONE}', 'Owner One'),
      ('${USER_TWO}', 'Owner Two'),
      ('${MANAGER_USER}', 'Manager'),
      ('${CASHIER_USER}', 'Cashier'),
      ('${KITCHEN_USER}', 'Kitchen');

    insert into public.restaurants (id, slug, name, trial_started_at) values
      ('${TRIAL_RESTAURANT}', 'trial-place', 'Trial Place', now()),
      ('${EXPIRED_RESTAURANT}', 'expired-place', 'Expired Place', now() - interval '11 days'),
      ('${OTHER_RESTAURANT}', 'other-place', 'Other Place', now());

    insert into public.memberships (restaurant_id, user_id, role) values
      ('${TRIAL_RESTAURANT}', '${USER_ONE}', 'owner'),
      ('${TRIAL_RESTAURANT}', '${MANAGER_USER}', 'manager'),
      ('${TRIAL_RESTAURANT}', '${CASHIER_USER}', 'cashier'),
      ('${TRIAL_RESTAURANT}', '${KITCHEN_USER}', 'kitchen'),
      ('${EXPIRED_RESTAURANT}', '${USER_ONE}', 'owner'),
      ('${OTHER_RESTAURANT}', '${USER_TWO}', 'owner');

    insert into public.items (id, restaurant_id, name, price_paise, is_available) values
      ('${TRIAL_ITEM}', '${TRIAL_RESTAURANT}', 'Trial item', 1000, true),
      ('${UNAVAILABLE_ITEM}', '${TRIAL_RESTAURANT}', 'Unavailable item', 500, false),
      ('${EXPIRED_ITEM}', '${EXPIRED_RESTAURANT}', 'Expired place item', 800, true),
      ('${OTHER_ITEM}', '${OTHER_RESTAURANT}', 'Other tenant item', 700, true);

    insert into public.dining_tables (id, restaurant_id, label) values
      ('${TRIAL_TABLE}', '${TRIAL_RESTAURANT}', 'T1'),
      ('${EXPIRED_TABLE}', '${EXPIRED_RESTAURANT}', 'T2'),
      ('${OTHER_TABLE}', '${OTHER_RESTAURANT}', 'T3');

    insert into public.qr_tokens (restaurant_id, table_id, token, expires_at) values
      ('${TRIAL_RESTAURANT}', '${TRIAL_TABLE}', 'trial-token', now() + interval '1 hour'),
      ('${EXPIRED_RESTAURANT}', '${EXPIRED_TABLE}', 'expired-token', now() + interval '1 hour'),
      ('${OTHER_RESTAURANT}', '${OTHER_TABLE}', 'other-token', now() + interval '1 hour');

    insert into public.orders (
      id, restaurant_id, code, subtotal_paise, tax_paise, total_paise
    ) values
      ('${EXISTING_EXPIRED_ORDER}', '${EXPIRED_RESTAURANT}', 'OLD', 1000, 50, 1050),
      ('${OTHER_ORDER}', '${OTHER_RESTAURANT}', 'OTH', 700, 35, 735);
  `);
});

afterAll(async () => {
  await db.close();
});

describe('Postgres trial entitlements and order RLS', () => {
  it('runs all migrations on PostgreSQL and keeps expired data readable but immutable', async () => {
    const result = await asRole('authenticated', USER_ONE, () =>
      db.query<{ id: string }>(
        'select id from public.orders where id = $1',
        [EXISTING_EXPIRED_ORDER],
      ),
    );
    expect(result.rows).toHaveLength(1);

    const update = await asRole('authenticated', USER_ONE, () =>
      db.query<{ id: string }>(
        "update public.orders set prep_status = 'preparing' where id = $1 returning id",
        [EXISTING_EXPIRED_ORDER],
      ),
    );
    expect(update.rows).toHaveLength(0);
  });

  it('does not disclose another tenant’s write entitlement to authenticated nonmembers', async () => {
    const member = await asRole('authenticated', USER_ONE, () =>
      db.query<{ can_write: boolean }>('select public.restaurant_can_write($1) as can_write', [TRIAL_RESTAURANT]),
    );
    const nonmember = await asRole('authenticated', USER_TWO, () =>
      db.query<{ can_write: boolean }>('select public.restaurant_can_write($1) as can_write', [TRIAL_RESTAURANT]),
    );

    expect(member.rows[0]?.can_write).toBe(true);
    expect(nonmember.rows[0]?.can_write).toBe(false);
    await expect(
      asRole('anon', USER_ONE, () =>
        db.query('select public.restaurant_can_write($1)', [TRIAL_RESTAURANT]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('denies authenticated direct inserts into orders and order_items', async () => {
    await expect(
      asRole('authenticated', USER_ONE, () =>
        db.query(
          'insert into public.orders (restaurant_id, code) values ($1, $2)',
          [TRIAL_RESTAURANT, 'BYPASS'],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);

    await expect(
      asRole('authenticated', USER_ONE, () =>
        db.query(
          `insert into public.order_items
            (order_id, name_snapshot, unit_price_paise, qty)
           values ($1, 'forged', 1, 1)`,
          [EXISTING_EXPIRED_ORDER],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it('prices a valid guest order from database values, not client totals', async () => {
    const created = await asRole('anon', USER_ONE, () =>
      db.query<{ order_id: string }>(
        'select public.place_order($1, $2, $3::jsonb, $4) as order_id',
        ['trial-place', 'trial-token', JSON.stringify([{ item_id: TRIAL_ITEM, qty: 1 }]), null],
      ),
    );

    const orderId = created.rows[0]?.order_id;
    expect(orderId).toBeTruthy();
    const order = await db.query<{ subtotal_paise: number; tax_paise: number; total_paise: number }>(
      'select subtotal_paise, tax_paise, total_paise from public.orders where id = $1',
      [orderId],
    );
    expect(order.rows[0]).toMatchObject({ subtotal_paise: 1000, tax_paise: 50, total_paise: 1050 });
  });

  it('rejects cross-tenant, unavailable, and invalid-quantity items', async () => {
    const invalidOrders = [
      { item_id: OTHER_ITEM, qty: 1 },
      { item_id: UNAVAILABLE_ITEM, qty: 1 },
      { item_id: TRIAL_ITEM, qty: 0 },
    ];

    for (const line of invalidOrders) {
      await expect(
        asRole('anon', USER_ONE, () =>
          db.query(
            'select public.place_order($1, $2, $3::jsonb, $4)',
            ['trial-place', 'trial-token', JSON.stringify([line]), null],
          ),
        ),
      ).rejects.toThrow();
    }
  });

  it('allows only owner, manager and cashier to create priced unpaid counter orders', async () => {
    for (const actor of [USER_ONE, MANAGER_USER, CASHIER_USER]) {
      const result = await asRole('authenticated', actor, () =>
        db.query<{ order_id: string }>(
          'select public.place_counter_order($1, $2::jsonb, $3) as order_id',
          [
            'trial-place',
            JSON.stringify([{ item_id: TRIAL_ITEM, qty: 2, price_paise: 1, total_paise: 2 }]),
            'Counter order',
          ],
        ),
      );
      const order = await db.query<{
        subtotal_paise: number;
        tax_paise: number;
        total_paise: number;
        payment_status: string;
        table_id: string | null;
      }>(
        'select subtotal_paise, tax_paise, total_paise, payment_status, table_id from public.orders where id = $1',
        [result.rows[0]?.order_id],
      );
      expect(order.rows[0]).toMatchObject({
        subtotal_paise: 2000,
        tax_paise: 100,
        total_paise: 2100,
        payment_status: 'pending',
        table_id: null,
      });
    }
  });

  it('rejects kitchen staff, cross-tenant access, and invalid counter items', async () => {
    await expect(
      asRole('authenticated', KITCHEN_USER, () =>
        db.query(
          'select public.place_counter_order($1, $2::jsonb, $3)',
          ['trial-place', JSON.stringify([{ item_id: TRIAL_ITEM, qty: 1 }]), null],
        ),
      ),
    ).rejects.toThrow(/permission/i);

    await expect(
      asRole('authenticated', USER_ONE, () =>
        db.query(
          'select public.place_counter_order($1, $2::jsonb, $3)',
          ['other-place', JSON.stringify([{ item_id: OTHER_ITEM, qty: 1 }]), null],
        ),
      ),
    ).rejects.toThrow(/permission/i);

    await expect(
      asRole('authenticated', CASHIER_USER, () =>
        db.query(
          'select public.place_counter_order($1, $2::jsonb, $3)',
          ['trial-place', JSON.stringify([{ item_id: OTHER_ITEM, qty: 1 }]), null],
        ),
      ),
    ).rejects.toThrow(/no longer available/i);
  });

  it('records exact cash once, audits the actor and allows a read-only idempotent retry after expiry', async () => {
    const created = await asRole('authenticated', CASHIER_USER, () =>
      db.query<{ order_id: string }>(
        'select public.place_counter_order($1, $2::jsonb, $3) as order_id',
        ['trial-place', JSON.stringify([{ item_id: TRIAL_ITEM, qty: 1 }]), null],
      ),
    );
    const orderId = created.rows[0]?.order_id;
    const requestKey = '60000000-0000-4000-8000-000000000001';

    const payment = await asRole('authenticated', CASHIER_USER, () =>
      db.query<{ payment_id: string }>(
        'select public.record_cash_payment($1, $2, $3, $4) as payment_id',
        ['trial-place', orderId, 1050, requestKey],
      ),
    );
    const paymentId = payment.rows[0]?.payment_id;
    expect(paymentId).toBeTruthy();

    const recorded = await db.query<{
      method: string;
      amount_paise: number;
      status: string;
      recorded_by: string;
      payment_status: string;
      created_at: string;
      audit_count: number;
      audit_actor: string;
      audit_amount: number;
    }>(
      `select p.method, p.amount_paise, p.status, p.recorded_by, p.created_at,
              o.payment_status,
              (select count(*)::int from public.payment_audit_events e where e.payment_id = p.id) as audit_count,
              (select e.actor_id from public.payment_audit_events e where e.payment_id = p.id) as audit_actor,
              (select e.amount_paise from public.payment_audit_events e where e.payment_id = p.id) as audit_amount
       from public.payments p join public.orders o on o.id = p.order_id
       where p.id = $1`,
      [paymentId],
    );
    expect(recorded.rows[0]).toMatchObject({
      method: 'cash',
      amount_paise: 1050,
      status: 'recorded',
      recorded_by: CASHIER_USER,
      payment_status: 'paid',
      audit_count: 1,
      audit_actor: CASHIER_USER,
      audit_amount: 1050,
    });
    expect(recorded.rows[0]?.created_at).toBeTruthy();

    await db.query(
      "update public.restaurants set trial_started_at = now() - interval '11 days' where id = $1",
      [TRIAL_RESTAURANT],
    );
    const retry = await asRole('authenticated', CASHIER_USER, () =>
      db.query<{ payment_id: string }>(
        'select public.record_cash_payment($1, $2, $3, $4) as payment_id',
        ['trial-place', orderId, 1050, requestKey],
      ),
    );
    expect(retry.rows[0]?.payment_id).toBe(paymentId);
    const counts = await db.query<{ payments: number; events: number }>(
      `select
         (select count(*)::int from public.payments where order_id = $1) as payments,
         (select count(*)::int from public.payment_audit_events where order_id = $1) as events`,
      [orderId],
    );
    expect(counts.rows[0]).toEqual({ payments: 1, events: 1 });
    await db.query('update public.restaurants set trial_started_at = now() where id = $1', [TRIAL_RESTAURANT]);

    await expect(
      asRole('authenticated', CASHIER_USER, () =>
        db.query('select public.record_cash_payment($1, $2, $3, $4)', [
          'trial-place', orderId, 1050, '60000000-0000-4000-8000-000000000002',
        ]),
      ),
    ).rejects.toThrow(/unpaid pending orders/i);
  });

  it('also authorizes owners and managers to collect cash', async () => {
    for (const actor of [USER_ONE, MANAGER_USER]) {
      const created = await asRole('authenticated', actor, () =>
        db.query<{ order_id: string }>(
          'select public.place_counter_order($1, $2::jsonb, $3) as order_id',
          ['trial-place', JSON.stringify([{ item_id: TRIAL_ITEM, qty: 1 }]), null],
        ),
      );
      const payment = await asRole('authenticated', actor, () =>
        db.query<{ payment_id: string }>(
          'select public.record_cash_payment($1, $2, $3, $4) as payment_id',
          [
            'trial-place',
            created.rows[0]?.order_id,
            1050,
            actor === USER_ONE
              ? '60000000-0000-4000-8000-000000000006'
              : '60000000-0000-4000-8000-000000000007',
          ],
        ),
      );
      const recorded = await db.query<{ recorded_by: string }>(
        'select recorded_by from public.payments where id = $1',
        [payment.rows[0]?.payment_id],
      );
      expect(recorded.rows[0]?.recorded_by).toBe(actor);
    }
  });

  it('rejects wrong cash amounts, kitchen collection and cross-tenant payment attempts', async () => {
    const created = await asRole('authenticated', CASHIER_USER, () =>
      db.query<{ order_id: string }>(
        'select public.place_counter_order($1, $2::jsonb, $3) as order_id',
        ['trial-place', JSON.stringify([{ item_id: TRIAL_ITEM, qty: 1 }]), null],
      ),
    );
    const orderId = created.rows[0]?.order_id;
    const key = '60000000-0000-4000-8000-000000000003';

    for (const amount of [1049, 1051, 0]) {
      await expect(
        asRole('authenticated', CASHIER_USER, () =>
          db.query('select public.record_cash_payment($1, $2, $3, $4)', [
            'trial-place', orderId, amount, key,
          ]),
        ),
      ).rejects.toThrow();
    }

    await expect(
      asRole('authenticated', KITCHEN_USER, () =>
        db.query('select public.record_cash_payment($1, $2, $3, $4)', [
          'trial-place', orderId, 1050, '60000000-0000-4000-8000-000000000004',
        ]),
      ),
    ).rejects.toThrow(/permission/i);

    await expect(
      asRole('authenticated', CASHIER_USER, () =>
        db.query('select public.record_cash_payment($1, $2, $3, $4)', [
          'other-place', OTHER_ORDER, 735, '60000000-0000-4000-8000-000000000005',
        ]),
      ),
    ).rejects.toThrow(/permission/i);

    const unpaid = await db.query<{ payment_status: string; payments: number }>(
      `select o.payment_status,
              (select count(*)::int from public.payments p where p.order_id = o.id) as payments
       from public.orders o where o.id = $1`,
      [orderId],
    );
    expect(unpaid.rows[0]).toEqual({ payment_status: 'pending', payments: 0 });
  });

  it('refuses cash collection for cancelled orders', async () => {
    const created = await asRole('authenticated', CASHIER_USER, () =>
      db.query<{ order_id: string }>(
        'select public.place_counter_order($1, $2::jsonb, $3) as order_id',
        ['trial-place', JSON.stringify([{ item_id: TRIAL_ITEM, qty: 1 }]), null],
      ),
    );
    const orderId = created.rows[0]?.order_id;
    await db.query("update public.orders set prep_status = 'cancelled' where id = $1", [orderId]);

    await expect(
      asRole('authenticated', CASHIER_USER, () =>
        db.query('select public.record_cash_payment($1, $2, $3, $4)', [
          'trial-place', orderId, 1050, '60000000-0000-4000-8000-000000000009',
        ]),
      ),
    ).rejects.toThrow(/cancelled orders/i);
  });

  it('prevents staff from directly changing payment status or writing payment rows', async () => {
    const created = await asRole('authenticated', CASHIER_USER, () =>
      db.query<{ order_id: string }>(
        'select public.place_counter_order($1, $2::jsonb, $3) as order_id',
        ['trial-place', JSON.stringify([{ item_id: TRIAL_ITEM, qty: 1 }]), null],
      ),
    );
    const orderId = created.rows[0]?.order_id;
    const payment = await asRole('authenticated', CASHIER_USER, () =>
      db.query<{ payment_id: string }>(
        'select public.record_cash_payment($1, $2, $3, $4) as payment_id',
        ['trial-place', orderId, 1050, '60000000-0000-4000-8000-000000000008'],
      ),
    );

    await expect(
      asRole('authenticated', CASHIER_USER, () =>
        db.query("update public.orders set payment_status = 'paid' where id = $1", [orderId]),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asRole('authenticated', CASHIER_USER, () =>
        db.query('update public.payments set amount_paise = 1 where id = $1', [payment.rows[0]?.payment_id]),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);

    await expect(
      asRole('authenticated', CASHIER_USER, () =>
        db.query(
          `insert into public.payments (order_id, restaurant_id, method, amount_paise, status)
           values ($1, $2, 'cash', 1050, 'recorded')`,
          [orderId, TRIAL_RESTAURANT],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it('blocks public order placement after expiry and preserves tenant isolation', async () => {
    await expect(
      asRole('anon', USER_ONE, () =>
        db.query(
          'select public.place_order($1, $2, $3::jsonb, $4)',
          ['expired-place', 'expired-token', JSON.stringify([{ item_id: EXPIRED_ITEM, qty: 1 }]), null],
        ),
      ),
    ).rejects.toThrow(/read-only/i);

    const hidden = await asRole('authenticated', USER_ONE, () =>
      db.query('select id from public.orders where id = $1', [OTHER_ORDER]),
    );
    expect(hidden.rows).toHaveLength(0);
  });

  it('restores server-authorized order placement during an active paid period', async () => {
    await db.query(
      `insert into public.restaurant_subscriptions
        (restaurant_id, plan_code, status, current_period_end)
       values ($1, 'starter', 'active', now() + interval '30 days')`,
      [EXPIRED_RESTAURANT],
    );

    const result = await asRole('anon', USER_ONE, () =>
      db.query<{ order_id: string }>(
        'select public.place_order($1, $2, $3::jsonb, $4) as order_id',
        ['expired-place', 'expired-token', JSON.stringify([{ item_id: EXPIRED_ITEM, qty: 1 }]), null],
      ),
    );
    expect(result.rows[0]?.order_id).toBeTruthy();
  });

  it('lists only current memberships and rejects a workspace after membership revocation', async () => {
    const before = await asRole('authenticated', USER_ONE, () =>
      db.query<{ slug: string }>(
        `select r.slug from public.memberships m
         join public.restaurants r on r.id = m.restaurant_id
         where m.user_id = auth.uid() order by r.slug`,
      ),
    );
    expect(before.rows.map((row) => row.slug)).toEqual(['expired-place', 'trial-place']);

    await db.query('delete from public.memberships where restaurant_id = $1 and user_id = $2', [TRIAL_RESTAURANT, USER_ONE]);

    const after = await asRole('authenticated', USER_ONE, () =>
      db.query<{ slug: string }>(
        `select r.slug from public.memberships m
         join public.restaurants r on r.id = m.restaurant_id
         where m.user_id = auth.uid() order by r.slug`,
      ),
    );
    expect(after.rows.map((row) => row.slug)).toEqual(['expired-place']);

    await expect(
      asRole('authenticated', USER_ONE, () =>
        db.query(
          'select public.place_counter_order($1, $2::jsonb, $3)',
          ['trial-place', JSON.stringify([{ item_id: TRIAL_ITEM, qty: 1 }]), null],
        ),
      ),
    ).rejects.toThrow(/permission/i);
  });
});
