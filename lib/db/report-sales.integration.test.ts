import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { GET as exportGet } from '../../app/(staff)/dashboard/reports/export/route';

const exportTestRuntime = vi.hoisted(() => ({
  db: null as {
    query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  } | null,
  userId: null as string | null,
  rpcCalls: [] as string[],
}));

// Replace only the Supabase HTTP boundary. The actual staff resolver reads its
// role and outlet from synthetic membership rows under authenticated-role RLS;
// RPCs execute the repository's real PostgreSQL functions in the disposable DB.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock('@/lib/supabase/env', () => ({ isSupabaseConfigured: true }));

vi.mock('@/lib/supabase/server', () => {
  function errorValue(error: unknown) {
    const value = error as { message?: unknown; code?: unknown };
    return {
      message: typeof value?.message === 'string' ? value.message : String(error),
      code: value?.code,
    };
  }

  async function withAuthenticated<T>(work: (db: NonNullable<typeof exportTestRuntime.db>) => Promise<T>): Promise<T> {
    const db = exportTestRuntime.db;
    if (!db) throw new Error('The disposable report-sales database is not connected');

    await db.query('begin');
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [exportTestRuntime.userId ?? '']);
      await db.query('set local role authenticated');
      const result = await work(db);
      await db.query('rollback');
      return result;
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
  }

  return {
    createSupabaseServerClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: exportTestRuntime.userId ? { id: exportTestRuntime.userId } : null },
          error: null,
        }),
      },
      from: (table: string) => {
        if (table !== 'memberships') throw new Error(`Unexpected test query for ${table}`);
        let userId: string | null = null;
        const builder = {
          select: (_columns: string) => builder,
          eq: (column: string, value: string) => {
            if (column !== 'user_id') throw new Error(`Unexpected membership filter: ${column}`);
            userId = value;
            return builder;
          },
          order: async (column: string, options?: { ascending?: boolean }) => {
            if (column !== 'restaurant_id' || options?.ascending !== true) {
              throw new Error('Unexpected membership ordering');
            }
            try {
              const result = await withAuthenticated((db) => db.query(
                `select m.restaurant_id::text as restaurant_id,
                        m.role::text as role,
                        jsonb_build_object(
                          'name', r.name, 'slug', r.slug,
                          'timezone', r.timezone, 'tagline', r.tagline
                        ) as restaurants
                   from public.memberships m
                   join public.restaurants r on r.id = m.restaurant_id
                  where m.user_id = $1::uuid
                  order by m.restaurant_id asc`,
                [userId],
              ));
              return { data: result.rows, error: null };
            } catch (error) {
              return { data: null, error: errorValue(error) };
            }
          },
        };
        return builder;
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        exportTestRuntime.rpcCalls.push(name);
        let sql: string;
        let values: unknown[];
        if (name === 'restaurant_access') {
          sql = 'select public.restaurant_access($1::uuid) as value';
          values = [args.p_restaurant_id];
        } else if (name === 'report_sales') {
          sql = `select public.report_sales(
                   $1::uuid, $2::timestamptz, $3::timestamptz, $4::text,
                   $5::text, $6::integer, $7::boolean
                 ) as value`;
          values = [
            args.p_restaurant_id,
            args.p_from,
            args.p_to,
            args.p_timezone,
            args.p_bucket,
            args.p_order_limit,
            args.p_include_lines,
          ];
        } else {
          return { data: null, error: { message: `Unexpected RPC ${name}` } };
        }

        try {
          const result = await withAuthenticated((db) => db.query(sql, values));
          return { data: result.rows[0]?.value ?? null, error: null };
        } catch (error) {
          return { data: null, error: errorValue(error) };
        }
      },
    }),
  };
});

const URL_VALUE = process.env.READINESS_DB_URL || '';
// A test URL is not permission to mutate an arbitrary database.
if (URL_VALUE) {
  const url = new URL(URL_VALUE);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)
  ) {
    throw new Error('Report-sales tests require a locally-created disposable autodine_check_* database');
  }
}

type Fixture = {
  restaurant: string;
  foreignRestaurant: string;
  account: string;
  foreignAccount: string;
  owner: string;
  manager: string;
  cashier: string;
  kitchen: string;
  foreignOwner: string;
  from: string;
  to: string;
};

type ReportResult = {
  totals: { bills: number; billed_paise: number };
  orders: Array<{ id: string; code: string }>;
};

let db: Client;

