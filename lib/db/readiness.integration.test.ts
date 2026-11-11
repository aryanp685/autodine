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
/**
 * Recreates a sitting from before 20261108008000: closed and invoiced while its
 * bill is still unpaid. The checkout RPC no longer produces this state -- it
 * refuses to close an unsettled table -- but rows like it already exist, and
 * later payments against their immutable receipt must stay correct. The
 * lock-order and receipt regressions below therefore build the state the way
 * the old RPC did, without the settlement gate.
 */
async function issueLegacyUnpaidReceipt(client: Client, f: Fixture): Promise<string> {
  await client.query("update order_sessions set status='closed', closed_at=statement_timestamp(), closed_by=$2 where id=$1", [f.sitting, f.user]);
  return (await client.query('select issue_closed_session_receipt($1) id', [f.sitting])).rows[0].id;
}
/**
 * The same role switch, but COMMITTED.
 *
 * asStaff() rolls back, which is right for a permission probe and wrong for
 * "the owner added an outlet": the row has to be there for the next query,
 * because a second outlet is what the account's plan is counted against.
 */
async function asStaffCommitted<T>(user: string, work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
    await db.query('set local role authenticated');
    const result = await work();
    await db.query('commit');
    return result;
  } catch (error) { await db.query('rollback'); throw error; }
  finally { await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}
