import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
const URL_VALUE = process.env.READINESS_DB_URL || '';
// A test URL is not permission to mutate an arbitrary database.
if (URL_VALUE) {
  const url = new URL(URL_VALUE);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/autodine_check_[a-f0-9]+$/.test(url.pathname)) {
    throw new Error('Readiness tests require a locally-created disposable autodine_check_* database');
  }
}
type Fixture = { restaurant: string; table: string; item: string; user: string; kitchen: string; slug: string; sessionToken: string; order: string; sitting: string };
let db: Client;
async function fixture(): Promise<Fixture> {
  const slug = 'ready-' + randomUUID();
  const user = randomUUID(), kitchen = randomUUID();
  await db.query('insert into profiles(id) values ($1),($2)', [user, kitchen]);
  const restaurant = (await db.query(`insert into restaurants(slug,name,address,tax_rate_bps,guest_verification_mode)
    values ($1,'Readiness restaurant','Test-only address',0,'scan') returning id`, [slug])).rows[0].id;
  await db.query(`insert into memberships(restaurant_id,user_id,role) values ($1,$2,'owner'),($1,$3,'kitchen')`, [restaurant,user,kitchen]);
  const menu = (await db.query(`insert into menus(restaurant_id,name,is_published) values($1,'Main',true) returning id`,[restaurant])).rows[0].id;
  const category = (await db.query(`insert into categories(restaurant_id,menu_id,name) values($1,$2,'Mains') returning id`,[restaurant,menu])).rows[0].id;
  const item = (await db.query(`insert into items(restaurant_id,category_id,name,price_paise,is_available) values($1,$2,'Dish',12500,true) returning id`,[restaurant,category])).rows[0].id;
  const table = (await db.query(`insert into dining_tables(restaurant_id,label) values($1,'T1') returning id`,[restaurant])).rows[0].id;
  const token = randomUUID().replaceAll('-','') + randomUUID().replaceAll('-','');
  await db.query('insert into table_qr_codes(restaurant_id,table_id,public_token) values($1,$2,$3)',[restaurant,table,token]);
  const sessionToken = (await db.query('select * from open_table_session($1,$2)',[token,'a'.repeat(64)])).rows[0].session_token;
  const code = (await db.query('select place_public_order($1,$2::jsonb,null,$3,$4::uuid,null) code',[slug,JSON.stringify([{itemId:item,qty:2}]),sessionToken,randomUUID()])).rows[0].code;
  const order = (await db.query('select id,order_session_id from orders where restaurant_id=$1 and code=$2',[restaurant,code])).rows[0];
  return {restaurant,table,item,user,kitchen,slug,sessionToken,order:order.id,sitting:order.order_session_id};
}
async function asStaff<T>(user: string, work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
    await db.query('set local role authenticated');
    return await work();
  } finally { await db.query('rollback'); }
}
async function withActor<T>(user: string, work: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  try { return await work(); }
  finally { await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}
async function seedLegacyUnpaidInvoice(f: Fixture): Promise<string> {
  // Reconstruct a pre-guard state for compatibility tests only; current
  // checkout must reject this state and new sessions cannot create it.
  await db.query("update order_sessions set status='closed',closed_at=statement_timestamp(),closed_by=$2 where id=$1",[f.sitting,f.user]);
  return withActor(f.user,async()=>
    (await db.query('select issue_closed_session_receipt($1) id',[f.sitting])).rows[0].id);
}
describe.skipIf(!URL_VALUE)('native PostgreSQL commercial boundary regression', () => {
  let a: Fixture, b: Fixture;
  beforeAll(async()=> { db=new Client({connectionString:URL_VALUE});await db.connect();a=await fixture();b=await fixture(); },30000);
  beforeEach(async()=>{await db.query("select set_config('request.jwt.claim.sub','',false)");});
  afterAll(async()=>{if(db)await db.end();});
  it('removes browser maintenance and sequence access for current and future public objects', async () => {
    const version=Number((await db.query("select current_setting('server_version_num')::int version")).rows[0].version);
    const roles=['anon','authenticated'];
    const tablePrivileges=['TRUNCATE','REFERENCES','TRIGGER',...(version>=170000?['MAINTAIN']:[])];
    const ownerFixtures=(await db.query(`select c.relname,r.rolname owner,c.relkind
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      join pg_roles r on r.oid=c.relowner
      where n.nspname='public' and c.relname=any($1::text[]) order by c.relname`,[
      ['acl_existing_postgres','acl_existing_postgres_seq','acl_existing_supabase_admin','acl_existing_supabase_admin_seq']])).rows;
    expect(ownerFixtures).toEqual([
      {relname:'acl_existing_postgres',owner:'postgres',relkind:'r'},
      {relname:'acl_existing_postgres_seq',owner:'postgres',relkind:'S'},
      {relname:'acl_existing_supabase_admin',owner:'supabase_admin',relkind:'r'},
      {relname:'acl_existing_supabase_admin_seq',owner:'supabase_admin',relkind:'S'},
    ]);
    for(const table of ['public.acl_existing_postgres','public.acl_existing_supabase_admin']) {
      for(const role of roles) {
        for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']) {
          expect((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,table,privilege])).rows[0].allowed,
            `${role} retains ${privilege} on current object-owner fixture ${table}`).toBe(true);
        }
      }
    }
    for(const sequence of ['public.acl_existing_postgres_seq','public.acl_existing_supabase_admin_seq']) {
      expect((await db.query('select has_sequence_privilege(\'service_role\',$1,\'USAGE\') allowed',[sequence])).rows[0].allowed).toBe(true);
    }
    for(const role of roles) {
      for(const privilege of tablePrivileges) {
        const count=(await db.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind in ('r','p') and has_table_privilege($1,c.oid,$2)`,[role,privilege])).rows[0].n;
        expect(count,`${role} ${privilege} on an existing public table`).toBe(0);
      }
      for(const privilege of ['USAGE','SELECT','UPDATE']) {
        const count=(await db.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and case when c.relkind='S' then has_sequence_privilege($1,c.oid,$2) else false end`,[role,privilege])).rows[0].n;
        expect(count,`${role} ${privilege} on an existing public sequence`).toBe(0);
      }
    }
    expect((await db.query("select has_schema_privilege('anon','public','USAGE') usage,has_schema_privilege('anon','public','CREATE') can_create")).rows[0])
      .toEqual({usage:true,can_create:false});
    expect((await db.query("select has_column_privilege('authenticated','public.orders','prep_status','UPDATE') allowed")).rows[0].allowed).toBe(true);

    await db.query('begin');
    try {
      await db.query('create table public.acl_future_postgres(id uuid primary key)');
      await db.query('create sequence public.acl_future_postgres_seq');
      await db.query('set local role supabase_admin');
      await db.query('create table public.acl_future_supabase_admin(id uuid primary key)');
      await db.query('create sequence public.acl_future_supabase_admin_seq');
      await db.query('reset role');
      for(const table of ['public.acl_future_postgres','public.acl_future_supabase_admin']) {
        for(const role of roles) {
          for(const privilege of tablePrivileges) {
            expect((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,table,privilege])).rows[0].allowed,
              `${role} ${privilege} on future table ${table}`).toBe(false);
          }
          // These are deliberately retained for existing RLS-backed API
          // workflows; a new table still must enable RLS and define policies.
          for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']) {
            expect((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,table,privilege])).rows[0].allowed,
              `${role} retains ${privilege} on future table ${table}`).toBe(true);
          }
        }
      }
      for(const sequence of ['public.acl_future_postgres_seq','public.acl_future_supabase_admin_seq']) {
        for(const role of roles) {
          for(const privilege of ['USAGE','SELECT','UPDATE']) {
            expect((await db.query('select has_sequence_privilege($1,$2,$3) allowed',[role,sequence,privilege])).rows[0].allowed,
              `${role} ${privilege} on future sequence ${sequence}`).toBe(false);
          }
        }
        expect((await db.query('select has_sequence_privilege(\'service_role\',$1,\'USAGE\') allowed',[sequence])).rows[0].allowed).toBe(true);
      }
      const publicUnsafe=(await db.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace
        cross join lateral aclexplode(c.relacl) acl where n.nspname='public'
          and c.relname in ('acl_future_postgres','acl_future_supabase_admin') and acl.grantee=0
          and acl.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')`)).rows[0].n;
      expect(publicUnsafe).toBe(0);
    } finally {await db.query('rollback');}
  });
  it('counter payment waits for the session before taking the order lock', async () => {
    const f = await fixture();
    const holder = new Client({ connectionString: URL_VALUE });
    const payer = new Client({ connectionString: URL_VALUE });
    await holder.connect(); await payer.connect();
    const paymentKey = randomUUID();
    let payment: Promise<unknown> | undefined;
    try {
      await holder.query('begin');
      await holder.query("set local statement_timeout = '8s'");
      await holder.query('select id from order_sessions where id=$1 for update', [f.sitting]);
      await payer.query('begin');
      await payer.query("set local statement_timeout = '8s'");
      await payer.query("select set_config('request.jwt.claim.sub',$1,true)", [f.user]);
      await payer.query('set local role authenticated');
      const pid = (await payer.query('select pg_backend_pid() pid')).rows[0].pid;
      // Attach the rejection handler immediately; cleanup always releases the holder.
      payment = payer.query('select record_counter_payment($1,$2,$3,$4,$5)',
        [f.slug, f.order, 'cash', 25000, paymentKey]).then(r => ({ result: r }), error => ({ error }));
      await expect.poll(async () => (await db.query(
        'select cardinality(pg_blocking_pids($1)) > 0 blocked', [pid])).rows[0].blocked,
        { timeout: 4000 }).toBe(true);
      // While payment is waiting, checkout must still be able to lock the order.
      await holder.query('select id from orders where id=$1 for update nowait', [f.order]);
      await holder.query('commit');
      const outcome = await payment as { error?: Error };
      expect(outcome.error).toBeUndefined();
      await payer.query('commit');
      const balance = (await db.query(`select o.total_paise,
        (select sum(p.amount_paise) from payments p where p.order_id=o.id and p.status='recorded') paid
        from orders o where o.id=$1`, [f.order])).rows[0];
      expect(balance.paid).toBe(balance.total_paise);
      await payer.query('begin');
      await payer.query("select set_config('request.jwt.claim.sub',$1,true)", [f.user]);
      await payer.query('set local role authenticated');
      await payer.query('select record_counter_payment($1,$2,$3,$4,$5)',
        [f.slug, f.order, 'cash', 25000, paymentKey]);
      await payer.query('commit');
      expect((await db.query('select count(*) n from payments where order_id=$1 and status=$2',
        [f.order, 'recorded'])).rows[0].n).toBe('1');

    } finally {
      await holder.query('rollback');
      if (payment) await payment;
      await payer.query('rollback');
      await holder.end(); await payer.end();
    }
  }, 15000);
  for (const operation of ['cancel', 'quantities', 'begin-online', 'settle-online']) {
    for (const checkout of [false, true]) it(`${operation} takes session first (checkout=${checkout})`, async () => {
      const f = await fixture();
      const ref = randomUUID();
      const line = (await db.query('select id from order_items where order_id=$1', [f.order])).rows[0].id;
      const token = (await db.query('select guest_token from orders where id=$1', [f.order])).rows[0].guest_token;
      await db.query('update restaurants set online_payments_enabled=true where id=$1', [f.restaurant]);
      if (checkout && ['cancel','quantities'].includes(operation)) {
        await withActor(f.user,()=>db.query('select record_counter_payment($1,$2,$3,$4,$5)',
          [f.slug,f.order,'cash',25000,randomUUID()]));
      }
      if (operation === 'settle-online') await db.query(`insert into payments
        (restaurant_id,order_id,method,status,amount_paise,provider,provider_ref)
        values($1,$2,'online','pending',25000,'phase1',$3)`, [f.restaurant,f.order,ref]);
      const holder = new Client({connectionString:URL_VALUE});
      const worker = new Client({connectionString:URL_VALUE});
      await holder.connect(); await worker.connect();
      let task: Promise<{error?: Error}> | undefined;
      try {
        await holder.query('begin');
        await holder.query("set local statement_timeout='8s'");
        await holder.query('select id from order_sessions where id=$1 for update',[f.sitting]);
        await worker.query('begin');
        await worker.query("set local statement_timeout='8s'");
        await worker.query("select set_config('request.jwt.claim.sub',$1,true)",[f.user]);
        await worker.query(`set local role ${operation.includes('online') ? 'service_role' : 'authenticated'}`);
        const pid=(await worker.query('select pg_backend_pid() pid')).rows[0].pid;
        const sql = operation === 'cancel' ? 'select cancel_order($1,null,null)' :
          operation === 'quantities' ? 'select set_order_line_quantities($1,$2::jsonb,null)' :
          operation === 'begin-online' ? 'select begin_online_payment($1,$2,$3,$4,$5,$6)' :
          'select settle_online_payment($1,$2,$3,$4)';
        const args = operation === 'cancel' ? [f.order] : operation === 'quantities' ?
          [f.order,JSON.stringify([{line_id:line,qty:1}])] : operation === 'begin-online' ?
          ['phase1',ref,f.slug,f.order,token,25000] : ['phase1',ref,'paid-'+ref,25000];
        task=worker.query(sql,args).then(()=>({}),error=>({error}));
        await expect.poll(async()=> (await db.query('select cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked,{timeout:4000}).toBe(true);
        await holder.query('select id from orders where id=$1 for update nowait',[f.order]);
        if(operation === 'settle-online') await holder.query('select id from payments where order_id=$1 for update nowait',[f.order]);
        let invoice: { id: string; snapshot: unknown } | undefined;
        if(checkout && ['cancel','quantities'].includes(operation)) {
          await holder.query("select set_config('request.jwt.claim.sub',$1,true)",[f.user]);
          const id=(await holder.query('select close_order_session_and_issue_receipt($1) id',[f.sitting])).rows[0].id;
          invoice={id,snapshot:(await holder.query('select totals_snapshot from restaurant_invoices where id=$1',[id])).rows[0].totals_snapshot};
        } else if(checkout) {
          // Pending or not-yet-created gateway money is still outstanding.
          // Prove checkout fails without aborting the lock-holder transaction.
          await holder.query('savepoint checkout_attempt');
          await holder.query("select set_config('request.jwt.claim.sub',$1,true)",[f.user]);
          let checkoutError: Error | undefined;
          try { await holder.query('select close_order_session_and_issue_receipt($1)',[f.sitting]); }
          catch(error) { checkoutError=error as Error; }
          expect(checkoutError?.message).toMatch(/outstanding balance/i);
          await holder.query('rollback to savepoint checkout_attempt');
          expect((await holder.query('select status from order_sessions where id=$1',[f.sitting])).rows[0].status).toBe('open');
          expect((await holder.query('select count(*)::int n from restaurant_invoices where order_session_id=$1',[f.sitting])).rows[0].n).toBe(0);
        }
        await holder.query('commit');
        const result=await task;
        if(checkout && ['cancel','quantities'].includes(operation)) {
          expect(result.error?.message).toMatch(/already been paid/i);
          await worker.query('rollback');
          expect((await db.query('select total_paise from orders where id=$1',[f.order])).rows[0].total_paise).toBe('25000');
        } else {
          expect(result.error).toBeUndefined();
          await worker.query('commit');
        }
        if(checkout && operation === 'begin-online') {
          await withActor(f.user,async()=>{
            await expect(db.query('select close_order_session_and_issue_receipt($1)',[f.sitting])).rejects.toThrow(/outstanding balance/i);
          });
          expect((await db.query('select status from order_sessions where id=$1',[f.sitting])).rows[0].status).toBe('open');
          expect((await db.query('select count(*)::int n from restaurant_invoices where order_session_id=$1',[f.sitting])).rows[0].n).toBe(0);
        }
        if(checkout && operation === 'settle-online') {
          const id=await withActor(f.user,async()=>
            (await db.query('select close_order_session_and_issue_receipt($1) id',[f.sitting])).rows[0].id);
          invoice={id,snapshot:(await db.query('select totals_snapshot from restaurant_invoices where id=$1',[id])).rows[0].totals_snapshot};
          expect((invoice.snapshot as {amount_paid_paise:number}).amount_paid_paise).toBe(25000);
          expect((invoice.snapshot as {outstanding_paise:number}).outstanding_paise).toBe(0);
          expect((await db.query('select count(*)::int n from restaurant_payment_receipts where invoice_id=$1',[id])).rows[0].n).toBe(0);
        }
        if(invoice) {
          expect((await db.query('select totals_snapshot from restaurant_invoices where id=$1',[invoice.id])).rows[0].totals_snapshot).toEqual(invoice.snapshot);
          if(operation === 'settle-online') {
            expect((await db.query("select sum(amount_paise) paid from payments where order_id=$1 and status='recorded'",[f.order])).rows[0].paid).toBe('25000');
          }
        }
      } finally {
        await db.query("select set_config('request.jwt.claim.sub','',false)");
        await holder.query('rollback'); if(task) await task;
        await worker.query('rollback'); await holder.end(); await worker.end();
      }
    },15000);
  }

  it('preserves supplemental receipt bookkeeping for a legacy unpaid invoice under competing counter collections', async () => {
    const f=await fixture();
    const invoice=await seedLegacyUnpaidInvoice(f);
    const before=(await db.query('select totals_snapshot from restaurant_invoices where id=$1',[invoice])).rows[0].totals_snapshot;
    const clients=[new Client({connectionString:URL_VALUE}),new Client({connectionString:URL_VALUE})];
    const keys=[randomUUID(),randomUUID()];
    try {
      await Promise.all(clients.map(c=>c.connect()));
      const outcomes=await Promise.all(clients.map(async(c,i)=>{
        await c.query('begin'); await c.query("set local statement_timeout='8s'");
        await c.query("select set_config('request.jwt.claim.sub',$1,true)",[f.user]);
        await c.query('set local role authenticated');
        try {
          await c.query('select record_counter_payment($1,$2,$3,$4,$5)',[f.slug,f.order,'cash',25000,keys[i]]);
          await c.query('commit'); return 'recorded';
        } catch(error) { await c.query('rollback'); return (error as Error).message; }
      }));
      expect(outcomes.filter(x=>x==='recorded')).toHaveLength(1);
      expect((await db.query("select sum(amount_paise) paid,count(*) n from payments where order_id=$1 and status='recorded'",[f.order])).rows[0]).toEqual({paid:'25000',n:'1'});
      expect((await db.query(`select actor_id,event_type,method,amount_paise from payment_audit_events where order_id=$1`,[f.order])).rows)
        .toEqual([{actor_id:f.user,event_type:'cash_collected',method:'cash',amount_paise:'25000'}]);
      expect((await db.query('select sequence_number from restaurant_payment_receipts where invoice_id=$1 order by sequence_number',[invoice])).rows.map(r=>r.sequence_number)).toEqual([1]);
      expect((await db.query('select totals_snapshot from restaurant_invoices where id=$1',[invoice])).rows[0].totals_snapshot).toEqual(before);
      await expect(withActor(f.user,()=>db.query('select record_counter_payment($1,$2,$3,$4,$5)',
        [f.slug,f.order,'cash',1,randomUUID()]))).rejects.toThrow();
      expect((await db.query('select count(*) n from restaurant_payment_receipts where invoice_id=$1',[invoice])).rows[0].n).toBe('1');
    } finally {await Promise.all(clients.map(async c=>{await c.query('rollback');await c.end();}));}
  },15000);

  it('payment-first checkout snapshots payment without a redundant supplemental receipt', async () => {
    const f=await fixture();
    const payer=new Client({connectionString:URL_VALUE}), checkout=new Client({connectionString:URL_VALUE});
    await payer.connect();await checkout.connect();
    let task: Promise<{id?: string; error?: Error}> | undefined;
    try {
      for(const c of [payer,checkout]) {
        await c.query('begin');await c.query("set local statement_timeout='8s'");
        await c.query("select set_config('request.jwt.claim.sub',$1,true)",[f.user]);
        await c.query('set local role authenticated');
      }
      await payer.query('select record_counter_payment($1,$2,$3,$4,$5)',[f.slug,f.order,'cash',25000,randomUUID()]);
      const pid=(await checkout.query('select pg_backend_pid() pid')).rows[0].pid;
      task=checkout.query('select close_order_session_and_issue_receipt($1) id',[f.sitting])
        .then(r=>({id:r.rows[0].id}),error=>({error}));
      await expect.poll(async()=> (await db.query('select cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked,{timeout:4000}).toBe(true);
      await payer.query('commit');
      const result=await task;expect(result.error).toBeUndefined();await checkout.query('commit');
      const invoice=(await db.query('select totals_snapshot from restaurant_invoices where id=$1',[result.id])).rows[0];
      expect(invoice.totals_snapshot.amount_paid_paise).toBe(25000);
      expect((await db.query('select count(*) n from restaurant_payment_receipts where invoice_id=$1',[result.id])).rows[0].n).toBe('0');
    } finally {
      await payer.query('rollback');if(task)await task;
      await checkout.query('rollback');await payer.end();await checkout.end();
    }
  },15000);

  it('rejects provider amount mismatches atomically and keeps webhook retries idempotent', async () => {
    const actorColumn = (await db.query(`
      select attnotnull
        from pg_catalog.pg_attribute
       where attrelid = 'public.payment_audit_events'::regclass
         and attname = 'actor_id' and not attisdropped`)).rows[0];
    expect(actorColumn.attnotnull).toBe(false); // Provider webhooks have no staff actor.
    const f=await fixture();const ref=randomUUID();
    await db.query("insert into payments(restaurant_id,order_id,method,status,amount_paise,provider,provider_ref) values($1,$2,'online','pending',25000,'phase1',$3)",[f.restaurant,f.order,ref]);
    await expect(db.query('select settle_online_payment($1,$2,$3,$4)',['phase1',ref,'provider-'+ref,24999])).rejects.toThrow(/amount/i);
    expect((await db.query('select status,provider_payment_ref from payments where order_id=$1',[f.order])).rows[0]).toEqual({status:'pending',provider_payment_ref:null});
    expect((await db.query('select payment_status from orders where id=$1',[f.order])).rows[0].payment_status).toBe('pending');
    expect((await db.query('select count(*) n from payment_audit_events where order_id=$1',[f.order])).rows[0].n).toBe('0');
    const first=(await db.query('select settle_online_payment($1,$2,$3,$4) id',['phase1',ref,'provider-'+ref,25000])).rows[0].id;
    const second=(await db.query('select settle_online_payment($1,$2,$3,$4) id',['phase1',ref,'provider-'+ref,25000])).rows[0].id;
    expect(second).toBe(first);
    const providerAudit=(await db.query(`select actor_id,event_type,method,amount_paise
      from payment_audit_events where order_id=$1`,[f.order])).rows;
    expect(providerAudit).toEqual([{actor_id:null,event_type:'online_collected',method:'online',amount_paise:'25000'}]);
    expect((await db.query("select sum(amount_paise) paid from payments where order_id=$1 and status='recorded'",[f.order])).rows[0].paid).toBe('25000');
    const actorFk=(await db.query(`select c.confrelid::regclass::text references_table,c.confdeltype,c.convalidated
      from pg_constraint c
      where c.conrelid='public.payment_audit_events'::regclass and c.contype='f'
        and c.conkey=array[(select attnum::smallint from pg_attribute where attrelid='public.payment_audit_events'::regclass and attname='actor_id')]::smallint[]`)).rows;
    expect(actorFk).toEqual([{references_table:'profiles',confdeltype:'n',convalidated:true}]);
  });

  it('keeps cancelled online orders unpaid and leaves the provider attempt pending', async () => {
    const f=await fixture();const ref=randomUUID();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.user]);
    await db.query('select cancel_order($1,null,null)',[f.order]);
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query("insert into payments(restaurant_id,order_id,method,status,amount_paise,provider,provider_ref) values($1,$2,'online','pending',25000,'phase1',$3)",[f.restaurant,f.order,ref]);
    await expect(db.query('select settle_online_payment($1,$2,$3,$4)',['phase1',ref,'provider-'+ref,25000])).rejects.toThrow(/cancelled/i);
    expect((await db.query('select prep_status,payment_status from orders where id=$1',[f.order])).rows[0])
      .toEqual({prep_status:'cancelled',payment_status:'pending'});
    expect((await db.query('select status,provider_payment_ref from payments where order_id=$1',[f.order])).rows[0])
      .toEqual({status:'pending',provider_payment_ref:null});
    expect((await db.query('select count(*)::int n from payment_audit_events where order_id=$1',[f.order])).rows[0].n).toBe(0);
  });

  it('keeps online intent and settlement executable only by the service role, not guests or staff', async () => {
    for(const signature of [
      'public.begin_online_payment(text,text,text,uuid,uuid,bigint)',
      'public.settle_online_payment(text,text,text,bigint)',
    ]) {
      const fn=(await db.query(`select p.prosecdef,p.proconfig,
          has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
          has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
          has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
        from pg_proc p where p.oid=to_regprocedure($1)`,[signature])).rows[0];
      expect(fn).toMatchObject({prosecdef:true,anon_execute:false,authenticated_execute:false,service_execute:true});
      expect(fn.proconfig).toContain('search_path=public, pg_temp');
    }
    await asStaff(a.user,async()=>{
      await expect(db.query('select settle_online_payment($1,$2,$3,$4)',['phase1','missing','missing',25000])).rejects.toMatchObject({code:'42501'});
    });
  });

  it('admits one online intent per order and rejects a stale second capture without double-recording', async () => {
    const f=await fixture();
    const token=(await db.query('select guest_token from orders where id=$1',[f.order])).rows[0].guest_token;
    const firstRef=randomUUID(),secondRef=randomUUID();
    await db.query('update restaurants set online_payments_enabled=true where id=$1',[f.restaurant]);
    const provider=new Client({connectionString:URL_VALUE});
    await provider.connect();
    try {
      await provider.query('set role service_role');
      const args=['phase1',firstRef,f.slug,f.order,token,25000];
      const first=(await provider.query('select begin_online_payment($1,$2,$3,$4,$5,$6) id',args)).rows[0].id;
      const retry=(await provider.query('select begin_online_payment($1,$2,$3,$4,$5,$6) id',args)).rows[0].id;
      expect(retry).toBe(first);
      await expect(provider.query('select begin_online_payment($1,$2,$3,$4,$5,$6)',
        ['phase1',secondRef,f.slug,f.order,token,25000])).rejects.toThrow(/already in progress/i);

      // Model a duplicate intent left by an older writer. The first provider
      // callback records the exact outstanding balance; the stale second one
      // must remain pending for provider reconciliation, not create an overpay.
      await db.query("insert into payments(restaurant_id,order_id,method,status,amount_paise,provider,provider_ref) values($1,$2,'online','pending',25000,'phase1',$3)",
        [f.restaurant,f.order,secondRef]);
      const settled=(await provider.query('select settle_online_payment($1,$2,$3,$4) id',
        ['phase1',firstRef,'payment-'+firstRef,25000])).rows[0].id;
      expect(settled).toBe(first);
      await expect(provider.query('select settle_online_payment($1,$2,$3,$4)',
        ['phase1',secondRef,'payment-'+secondRef,25000])).rejects.toThrow(/already been settled|outstanding balance/i);
      expect((await db.query('select status from payments where provider_ref=$1',[secondRef])).rows[0].status).toBe('pending');
      expect((await db.query("select sum(amount_paise) paid,count(*)::int n from payments where order_id=$1 and status='recorded'",[f.order])).rows[0])
        .toEqual({paid:'25000',n:1});
      expect((await db.query('select payment_status from orders where id=$1',[f.order])).rows[0].payment_status).toBe('paid');
      expect((await db.query('select count(*)::int n from payment_audit_events where order_id=$1',[f.order])).rows[0].n).toBe(1);
    } finally {await provider.end();}
  });

  it('serializes concurrent distinct online intents so only one becomes pending', async () => {
    const f=await fixture();
    const token=(await db.query('select guest_token from orders where id=$1',[f.order])).rows[0].guest_token;
    await db.query('update restaurants set online_payments_enabled=true where id=$1',[f.restaurant]);
    const refs=[randomUUID(),randomUUID()];
    const providers=refs.map(()=>new Client({connectionString:URL_VALUE}));
    await Promise.all(providers.map(client=>client.connect()));
    try {
      await Promise.all(providers.map(client=>client.query('set role service_role')));
      const outcomes=await Promise.all(providers.map((client,index)=>client
        .query('select begin_online_payment($1,$2,$3,$4,$5,$6)',
          ['phase1',refs[index],f.slug,f.order,token,25000])
        .then(()=>({ok:true as const}),error=>({ok:false as const,error}))));
      expect(outcomes.filter(result=>result.ok)).toHaveLength(1);
      const rejected=outcomes.find(result=>!result.ok);
      expect(rejected && !rejected.ok ? rejected.error.message : '').toMatch(/already in progress/i);
      expect((await db.query("select count(*)::int n from payments where order_id=$1 and method='online' and status='pending'",[f.order])).rows[0].n).toBe(1);
    } finally {await Promise.all(providers.map(client=>client.end()));}
  });

  it('void-first payment race does not create a receipt against a voided invoice', async () => {
    const f=await fixture();const ref=randomUUID();
    // Reconstruct an invoice issued before the outstanding-balance guard; a
    // pending provider attempt was already attached to this legacy order.
    const invoice=await seedLegacyUnpaidInvoice(f);
    await db.query("insert into payments(restaurant_id,order_id,method,status,amount_paise,provider,provider_ref) values($1,$2,'online','pending',25000,'phase1',$3)",[f.restaurant,f.order,ref]);
    const voider=new Client({connectionString:URL_VALUE}),payer=new Client({connectionString:URL_VALUE});
    await voider.connect();await payer.connect();
    let task: Promise<{error?: Error}> | undefined;
    try {
      await voider.query('begin');await voider.query("set local statement_timeout='8s'");
      await voider.query("select set_config('request.jwt.claim.sub',$1,true)",[f.user]);
      await voider.query('set local role authenticated');
      await voider.query('select void_restaurant_invoice($1,$2)',[invoice,'Local regression correction']);
      await payer.query('begin');await payer.query("set local statement_timeout='8s'");await payer.query('set local role service_role');
      const pid=(await payer.query('select pg_backend_pid() pid')).rows[0].pid;
      task=payer.query('select settle_online_payment($1,$2,$3,$4)',['phase1',ref,'provider-'+ref,25000]).then(()=>({}),error=>({error}));
      await expect.poll(async()=> (await db.query('select cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked,{timeout:4000}).toBe(true);
      await voider.query('commit');expect((await task).error).toBeUndefined();await payer.query('commit');
      expect((await db.query('select status from restaurant_invoices where id=$1',[invoice])).rows[0].status).toBe('voided');
      expect((await db.query('select count(*) n from restaurant_payment_receipts where invoice_id=$1',[invoice])).rows[0].n).toBe('0');
      expect((await db.query("select sum(amount_paise) paid from payments where order_id=$1 and status='recorded'",[f.order])).rows[0].paid).toBe('25000');
    } finally {
      await voider.query('rollback');if(task)await task;await payer.query('rollback');await voider.end();await payer.end();
    }
  },15000);

  it('admits guests on different table cards behind the same shared Wi-Fi address', async () => {
    const f=await fixture();const shared='d'.repeat(64);
    const cards:string[]=[];
    for(let i=0;i<3;i++) {
      const table=(await db.query('insert into dining_tables(restaurant_id,label) values($1,$2) returning id',[f.restaurant,'WiFi-'+i])).rows[0].id;
      const token=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','');cards.push(token);
      await db.query('insert into table_qr_codes(restaurant_id,table_id,public_token) values($1,$2,$3)',[f.restaurant,table,token]);
    }
    for(const card of cards) for(let i=0;i<8;i++) {
      const result=(await db.query('select * from open_table_session($1,$2)',[card,shared])).rows[0];
      expect(result.status).toBe('opened');expect(result.session_token).toBeTruthy();
    }
  });

  it('atomically enforces the existing ten-opens-per-card ceiling under concurrent scans', async () => {
    const f=await fixture();
    const card=(await db.query('select q.public_token from table_qr_codes q join table_verification_sessions s on s.qr_code_id=q.id where q.restaurant_id=$1',[f.restaurant])).rows[0].public_token;
    const clients=Array.from({length:16},()=>new Client({connectionString:URL_VALUE}));
    try {
      await Promise.all(clients.map(c=>c.connect()));
      const results=await Promise.all(clients.map((c,i)=>c.query('select * from open_table_session($1,$2)',[card,i.toString(16).padStart(64,'0')])));
      const opened=results.map(r=>r.rows[0]).filter(r=>r.status==='opened');
      const limited=results.map(r=>r.rows[0]).filter(r=>r.status==='limited');
      expect(opened).toHaveLength(9); // fixture already minted one session.
      expect(limited).toHaveLength(7);
      for(const result of limited) expect(result.session_token).toBeNull();
      expect((await db.query('select count(*) n from table_session_opens o join table_qr_codes q on q.id=o.qr_code_id where q.restaurant_id=$1',[f.restaurant])).rows[0].n).toBe('10');
      expect((await db.query('select count(*) n from table_verification_sessions where restaurant_id=$1',[f.restaurant])).rows[0].n).toBe('10');
    } finally {await Promise.all(clients.map(c=>c.end()));}
  },15000);

  it('does not let a tenant IP quota block another restaurant on the same address', async () => {
    const first=await fixture(),second=await fixture();const shared='e'.repeat(64);
    await db.query('insert into rate_limit_hits(key,window_started_at,count) values($1,statement_timestamp(),60)',
      ['po:i:'+first.restaurant+':'+shared]);
    const sql='select place_public_order($1,$2::jsonb,null,$3,$4,$5) code';
    await expect(db.query(sql,[first.slug,JSON.stringify([{itemId:first.item,qty:1}]),first.sessionToken,randomUUID(),shared])).rejects.toMatchObject({hint:'rate-limited'});
    const result=await db.query(sql,[second.slug,JSON.stringify([{itemId:second.item,qty:1}]),second.sessionToken,randomUUID(),shared]);
    expect(result.rows[0].code).toBeTruthy();
    expect((await db.query('select count(*) n from orders where restaurant_id=$1',[first.restaurant])).rows[0].n).toBe('1');
    expect((await db.query('select count(*) n from orders where restaurant_id=$1',[second.restaurant])).rows[0].n).toBe('2');
  });

  it('persists wrong-code budgets atomically and releases shared-Wi-Fi guests after expiry/success', async () => {
    const f=await fixture();const ip='f'.repeat(64);
    const qr=(await db.query('select q.id,q.public_token from table_qr_codes q join table_verification_sessions s on s.qr_code_id=q.id where q.restaurant_id=$1',[f.restaurant])).rows[0];
    await db.query("update restaurants set guest_verification_mode='code' where id=$1",[f.restaurant]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.user]);
    await db.query('select current_verification_code($1)',[f.restaurant]);
    const clients=Array.from({length:12},()=>new Client({connectionString:URL_VALUE}));
    try {
      await Promise.all(clients.map(c=>c.connect()));
      const results=await Promise.all(clients.map(c=>c.query('select * from verify_table_qr_with_code($1,$2,$3)',[qr.public_token,'not-digits',ip])));
      expect(results.filter(r=>r.rows[0].status==='wrong')).toHaveLength(5);
      expect(results.filter(r=>r.rows[0].status==='limited')).toHaveLength(7);
      for(const result of results) expect(result.rows[0].session_token).toBeNull();
      const attempt=(await db.query('select attempt_count,blocked_until>statement_timestamp() blocked from qr_verification_attempt_budgets where qr_code_id=$1 and ip_hash=$2',[qr.id,ip])).rows[0];
      expect(attempt).toEqual({attempt_count:5,blocked:true});
      await db.query("update qr_verification_attempt_budgets set window_started_at=statement_timestamp()-interval '16 minutes',blocked_until=statement_timestamp()-interval '1 second' where qr_code_id=$1 and ip_hash=$2",[qr.id,ip]);
      const code=(await db.query('select verification_code_for(secret,floor(extract(epoch from statement_timestamp())/window_seconds)::bigint) code from restaurant_verification_codes where restaurant_id=$1',[f.restaurant])).rows[0].code;
      for(let i=0;i<2;i++) expect((await db.query('select * from verify_table_qr_with_code($1,$2,$3)',[qr.public_token,code,ip])).rows[0].status).toBe('ok');
      expect((await db.query('select count(*) n from qr_verification_attempt_budgets where qr_code_id=$1 and ip_hash=$2',[qr.id,ip])).rows[0].n).toBe('0');
      expect((await db.query('select count(*) n from qr_verification_attempts where qr_code_id=$1 and ip_hash=$2',[qr.id,ip])).rows[0].n).toBe('0');
    } finally {await Promise.all(clients.map(c=>c.end()));}
  },15000);

  it('backfills duplicate legacy QR-attempt events without adding uniqueness or dropping state', async () => {
    const legacy = (await db.query(`select exists(
      select 1 from pg_attribute where attrelid='public.qr_verification_attempts'::regclass
        and attname='attempted_at' and not attisdropped) has_event_shape`)).rows[0].has_event_shape;
    if (!legacy) return;

    const seeded=(await db.query(`select q.id,count(*)::int legacy_rows,b.attempt_count
      from restaurants r
      join dining_tables t on t.restaurant_id=r.id
      join table_qr_codes q on q.table_id=t.id
      join qr_verification_attempts a on a.qr_code_id=q.id
      left join qr_verification_attempt_budgets b on b.qr_code_id=q.id and b.ip_hash=a.ip_hash
      where r.slug=$1 and a.ip_hash=$2
      group by q.id,b.attempt_count`,['readiness-qr-legacy-upgrade','c'.repeat(64)])).rows;
    expect(seeded).toHaveLength(1);
    const {id,legacy_rows,attempt_count}=seeded[0];
    expect(legacy_rows).toBe(6); // four recent events plus two expired ones remain intact.
    expect(attempt_count).toBe(4); // only the active 15-minute window is charged.

    expect((await db.query('select * from reserve_qr_verification_attempt($1,$2)',[id,'c'.repeat(64)])).rows[0].allowed).toBe(true);
    expect((await db.query('select * from reserve_qr_verification_attempt($1,$2)',[id,'c'.repeat(64)])).rows[0].allowed).toBe(false);
    expect((await db.query('select count(*)::int n from qr_verification_attempts where qr_code_id=$1 and ip_hash=$2',[id,'c'.repeat(64)])).rows[0].n).toBe(6);
    expect((await db.query('select attempt_count,blocked_until>statement_timestamp() blocked from qr_verification_attempt_budgets where qr_code_id=$1 and ip_hash=$2',[id,'c'.repeat(64)])).rows[0])
      .toEqual({attempt_count:5,blocked:true});

    await db.query('select clear_qr_verification_attempts($1,$2)',[id,'c'.repeat(64)]);
    expect((await db.query('select count(*)::int n from qr_verification_attempt_budgets where qr_code_id=$1 and ip_hash=$2',[id,'c'.repeat(64)])).rows[0].n).toBe(0);
    expect((await db.query('select count(*)::int n from qr_verification_attempts where qr_code_id=$1 and ip_hash=$2',[id,'c'.repeat(64)])).rows[0].n).toBe(0);
  });

  it('reopens scan admission after the window without reviving expired verification tokens', async () => {
    const f=await fixture();const ip='c'.repeat(64);
    const qr=(await db.query('select q.id,q.public_token from table_qr_codes q join table_verification_sessions s on s.qr_code_id=q.id where q.restaurant_id=$1',[f.restaurant])).rows[0];
    for(let i=0;i<9;i++) expect((await db.query('select * from open_table_session($1,$2)',[qr.public_token,ip])).rows[0].status).toBe('opened');
    expect((await db.query('select * from open_table_session($1,$2)',[qr.public_token,ip])).rows[0].status).toBe('limited');
    await db.query("update table_session_opens set opened_at=statement_timestamp()-interval '1 hour' where qr_code_id=$1",[qr.id]);
    expect((await db.query('select * from open_table_session($1,$2)',[qr.public_token,ip])).rows[0].status).toBe('opened');
    await db.query("update table_verification_sessions set expires_at=statement_timestamp()-interval '1 second' where restaurant_id=$1",[f.restaurant]);
    await expect(db.query('select place_public_order($1,$2::jsonb,null,$3,$4)',[f.slug,JSON.stringify([{itemId:f.item,qty:1}]),f.sessionToken,randomUUID()])).rejects.toThrow();
    expect((await db.query('select count(*) n from orders where restaurant_id=$1',[f.restaurant])).rows[0].n).toBe('1');
  });

  it('preserves scan-confirm holds until authorized staff confirms the verification session', async () => {
    const f=await fixture();
    await db.query("update restaurants set guest_verification_mode='scan_confirm' where id=$1",[f.restaurant]);
    const qr=(await db.query('select q.public_token from table_qr_codes q join table_verification_sessions s on s.qr_code_id=q.id where q.restaurant_id=$1',[f.restaurant])).rows[0];
    const session=(await db.query('select * from open_table_session($1,$2)',[qr.public_token,'b'.repeat(64)])).rows[0].session_token;
    const code=(await db.query('select place_public_order($1,$2::jsonb,null,$3,$4) code',[f.slug,JSON.stringify([{itemId:f.item,qty:1}]),session,randomUUID()])).rows[0].code;
    const order=(await db.query('select hold_required,confirmed_at,table_session_id from orders where restaurant_id=$1 and code=$2',[f.restaurant,code])).rows[0];
    expect(order.hold_required).toBe(true);expect(order.confirmed_at).toBeNull();
    await expect(asStaff(b.user,()=>db.query('select confirm_table_orders($1)',[order.table_session_id]))).rejects.toThrow();
    await asStaff(f.user,async()=>{
      await db.query('select confirm_table_orders($1)',[order.table_session_id]);
      expect((await db.query('select confirmed_at is not null confirmed from orders where restaurant_id=$1 and code=$2',[f.restaurant,code])).rows[0].confirmed).toBe(true);
    });
  });

  it('keeps session caps authoritative with no IP and makes retries quota-free', async () => {
    const f=await fixture();const key=randomUUID();
    const sql='select place_public_order($1,$2::jsonb,null,$3,$4,$5) code';
    const args=[f.slug,JSON.stringify([{itemId:f.item,qty:1}]),f.sessionToken,key,null];
    const first=(await db.query(sql,args)).rows[0].code;
    const budgetKey='po:s:'+(await db.query("select encode(sha256($1::bytea),'hex') hash",[f.sessionToken])).rows[0].hash;
    await db.query('update rate_limit_hits set count=30 where key=$1',[budgetKey]);
    expect((await db.query(sql,args)).rows[0].code).toBe(first);
    expect((await db.query('select count from rate_limit_hits where key=$1',[budgetKey])).rows[0].count).toBe(30);
    for(const ip of [null,'0'.repeat(64),'1'.repeat(64)]) {
      await expect(db.query(sql,[...args.slice(0,3),randomUUID(),ip])).rejects.toMatchObject({hint:'rate-limited'});
    }
    expect((await db.query('select count(*) n from orders where restaurant_id=$1',[f.restaurant])).rows[0].n).toBe('2');
    await db.query("update rate_limit_hits set window_started_at=statement_timestamp()-interval '601 seconds' where key=$1",[budgetKey]);
    expect((await db.query(sql,[...args.slice(0,3),randomUUID(),null])).rows[0].code).toBeTruthy();
  });

  it('keeps the restaurant cap authoritative across fresh sessions and IP hashes', async () => {
    const f=await fixture();
    await db.query('update rate_limit_hits set count=60 where key=$1',['po:t:'+f.restaurant]);
    const qr=(await db.query('select q.public_token from table_qr_codes q join table_verification_sessions s on s.qr_code_id=q.id where q.restaurant_id=$1',[f.restaurant])).rows[0];
    for(let i=0;i<3;i++) {
      const ip=i.toString().repeat(64);
      const token=(await db.query('select * from open_table_session($1,$2)',[qr.public_token,ip])).rows[0].session_token;
      await expect(db.query('select place_public_order($1,$2::jsonb,null,$3,$4,$5)',[f.slug,JSON.stringify([{itemId:f.item,qty:1}]),token,randomUUID(),i===0?null:ip])).rejects.toMatchObject({hint:'rate-limited'});
    }
    expect((await db.query('select count(*) n from orders where restaurant_id=$1',[f.restaurant])).rows[0].n).toBe('1');
  });

  it('commits malformed-order attempt budgets and denies the old public bypass', async () => {
    const f=await fixture();
    for(let i=0;i<60;i++) {
      const result=(await db.query('select place_public_order_attempt($1,$2::jsonb,null,$3,$4) result',[f.slug,'[]',f.sessionToken,randomUUID()])).rows[0].result;
      expect(result.code).toBeNull();expect(result.error).toBeTruthy();
    }
    const result=(await db.query('select place_public_order_attempt($1,$2::jsonb,null,$3,$4) result',[f.slug,JSON.stringify([{itemId:f.item,qty:1}]),f.sessionToken,randomUUID()])).rows[0].result;
    expect(result.error.hint).toBe('rate-limited');
    expect((await db.query('select count(*) n from orders where restaurant_id=$1',[f.restaurant])).rows[0].n).toBe('1');
    const count=(await db.query("select count from rate_limit_hits where key='po:attempt:s:'||encode(sha256($1::bytea),'hex')",[f.sessionToken])).rows[0].count;
    expect(count).toBe(61);
    for(const role of ['anon','authenticated']) {
      expect((await db.query("select has_function_privilege($1,'public.place_public_order(text,jsonb,text,text,uuid,text)','EXECUTE') allowed",[role])).rows[0].allowed).toBe(false);
      expect((await db.query("select has_function_privilege($1,'public.place_public_order_attempt(text,jsonb,text,text,uuid,text)','EXECUTE') allowed",[role])).rows[0].allowed).toBe(true);
    }
    await asStaff(f.user,async()=>{
      await expect(db.query('select place_public_order($1,$2::jsonb,null,$3,$4)',[f.slug,'[]',f.sessionToken,randomUUID()])).rejects.toMatchObject({code:'42501'});
    });
  });

  it('returns existing orders through the versioned API without consuming attempt quota', async () => {
    const f=await fixture();const key=randomUUID();
    const sql='select place_public_order_attempt($1,$2::jsonb,null,$3,$4) result';
    const args=[f.slug,JSON.stringify([{itemId:f.item,qty:1}]),f.sessionToken,key];
    const first=(await db.query(sql,args)).rows[0].result;
    expect(first.error).toBeNull();expect(first.code).toBeTruthy();
    await db.query("update rate_limit_hits set count=60 where key='po:attempt:s:'||encode(sha256($1::bytea),'hex')",[f.sessionToken]);
    expect((await db.query(sql,args)).rows[0].result).toEqual(first);
    const count=(await db.query("select count from rate_limit_hits where key='po:attempt:s:'||encode(sha256($1::bytea),'hex')",[f.sessionToken])).rows[0].count;
    expect(count).toBe(60);
  });

  it('atomically commits anonymous failed attempts at the admission boundary', async () => {
    const f=await fixture();
    const budgetKey='po:attempt:s:'+(await db.query("select encode(sha256($1::bytea),'hex') hash",[f.sessionToken])).rows[0].hash;
    await db.query('insert into rate_limit_hits(key,window_started_at,count) values($1,statement_timestamp(),50)',[budgetKey]);
    const clients=Array.from({length:16},()=>new Client({connectionString:URL_VALUE}));
    try {
      await Promise.all(clients.map(async c=>{await c.connect();await c.query("set statement_timeout='8s'");await c.query('set role anon');}));
      const results=await Promise.all(clients.map(async c=>(await c.query('select place_public_order_attempt($1,$2::jsonb,null,$3,$4) result',[f.slug,'[]',f.sessionToken,randomUUID()])).rows[0].result));
      expect(results.filter(r=>r.error?.hint==='rate-limited')).toHaveLength(6);
      expect(results.filter(r=>r.error && r.error.hint!=='rate-limited')).toHaveLength(10);
      expect((await db.query('select count from rate_limit_hits where key=$1',[budgetKey])).rows[0].count).toBe(66);
      expect((await db.query('select count from rate_limit_hits where key=$1',['po:attempt:t:'+f.restaurant])).rows[0].count).toBe(10);
      expect((await db.query('select count(*) n from orders where restaurant_id=$1',[f.restaurant])).rows[0].n).toBe('1');
    } finally {await Promise.all(clients.map(c=>c.end()));}
  },15000);

  it('enforces durable tenant-attempt caps across new sessions and permits window recovery', async () => {
    const f=await fixture();const tenantKey='po:attempt:t:'+f.restaurant;
    await db.query('insert into rate_limit_hits(key,window_started_at,count) values($1,statement_timestamp(),120)',[tenantKey]);
    const qr=(await db.query('select q.public_token from table_qr_codes q join table_verification_sessions s on s.qr_code_id=q.id where q.restaurant_id=$1',[f.restaurant])).rows[0];
    const sessions:string[]=[];
    for(let i=0;i<2;i++) sessions.push((await db.query('select * from open_table_session($1,$2)',[qr.public_token,i.toString().repeat(64)])).rows[0].session_token);
    const sql='select place_public_order_attempt($1,$2::jsonb,null,$3,$4) result';
    for(const session of sessions) {
      const result=(await db.query(sql,[f.slug,JSON.stringify([{itemId:f.item,qty:1}]),session,randomUUID()])).rows[0].result;
      expect(result.error.hint).toBe('rate-limited');expect(result.code).toBeNull();
    }
    expect((await db.query('select count from rate_limit_hits where key=$1',[tenantKey])).rows[0].count).toBe(122);
    await db.query("update rate_limit_hits set window_started_at=statement_timestamp()-interval '601 seconds' where key=$1",[tenantKey]);
    await asStaff(f.user,async()=>{
      const result=(await db.query(sql,[f.slug,JSON.stringify([{itemId:f.item,qty:1}]),sessions[0],randomUUID()])).rows[0].result;
      expect(result.error).toBeNull();expect(result.code).toBeTruthy();
    });
  });

  it('rejects wrong-tenant and expired credentials before durable admission', async () => {
    const f=await fixture(),other=await fixture();
    const sql='select place_public_order_attempt($1,$2::jsonb,null,$3,$4) result';
    const lines=JSON.stringify([{itemId:f.item,qty:1}]);
    const wrong=(await db.query(sql,[f.slug,lines,other.sessionToken,randomUUID()])).rows[0].result;
    expect(wrong.code).toBeNull();expect(wrong.error).toBeTruthy();
    await db.query("update table_verification_sessions set expires_at=statement_timestamp()-interval '1 second' where restaurant_id=$1",[f.restaurant]);
    const expired=(await db.query(sql,[f.slug,lines,f.sessionToken,randomUUID()])).rows[0].result;
    expect(expired.code).toBeNull();expect(expired.error).toBeTruthy();
    expect((await db.query('select count(*) n from orders where restaurant_id=$1',[f.restaurant])).rows[0].n).toBe('1');
    expect((await db.query('select count(*) n from rate_limit_hits where key=$1',['po:attempt:t:'+f.restaurant])).rows[0].n).toBe('0');
  });

  it('exposes only versioned order admission among placement RPCs and denies direct inserts', async () => {
    for(const role of ['anon','authenticated']) {
      const entrypoints=(await db.query(`select p.proname,p.oid::regprocedure::text signature
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and (p.proname like 'place_public_order%' or p.proname='place_order')
          and has_function_privilege($1,p.oid,'EXECUTE') order by 2`,[role])).rows;
      expect(entrypoints.map(r=>r.proname)).toEqual(['place_public_order_attempt']);
      for(const table of ['orders','order_items']) {
        expect((await db.query("select has_table_privilege($1,$2,'INSERT') allowed",[role,'public.'+table])).rows[0].allowed).toBe(false);
      }
    }
  });

  it('revokes bypassing table privileges from current client roles and preserves kitchen status updates', async () => {
    const serverVersion = Number((await db.query('show server_version_num')).rows[0].server_version_num);
    const unsafePrivileges = ['TRUNCATE', 'REFERENCES', 'TRIGGER'];
    if (serverVersion >= 170000) unsafePrivileges.push('MAINTAIN');

    const leaked = await db.query(`
      select r.rolname, c.relname, p.privilege_name
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        cross join (values ('anon'), ('authenticated')) as r(rolname)
        cross join unnest($1::text[]) as p(privilege_name)
       where n.nspname = 'public'
         and c.relkind in ('r', 'p')
         and has_table_privilege(r.rolname, c.oid, p.privilege_name)
       order by r.rolname, c.relname, p.privilege_name`, [unsafePrivileges]);
    expect(leaked.rows).toEqual([]);

    // This assertion covers the standard migration owner (postgres). The test
    // near the beginning of this suite separately exercises the owner-correct
    // supabase_admin step and objects created under both owners.
    const defaultAclLeak = await db.query(`
      select acl.grantee, acl.privilege_type
        from pg_catalog.pg_default_acl d
        cross join lateral aclexplode(d.defaclacl) acl
       where d.defaclrole = (select oid from pg_catalog.pg_roles where rolname = current_user)
         and d.defaclnamespace = 'public'::regnamespace
         and d.defaclobjtype = 'r'
         and acl.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
         and acl.privilege_type = any($1::text[])
       order by acl.grantee, acl.privilege_type`, [unsafePrivileges]);
    expect(defaultAclLeak.rows).toEqual([]);

    expect((await db.query("select has_column_privilege('authenticated','public.orders','prep_status','UPDATE') allowed")).rows[0].allowed).toBe(true);
    expect((await db.query("select has_column_privilege('authenticated','public.orders','total_paise','UPDATE') allowed")).rows[0].allowed).toBe(false);
    expect((await db.query("select has_column_privilege('anon','public.orders','prep_status','UPDATE') allowed")).rows[0].allowed).toBe(false);
  });

  it('prices orders from the database and attaches a durable sitting', async()=>{
    const row=(await db.query('select subtotal_paise,total_paise,order_session_id from orders where id=$1',[a.order])).rows[0];
    expect(row.subtotal_paise).toBe('25000');expect(row.total_paise).toBe('25000');expect(row.order_session_id).toBe(a.sitting);
  });
  it('isolates tenant order reads, including users who know the other UUID',async()=>{
    await asStaff(a.user,async()=>{
      expect((await db.query('select id from orders where id=$1',[a.order])).rowCount).toBe(1);
      expect((await db.query('select id from orders where id=$1',[b.order])).rowCount).toBe(0);
    });
  });
  it('aggregates floor-plan activity without bypassing tenant RLS', async()=>{
    await asStaff(a.user, async()=>{
      expect((await db.query('select * from table_order_activity($1)',[a.restaurant])).rows[0].order_count).toBe('1');
      expect((await db.query('select * from table_order_activity($1)',[b.restaurant])).rowCount).toBe(0);
    });
  });
  it('requires membership for voice budgets and enforces the shared fixed user quota', async()=>{
    await expect(asStaff(b.user,()=>db.query('select * from reserve_staff_tts_attempt($1)',[a.restaurant]))).rejects.toMatchObject({code:'42501'});
    expect((await db.query("select has_function_privilege('anon','public.reserve_staff_tts_attempt(uuid)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
    await asStaff(a.user,async()=>{
      for(let n=0;n<30;n++) expect((await db.query('select * from reserve_staff_tts_attempt($1)',[a.restaurant])).rows[0].allowed).toBe(true);
      const denied=(await db.query('select * from reserve_staff_tts_attempt($1)',[a.restaurant])).rows[0];
      expect(denied.allowed).toBe(false);expect(denied.retry_after_seconds).toBeGreaterThan(0);
    });
  });
  it('shares the voice quota atomically across separate database clients', async()=>{
    const c=await fixture();const clients=Array.from({length:40},()=>new Client({connectionString:URL_VALUE}));
    await Promise.all(clients.map(client=>client.connect()));
    try {
      const results=await Promise.all(clients.map(async client=>{
        await client.query('begin');
        await client.query("select set_config('request.jwt.claim.sub',$1,true)",[c.user]);
        await client.query('set local role authenticated');
        const row=(await client.query('select * from reserve_staff_tts_attempt($1)',[c.restaurant])).rows[0];
        await client.query('commit');return row.allowed;
      }));
      expect(results.filter(Boolean)).toHaveLength(30);expect(results.filter(x=>!x)).toHaveLength(10);
    }finally{await Promise.all(clients.map(client=>client.end()));}
  });
  it('probes operational schema without granting service-role access to invoices', async()=>{
    await db.query('begin');
    try {
      await db.query('set local role service_role');
      const result=(await db.query('select operational_schema_readiness() ready')).rows[0].ready;
      expect(Object.values(result)).toEqual(Array(5).fill(true));
      expect((await db.query("select has_table_privilege('service_role','public.restaurant_invoices','SELECT') allowed")).rows[0].allowed).toBe(false);
    }finally{await db.query('rollback');}
    expect((await db.query("select has_function_privilege('anon','public.operational_schema_readiness()','EXECUTE') allowed")).rows[0].allowed).toBe(false);
  });
  it('denies direct financial-state changes even to the tenant owner',async()=>{
    await expect(asStaff(a.user,()=>db.query("update orders set payment_status='paid' where id=$1",[a.order]))).rejects.toMatchObject({code:'42501'});
  });
  it('allows forward kitchen progress but rejects skipping/backtracking',async()=>{
    await asStaff(a.kitchen,async()=>{expect((await db.query("update orders set prep_status='preparing' where id=$1 returning prep_status",[a.order])).rows[0].prep_status).toBe('preparing');});
    await expect(asStaff(a.kitchen,()=>db.query("update orders set prep_status='served' where id=$1",[a.order]))).rejects.toMatchObject({code:'42501'});
  });
  it('does not allow a held ticket to bypass table confirmation',async()=>{
    await db.query('update orders set hold_required=true where id=$1',[a.order]);
    try { await expect(asStaff(a.kitchen,()=>db.query("update orders set prep_status='preparing' where id=$1",[a.order]))).rejects.toMatchObject({code:'42501'}); }
    finally { await db.query('update orders set hold_required=false where id=$1',[a.order]); }
  });
  it('revokes every retired placement overload even when the four-argument signature is absent',async()=>{
    await db.query('begin');
    try {
      await db.query('drop function if exists public.place_order(text,text,jsonb,text)');
      await db.query(`create function public.place_order(text,jsonb,text) returns text language sql as $$ select 'test-only'::text $$;
        grant execute on function public.place_order(text,jsonb,text) to public,anon,authenticated;`);
      await db.query(await readFile('supabase/migrations/20261109000400_order_write_boundary.sql','utf8'));
      for (const role of ['anon','authenticated']) {
        expect((await db.query("select has_function_privilege($1,'public.place_order(text,jsonb,text)','EXECUTE') allowed",[role])).rows[0].allowed).toBe(false);
      }
      await db.query('drop function public.place_order(text,jsonb,text)');
      // Zero legacy overloads must be a safe no-op too.
      await db.query(await readFile('supabase/migrations/20261109000400_order_write_boundary.sql','utf8'));
    } finally { await db.query('rollback'); }
  });
  it('does not expose the legacy order entrypoint or caller-selected rate budgets',async()=>{
    const row=(await db.query(`select has_function_privilege('anon','public.place_order(text,text,jsonb,text)','EXECUTE') legacy,
      has_function_privilege('anon','public.hit_rate_limit(text,integer,integer)','EXECUTE') limiter`)).rows[0];
    expect(row).toEqual({legacy:false,limiter:false});
  });
  it('refuses cross-tenant and kitchen settlement at the SQL boundary',async()=>{
    await expect(asStaff(b.user,()=>db.query('select mark_order_session_paid($1)',[a.sitting]))).rejects.toMatchObject({code:'42501'});
    await expect(asStaff(a.kitchen,()=>db.query('select mark_order_session_paid($1)',[a.sitting]))).rejects.toMatchObject({code:'42501'});
  });
  it('blocks manual settlement and cancellation while an online attempt is in flight',async()=>{
    const payment=(await db.query("insert into payments(restaurant_id,order_id,method,status,amount_paise) values($1,$2,'online','pending',25000) returning id",[a.restaurant,a.order])).rows[0].id;
    try {
      await expect(asStaff(a.user,()=>db.query('select mark_order_session_paid($1)',[a.sitting]))).rejects.toThrow(/online payment/i);
      await expect(asStaff(a.user,()=>db.query('select cancel_order($1,null,null)',[a.order]))).rejects.toThrow(/online payment/i);
    } finally {await db.query('delete from payments where id=$1',[payment]);}
  });
  it('settles a table once, issues a durable invoice, and returns the same invoice on retry',async()=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a.user]);
    await db.query('select mark_order_session_paid($1)',[a.sitting]);
    await db.query('select mark_order_session_paid($1)',[a.sitting]);
    expect((await db.query('select count(*)::int n from payments where order_id=$1',[a.order])).rows[0].n).toBe(1);
    expect((await db.query(`select actor_id,event_type,method,amount_paise from payment_audit_events where order_id=$1`,[a.order])).rows)
      .toEqual([{actor_id:a.user,event_type:'manual_marked_paid',method:'manual',amount_paise:'25000'}]);
    const issued=(await db.query('select close_order_session_and_issue_receipt($1) id',[a.sitting])).rows[0].id;
    expect((await db.query('select close_order_session_and_issue_receipt($1) id',[a.sitting])).rows[0].id).toBe(issued);
    const invoice=(await db.query('select invoice_number,totals_snapshot from restaurant_invoices where id=$1',[issued])).rows[0];
    expect(invoice.invoice_number).toMatch(/^INV\/\d\d-\d\d\/\d{6}$/);
    expect(invoice.totals_snapshot.total_paise).toBe(25000);
    await expect(asStaff(a.user,()=>db.query("update restaurant_invoices set seller_snapshot='{}' where id=$1",[issued]))).rejects.toMatchObject({code:'42501'});
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  });
  it('removes a zero-quantity line without violating the positive-quantity constraint', async()=>{
    const c=await fixture();
    await db.query("insert into order_items(order_id,name_snapshot,unit_price_paise,qty) values($1,'Second dish',10000,1)",[c.order]);
    await db.query('update orders set subtotal_paise=35000,total_paise=35000 where id=$1',[c.order]);
    const line=(await db.query("select id from order_items where order_id=$1 and name_snapshot='Dish'",[c.order])).rows[0].id;
    await asStaff(c.user,async()=>{
      const result=await db.query('select set_order_line_quantities($1,$2::jsonb,null) result',[c.order,JSON.stringify([{line_id:line,qty:0}])]);
      expect(result.rows[0].result.total_paise).toBe(10000);
      expect((await db.query('select count(*)::int n from order_items where order_id=$1',[c.order])).rows[0].n).toBe(1);
    });
    await expect(asStaff(c.user,()=>db.query('select set_order_line_quantities($1,$2::jsonb,null)',[c.order,JSON.stringify([{line_id:randomUUID(),qty:1}])]))).rejects.toMatchObject({code:'22023'});
  });

  it('keeps checkout open until every active ticket is fully paid and snapshots the settled balance', async()=>{
    const c=await fixture();
    const secondCode=(await db.query('select place_public_order($1,$2::jsonb,null,$3,$4::uuid,null) code',
      [c.slug,JSON.stringify([{itemId:c.item,qty:1}]),c.sessionToken,randomUUID()])).rows[0].code;
    const secondOrder=(await db.query('select id from orders where restaurant_id=$1 and code=$2',[c.restaurant,secondCode])).rows[0].id;

    await withActor(c.user,async()=>{
      await expect(db.query('select close_order_session_and_issue_receipt($1)',[c.sitting])).rejects.toThrow(/outstanding balance/i);
    });
    expect((await db.query('select status from order_sessions where id=$1',[c.sitting])).rows[0].status).toBe('open');
    expect((await db.query('select count(*)::int n from restaurant_invoices where order_session_id=$1',[c.sitting])).rows[0].n).toBe(0);

    const invoice=await withActor(c.user,async()=>{
      await db.query('select record_counter_payment($1,$2,$3,$4,$5)',[c.slug,c.order,'cash',25000,randomUUID()]);
      await db.query('select record_counter_payment($1,$2,$3,$4,$5)',[c.slug,secondOrder,'upi',12500,randomUUID()]);
      return (await db.query('select close_order_session_and_issue_receipt($1) id',[c.sitting])).rows[0].id as string;
    });
    const snapshot=(await db.query('select totals_snapshot from restaurant_invoices where id=$1',[invoice])).rows[0].totals_snapshot;
    expect(snapshot).toMatchObject({total_paise:37500,amount_paid_paise:37500,outstanding_paise:0,payment_status:'paid'});
    expect((await withActor(c.user,()=>db.query('select close_order_session_and_issue_receipt($1) id',[c.sitting]))).rows[0].id).toBe(invoice);
    expect((await db.query('select count(*)::int n from restaurant_invoice_lines where invoice_id=$1',[invoice])).rows[0].n).toBe(2);

    await withActor(c.user,async()=>{
      await expect(db.query('select cancel_order($1,null,null)',[c.order])).rejects.toThrow(/already been paid/i);
      const line=(await db.query('select id from order_items where order_id=$1',[c.order])).rows[0].id;
      await expect(db.query('select set_order_line_quantities($1,$2::jsonb,null)',[c.order,JSON.stringify([{line_id:line,qty:1}])])).rejects.toThrow(/already been paid/i);
    });
    expect((await db.query('select total_paise from orders where id=$1',[c.order])).rows[0].total_paise).toBe('25000');
    expect((await db.query('select totals_snapshot from restaurant_invoices where id=$1',[invoice])).rows[0].totals_snapshot).toEqual(snapshot);
  });
  it('keeps concurrent duplicate and distinct submissions correct under a bounded local workload', async()=>{
    const c=await fixture();const duplicate=randomUUID();const clients=Array.from({length:16},()=>new Client({connectionString:URL_VALUE}));
    await Promise.all(clients.map(client=>client.connect()));
    const sql='select place_public_order($1,$2::jsonb,null,$3,$4::uuid,null) code';
    const args=[c.slug,JSON.stringify([{itemId:c.item,qty:1}]),c.sessionToken];
    const times:number[]=[];
    try {
      const codes=await Promise.all(clients.map(async client=>{const t=performance.now();const result=await client.query(sql,[...args,duplicate]);times.push(performance.now()-t);return result.rows[0].code;}));
      expect(new Set(codes).size).toBe(1);
      const distinct=await Promise.all(clients.map(client=>client.query(sql,[...args,randomUUID()])));
      expect(new Set(distinct.map(r=>r.rows[0].code)).size).toBe(16);
      expect((await db.query('select count(*)::int n,count(distinct order_session_id)::int sittings from orders where restaurant_id=$1',[c.restaurant])).rows[0]).toEqual({n:18,sittings:1});
      times.sort((a,b)=>a-b);console.log('LOCAL_DB_WORKLOAD',JSON.stringify({concurrentClients:16,duplicateSubmissions:16,distinctSubmissions:16,duplicateP95Ms:Math.round(times[15]),capacityClaim:false}));
    } finally {await Promise.all(clients.map(client=>client.end()));}
  },30000);

  it('makes expired trials read-only in SQL, not just in the UI',async()=>{
    await db.query("update restaurants set trial_started_at=now()-interval '10 days' where id=$1",[b.restaurant]);
    await asStaff(b.user,async()=>{expect((await db.query("update orders set prep_status='preparing' where id=$1 returning id",[b.order])).rowCount).toBe(0);});
  });
});