async function fixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const [owner, manager, cashier, kitchen, foreignOwner] = Array.from({ length: 5 }, () => randomUUID());
  await db.query('insert into public.profiles(id) values ($1),($2),($3),($4),($5)', [
    owner, manager, cashier, kitchen, foreignOwner,
  ]);

  const account = (await db.query(
    'insert into public.accounts(owner_id) values ($1) returning id', [owner],
  )).rows[0].id as string;
  const foreignAccount = (await db.query(
    'insert into public.accounts(owner_id) values ($1) returning id', [foreignOwner],
  )).rows[0].id as string;

  const restaurant = (await db.query(
    `insert into public.restaurants
       (slug,name,address,tax_rate_bps,timezone,guest_verification_mode,account_id)
     values ($1,'Synthetic F1 report outlet','Test-only address',0,'UTC','scan',$2) returning id`,
    [`f1-report-${suffix}`, account],
  )).rows[0].id as string;
  const foreignRestaurant = (await db.query(
    `insert into public.restaurants
       (slug,name,address,tax_rate_bps,timezone,guest_verification_mode,account_id)
     values ($1,'Synthetic unrelated outlet','Test-only address',0,'UTC','scan',$2) returning id`,
    [`f1-report-other-${suffix}`, foreignAccount],
  )).rows[0].id as string;

  await db.query(
    `insert into public.memberships(restaurant_id,user_id,role) values
       ($1,$2,'owner'), ($1,$3,'manager'), ($1,$4,'cashier'), ($1,$5,'kitchen'),
       ($6,$7,'owner')`,
    [restaurant, owner, manager, cashier, kitchen, foreignRestaurant, foreignOwner],
  );

  const { rows: clock } = await db.query('select statement_timestamp() as now');
  const rawNow = clock[0].now;
  const now = rawNow instanceof Date ? rawNow : new Date(String(rawNow));
  const from = new Date(now.getTime() - 60_000).toISOString();
  const to = new Date(now.getTime() + 60_000).toISOString();

  // A little more than the maximum returned list. All rows are synthetic, have
  // simple integer-paise values, and stay inside the same requested range.
  await db.query(
    `insert into public.orders
       (restaurant_id,code,subtotal_paise,discount_paise,tax_paise,total_paise,placed_at)
     select $1, 'F1-' || lpad(n::text,5,'0'), 100, 0, 0, 100,
            $2::timestamptz - n * interval '1 millisecond'
       from generate_series(1,10002) as series(n)`,
    [restaurant, to],
  );

  return {
    restaurant,
    foreignRestaurant,
    account,
    foreignAccount,
    owner,
    manager,
    cashier,
    kitchen,
    foreignOwner,
    from,
    to,
  };
}

async function asStaff<T>(user: string | null, work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? '']);
    await db.query('set local role authenticated');
    return await work();
  } finally {
    await db.query('rollback');
  }
}

function reportCall(restaurantId: string, from: string, to: string, orderLimit: number | null) {
  return db.query(
    `select public.report_sales($1::uuid,$2::timestamptz,$3::timestamptz,
                                'UTC','day',$4::integer,false) as report`,
    [restaurantId, from, to, orderLimit],
  );
}

function reportValue(result: { rows: Array<{ report: ReportResult }> }): ReportResult {
  return result.rows[0].report;
}

