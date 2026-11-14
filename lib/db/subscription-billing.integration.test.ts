/**
 * The subscription and billing boundary, against a real PostgreSQL.
 *
 * Runs only against the disposable database created by
 * scripts/verify-database.mjs. Every check acts as the role PostgREST would
 * use — `anon` for a guest, `authenticated` with a JWT subject for an owner or
 * a stranger — inside a transaction that is rolled back, except where the test
 * says otherwise.
 *
 * WHAT IS BEING PROVED
 *
 * The commercial rules, in the only place they can be enforced: the database.
 * A trial is issued once per person and lasts 21 days. A plan costs what the
 * catalog says it costs. Outlet limits are 1, 5 and unlimited, and a downgrade
 * deletes nothing. A payment is recorded once, at the approved amount, and its
 * receipt cannot be rewritten. An expired account is read-only and intact.
 *
 * No provider exists in this deployment, so nothing here creates a checkout or
 * charges anybody: the recording functions are called directly, which is what a
 * verified webhook would do.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';

const URL_VALUE = process.env.READINESS_DB_URL || '';
// A test URL is not permission to mutate an arbitrary database.
if (URL_VALUE) {
  const url = new URL(URL_VALUE);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)) {
    throw new Error('Subscription tests require a locally-created disposable autodine_check_* database');
  }
}

let db: Client;

/** Runs `work` as a PostgREST role, then rolls back. */
async function asRole<T>(role: 'anon' | 'authenticated', user: string | null, work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? '']);
    await db.query(`set local role ${role}`);
    return await work();
  } finally { await db.query('rollback'); }
}
const guest = <T>(work: () => Promise<T>) => asRole('anon', null, work);
const staff = <T>(user: string, work: () => Promise<T>) => asRole('authenticated', user, work);

/** The same switch, but COMMITTED: for rows the next query must see. */
async function committed<T>(user: string, work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await db.query('set local role authenticated');
    const result = await work();
    await db.query('commit');
    return result;
  } catch (error) { await db.query('rollback'); throw error; }
  finally { await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}

type Account = {
  owner: string;
  account: string;
  restaurant: string;
  name: string;
  slug: string;
};

/** One owner with one account and one restaurant, on the 21-day trial. */
async function newAccount(name = 'Billing ' + randomUUID()): Promise<Account> {
  const owner = randomUUID();
  const slug = 'billing-' + randomUUID();
  await db.query('insert into profiles(id) values($1)', [owner]);
  const restaurant = (await db.query('select create_account_with_restaurant($1,$2,$3,$4) id',
    [name, slug, 'Asia/Kolkata', owner])).rows[0].id as string;
  const account = (await db.query('select account_id from restaurants where id=$1', [restaurant])).rows[0].account_id as string;
  return { owner, account, restaurant, name, slug };
}

/** Put an account on a paid plan for a number of months, by recording a payment. */
async function payFor(restaurantName: string, plan: string, eventId = randomUUID(), months = 1) {
  const price = Number((await db.query('select plan_price_paise($1) p', [plan])).rows[0].p);
  const result = await db.query(
    `select record_subscription_payment($1,'test-provider',$2,$3,$4,'INR',$5,now()) result`,
    [restaurantName, eventId, plan, price * months, months],
  );
  return result.rows[0].result as Record<string, unknown>;
}