async function asStaff<T>(user: string, work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
    await db.query('set local role authenticated');
    return await work();
  } finally { await db.query('rollback'); }
}
describe.skipIf(!URL_VALUE)('native PostgreSQL commercial boundary regression', () => {
  let a: Fixture, b: Fixture;
  beforeAll(async()=> { db=new Client({connectionString:URL_VALUE});await db.connect();a=await fixture();b=await fixture(); },30000);
  beforeEach(async()=>{await db.query("select set_config('request.jwt.claim.sub','',false)");});
  afterAll(async()=>{if(db)await db.end();});
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
        if(checkout) {
          await holder.query("select set_config('request.jwt.claim.sub',$1,true)",[f.user]);
          const id=await issueLegacyUnpaidReceipt(holder,f);
          invoice={id,snapshot:(await holder.query('select totals_snapshot from restaurant_invoices where id=$1',[id])).rows[0].totals_snapshot};
        }
        await holder.query('commit');
        const result=await task;
        if(checkout && ['cancel','quantities'].includes(operation)) {
          expect(result.error?.message).toMatch(/finalized invoice/i);
          await worker.query('rollback');
          expect((await db.query('select total_paise from orders where id=$1',[f.order])).rows[0].total_paise).toBe('25000');
        } else {
          expect(result.error).toBeUndefined();
          await worker.query('commit');
        }
        if(invoice) {
          expect((await db.query('select totals_snapshot from restaurant_invoices where id=$1',[invoice.id])).rows[0].totals_snapshot).toEqual(invoice.snapshot);
          if(operation === 'settle-online') {
            expect((await db.query('select count(*) n from restaurant_payment_receipts where invoice_id=$1',[invoice.id])).rows[0].n).toBe('1');
            expect((await db.query("select sum(amount_paise) paid from payments where order_id=$1 and status='recorded'",[f.order])).rows[0].paid).toBe('25000');
          }
        }
      } finally {
        await holder.query('rollback'); if(task) await task;
        await worker.query('rollback'); await holder.end(); await worker.end();
      }
    },15000);
  }

  it('refuses to close an unpaid sitting through the checkout RPC and leaves it open', async () => {
    const f=await fixture();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.user]);
    await expect(db.query('select close_order_session_and_issue_receipt($1)',[f.sitting])).rejects.toThrow(/Collect the full outstanding balance/);
    expect((await db.query('select status from order_sessions where id=$1',[f.sitting])).rows[0].status).toBe('open');
    expect((await db.query('select count(*) n from restaurant_invoices where order_session_id=$1',[f.sitting])).rows[0].n).toBe('0');
  });

  it('allows only one of two distinct full collections after invoice issuance', async () => {
    const f=await fixture();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.user]);
    const invoice=await issueLegacyUnpaidReceipt(db,f);
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
      expect((await db.query('select sequence_number from restaurant_payment_receipts where invoice_id=$1 order by sequence_number',[invoice])).rows.map(r=>r.sequence_number)).toEqual([1]);
      expect((await db.query('select totals_snapshot from restaurant_invoices where id=$1',[invoice])).rows[0].totals_snapshot).toEqual(before);
      await expect(db.query('select record_counter_payment($1,$2,$3,$4,$5)',[f.slug,f.order,'cash',1,randomUUID()])).rejects.toThrow();
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
    const f=await fixture();const ref=randomUUID();
    await db.query("insert into payments(restaurant_id,order_id,method,status,amount_paise,provider,provider_ref) values($1,$2,'online','pending',25000,'phase1',$3)",[f.restaurant,f.order,ref]);
    await expect(db.query('select settle_online_payment($1,$2,$3,$4)',['phase1',ref,'provider-'+ref,24999])).rejects.toThrow(/amount/i);
    expect((await db.query('select status,provider_payment_ref from payments where order_id=$1',[f.order])).rows[0]).toEqual({status:'pending',provider_payment_ref:null});
    expect((await db.query('select payment_status from orders where id=$1',[f.order])).rows[0].payment_status).toBe('pending');
    expect((await db.query('select count(*) n from payment_audit_events where order_id=$1',[f.order])).rows[0].n).toBe('0');
    const first=(await db.query('select settle_online_payment($1,$2,$3,$4) id',['phase1',ref,'provider-'+ref,25000])).rows[0].id;
    const second=(await db.query('select settle_online_payment($1,$2,$3,$4) id',['phase1',ref,'provider-'+ref,25000])).rows[0].id;
    expect(second).toBe(first);
    expect((await db.query('select count(*) n from payment_audit_events where order_id=$1',[f.order])).rows[0].n).toBe('1');
    expect((await db.query("select sum(amount_paise) paid from payments where order_id=$1 and status='recorded'",[f.order])).rows[0].paid).toBe('25000');
  });

  it('keeps provider settlement executable only by the service role, not guests or staff', async () => {
    for(const role of ['anon','authenticated']) {
      expect((await db.query("select has_function_privilege($1,'public.settle_online_payment(text,text,text,bigint)','EXECUTE') allowed",[role])).rows[0].allowed).toBe(false);
    }
    expect((await db.query("select has_function_privilege('service_role','public.settle_online_payment(text,text,text,bigint)','EXECUTE') allowed")).rows[0].allowed).toBe(true);
    await asStaff(a.user,async()=>{
      await expect(db.query('select settle_online_payment($1,$2,$3,$4)',['phase1','missing','missing',25000])).rejects.toMatchObject({code:'42501'});
    });
  });

  it('void-first payment race does not create a receipt against a voided invoice', async () => {
    const f=await fixture();const ref=randomUUID();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.user]);
    const invoice=await issueLegacyUnpaidReceipt(db,f);
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

  it('does not let a saturated tenant IP counter block an order on the same address', async () => {
    // The counter still exists -- it throttles SESSION MINTING, which is where
    // a shared Wi-Fi address has to be rate-limited. It must not reach the
    // order: every table on one NAT address is a different party.
    const first=await fixture(),second=await fixture();const shared='e'.repeat(64);
    await db.query('insert into rate_limit_hits(key,window_started_at,count) values($1,statement_timestamp(),60) on conflict (key) do update set count=60',
      ['po:i:'+first.restaurant+':'+shared]);
    const sql='select place_public_order($1,$2::jsonb,null,$3,$4,$5) code';
    expect((await db.query(sql,[first.slug,JSON.stringify([{itemId:first.item,qty:1}]),first.sessionToken,randomUUID(),shared])).rows[0].code).toBeTruthy();
    expect((await db.query(sql,[second.slug,JSON.stringify([{itemId:second.item,qty:1}]),second.sessionToken,randomUUID(),shared])).rows[0].code).toBeTruthy();
    expect((await db.query('select count(*) n from orders where restaurant_id=$1',[first.restaurant])).rows[0].n).toBe('2');
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
      const attempt=(await db.query('select attempt_count,blocked_until>statement_timestamp() blocked from qr_verification_attempts where qr_code_id=$1 and ip_hash=$2',[qr.id,ip])).rows[0];
      expect(attempt).toEqual({attempt_count:5,blocked:true});
      await db.query("update qr_verification_attempts set window_started_at=statement_timestamp()-interval '16 minutes',blocked_until=statement_timestamp()-interval '1 second' where qr_code_id=$1 and ip_hash=$2",[qr.id,ip]);
      const code=(await db.query('select verification_code_for(secret,floor(extract(epoch from statement_timestamp())/window_seconds)::bigint) code from restaurant_verification_codes where restaurant_id=$1',[f.restaurant])).rows[0].code;
      for(let i=0;i<2;i++) expect((await db.query('select * from verify_table_qr_with_code($1,$2,$3)',[qr.public_token,code,ip])).rows[0].status).toBe('ok');
      expect((await db.query('select count(*) n from qr_verification_attempts where qr_code_id=$1 and ip_hash=$2',[qr.id,ip])).rows[0].n).toBe('0');
    } finally {await Promise.all(clients.map(c=>c.end()));}
  },15000);

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

  // ─────────────────────────────────────────────────────────────────────────
  // Order submission is not throttled (migration 20261110000800).
  //
  // The rule: a legitimate guest order is never refused for counting. What
  // survives is everything that is not a counter -- the sitting check, the
  // QR validation, the replay path and the guest-token idempotency.
  // ─────────────────────────────────────────────────────────────────────────
  it('places every order a session submits, with no budget anywhere', async () => {
    const f = await fixture();
    const sql = 'select place_public_order_attempt($1,$2::jsonb,null,$3,$4) result';
    const lines = JSON.stringify([{ itemId: f.item, qty: 1 }]);
    const counters = "select coalesce(sum(count),0)::int n from rate_limit_hits where key like 'po:s:%' or key like 'po:t:%' or key like 'po:i:%'";
    const before = (await db.query(counters)).rows[0].n;
    const codes: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const result = (await db.query(sql, [f.slug, lines, f.sessionToken, randomUUID()])).rows[0].result;
      expect(result.error).toBeNull();
      codes.push(result.code);
    }
    // Forty separate orders, not forty refusals of the same one.
    expect(new Set(codes).size).toBe(40);
    // Ordering adds nothing to any counter. (Session minting still writes
    // po:s:/po:t:/po:i:, which is correct: that is the scan path, not the
    // order path.)
    expect((await db.query(counters)).rows[0].n).toBe(before);
    expect((await db.query("select count(*) n from rate_limit_hits where key like 'po:attempt:%'")).rows[0].n).toBe('0');
  }, 20000);

  it('ignores stale order-submission counters left by an older release', async () => {
    const f = await fixture();
    const hash = (await db.query("select encode(sha256($1::bytea),'hex') hash", [f.sessionToken])).rows[0].hash;
    const keys = [`po:attempt:s:${hash}`, `po:attempt:t:${f.restaurant}`, `po:s:${hash}`, `po:t:${f.restaurant}`];
    for (const key of keys) {
      await db.query('insert into rate_limit_hits(key,window_started_at,count) values($1,statement_timestamp(),999) on conflict (key) do update set count=999', [key]);
    }
    const result = (await db.query('select place_public_order_attempt($1,$2::jsonb,null,$3,$4) result',
      [f.slug, JSON.stringify([{ itemId: f.item, qty: 1 }]), f.sessionToken, randomUUID()])).rows[0].result;
    expect(result.error).toBeNull();
    expect(result.code).toBeTruthy();
    await db.query('delete from rate_limit_hits where key = any($1::text[])', [keys]);
  });

  it('places orders from several fresh sessions without a tenant ceiling', async () => {
    const f = await fixture();
    const qr = (await db.query('select q.public_token from table_qr_codes q join table_verification_sessions s on s.qr_code_id=q.id where q.restaurant_id=$1', [f.restaurant])).rows[0];
    const lines = JSON.stringify([{ itemId: f.item, qty: 1 }]);
    for (let i = 0; i < 5; i += 1) {
      const ip = i.toString().repeat(64);
      const token = (await db.query('select * from open_table_session($1,$2)', [qr.public_token, ip])).rows[0].session_token;
      const result = (await db.query('select place_public_order_attempt($1,$2::jsonb,null,$3,$4,$5) result', [f.slug, lines, token, randomUUID(), ip])).rows[0].result;
      expect(result.error).toBeNull();
      expect(result.code).toBeTruthy();
    }
    // One from the fixture plus five new ones.
    expect((await db.query('select count(*) n from orders where restaurant_id=$1', [f.restaurant])).rows[0].n).toBe('6');
    expect((await db.query("select count(*) n from rate_limit_hits where key like 'po:attempt:%'")).rows[0].n).toBe('0');
  }, 20000);

  it('returns malformed-order errors and denies the old public bypass', async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i += 1) {
      const result = (await db.query('select place_public_order_attempt($1,$2::jsonb,null,$3,$4) result', [f.slug, '[]', f.sessionToken, randomUUID()])).rows[0].result;
      expect(result.code).toBeNull();
      expect(result.error).toBeTruthy();
      // A validation failure is not a budget refusal.
      expect(result.error.hint).not.toBe('rate-limited');
    }
    const ok = (await db.query('select place_public_order_attempt($1,$2::jsonb,null,$3,$4) result',
      [f.slug, JSON.stringify([{ itemId: f.item, qty: 1 }]), f.sessionToken, randomUUID()])).rows[0].result;
    expect(ok.error).toBeNull();
    expect(ok.code).toBeTruthy();
    for (const role of ['anon', 'authenticated']) {
      expect((await db.query("select has_function_privilege($1,'public.place_public_order(text,jsonb,text,text,uuid,text)','EXECUTE') allowed", [role])).rows[0].allowed).toBe(false);
      expect((await db.query("select has_function_privilege($1,'public.place_public_order_attempt(text,jsonb,text,text,uuid,text)','EXECUTE') allowed", [role])).rows[0].allowed).toBe(true);
    }
    await asStaff(f.user, async () => {
      await expect(db.query('select place_public_order($1,$2::jsonb,null,$3,$4)', [f.slug, '[]', f.sessionToken, randomUUID()])).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('returns existing orders through the versioned API without writing anything', async () => {
    const f = await fixture();const key = randomUUID();
    const sql = 'select place_public_order_attempt($1,$2::jsonb,null,$3,$4) result';
    const args = [f.slug, JSON.stringify([{ itemId: f.item, qty: 1 }]), f.sessionToken, key];
    const first = (await db.query(sql, args)).rows[0].result;
    expect(first.error).toBeNull();expect(first.code).toBeTruthy();
    // The same guest token is a replay, not a new order, and it costs nothing.
    expect((await db.query(sql, args)).rows[0].result).toEqual(first);
    expect((await db.query('select count(*) n from orders where guest_token=$1', [key])).rows[0].n).toBe('1');
  });

  it('places concurrent guest orders without losing or duplicating one', async () => {
    const f = await fixture();
    const clients = Array.from({ length: 8 }, () => new Client({ connectionString: URL_VALUE }));
    try {
      await Promise.all(clients.map(async (c) => { await c.connect(); await c.query("set statement_timeout='20s'"); await c.query('set role anon'); }));
      const results = await Promise.all(clients.map(async (c) => (await c.query('select place_public_order_attempt($1,$2::jsonb,null,$3,$4) result',
        [f.slug, JSON.stringify([{ itemId: f.item, qty: 1 }]), f.sessionToken, randomUUID()])).rows[0].result));
      const codes = results.map((r) => r.code);
      expect(results.filter((r) => r.error)).toEqual([]);
      expect(new Set(codes).size).toBe(8);
      expect((await db.query('select count(*) n from orders where restaurant_id=$1', [f.restaurant])).rows[0].n).toBe('9');
    } finally { await Promise.all(clients.map((c) => c.end())); }
  }, 30000);

  it('never reintroduces an order-submission budget', async () => {
    // A guard, not a behaviour test: the five keys migrations 000300 and
    // 000400 put in front of ordering. If any of them comes back in a
    // function body, a busy table is refused food again.
    const banned = ['po:s:', 'po:t:', 'po:i:', 'po:attempt:s:', 'po:attempt:t:'];
    const rows = (await db.query(`select p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('place_public_order', 'place_public_order_attempt')`)).rows;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      for (const key of banned) expect(String(row.def)).not.toContain(key);
    }
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

  it('freezes finalized source amounts and cancellation after receipt issuance', async()=>{
    const c=await fixture();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[c.user]);
    await db.query('select mark_order_session_paid($1)',[c.sitting]);
    await db.query('select close_order_session_and_issue_receipt($1)',[c.sitting]);
    await expect(db.query('select cancel_order($1,null,null)',[c.order])).rejects.toThrow(/already been paid/i);
    await expect(db.query('select set_order_line_quantities($1,$2::jsonb,null)',[c.order,JSON.stringify([{line_id:(await db.query('select id from order_items where order_id=$1',[c.order])).rows[0].id,qty:1}])])).rejects.toThrow(/already been paid/i);
    expect((await db.query('select total_paise from orders where id=$1',[c.order])).rows[0].total_paise).toBe('25000');
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
    // The trial is 21 days (migration 20261110001000). This fixture has no
    // account link, so it exercises the legacy fallback path in
    // restaurant_can_write(), which an outlet only reaches before the
    // backfill or if it was created outside every supported path.
    await db.query("update restaurants set trial_started_at=now()-interval '25 days' where id=$1",[b.restaurant]);
    await asStaff(b.user,async()=>{expect((await db.query("update orders set prep_status='preparing' where id=$1 returning id",[b.order])).rowCount).toBe(0);});
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Model C: ONE subscription per ACCOUNT, shared by every outlet
  // (migration 20261110001000).
  // ─────────────────────────────────────────────────────────────────────────
  async function newAccount(
    plan: string | null = null,
  ): Promise<{ account: string; restaurant: string; slug: string; name: string; owner: string }> {
    const owner = randomUUID();
    const name = 'Model C ' + randomUUID();
    const slug = 'modelc-' + randomUUID();
    await db.query('insert into profiles(id) values($1)', [owner]);
    const restaurant = (await db.query('select create_account_with_restaurant($1,$2,$3,$4) id',
      [name, slug, 'Asia/Kolkata', owner])).rows[0].id;
    const account = (await db.query('select account_id from restaurants where id=$1', [restaurant])).rows[0].account_id;
    expect(account).toBeTruthy();
    if (plan) {
      await db.query(
        "update accounts set plan=$2, plan_status='active', plan_started_at=statement_timestamp(), plan_expires_at=statement_timestamp()+interval '30 days' where id=$1",
        [account, plan]);
    }
    return { account, restaurant, slug, name, owner };
  }

  describe('Model C: one subscription per account', () => {
    it('extends a running trial from its activation date and leaves an expired one expired', async () => {
      // The rule the 21-day change was approved under, run as the migration
      // runs it: the real statement, extracted from the file, against two
      // accounts -- one three days into a 7-day trial, one 30 days past it.
      const sql = await readFile(
        new URL('../../supabase/migrations/20261110001000_account_subscriptions.sql', import.meta.url),
        'utf8');
      const start = sql.indexOf('update public.accounts a\n   set trial_started_at = s.activation');
      const marker = ' where a.id = s.account_id;';
      const end = sql.indexOf(marker, start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const backfill = sql.slice(start, end + marker.length);

      async function activated(daysAgo: number): Promise<string> {
        const owner = randomUUID();
        await db.query('insert into profiles(id) values($1)', [owner]);
        const account = (await db.query(
          "insert into accounts(owner_id,plan,plan_status,trial_started_at) values($1,'trial','trialing',statement_timestamp()-make_interval(days=>$2)) returning id",
          [owner, daysAgo])).rows[0].id;
        await db.query(
          "insert into restaurants(slug,name,account_id,trial_started_at) values($1,'Backfill probe',$2,statement_timestamp()-make_interval(days=>$3))",
          ['backfill-' + randomUUID(), account, daysAgo]);
        return account;
      }
      const running = await activated(3);
      const expired = await activated(30);

      await db.query(backfill);

      const rows = (await db.query(
        'select id, account_trial_ends_at(id) trial_ends, account_can_write(id) can_write, plan_status from accounts where id = any($1::uuid[])',
        [[running, expired]])).rows;
      const byId = new Map(rows.map((row) => [row.id as string, row]));

      // Still running when the length changed: the original activation date
      // plus 21 days, so eighteen days remain.
      const runningLeft = Number((await db.query(
        'select extract(epoch from ($1::timestamptz - statement_timestamp()))/86400 days',
        [byId.get(running)?.trial_ends])).rows[0].days);
      expect(runningLeft).toBeGreaterThan(17.5);
      expect(runningLeft).toBeLessThanOrEqual(18.5);
      expect(byId.get(running)?.can_write).toBe(true);
      expect(byId.get(running)?.plan_status).toBe('trialing');

      // Already expired: it keeps the seven days it actually had. Nothing
      // here revives it.
      const expiredFor = Number((await db.query(
        'select extract(epoch from (statement_timestamp() - $1::timestamptz))/86400 days',
        [byId.get(expired)?.trial_ends])).rows[0].days);
      expect(expiredFor).toBeGreaterThan(22.5);
      expect(expiredFor).toBeLessThan(23.5);
      expect(byId.get(expired)?.can_write).toBe(false);
      expect(byId.get(expired)?.plan_status).toBe('expired');
    }, 20000);

    it('starts a new account on a 21-day trial that can write', async () => {
      const { account, restaurant, owner } = await newAccount();
      const row = (await db.query(
        "select plan, plan_status, account_trial_ends_at($1) trial_ends, account_can_write($1) can_write from accounts where id=$1",
        [account])).rows[0];
      expect(row.plan).toBe('trial');
      expect(row.plan_status).toBe('trialing');
      expect(row.can_write).toBe(true);
      const days = Number((await db.query(
        'select extract(epoch from ($1::timestamptz - statement_timestamp()))/86400 days',
        [row.trial_ends])).rows[0].days);
      expect(days).toBeGreaterThan(20.5);
      expect(days).toBeLessThanOrEqual(21);
      expect((await db.query('select restaurant_can_write($1) can', [restaurant])).rows[0].can).toBe(true);
      await asStaff(owner, async () => {
        const access = (await db.query('select restaurant_access($1) access', [restaurant])).rows[0].access;
        expect(access.plan).toBe('trial');
        expect(access.outlets.used).toBe(1);
        expect(access.outlets.limit).toBe(5);
        expect(access.can_write).toBe(true);
      });
    });

    it('shares one subscription across every outlet of the account', async () => {
      const { account, owner, restaurant } = await newAccount('professional');
      let second = '';
      await asStaffCommitted(owner, async () => {
        second = (await db.query('select create_outlet($1,$2) id', ['Second room', 'second-' + randomUUID()])).rows[0].id;
      });
      expect(second).toBeTruthy();
      expect((await db.query('select account_id from restaurants where id=$1', [second])).rows[0].account_id).toBe(account);
      expect((await db.query('select account_outlet_count($1) n', [account])).rows[0].n).toBe(2);
      // Expiring the account silences every outlet at once, and deletes none.
      await db.query("update accounts set plan_expires_at=statement_timestamp()-interval '1 day' where id=$1", [account]);
      expect((await db.query('select account_can_write($1) can', [account])).rows[0].can).toBe(false);
      expect((await db.query('select restaurant_can_write($1) can', [restaurant])).rows[0].can).toBe(false);
      expect((await db.query('select restaurant_can_write($1) can', [second])).rows[0].can).toBe(false);
      expect((await db.query('select count(*) n from restaurants where account_id=$1', [account])).rows[0].n).toBe('2');
    });

    it('caps new outlets at the plan allowance, and a downgrade keeps every existing one', async () => {
      const { account, owner } = await newAccount('professional'); // five outlets
      for (let i = 0; i < 4; i += 1) {
        await asStaffCommitted(owner, async () => {
          await db.query('select create_outlet($1,$2)', ['Outlet ' + i, 'outlet-' + randomUUID()]);
        });
      }
      expect((await db.query('select account_outlet_count($1) n', [account])).rows[0].n).toBe(5);
      await asStaff(owner, async () => {
        await expect(db.query('select create_outlet($1,$2)', ['One too many', 'over-' + randomUUID()])).rejects.toThrow(/outlet_limit/);
      });
      // Downgrade to Starter, which allows ONE outlet. Every outlet the
      // account already has stays, keeps its data and keeps taking orders;
      // only new creation is refused.
      await db.query(
        "update accounts set plan='starter', plan_status='active', plan_expires_at=statement_timestamp()+interval '30 days' where id=$1",
        [account]);
      expect((await db.query('select count(*) n from restaurants where account_id=$1', [account])).rows[0].n).toBe('5');
      expect((await db.query('select account_can_write($1) can', [account])).rows[0].can).toBe(true);
      await asStaff(owner, async () => {
        await expect(db.query('select create_outlet($1,$2)', ['Still too many', 'over2-' + randomUUID()])).rejects.toThrow(/outlet_limit/);
      });
    }, 30000);

    it('keeps subscription state out of staff hands and activation with the service role', async () => {
      const { account, owner, name } = await newAccount();
      // The table has no write policy for authenticated: a subscription is
      // not a row a member of the account may edit, whatever their role.
      await asStaff(owner, async () => {
        await expect(db.query("update accounts set plan='business', plan_status='active' where id=$1", [account]))
          .rejects.toMatchObject({ code: '42501' });
      });
      // And behind that refusal, a guard trigger in case a future policy or a
      // definer function writes the row on somebody's behalf.
      const guards = (await db.query(
        "select tgname, tgenabled from pg_trigger where tgrelid='public.accounts'::regclass and not tgisinternal")).rows;
      expect(guards.map((row) => row.tgname)).toContain('accounts_plan_guard');
      for (const guard of guards) expect(guard.tgenabled).toBe('O');
      for (const role of ['anon', 'authenticated']) {
        expect((await db.query(
          "select has_function_privilege($1,'public.admin_set_subscription(text,text,integer,integer)','EXECUTE') allowed",
          [role])).rows[0].allowed).toBe(false);
        expect((await db.query(
          "select has_function_privilege($1,'public.create_account_with_restaurant(text,text,text,uuid)','EXECUTE') allowed",
          [role])).rows[0].allowed).toBe(false);
      }
      // Manual activation records a plan. There is no provider here: this is
      // the off-line path an operator uses.
      const result = (await db.query('select admin_set_subscription($1,$2,null,1) result', [name, 'professional'])).rows[0].result;
      expect(result.plan).toBe('professional');
      expect(result.plan_status).toBe('active');
      expect(result.outlets).toBe(1);
      expect((await db.query('select account_can_write($1) can', [account])).rows[0].can).toBe(true);
      // And a trial renewal is the same call with the trial plan.
      const renewed = (await db.query('select admin_set_subscription($1,$2,21,null) result', [name, 'trial'])).rows[0].result;
      expect(renewed.plan).toBe('trial');
      expect(renewed.plan_status).toBe('trialing');
      expect(renewed.plan_expires_at).toBeNull();
    }, 20000);

    it('renews by an exact name only, and refuses a name two accounts share', async () => {
      // The name is how an operator reaches an account, so the lookup is part
      // of the authorization: it must match ONE account or none, and never
      // pick one of several. Both refusals are raised by the function, which
      // is the only place a caller cannot route around.
      const first = await newAccount();
      const second = await newAccount();
      const shared = 'Shared name ' + randomUUID();
      await db.query('update restaurants set name=$1 where id = any($2::uuid[])',
        [shared, [first.restaurant, second.restaurant]]);

      await expect(db.query('select admin_set_subscription($1,$2,21,null)', [shared, 'trial']))
        .rejects.toMatchObject({ code: 'P0001', message: expect.stringContaining('restaurant_ambiguous') });

      const nobody = 'Nobody owns this name ' + randomUUID();
      await expect(db.query('select admin_set_subscription($1,$2,21,null)', [nobody, 'trial']))
        .rejects.toMatchObject({ code: 'P0001', message: expect.stringContaining('restaurant_not_found') });

      // A refusal is a refusal: neither account was renewed, and neither lost
      // the trial it already had.
      const rows = (await db.query(
        'select plan, plan_status from accounts where id = any($1::uuid[])', [[first.account, second.account]])).rows;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.plan).toBe('trial');
        expect(row.plan_status).toBe('trialing');
      }

      // A name only one account owns still renews, and renews that account.
      const unique = 'Only mine ' + randomUUID();
      await db.query('update restaurants set name=$1 where id=$2', [unique, first.restaurant]);
      const result = (await db.query('select admin_set_subscription($1,$2,21,null) result',
        [unique, 'professional'])).rows[0].result;
      expect(result.account_id).toBe(first.account);
      expect(result.plan).toBe('professional');
      expect((await db.query('select plan from accounts where id=$1', [second.account])).rows[0].plan).toBe('trial');
    }, 20000);
  });
});