describe.skipIf(!URL_VALUE)('report_sales role and export-limit boundary (disposable PostgreSQL)', () => {
  let f: Fixture;

  beforeAll(async () => {
    db = new Client({ connectionString: URL_VALUE });
    await db.connect();
    exportTestRuntime.db = db as unknown as NonNullable<typeof exportTestRuntime.db>;
    f = await fixture();
  }, 30_000);

  beforeEach(async () => {
    exportTestRuntime.userId = null;
    exportTestRuntime.rpcCalls.length = 0;
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  });

  afterAll(async () => {
    if (db) await db.end();
    exportTestRuntime.db = null;
  });

  it('retains the existing authenticated-only RPC grant and SECURITY DEFINER boundary', async () => {
    const { rows } = await db.query(`
      select p.prosecdef as security_definer,
             p.provolatile as volatility,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
             p.proconfig as configuration
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public'
         and p.oid = 'public.report_sales(uuid,timestamptz,timestamptz,text,text,integer,boolean)'::regprocedure`);

    expect(rows).toHaveLength(1);
    expect(rows[0].security_definer).toBe(true);
    expect(rows[0].volatility).toBe('s');
    expect(rows[0].authenticated_execute).toBe(true);
    expect(rows[0].anon_execute).toBe(false);
    expect(rows[0].configuration).toContain('search_path=public');
  });

  it.each([
    ['unauthenticated', null],
    ['Cashier', 'cashier'],
    ['Kitchen', 'kitchen'],
  ] as const)('rejects a direct RPC call by an unauthenticated or %s caller', async (_label, identity) => {
    const user = identity === 'cashier' ? f.cashier : identity === 'kitchen' ? f.kitchen : null;

    await expect(
      asStaff(user, () => reportCall(f.restaurant, f.from, f.to, 10)),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('allows Owner and Manager direct RPC calls for their own outlet', async () => {
    for (const user of [f.owner, f.manager]) {
      const result = await asStaff(user, () => reportCall(f.restaurant, f.from, f.to, 3));
      const report = reportValue(result);
      expect(Number(report.totals.bills)).toBe(10_002);
      expect(report.orders).toHaveLength(3);
    }
  });

  it('rejects direct RPC calls across outlet and unrelated-account membership boundaries', async () => {
    expect(f.account).not.toBe(f.foreignAccount);
    await expect(
      asStaff(f.owner, () => reportCall(f.foreignRestaurant, f.from, f.to, 1)),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asStaff(f.foreignOwner, () => reportCall(f.restaurant, f.from, f.to, 1)),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('uses the null default of 200 while keeping range-wide totals complete', async () => {
    const result = await asStaff(f.owner, () => reportCall(f.restaurant, f.from, f.to, null));
    const report = reportValue(result);

    expect(report.orders).toHaveLength(200);
    expect(Number(report.totals.bills)).toBe(10_002);
    expect(Number(report.totals.billed_paise)).toBe(1_000_200);
  });

  it.each([0, -25])('returns no order details for a %i limit without changing totals', async (limit) => {
    const result = await asStaff(f.owner, () => reportCall(f.restaurant, f.from, f.to, limit));
    const report = reportValue(result);

    expect(report.orders).toEqual([]);
    expect(Number(report.totals.bills)).toBe(10_002);
    expect(Number(report.totals.billed_paise)).toBe(1_000_200);
  });

  it('caps an oversized direct RPC limit at 10000 before joining order details', async () => {
    const result = await asStaff(f.owner, () => reportCall(f.restaurant, f.from, f.to, 100_001));
    const report = reportValue(result);

    expect(report.orders).toHaveLength(10_000);
    expect(Number(report.totals.bills)).toBe(10_002);
    expect(Number(report.totals.billed_paise)).toBe(1_000_200);
  });

  it('fails closed for invalid or out-of-range integer limit inputs', async () => {
    const callWithRawLimit = (raw: string) => db.query(
      `select public.report_sales($1::uuid,$2::timestamptz,$3::timestamptz,
                                  'UTC','day',$4::integer,false)`,
      [f.restaurant, f.from, f.to, raw],
    );

    await expect(
      asStaff(f.owner, () => callWithRawLimit('not-an-integer')),
    ).rejects.toMatchObject({ code: '22P02' });
    await expect(
      asStaff(f.owner, () => callWithRawLimit('2147483648')),
    ).rejects.toMatchObject({ code: '22003' });
  });

  it('keeps the existing 400-day range rejection', async () => {
    const beyondRange = new Date(Date.parse(f.from) + 401 * 24 * 60 * 60 * 1000).toISOString();

    await expect(
      asStaff(f.owner, () => reportCall(f.restaurant, f.from, beyondRange, 1)),
    ).rejects.toMatchObject({ code: '22023' });
  });

  describe('actual report-export Route Handler with synthetic memberships', () => {
    async function requestAs(userId: string | null) {
      exportTestRuntime.userId = userId;
      exportTestRuntime.rpcCalls.length = 0;
      return exportGet(new Request(
        'http://localhost/dashboard/reports/export?type=orders&range=custom&from=2000-01-01&to=2000-01-01',
      ));
    }

    it('denies an unauthenticated direct export request', async () => {
      const response = await requestAs(null);

      expect(response.status).toBe(401);
      expect(exportTestRuntime.rpcCalls).toEqual([]);
    });

    it.each([
      ['Owner', 'owner'],
      ['Manager', 'manager'],
    ] as const)('allows a direct export request for the synthetic %s membership', async (_label, role) => {
      const response = await requestAs(role === 'owner' ? f.owner : f.manager);
      const body = Buffer.from(await response.arrayBuffer());

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
      expect(body.subarray(0, 3).toString('hex')).toBe('efbbbf');
      expect(body.subarray(3).toString()).toContain('Date,Time,Reference,Table,Kitchen,Payment');
      expect(exportTestRuntime.rpcCalls.filter((name) => name === 'report_sales')).toEqual(['report_sales']);
    });

    it.each([
      ['Cashier', 'cashier'],
      ['Kitchen', 'kitchen'],
    ] as const)('denies a direct export request for the synthetic %s membership before report_sales', async (_label, role) => {
      const user = role === 'cashier' ? f.cashier : f.kitchen;
      const response = await requestAs(user);

      expect(response.status).toBe(403);
      expect(exportTestRuntime.rpcCalls).toContain('restaurant_access');
      expect(exportTestRuntime.rpcCalls).not.toContain('report_sales');
    });
  });
});