describe.skipIf(!URL_VALUE)('Model C subscription and billing', () => {
  beforeAll(async () => { db = new Client({ connectionString: URL_VALUE }); await db.connect(); }, 30000);
  beforeEach(async () => { await db.query("select set_config('request.jwt.claim.sub','',false)"); });
  afterAll(async () => { if (db) await db.end(); });

  // ─────────────────────────────────────────────────────────────────────────
  describe('the plan catalog', () => {
    it('prices the three plans at 999, 2699 and 3699 rupees a month', async () => {
      const prices = (await db.query(
        "select plan_price_paise('starter') starter, plan_price_paise('professional') professional, plan_price_paise('business') business",
      )).rows[0];
      expect(Number(prices.starter)).toBe(99900);
      expect(Number(prices.professional)).toBe(269900);
      expect(Number(prices.business)).toBe(369900);
    });

    it('refuses to price a plan that is not for sale', async () => {
      for (const plan of ['trial', 'enterprise', '', null]) {
        expect((await db.query('select plan_price_paise($1) p', [plan])).rows[0].p).toBeNull();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('trial activation', () => {
    it('starts a 21-day trial and records it as a grant', async () => {
      const a = await newAccount();
      const trial = (await db.query(
        'select plan, plan_status, trial_started_at, trial_ends_at from accounts where id=$1', [a.account])).rows[0];
      expect(trial.plan).toBe('trial');
      expect(trial.plan_status).toBe('trialing');

      const days = Number((await db.query(
        'select extract(epoch from (trial_ends_at - trial_started_at))/86400 days from accounts where id=$1', [a.account])).rows[0].days);
      expect(days).toBeGreaterThan(20.9);
      expect(days).toBeLessThan(21.1);

      const grant = (await db.query('select owner_id, account_id from trial_grants where owner_id=$1', [a.owner])).rows;
      expect(grant).toHaveLength(1);
      expect(grant[0].account_id).toBe(a.account);

      const history = (await db.query(
        "select kind from subscription_events where account_id=$1 and kind='trial_granted'", [a.account])).rows;
      expect(history).toHaveLength(1);
    });

    it('refuses a second trial to the same person, and says why', async () => {
      const first = await newAccount();

      // One account per person is structural: a unique key, not a policy.
      const unique = (await db.query(
        "select indexdef from pg_indexes where schemaname='public' and indexname='accounts_owner_key'")).rows;
      expect(unique).toHaveLength(1);

      // The reachable recreation path is therefore a person who already holds
      // a trial grant — the row the backfill writes for everybody who had one
      // before this rule existed.
      const owner = randomUUID();
      await db.query('insert into profiles(id) values($1)', [owner]);
      await db.query(
        "insert into trial_grants(owner_id, account_id, source) values($1,$2,'backfill')", [owner, first.account]);

      const second = (await db.query('select create_account_with_restaurant($1,$2,$3,$4) id',
        ['Second ' + randomUUID(), 'second-' + randomUUID(), 'Asia/Kolkata', owner])).rows[0].id as string;
      const secondAccount = (await db.query('select account_id from restaurants where id=$1', [second])).rows[0].account_id as string;

      // The account exists, and every row with it — it simply has no trial.
      expect(secondAccount).toBeTruthy();
      expect((await db.query('select plan_status, trial_ends_at from accounts where id=$1', [secondAccount])).rows[0].plan_status).toBe('expired');
      expect((await db.query('select count(*)::int n from trial_grants where owner_id=$1', [owner])).rows[0].n).toBe(1);
      expect((await db.query("select note from subscription_events where account_id=$1 and kind='trial_denied'", [secondAccount])).rows).toHaveLength(1);

      // Read-only, because there is no trial and no plan — and nothing deleted.
      expect((await db.query('select account_can_write($1) can', [secondAccount])).rows[0].can).toBe(false);
      expect((await db.query('select count(*)::int n from restaurants where account_id=$1', [secondAccount])).rows[0].n).toBe(1);
    });

    it('does not shorten a trial that is already running, and never revives one that ended', async () => {
      const running = await newAccount();
      await db.query("update accounts set trial_started_at = now() - interval '3 days' where id=$1", [running.account]);
      const ended = await newAccount();
      await db.query("update accounts set trial_started_at = now() - interval '30 days', trial_ends_at = now() - interval '9 days' where id=$1", [ended.account]);

      await db.query(
        "update accounts a set trial_ends_at = a.trial_started_at + interval '21 days' where id = any($1::uuid[])",
        [[running.account, ended.account]],
      );

      const after = (await db.query(
        'select id, account_trial_ends_at(id) ends, account_can_write(id) can from accounts where id = any($1::uuid[])',
        [[running.account, ended.account]])).rows;
      const byId = new Map(after.map((row) => [row.id as string, row]));

      // Three days in: eighteen days left, from the ORIGINAL activation date.
      const left = Number((await db.query(
        'select extract(epoch from ($1::timestamptz - now()))/86400 days', [byId.get(running.account)?.ends])).rows[0].days);
      expect(left).toBeGreaterThan(17.5);
      expect(left).toBeLessThanOrEqual(18.5);
      expect(byId.get(running.account)?.can).toBe(true);

      // Already expired: still expired. Nothing here grants a fresh 21 days.
      expect(byId.get(ended.account)?.can).toBe(false);
    });

    /**
     * The migration as it met the existing customers.
     *
     * The 21-day rule changes a date for people who were already using the
     * product on the 7-day rule, which is the only change here that touches
     * somebody else's data. So the backfill statement is not paraphrased in a
     * test: it is read out of the migration and run again, over rows arranged
     * to look like the old world. If the statement changes, this follows it.
     */
    describe('the trial migration, run again over the old world', () => {
      const MIGRATION = readFileSync(
        new URL('../../supabase/migrations/20261110001000_account_subscriptions.sql', import.meta.url),
        'utf8',
      );

      /** The one statement that decides an existing trial's end date. */
      function backfillStatement(): string {
        const start = MIGRATION.indexOf('update public.accounts a\n   set trial_started_at = s.activation,');
        const end = MIGRATION.indexOf('-- 4. Entitlement helpers.');
        if (start < 0 || end < 0 || end < start) throw new Error('could not find the trial backfill in the migration');
        return MIGRATION.slice(start, end);
      }

      /** An account whose restaurant carries the OLD 7-day trial rule. */
      async function oldWorldAccount(activatedDaysAgo: number) {
        const a = await newAccount();
        const activation = new Date(Date.now() - activatedDaysAgo * 86400000).toISOString();
        await db.query(
          "update restaurants set trial_started_at = $2::timestamptz, plan = 'trial', plan_status = 'trialing', plan_expires_at = null where id = $1",
          [a.restaurant, activation],
        );
        // What the account row looked like before this work existed.
        await db.query(
          "update accounts set trial_started_at = $2::timestamptz, trial_ends_at = $2::timestamptz + interval '7 days', plan = 'trial', plan_status = 'trialing' where id = $1",
          [a.account, activation],
        );
        return { ...a, activation };
      }

      it('extends a trial that was still running, from the date it was activated', async () => {
        const a = await oldWorldAccount(3);
        const before = (await db.query('select trial_started_at from accounts where id=$1', [a.account])).rows[0];

        await db.query(backfillStatement());

        const after = (await db.query(
          'select trial_started_at, trial_ends_at, plan_status, account_trial_ends_at(id) ends from accounts where id=$1',
          [a.account])).rows[0];

        // The activation date is the one thing this was never allowed to move.
        expect(new Date(after.trial_started_at).getTime()).toBe(new Date(before.trial_started_at).getTime());

        // Twenty-one days from THAT date, not from the day the migration ran:
        // three days in, so eighteen left.
        const left = Number((await db.query(
          'select extract(epoch from ($1::timestamptz - now()))/86400 days', [after.ends])).rows[0].days);
        expect(left).toBeGreaterThan(17.5);
        expect(left).toBeLessThanOrEqual(18.5);
        expect(after.plan_status).toBe('trialing');
      });

      it('leaves a trial that had already ended ended, and grants nothing', async () => {
        const a = await oldWorldAccount(40);

        await db.query(backfillStatement());

        const after = (await db.query(
          'select trial_ends_at, plan_status, account_can_write(id) can from accounts where id=$1',
          [a.account])).rows[0];

        // Still seven days from activation: a date in the past, untouched.
        const expected = new Date(Date.parse(a.activation) + 7 * 86400000).getTime();
        expect(new Date(after.trial_ends_at).getTime()).toBe(expected);
        expect(after.plan_status).toBe('expired');
        expect(after.can).toBe(false);

        // And no trial grant was manufactured for it by the backfill.
        expect((await db.query(
          'select count(*)::int n from subscription_events where account_id=$1 and kind=$2',
          [a.account, 'trial_granted'])).rows[0].n).toBe(1);
      });

      it('says in its own words that an expired trial stays expired', () => {
        expect(backfillStatement()).toMatch(/already expired/);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('outlet limits', () => {
    it('allows exactly 1 outlet on Starter and refuses the second', async () => {
      const a = await newAccount();
      await payFor(a.name, 'starter');

      // The account's first restaurant is its first outlet: Starter is one.
      expect((await db.query('select account_outlet_count($1) n', [a.account])).rows[0].n).toBe(1);

      await expect(staff(a.owner, () => db.query('select create_outlet($1,$2)',
        ['Second room', 'starter-second-' + randomUUID()])))
        .rejects.toMatchObject({ message: expect.stringContaining('outlet_limit') });

      // The outlet it has is still here. A limit is not a deletion.
      expect((await db.query('select count(*)::int n from restaurants where account_id=$1', [a.account])).rows[0].n).toBe(1);
    });

    it('allows 5 outlets on Professional and refuses the sixth', async () => {
      const a = await newAccount();
      await payFor(a.name, 'professional');

      for (let i = 2; i <= 5; i += 1) {
        await committed(a.owner, () => db.query('select create_outlet($1,$2) id',
          [`Room ${i}`, `pro-${i}-${randomUUID()}`]));
      }
      expect((await db.query('select count(*)::int n from restaurants where account_id=$1', [a.account])).rows[0].n).toBe(5);

      await expect(staff(a.owner, () => db.query('select create_outlet($1,$2)',
        ['Room 6', 'pro-6-' + randomUUID()]))).rejects.toMatchObject({ message: expect.stringContaining('outlet_limit') });
    });

    it('allows outlets past 5 on Business', async () => {
      const a = await newAccount();
      await payFor(a.name, 'business');

      for (let i = 2; i <= 7; i += 1) {
        await committed(a.owner, () => db.query('select create_outlet($1,$2) id',
          [`Site ${i}`, `biz-${i}-${randomUUID()}`]));
      }
      // Past the Professional ceiling, because Business has none.
      expect((await db.query('select account_outlet_count($1) n', [a.account])).rows[0].n).toBe(7);
    });

    it('keeps every outlet on a downgrade, blocks new ones, and restores capacity on upgrade', async () => {
      const a = await newAccount();
      await payFor(a.name, 'business');
      for (let i = 2; i <= 4; i += 1) {
        await committed(a.owner, () => db.query('select create_outlet($1,$2) id', [`Wing ${i}`, `down-${i}-${randomUUID()}`]));
      }
      const before = (await db.query('select count(*)::int n from restaurants where account_id=$1', [a.account])).rows[0].n;
      expect(before).toBe(4);

      // Downgrade to Starter: 1 outlet is included, 4 already exist.
      await db.query("update accounts set plan='starter', plan_status='active', plan_expires_at=now()+interval '30 days' where id=$1", [a.account]);

      expect((await db.query('select count(*)::int n from restaurants where account_id=$1', [a.account])).rows[0].n).toBe(4);
      expect((await db.query('select account_can_write($1) can', [a.account])).rows[0].can).toBe(true);
      await expect(staff(a.owner, () => db.query('select create_outlet($1,$2)',
        ['One more', 'down-more-' + randomUUID()]))).rejects.toMatchObject({ message: expect.stringContaining('outlet_limit') });

      // The reason the owner is shown names both numbers. Read as the owner:
      // the function answers nobody else.
      const state = await staff(a.owner, async () => (await db.query('select account_subscription_state($1) s', [a.restaurant])).rows[0].s);
      expect(state.outlets.used).toBe(4);
      expect(state.outlets.limit).toBe(1);
      expect(state.outlets.remaining).toBe(0);

      // Upgrade: capacity comes back, and nothing had to be recreated.
      await db.query("update accounts set plan='professional' where id=$1", [a.account]);
      const created = await committed(a.owner, () => db.query('select create_outlet($1,$2) id',
        ['Wing 5', 'down-5-' + randomUUID()]));
      expect(created.rows[0].id).toBeTruthy();
      expect((await db.query('select count(*)::int n from restaurants where account_id=$1', [a.account])).rows[0].n).toBe(5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('one subscription, shared by every outlet', () => {
    it('makes every outlet read-only when the account expires, and loses nothing', async () => {
      const a = await newAccount();
      await payFor(a.name, 'professional');
      const second = (await committed(a.owner, () => db.query('select create_outlet($1,$2) id',
        ['Second room', 'shared-' + randomUUID()]))).rows[0].id as string;

      await db.query("update accounts set plan_expires_at = now() - interval '1 day' where id=$1", [a.account]);
      const expired = Number((await db.query('select expire_subscriptions() n')).rows[0].n);
      expect(expired).toBeGreaterThanOrEqual(1);

      expect((await db.query('select account_can_write($1) can', [a.account])).rows[0].can).toBe(false);
      for (const restaurant of [a.restaurant, second]) {
        expect((await db.query('select restaurant_can_write($1) can', [restaurant])).rows[0].can).toBe(false);
      }

      // Every outlet, every menu: preserved.
      expect((await db.query('select count(*)::int n from restaurants where account_id=$1', [a.account])).rows[0].n).toBe(2);
      expect((await db.query('select count(*)::int n from menus where restaurant_id = any($1::uuid[])', [[a.restaurant, second]])).rows[0].n).toBe(2);
      expect((await db.query("select count(*)::int n from subscription_events where account_id=$1 and kind='expired'", [a.account])).rows[0].n).toBe(1);
    });

    it('reads the same entitlement from either outlet', async () => {
      const a = await newAccount();
      // Professional: the plan has to allow a second outlet for there to be
      // two to compare.
      await payFor(a.name, 'professional');
      const second = (await committed(a.owner, () => db.query('select create_outlet($1,$2) id',
        ['Annex', 'entitle-' + randomUUID()]))).rows[0].id as string;

      const first = await staff(a.owner, async () => (await db.query('select account_subscription_state($1) s', [a.restaurant])).rows[0].s);
      const other = await staff(a.owner, async () => (await db.query('select account_subscription_state($1) s', [second])).rows[0].s);
      expect(other.accountId).toBe(first.accountId);
      expect(other.plan).toBe('professional');
      expect(other.outlets.used).toBe(2);
      expect(other.outlets.limit).toBe(5);
      expect(other.outlets.remaining).toBe(3);
      // One subscription, so one answer, whichever door you come in by.
      expect(other.canWrite).toBe(first.canWrite);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('tenant isolation', () => {
    it('shows one account its own payments and no other account theirs', async () => {
      const a = await newAccount();
      const b = await newAccount();
      await payFor(a.name, 'starter');
      await payFor(b.name, 'business');

      // Each owner sees exactly their own payment, through the membership check.
      const rowsA = await staff(a.owner, async () => (await db.query('select account_payment_history($1) rows', [a.restaurant])).rows[0].rows as unknown[]);
      const rowsB = await staff(b.owner, async () => (await db.query('select account_payment_history($1) rows', [b.restaurant])).rows[0].rows as unknown[]);
      expect(rowsA).toHaveLength(1);
      expect(rowsB).toHaveLength(1);

      // And nobody sees anybody else's by naming their restaurant.
      const crossed = await staff(a.owner, async () => (await db.query('select account_payment_history($1) rows', [b.restaurant])).rows[0].rows);
      expect(crossed).toBeNull();

      // Strangers and guests get nothing at all.
      expect(await staff(b.owner, async () => (await db.query('select account_payment_history($1) rows', [a.restaurant])).rows[0].rows)).toBeNull();
      await expect(guest(() => db.query('select account_payment_history($1)', [a.restaurant]))).rejects.toThrow();

      // And the tables themselves hold no rows for a caller from outside.
      expect(await staff(a.owner, async () => (await db.query('select id from subscription_payments where account_id=$1', [b.account])).rows)).toEqual([]);
      expect(await staff(a.owner, async () => (await db.query('select id from subscription_events where account_id=$1', [b.account])).rows)).toEqual([]);
    });

    it('bounds account history before aggregation while preserving member-read and owner-write scope', async () => {
      const a = await newAccount();
      await payFor(a.name, 'professional');

      const cashier = randomUUID();
      await db.query('insert into profiles(id) values($1)', [cashier]);
      await db.query(
        "insert into memberships(restaurant_id,user_id,role) values($1,$2,'cashier')",
        [a.restaurant, cashier],
      );
      const receiptId = (await db.query(
        'select id from subscription_receipts where account_id=$1', [a.account])).rows[0].id as string;

      // Synthetic rows are newer than the trial/payment setup rows, with a
      // unique timestamp per row so the expected newest-first window is stable.
      const prefix = `history-${randomUUID()}`;
      await db.query(
        `insert into public.subscription_events(account_id,kind,note,occurred_at)
         select $1,'trial_extended',$2 || '-event-' || n::text,
                clock_timestamp() + (60 - n) * interval '1 second'
           from generate_series(1,60) as series(n)`,
        [a.account, prefix],
      );
      await db.query(
        `insert into public.subscription_payments
           (account_id,plan,amount_paise,currency,status,provider,provider_event_id,occurred_at)
         select $1,'starter',99900,'INR','succeeded','history-test',
                $2 || '-payment-' || lpad(n::text,2,'0'),
                clock_timestamp() + (60 - n) * interval '1 second'
           from generate_series(1,60) as series(n)`,
        [a.account, prefix],
      );

      const expectedNotes = (await db.query(
        `select note from public.subscription_events
          where account_id=$1 and note like $2 || '-event-%'
          order by occurred_at desc,id desc limit 50`,
        [a.account, prefix],
      )).rows.map((row) => row.note);
      const expectedPaymentIds = (await db.query(
        `select id::text as id from public.subscription_payments
          where account_id=$1 and provider='history-test'
            and provider_event_id like $2 || '-payment-%'
          order by occurred_at desc,recorded_at desc,id desc limit 50`,
        [a.account, prefix],
      )).rows.map((row) => row.id);

      const memberReads = await staff(cashier, async () => {
        const state = (await db.query(
          'select account_subscription_state($1) value', [a.restaurant])).rows[0].value;
        const history = (await db.query(
          'select account_subscription_history($1,50) value', [a.restaurant])).rows[0].value as Array<{ note: string }>;
        const payments = (await db.query(
          'select account_payment_history($1,50) value', [a.restaurant])).rows[0].value as Array<{ id: string }>;
        const receipt = (await db.query(
          'select account_receipt($1) value', [receiptId])).rows[0].value;
        return { state, history, payments, receipt };
      });

      expect(memberReads.state.accountId).toBe(a.account);
      expect(memberReads.history).toHaveLength(50);
      expect(memberReads.history.map((row) => row.note)).toEqual(expectedNotes);
      expect(memberReads.payments).toHaveLength(50);
      expect(memberReads.payments.map((row) => row.id)).toEqual(expectedPaymentIds);
      expect(memberReads.receipt).toBeTruthy();
      expect(Number(memberReads.receipt.amountPaise)).toBe(269900);

      // Read access is membership-scoped, but the matching write remains owner-only.
      await expect(staff(cashier, () => db.query(
        'select request_subscription_cancellation($1)', [a.restaurant],
      ))).rejects.toMatchObject({ message: expect.stringContaining('not_found') });
    });

    it('will not show a receipt to another account', async () => {
      const a = await newAccount();
      await payFor(a.name, 'professional');
      const receiptId = (await db.query(
        'select id from subscription_receipts where account_id=$1', [a.account])).rows[0].id as string;

      const mine = await staff(a.owner, async () => (await db.query('select account_receipt($1) r', [receiptId])).rows[0].r);
      expect(mine).toBeTruthy();
      expect(Number(mine.amountPaise)).toBe(269900);

      const stranger = randomUUID();
      await db.query('insert into profiles(id) values($1)', [stranger]);
      expect(await staff(stranger, async () => (await db.query('select account_receipt($1) r', [receiptId])).rows[0].r)).toBeNull();
      await expect(guest(() => db.query('select account_receipt($1)', [receiptId]))).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('payments', () => {
    it('records a payment once, with a receipt, and extends the period', async () => {
      const a = await newAccount();
      const first = await payFor(a.name, 'professional');
      expect(first.status).toBe('recorded');
      expect(Number(first.period_end) > 0 || typeof first.period_end === 'string').toBe(true);

      const account = (await db.query('select plan, plan_status, plan_expires_at from accounts where id=$1', [a.account])).rows[0];
      expect(account.plan).toBe('professional');
      expect(account.plan_status).toBe('active');
      expect(new Date(account.plan_expires_at).getTime()).toBeGreaterThan(Date.now());

      const payments = (await db.query('select id, status, amount_paise from subscription_payments where account_id=$1', [a.account])).rows;
      expect(payments).toHaveLength(1);
      expect(Number(payments[0].amount_paise)).toBe(269900);

      const receipts = (await db.query('select receipt_number, amount_paise from subscription_receipts where account_id=$1', [a.account])).rows;
      expect(receipts).toHaveLength(1);
      expect(receipts[0].receipt_number).toMatch(/^AD-SUB-\d{4}-\d{6}$/);
    });

    it('records the same provider event only once', async () => {
      const a = await newAccount();
      const eventId = randomUUID();
      await payFor(a.name, 'starter', eventId);
      const replay = await payFor(a.name, 'starter', eventId);

      expect(replay.status).toBe('duplicate');
      expect((await db.query('select count(*)::int n from subscription_payments where account_id=$1', [a.account])).rows[0].n).toBe(1);
      expect((await db.query('select count(*)::int n from subscription_receipts where account_id=$1', [a.account])).rows[0].n).toBe(1);
    });

    it('refuses an amount that is not the price of the plan', async () => {
      const a = await newAccount();
      // A perfectly signed request for one rupee.
      await expect(db.query(
        `select record_subscription_payment($1,'test-provider',$2,'business',$3,'INR',1,now())`,
        [a.name, randomUUID(), 100])).rejects.toMatchObject({ message: expect.stringContaining('amount_mismatch') });

      // And one for the right amount of the wrong plan.
      await expect(db.query(
        `select record_subscription_payment($1,'test-provider',$2,'business',$3,'INR',1,now())`,
        [a.name, randomUUID(), 99900])).rejects.toMatchObject({ message: expect.stringContaining('amount_mismatch') });

      expect((await db.query('select count(*)::int n from subscription_payments where account_id=$1', [a.account])).rows[0].n).toBe(0);
      expect((await db.query('select plan_status from accounts where id=$1', [a.account])).rows[0].plan_status).toBe('trialing');
    });

    it('refuses a currency that is not INR, and a plan that is not for sale', async () => {
      const a = await newAccount();
      await expect(db.query(
        `select record_subscription_payment($1,'test-provider',$2,'starter',99900,'USD',1,now())`,
        [a.name, randomUUID()])).rejects.toMatchObject({ message: expect.stringContaining('currency_mismatch') });
      await expect(db.query(
        `select record_subscription_payment($1,'test-provider',$2,'trial',0,'INR',1,now())`,
        [a.name, randomUUID()])).rejects.toMatchObject({ message: expect.stringContaining('plan_invalid') });
      await expect(db.query(
        `select record_subscription_payment($1,'test-provider','',$2,99900,'INR',1,now())`,
        [a.name, 'starter'])).rejects.toMatchObject({ message: expect.stringContaining('provider_event_required') });
    });

    it('keeps the account working after a failed payment, until the period ends', async () => {
      const a = await newAccount();
      await payFor(a.name, 'starter');

      const failed = await db.query(
        `select record_subscription_payment_failure($1,'test-provider',$2,'starter',99900,'Card declined',now()) result`,
        [a.name, randomUUID()]);
      expect((failed.rows[0].result as Record<string, unknown>).status).toBe('recorded');

      const account = (await db.query('select plan_status from accounts where id=$1', [a.account])).rows[0];
      expect(account.plan_status).toBe('past_due');
      // Still inside the period it paid for: nothing is taken away by a charge
      // that failed.
      expect((await db.query('select account_can_write($1) can', [a.account])).rows[0].can).toBe(true);

      const state = await staff(a.owner, async () => (await db.query('select account_subscription_state($1) s', [a.restaurant])).rows[0].s);
      expect(state.pastDue).toBe(true);
      expect(state.readOnly).toBe(false);

      // And the failure is on the record, with its reason.
      const failedRows = (await db.query(
        "select failure_reason from subscription_payments where account_id=$1 and status='failed'", [a.account])).rows;
      expect(failedRows).toHaveLength(1);
      expect(failedRows[0].failure_reason).toBe('Card declined');
    });

    it('records a refund as its own event and never edits the original payment', async () => {
      const a = await newAccount();
      const eventId = randomUUID();
      await payFor(a.name, 'business', eventId);
      const original = (await db.query('select id, amount_paise, status from subscription_payments where account_id=$1', [a.account])).rows[0];

      // The refund quotes the provider's reference for the original payment.
      const refund = (await db.query(
        `select record_subscription_refund($1,'test-provider',$2,$3,now()) result`,
        [a.name, randomUUID(), eventId])).rows[0].result as Record<string, unknown>;
      expect(refund.status).toBe('recorded');

      const rows = (await db.query('select status, amount_paise from subscription_payments where account_id=$1 order by recorded_at', [a.account])).rows;
      expect(rows).toHaveLength(2);
      expect(rows[0].status).toBe('succeeded');
      expect(rows[1].status).toBe('refunded');
      // The original row is untouched, exactly as it was issued.
      expect(Number(rows[0].amount_paise)).toBe(Number(original.amount_paise));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('billing history is immutable', () => {
    it('refuses to update or delete a payment, a receipt or a webhook record', async () => {
      const a = await newAccount();
      await payFor(a.name, 'starter');
      const paymentId = (await db.query('select id from subscription_payments where account_id=$1', [a.account])).rows[0].id as string;
      const receiptId = (await db.query('select id from subscription_receipts where account_id=$1', [a.account])).rows[0].id as string;

      await expect(db.query('update subscription_payments set amount_paise=1 where id=$1', [paymentId]))
        .rejects.toMatchObject({ code: '42501' });
      await expect(db.query('delete from subscription_payments where id=$1', [paymentId]))
        .rejects.toMatchObject({ code: '42501' });
      await expect(db.query('update subscription_receipts set amount_paise=1 where id=$1', [receiptId]))
        .rejects.toMatchObject({ code: '42501' });
      await expect(db.query('delete from subscription_receipts where id=$1', [receiptId]))
        .rejects.toMatchObject({ code: '42501' });
    });

    it('lets no authenticated caller write a payment row at all', async () => {
      const a = await newAccount();
      await expect(staff(a.owner, () => db.query(
        'insert into subscription_payments(account_id,plan,amount_paise,currency,status,provider) values($1,$2,$3,$4,$5,$6)',
        [a.account, 'business', 1, 'INR', 'succeeded', 'self-service']))).rejects.toThrow();
      await expect(guest(() => db.query('select count(*) from subscription_payments'))).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('cancellation', () => {
    it('is requested by the owner, runs to the end of the period, and can be withdrawn', async () => {
      const a = await newAccount();
      await payFor(a.name, 'professional');

      const requested = await committed(a.owner, async () => (await db.query('select request_subscription_cancellation($1) r', [a.restaurant])).rows[0].r);
      expect(requested.account_id).toBe(a.account);

      const after = (await db.query('select plan_status, cancel_requested_at, cancel_effective_at, plan_expires_at from accounts where id=$1', [a.account])).rows[0];
      expect(after.plan_status).toBe('cancel_requested');
      expect(new Date(after.cancel_effective_at).getTime()).toBe(new Date(after.plan_expires_at).getTime());
      // The cancellation is not a lockout: the period it was paid for still runs.
      expect(new Date(after.cancel_effective_at).getTime()).toBeGreaterThan(Date.now());
      expect((await db.query('select account_can_write($1) can', [a.account])).rows[0].can).toBe(true);

      const withdrawn = await committed(a.owner, async () => (await db.query('select withdraw_subscription_cancellation($1) ok', [a.restaurant])).rows[0].ok);
      expect(withdrawn).toBe(true);
      const restored = (await db.query('select plan_status, cancel_requested_at from accounts where id=$1', [a.account])).rows[0];
      expect(restored.plan_status).toBe('active');
      expect(restored.cancel_requested_at).toBeNull();
    });

    it('cannot be requested by somebody who is not an owner of the account', async () => {
      const a = await newAccount();
      const stranger = randomUUID();
      await db.query('insert into profiles(id) values($1)', [stranger]);
      await expect(staff(stranger, () => db.query('select request_subscription_cancellation($1)', [a.restaurant])))
        .rejects.toMatchObject({ message: expect.stringContaining('not_found') });
      await expect(guest(() => db.query('select request_subscription_cancellation($1)', [a.restaurant]))).rejects.toThrow();
    });

    it('is confirmed only after a request, and ends access on the effective date', async () => {
      const a = await newAccount();
      await payFor(a.name, 'starter');

      // No request, no confirmation.
      await expect(db.query('select confirm_subscription_cancellation($1,$2,$3)', [a.name, 'test-provider', randomUUID()]))
        .rejects.toMatchObject({ message: expect.stringContaining('cancellation_not_requested') });

      await committed(a.owner, async () => db.query('select request_subscription_cancellation($1)', [a.restaurant]));
      const confirmed = (await db.query('select confirm_subscription_cancellation($1,$2,$3) r', [a.name, 'test-provider', randomUUID()])).rows[0].r;
      expect(confirmed.account_id).toBe(a.account);

      const now = (await db.query('select plan_status, plan_expires_at from accounts where id=$1', [a.account])).rows[0];
      expect(now.plan_status).toBe('cancelled');
      // Still inside the paid period: cancellation stops the NEXT renewal.
      expect((await db.query('select account_can_write($1) can', [a.account])).rows[0].can).toBe(true);
      expect((await db.query('select count(*)::int n from restaurants where account_id=$1', [a.account])).rows[0].n).toBe(1);

      // Past the effective date it is read-only, and still intact.
      await db.query('update accounts set plan_expires_at = now() - interval \'1 hour\' where id=$1', [a.account]);
      await db.query('select expire_subscriptions()');
      expect((await db.query('select account_can_write($1) can', [a.account])).rows[0].can).toBe(false);
      expect((await db.query('select count(*)::int n from restaurants where account_id=$1', [a.account])).rows[0].n).toBe(1);
    });

    it('is cancelled by a payment: paying for the next period withdraws the request', async () => {
      const a = await newAccount();
      await payFor(a.name, 'starter');
      await committed(a.owner, async () => db.query('select request_subscription_cancellation($1)', [a.restaurant]));

      await payFor(a.name, 'starter', randomUUID());
      const after = (await db.query('select plan_status, cancel_requested_at from accounts where id=$1', [a.account])).rows[0];
      expect(after.plan_status).toBe('active');
      expect(after.cancel_requested_at).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('expiry', () => {
    it('leaves a trial that has ended expired, and never re-grants it', async () => {
      const a = await newAccount();
      await db.query("update accounts set trial_started_at = now() - interval '25 days', trial_ends_at = now() - interval '4 days' where id=$1", [a.account]);
      await db.query('select expire_subscriptions()');

      expect((await db.query('select plan_status from accounts where id=$1', [a.account])).rows[0].plan_status).toBe('expired');
      expect((await db.query('select account_can_write($1) can', [a.account])).rows[0].can).toBe(false);

      // A second expiry run changes nothing, and a second grant is impossible.
      await db.query('select expire_subscriptions()');
      expect((await db.query("select count(*)::int n from subscription_events where account_id=$1 and kind='expired'", [a.account])).rows[0].n).toBe(1);
      expect((await db.query('select claim_account_trial($1) ok', [a.account])).rows[0].ok).toBe(false);
    });

    it('never shortens a period that is still running', async () => {
      const a = await newAccount();
      await payFor(a.name, 'professional');
      const before = (await db.query('select plan_expires_at from accounts where id=$1', [a.account])).rows[0].plan_expires_at;

      await db.query('select expire_subscriptions()');

      const after = (await db.query('select plan_status, plan_expires_at from accounts where id=$1', [a.account])).rows[0];
      expect(after.plan_status).toBe('active');
      expect(new Date(after.plan_expires_at).getTime()).toBe(new Date(before).getTime());
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('unauthorized plan changes', () => {
    it('lets no authenticated caller set a subscription', async () => {
      const a = await newAccount();
      for (const user of [a.owner, randomUUID()]) {
        await expect(staff(user, () => db.query(
          "select admin_set_subscription($1,'business',null,12)", [a.name]))).rejects.toMatchObject({ code: '42501' });
        await expect(staff(user, () => db.query(
          `select record_subscription_payment($1,'test-provider',$2,'business',369900,'INR',1,now())`,
          [a.name, randomUUID()]))).rejects.toMatchObject({ code: '42501' });
        await expect(staff(user, () => db.query(
          `select confirm_subscription_cancellation($1,'test-provider',$2)`, [a.name, randomUUID()]))).rejects.toMatchObject({ code: '42501' });
      }
    });

    it('refuses a plan change written straight to the table', async () => {
      const a = await newAccount();
      await expect(staff(a.owner, () => db.query(
        "update accounts set plan='business', plan_status='active' where id=$1", [a.account])))
        .rejects.toMatchObject({ code: '42501' });
      // The guard trigger is the backstop behind that refusal, and it is on.
      const guards = (await db.query(
        "select tgname, tgenabled from pg_trigger where tgrelid='public.accounts'::regclass and not tgisinternal")).rows;
      expect(guards.map((row: { tgname: string }) => row.tgname)).toContain('accounts_plan_guard');
      for (const guard of guards) expect(guard.tgenabled).toBe('O');
    });
  });
});
