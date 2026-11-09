import { randomUUID } from 'node:crypto';
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
describe.skipIf(!URL_VALUE)('native PostgreSQL commercial boundary regression', () => {
  let a: Fixture, b: Fixture;
  beforeAll(async()=> { db=new Client({connectionString:URL_VALUE});await db.connect();a=await fixture();b=await fixture(); },30000);
  beforeEach(async()=>{await db.query("select set_config('request.jwt.claim.sub','',false)");});
  afterAll(async()=>{if(db)await db.end();});
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
    await db.query("update restaurants set trial_started_at=now()-interval '10 days' where id=$1",[b.restaurant]);
    await asStaff(b.user,async()=>{expect((await db.query("update orders set prep_status='preparing' where id=$1 returning id",[b.order])).rowCount).toBe(0);});
  });
});
