/** Real issuance / ACL / row locks in disposable PostgreSQL only. No network
 * provider or Auth server involved. The issuer and worker role are distinct. */
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syntheticGstin, SYNTHETIC_BUYER, SYNTHETIC_FSSAI, SYNTHETIC_SERVICE_SAC } from '@/lib/gst/test-fixtures';
import { prepareEinvoicePayload } from '@/lib/gst/einvoice';
import { toValidatedInv01 } from '@/lib/gst/irp/inv01';
import { IrpWorker, postgresExecutionStore } from '@/lib/gst/irp/execution/worker';
import { simulationAdapter, type SimRegistration, type SimulationRegistry } from '@/lib/gst/irp/execution/simulator';
import { signerId } from '@/lib/gst/irp/execution/verification';
import { verifiedJwsObject } from '@/lib/gst/irp/provider';
import { irpRegisterCsv, parseIrpRegister } from './irp-register';

const url = process.env.READINESS_DB_URL;
const CLOCK_ONLY=process.env.READINESS_IRP_CLOCK_ONLY==='1';
if (url) {
  const u=new URL(url);
  if (!['postgres:','postgresql:'].includes(u.protocol) || !['127.0.0.1','localhost','[::1]'].includes(u.hostname)
    || !/^\/autodine_check_[a-f0-9]+$/.test(u.pathname) || u.search || u.hash) throw new Error('IRP test requires a disposable loopback database');
}
const buyer={name:'Synthetic IRP buyer',gstin:SYNTHETIC_BUYER,address:'2 Synthetic Test Lane',location:'Synthetic City',pincode:'560001',state_code:'29'};
let admin:Client;
let keyPair:ReturnType<typeof generateRsa>;
let sellerSeq=0;
function generateRsa() { return generateKeyPairSync('rsa',{modulusLength:2048}); }
const val=async(c:Client,text:string,args:unknown[]=[])=>(await c.query(text,args)).rows[0]?.value;
const fresh=async()=>{ const c=new Client({connectionString:url}); await c.connect(); return c; };
async function as<T>(role:string,actor:string|null,run:(c:Client)=>Promise<T>) {
  if (!['anon','authenticated','service_role','irp_local_worker_fixture','irp_local_provider_fixture'].includes(role)) throw new Error('Invalid fixture role');
  const c=await fresh();
  try {
    await c.query('begin');
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor??'']);
    const out=await run(c); await c.query('commit'); return out;
  } catch (e) { await c.query('rollback'); throw e; }
  finally { await c.end(); }
}
const ownerSql=(owner:string,text:string,args:unknown[]=[])=>as('authenticated',owner,c=>val(c,text,args));
const testStore=()=>postgresExecutionStore((text,params)=>as('irp_local_worker_fixture',null,c=>val(c,text,params)));
/** A synthetic provider transaction is independent of every worker claim
 * and survives its connection closing. The provider role has no job grants. */
function registry(): SimulationRegistry {
  const provider=<T>(run:(c:Client)=>Promise<T>)=>as('irp_local_provider_fixture',null,run);
  const lookup=(clause:'document_key'|'reference',id:string)=>provider(c=>
    val(c,`select record as value from irp_fixture.registry where ${clause}=$1`,[id])).then(r=>r as SimRegistration??null);
  return {
    findByKey:key=>lookup('document_key',key), findByReference:ref=>lookup('reference',ref),
    async insertIfAbsent(entry) {
      return provider(async c=>(await c.query(`insert into irp_fixture.registry values($1,$2,$3)
        on conflict(document_key) do nothing`,[entry.documentKey,entry.reference,entry])).rowCount===1);
    },
    async cancelUnlessCancelled(ref,at) {
      return provider(async c=>await val(c,`update irp_fixture.registry set record=record||jsonb_build_object('cancelledAt',$2::text)
        where reference=$1 and record->>'cancelledAt' is null returning record as value`,[ref,at])??null);
    },
  };
}
const adapter = (behavior?:Parameters<typeof simulationAdapter>[0]['behavior']) => simulationAdapter({keyPair,registry:registry(),behavior});
const worker=(behavior?:Parameters<typeof adapter>[0])=>new IrpWorker(testStore(),[adapter(behavior)]);

async function setup() {
  admin=await fresh(); keyPair=generateRsa();
  await admin.query(`create schema irp_fixture;
    create table irp_fixture.registry(document_key text primary key,reference text unique,record jsonb not null);
    create role irp_local_provider_fixture nologin;
    grant usage on schema irp_fixture to irp_local_provider_fixture;
    grant select,insert,update(record) on irp_fixture.registry to irp_local_provider_fixture;
    create role irp_local_worker_fixture nologin;
    grant usage on schema public to irp_local_worker_fixture;
    grant execute on function public.claim_irp_dispatch(uuid,uuid,uuid),public.sweep_irp_leases(uuid,uuid),
      public.finish_irp_dispatch(uuid,uuid,text,integer,text,jsonb) to irp_local_worker_fixture;`);
}
function indiaDay() {return val(admin,"select ((clock_timestamp() at time zone 'Asia/Kolkata')::date)::text as value") as Promise<string>;}
async function addStaff(outlet:string,user:string,role:string) {
  await admin.query('insert into profiles(id) values($1) on conflict do nothing',[user]);
  await admin.query('insert into memberships(restaurant_id,user_id,role) values($1,$2,$3)',[outlet,user,role]);
}
async function makeOutlet(aato:number|null=6_000_000_000, sellerBase?:string) {
  const owner=randomUUID(), slug=`irp-test-${randomUUID().slice(0,10)}`;
  const gstin=syntheticGstin(sellerBase??`27ZZIRN${String(++sellerSeq).padStart(4,'0')}A1Z`);
  const outlet=await val(admin,`insert into restaurants(slug,name,address,phone,tax_rate_bps,guest_verification_mode)
    values($1,'Synthetic IRP Test Kitchen','1 Synthetic Test Lane','07120000000',0,'scan') returning id value`,[slug]);
  await addStaff(outlet,owner,'owner');
  if (CLOCK_ONLY) await admin.query("update restaurants set plan='starter',plan_status='active' where id=$1",[outlet]);
  const config={mode:'regular',regular_profile:'other_than_specified_premises',registration_type:'regular',gstin,
    legal_name:'Synthetic IRP Supplier',address:'1 Synthetic Test Lane',business_type:'standalone',fssai_number:SYNTHETIC_FSSAI,
    service_sac:SYNTHETIC_SERVICE_SAC,einvoice_location:'Nagpur',einvoice_pincode:'440001',einvoice_hsn_sac:SYNTHETIC_SERVICE_SAC};
  const save=async(highest:number|null,rev:number)=>ownerSql(owner,'select save_restaurant_gst_config($1,$2,$3) value',[outlet,rev,{...config,
    activation:{confirm:true,effective_from:await indiaDay(),premises_address:config.address,premises_state_code:'27',invoice_phone:'07120000000',
      series_confirmed:true,external_prefixes:[],series:{INV:'INV',BOS:'BOS',RBL:'RBL',CN:'CN',DN:'DN'},
      aato:highest===null?null:{highest_prior_fy_paise:highest,reference:'Synthetic full PAN review',reporting_category:highest>=10_000_000_000?'at_least_10cr':'under_10cr'}},
  }]);
  const cfg=await save(aato,0);
  const menu=await val(admin,"insert into menus(restaurant_id,name,is_published) values($1,'Main',true) returning id value",[outlet]);
  const cat=await val(admin,"insert into categories(restaurant_id,menu_id,name) values($1,$2,'Main') returning id value",[outlet,menu]);
  const item=await val(admin,"insert into items(restaurant_id,category_id,name,price_paise) values($1,$2,'Plate',10511) returning id value",[outlet,cat]);
  const route=await val(admin,`insert into irp_routes(outlet_id,seller_gstin,tier,provider_key,api_version,schema_version,signer_fingerprint,available,interval_ms)
    values($1,$2,'simulation','sim-local','synthetic-1','1.1',$3,true,50) returning id value`,[outlet,gstin,signerId(keyPair.publicKey)]);
  const choose=(choice:string|null,revision:number)=>ownerSql(owner,'select choose_irp_route($1,$2,$3) value',[outlet,choice,revision]);
  async function issue(recipient:unknown=buyer) {
    const table=await val(admin,"insert into dining_tables(restaurant_id,label) values($1,$2) returning id value",[outlet,`IRP ${randomUUID().slice(0,8)}`]);
    const qr=await val(admin,'select public_token value from table_qr_codes where table_id=$1 and revoked_at is null',[table]);
    const code=await as('anon',null,async c=>{
      const token=await val(c,'select session_token value from open_table_session($1,$2)',[qr,'b'.repeat(64)]);
      const result=await val(c,'select place_public_order_attempt($1,$2::jsonb,null,$3,$4::uuid,null) value',
        [slug,JSON.stringify([{itemId:item,qty:1}]),token,randomUUID()]);
      expect(result.error).toBeNull(); return result.code;
    });
    const sitting=await val(admin,'select order_session_id value from orders where restaurant_id=$1 and code=$2',[outlet,code]);
    await ownerSql(owner,'select mark_order_session_paid($1) value',[sitting]);
    return ownerSql(owner,'select close_order_session_and_issue_receipt($1,$2) value',[sitting,recipient]) as Promise<string>;
  }
  const issueNote=(original:string,kind='credit_note')=>ownerSql(owner,'select issue_invoice_note($1,$2,$3,$4) value',
    [original,kind,'other','Synthetic adjustment only']) as Promise<string>;
  async function prepare(id:string,kind:'invoice'|'note'='invoice') {
    const t=kind==='invoice'?'restaurant_invoices':'restaurant_notes';
    const row=await val(admin,`select to_jsonb(i) value from ${t} i where id=$1`,[id]);
    const g=row.gst_snapshot, s=row.seller_snapshot, c=row.customer_snapshot, total=row.totals_snapshot;
    const original=kind==='note'?await val(admin,'select to_jsonb(i) value from restaurant_invoices i where id=$1',[row.invoice_id]):null;
    const lines=(await admin.query('select line_snapshot s from restaurant_invoice_lines where invoice_id=$1 order by line_number',[original?.id??id])).rows;
    const prepared=prepareEinvoicePayload({ profile:{mode:g.mode,registrationType:s.registration_type,gstin:s.gstin,legalName:s.legal_name,tradeName:null,
      address:s.address,stateCode:s.state_code,einvoiceLocation:s.einvoice_location,einvoicePincode:s.einvoice_pincode,
      einvoiceHsnSac:g.service_sac,precedingFyTurnoverPaise:null}, invoice:{
      status:row.status,irpStatus:row.irp_status,documentType:row.document_type,issuedLocalDate:g.issued_local_date,invoiceNumber:row.invoice_number??row.document_number,
      ...(original?{originalInvoice:{documentType:'INV',documentNumber:original.invoice_number,issuedDate:original.gst_snapshot.issued_local_date}}:{}),
      irpEvidence:{applicability:g.irp_evidence?.applicability,reportingCategory:g.irp_evidence?.reporting_category},
      seller:{name:s.name,tradeName:null,address:s.address,phone:s.phone},recipient:{name:c?.name,gstin:c?.gstin,address:c?.address,location:c?.location,pincode:c?.pincode,
        email:c?.email??null,phone:c?.phone},
      gst:{rateBps:g.rate_bps,taxablePaise:g.taxable_paise,cgstPaise:g.cgst_paise,sgstPaise:g.sgst_paise,igstPaise:g.igst_paise,placeOfSupplyStateCode:g.place_of_supply_state_code},
      totals:{taxPaise:total.tax_paise,subtotalPaise:total.subtotal_paise??total.source_total_paise,totalPaise:total.total_paise},
      lines:lines.map(({s})=>({itemName:s.item_name,quantity:s.quantity,unitPricePaise:s.unit_price_paise,amountPaise:s.amount_paise})),
    }});
    if (!prepared.ok) throw new Error(prepared.error);
    const wire=toValidatedInv01(prepared.payload);
    const draft=await ownerSql(owner,'select record_gst_irp_preflight($1,$2,$3,$4,$5) value',[outlet,id,kind,prepared.payload.fingerprintSha256,wire]);
    return {id:draft.id as string, wire,source:row};
  }
  const queue=(id:string,actor=owner)=>ownerSql(actor,'select queue_irp_dispatch($1,$2) value',[outlet,id]) as Promise<string>;
  const state=(id:string,actor=owner)=>ownerSql(actor,'select read_irp_dispatch($1,$2) value',[outlet,id]);
  const request=(id:string,revision:number,operation:string,reason:string|null=null,actor=owner)=>
    ownerSql(actor,'select request_irp_dispatch_action($1,$2,$3,$4,$5) value',[outlet,id,revision,operation,reason]);
  const run=(job?:string,behavior?:Parameters<typeof adapter>[0])=>worker(behavior).one(outlet,route,job);
  const due=async(job:string)=>{
    // Fixture-only monotonic delay advancement, not a public retry override.
    await admin.query("update irp_dispatches set next_action_at=clock_timestamp()-interval '1 second' where id=$1",[job]);
    await admin.query("update irp_routes set next_slot='-infinity' where id=$1",[route]);
  };
  return {owner,outlet,gstin,route,choose,issue,issueNote,save,cfg,prepare,queue,state,request,run,due};
}
async function queued(aato?:number) {
  const f=await makeOutlet(aato), source=await f.issue(), draft=await f.prepare(source);
  await f.choose(f.route,0);
  const id=await f.queue(draft.id);
  return {...f,source,draft,id};
}

const readPublic=(hash:string)=>as('anon',null,c=>val(c,'select read_shared_restaurant_invoice($1) value',[hash]));
const assertNullLegalCopy=async(f:Awaited<ReturnType<typeof queued>>)=>{
  expect(await ownerSql(f.owner,"select read_active_irp_document($1,$2,'invoice') value",[f.outlet,f.source])).toBeNull();
  await expect(ownerSql(f.owner,'select create_restaurant_invoice_share_link($1,$2) value',[f.source,randomBytes(32).toString('hex')])).rejects.toThrow(/IRN hold/i);
  expect(await val(admin,'select irn value from restaurant_invoices where id=$1',[f.source])).toBeNull();
};

describe.skipIf(!url||CLOCK_ONLY)('Durable local IRP execution (PostgreSQL)',()=>{
  beforeAll(setup,20_000);
  afterAll(async()=>{ await admin?.end(); });
  it('has no route until provisioned and restricts every operation/report by tenant, role and worker grant',async()=>{
    const a=await makeOutlet(), b=await makeOutlet(), source=await a.issue(), draft=await a.prepare(source);
    const manager=randomUUID(), cashier=randomUUID();
    await addStaff(a.outlet,manager,'manager'); await addStaff(a.outlet,cashier,'cashier'); await addStaff(b.outlet,a.owner,'owner');
    await expect(a.queue(draft.id)).rejects.toThrow(/compatible route/i);
    await expect(a.choose(b.route,0)).rejects.toMatchObject({code:'23514'});
    await expect(ownerSql(manager,'select choose_irp_route($1,$2,0) value',[a.outlet,a.route])).rejects.toMatchObject({code:'42501'});
    expect(await a.choose(a.route,0)).toBe(1);
    await expect(a.choose(null,0)).rejects.toMatchObject({code:'40001'});
    const job=await a.queue(draft.id);
    await expect(a.queue(draft.id,manager)).rejects.toMatchObject({code:'42501'});
    await expect(a.request(job,0,'retry',null,manager)).rejects.toMatchObject({code:'42501'});
    await expect(b.queue(draft.id)).rejects.toMatchObject({code:'23514'});
    expect(await b.state(job,a.owner)).toBeNull();
    expect(await a.state(job,manager)).toMatchObject({phase:'queued'});
    await expect(a.state(job,cashier)).rejects.toMatchObject({code:'42501'});
    await expect(a.state(job,b.owner)).rejects.toMatchObject({code:'42501'});
    for (const [role,actor] of [['authenticated',a.owner],['anon',null],['service_role',null]] as const) {
      for (const [sql,args] of [
        ['select claim_irp_dispatch($1,$2,$3) value',[a.outlet,a.route,job]],
        ['select sweep_irp_leases($1,$2) value',[a.outlet,a.route]],
        ['select finish_irp_dispatch($1,$2,\'verified\',0,null) value',[job,randomUUID()]],
        ['select * from irp_verified_artifacts',[]],['select * from irp_routes',[]],['select * from irp_dispatches',[]],
      ] as const) await expect(as(role,actor,c=>val(c,sql,[...args]))).rejects.toMatchObject({code:'42501'});
    }
    await expect(as('irp_local_worker_fixture',null,c=>val(c,'select * from irp_routes'))).rejects.toMatchObject({code:'42501'});
    await expect(as('irp_local_worker_fixture',null,c=>val(c,'select * from irp_fixture.registry'))).rejects.toMatchObject({code:'42501'});
    await expect(as('service_role',null,c=>val(c,'select * from irp_fixture.registry'))).rejects.toMatchObject({code:'42501'});
    await expect(as('irp_local_provider_fixture',null,c=>val(c,'select sweep_irp_leases($1,$2)',[a.outlet,a.route]))).rejects.toMatchObject({code:'42501'});
    await expect(val(admin,`insert into irp_routes(outlet_id,seller_gstin,tier,provider_key,api_version,schema_version,signer_fingerprint,available)
      values($1,$2,'authority','not-approved','example','1.1',$3,true) returning id value`,[a.outlet,a.gstin,signerId(keyPair.publicKey)])).rejects.toMatchObject({code:'23514'});
    const report=await ownerSql(manager,'select report_irp_register($1) value',[a.outlet]);
    expect(report).toMatchObject({total:1,outlet:a.outlet});
    expect(await ownerSql(a.owner,'select report_irp_register($1) value',[b.outlet])).toMatchObject({total:0});
    await expect(ownerSql(cashier,'select report_irp_register($1) value',[a.outlet])).rejects.toMatchObject({code:'42501'});
  });
  it('uses known shared-PAN evidence without disclosing a second outlet or its turnover in the register',async()=>{
    const low=await makeOutlet(null,'27ZZHLD9000A1Z');
    const report=()=>ownerSql(low.owner,'select report_irp_register($1) value',[low.outlet]);
    expect(await report()).toMatchObject({eligibility:{mandate:'unknown',reporting_category:'unknown'}});
    const high=await makeOutlet(11_000_000_000,'27ZZHLD9000A2Z');
    const r=await report();
    expect(r).toMatchObject({eligibility:{mandate:'required',reporting_category:'unknown'},total:0,routes:[{id:low.route}]});
    expect(JSON.stringify(r)).not.toMatch(new RegExp(`${high.outlet}|${high.gstin}|11000000000`));
    const id=await low.issue();
    expect(await val(admin,"select gst_snapshot->'irp_evidence' value from restaurant_invoices where id=$1",[id]))
      .toMatchObject({applicability:'required',reporting_category:'unknown'});
  });
  it('accepts one signed simulation under concurrent queues and workers; preserves real copies, cents and register isolation',async()=>{
    const f=await queued();
    expect(await Promise.all([f.queue(f.draft.id),f.queue(f.draft.id)])).toEqual([f.id,f.id]);
    expect(f.draft.wire).toMatchObject({BuyerDtls:{Pos:'27',Stcd:'29'},ItemList:[{HsnCd:SYNTHETIC_SERVICE_SAC}],
      ValDtls:{TotInvVal:105.11,AssVal:100.1,CgstVal:2.51,SgstVal:2.5,IgstVal:0}});
    expect((await Promise.all([f.run(f.id),f.run(f.id)])).sort()).toEqual(['idle','recorded']);
    const d=await f.state(f.id);
    expect(d).toMatchObject({phase:'accepted',tier:'simulation',generation_attempts:1,copy:{tier:'simulation',reference:expect.stringMatching(/^SIM-/)}});
    const a=await val(admin,'select to_jsonb(a) value from irp_verified_artifacts a where dispatch_id=$1',[f.id]);
    expect(verifiedJwsObject(a.signed_invoice,keyPair.publicKey)).toMatchObject({...f.draft.wire,Simulation:true});
    expect(verifiedJwsObject(a.signed_qr,keyPair.publicKey)).toMatchObject({Irn:a.reference,Simulation:true,TotInvVal:105.11,ItemCnt:1});
    await assertNullLegalCopy(f);
    await expect(f.issueNote(f.source)).rejects.toThrow(/held/i);
    expect(await val(admin,'select to_jsonb(i) value from restaurant_invoices i where id=$1',[f.source])).toEqual(f.draft.source);
    const report=parseIrpRegister(await ownerSql(f.owner,'select report_irp_register($1) value',[f.outlet]),f.outlet);
    expect(report).toMatchObject({total:1,verifiedAuthority:0,verifiedSimulation:1,providers:[{completions:1,failures:0}]});
    const csv=irpRegisterCsv(report!.rows);
    expect(csv).toContain('"simulation","accepted","yes"');
    expect(csv).not.toContain(buyer.name); expect(csv).not.toContain(a.reference); expect(csv).not.toContain(a.signed_qr);
    expect(await ownerSql(f.owner,'select report_irp_register($1,100,null,null,true) value',[f.outlet])).toMatchObject({total:0});
    await expect(val(admin,'delete from irp_verified_artifacts where dispatch_id=$1',[f.id])).rejects.toMatchObject({code:'23514'});
    await expect(val(admin,'update irp_dispatch_events set code=\'declined\' where dispatch_id=$1',[f.id])).rejects.toMatchObject({code:'23514'});
  });
  it.each(['credit_note','debit_note'] as const)('uses the actual %s, referenced original and preserved issue amounts',async kind=>{
    const f=await makeOutlet(4_000_000_000), original=await f.issue();
    expect(await val(admin,'select irp_status value from restaurant_invoices where id=$1',[original])).toBe('not_required');
    await f.save(10_000_000_000,f.cfg);
    const note=await f.issueNote(original,kind), draft=await f.prepare(note,'note');
    expect(draft.wire).toMatchObject({DocDtls:{Typ:kind==='credit_note'?'CRN':'DBN'},
      RefDtls:{PrecDocDtls:[{InvNo:await val(admin,'select invoice_number value from restaurant_invoices where id=$1',[original])}]},
      ValDtls:{TotInvVal:105.11}});
    await f.choose(f.route,0); const job=await f.queue(draft.id);
    expect(await f.run(job)).toBe('recorded');
    expect(await f.state(job)).toMatchObject({phase:'accepted',reporting_category:'at_least_10cr',document_id:note,kind:'note'});
    expect(await ownerSql(f.owner,"select read_active_irp_document($1,$2,'note') value",[f.outlet,note])).toBeNull();
    expect(await val(admin,'select to_jsonb(n) value from restaurant_notes n where id=$1',[note])).toEqual(draft.source);
  });
  it('recovers an abandoned provider-accepted lease through lookup; stale results and concurrent void cannot win',async()=>{
    const f=await queued();
    const store=testStore(), c=await store.claim(f.outlet,f.route,f.id);
    expect(c?.operation).toBe('generate');
    await expect(ownerSql(f.owner,'select void_restaurant_invoice($1,$2) value',[f.source,'Synthetic concurrent void'])).rejects.toThrow(/Reconcile IRP/i);
    await expect(f.request(f.id,1,'cancel','1')).rejects.toMatchObject({code:'23514'});
    // The provider transaction survived the loss of the first worker connection.
    const signal=new AbortController().signal;
    const session=await adapter().open({outlet:f.outlet,seller:f.gstin,provider:'sim-local',tier:'simulation'},signal);
    expect((await session.generate(c!.request,c!.documentKey,signal)).kind).toBe('accepted');
    expect(await store.sweep(f.outlet,f.route)).toBe(0);
    await admin.query("update irp_dispatches set lease_until=clock_timestamp()-interval '1 second' where id=$1",[f.id]);
    expect(await testStore().sweep(f.outlet,f.route)).toBe(1);
    expect(await testStore().finish(c!,{code:'declined'},0)).toBe(false);
    await expect(f.request(f.id,2,'retry')).rejects.toMatchObject({code:'23514'});
    await f.request(f.id,2,'lookup');
    expect(await f.run()).toBe('idle'); // real cooldown, cannot use fresh lease to send again
    await f.due(f.id);
    expect(await f.run()).toBe('recorded');
    expect(await f.state(f.id)).toMatchObject({phase:'accepted',generation_attempts:1,lookup_attempts:1});
    expect(await testStore().finish(c!,{code:'not_sent'},1)).toBe(false);
    await assertNullLegalCopy(f);
    if (process.env.AUTODINE_IRP_REHEARSAL_TRACE==='1') {
      const result=await f.state(f.id);
      console.log('IRP_REHEARSAL', JSON.stringify({tier:'simulation',generationClaims:result.generation_attempts,
        lookupClaims:result.lookup_attempts,legalCopy:false,events:result.events.map((e:{code:string})=>e.code)}));
    }
  });
  it('voids before dispatch without sending; stored legacy bearer still does not expose the held/voided snapshot',async()=>{
    const f=await queued(), hash=randomBytes(32).toString('hex');
    await admin.query(`insert into restaurant_invoice_share_links(restaurant_id,invoice_id,token_hash,created_by,expires_at)
      values($1,$2,$3,$4,now()+interval '1 hour')`,[f.outlet,f.source,hash,f.owner]);
    expect(await readPublic(hash)).toBeNull();
    await ownerSql(f.owner,'select void_restaurant_invoice($1,$2) value',[f.source,'Synthetic void before dispatch']);
    expect(await f.run(f.id)).toBe('idle');
    expect(await f.state(f.id)).toMatchObject({phase:'source_unavailable',generation_attempts:0,copy:null});
    expect(await readPublic(hash)).toBeNull();
  });
  it.each(['accept_then_timeout','bad_signature','wrong_document','wrong_qr'] as const)(
    'does not verify %s; signed lookup recovers the single original registration',async generate=>{
      const f=await queued(); expect(await f.run(f.id,{generate})).toBe('recorded');
      const pending=await f.state(f.id); expect(pending).toMatchObject({phase:'ambiguous',copy:null});
      expect(pending.events.at(-1).code).toBe(generate==='accept_then_timeout'?'uncertain':'invalid_reply');
      expect(await ownerSql(f.owner,'select report_irp_register($1) value',[f.outlet])).toMatchObject({verified_authority:0,verified_simulation:0});
      await expect(f.request(f.id,pending.revision,'retry')).rejects.toMatchObject({code:'23514'});
      await f.request(f.id,pending.revision,'lookup');
      await f.due(f.id); await f.run(f.id);
      expect(await f.state(f.id)).toMatchObject({phase:'accepted',generation_attempts:1,lookup_attempts:1});
    });
  it('looks up a duplicate originating outside the local dispatch without a second registration',async()=>{
    const f=await queued();
    const key=await val(admin,'select document_key value from irp_dispatches where id=$1',[f.id]);
    const signal=new AbortController().signal;
    const caller=await adapter().open({seller:f.gstin,outlet:f.outlet,provider:'sim-local',tier:'simulation'},signal);
    expect((await caller.generate(f.draft.wire,key,signal)).kind).toBe('accepted');
    await f.run();
    const result=await f.state(f.id); expect(result).toMatchObject({phase:'ambiguous',copy:null});
    expect(result.events.at(-1).code).toBe('duplicate');
    await f.request(f.id,result.revision,'lookup'); await f.due(f.id); await f.run();
    expect(await f.state(f.id)).toMatchObject({phase:'accepted',generation_attempts:1,lookup_attempts:1});
  });
  it('allows a bounded owner retry only after definitive absence or proof of no send',async()=>{
    const f=await queued(); await f.run(f.id,{generate:'unknown'});
    await f.request(f.id,2,'lookup'); await f.due(f.id); await f.run();
    expect(await f.state(f.id)).toMatchObject({phase:'retryable',revision:5,lookup_attempts:1});
    await f.request(f.id,5,'retry'); await f.due(f.id); await f.run(f.id,{generate:'not_sent'});
    expect(await f.state(f.id)).toMatchObject({phase:'retryable',revision:8,generation_attempts:2});
    await f.request(f.id,8,'retry'); await f.due(f.id); await f.run();
    expect(await f.state(f.id)).toMatchObject({phase:'accepted',generation_attempts:3,lookup_attempts:1});
  });
  it('honors a database rate slot shared across jobs on the same pinned route',async()=>{
    const f=await queued(), second=await f.issue(), draft=await f.prepare(second), job=await f.queue(draft.id);
    await admin.query('update irp_routes set interval_ms=60000 where id=$1',[f.route]);
    expect(await f.run(f.id)).toBe('recorded');
    expect(await f.run(job)).toBe('idle');
    expect(await f.state(job)).toMatchObject({phase:'queued',generation_attempts:0});
    await f.due(job);
    expect(await f.run(job)).toBe('recorded');
    expect(await f.state(job)).toMatchObject({phase:'accepted',generation_attempts:1});
  });
  it('does not change a definitive rejection into an acceptance; prevents new sends after deselection',async()=>{
    const f=await queued(); await f.choose(null,1);
    expect(await f.run()).toBe('idle');
    await f.choose(f.route,2); await f.run(f.id,{generate:'declined'});
    expect(await f.state(f.id)).toMatchObject({phase:'rejected',copy:null});
    await expect(f.request(f.id,2,'lookup')).rejects.toMatchObject({code:'23514'});
    await expect(f.request(f.id,2,'retry')).rejects.toMatchObject({code:'23514'});
    expect(await f.queue(f.draft.id)).toBe(f.id);
  });
  it('checks cancellation concurrently, after definitive decline, with an active e-way bill and lost response',async()=>{
    const f=await queued(); await f.run();
    const pay=async()=>val(admin,"select jsonb_agg(to_jsonb(p) order by p.id) value from payments p where restaurant_id=$1",[f.outlet]);
    const before=await pay();
    const race=await Promise.allSettled([f.request(f.id,2,'cancel','2'),f.request(f.id,2,'cancel','3')]);
    expect(race.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(race.find(x=>x.status==='rejected')).toMatchObject({reason:{code:'40001'}});
    expect(await f.state(f.id)).toMatchObject({phase:'cancel_queued',copy:null});
    await f.due(f.id); await f.run(f.id,{ewayBill:'active'});
    expect(await f.state(f.id)).toMatchObject({phase:'accepted',revision:5});
    await f.request(f.id,5,'cancel','2'); await f.due(f.id); await f.run(f.id,{cancel:'declined'});
    expect(await f.state(f.id)).toMatchObject({phase:'accepted',revision:8});
    await f.request(f.id,8,'cancel','3'); await f.due(f.id); await f.run(f.id,{cancel:'cancel_then_timeout'});
    expect(await f.state(f.id)).toMatchObject({phase:'cancel_ambiguous',copy:null,revision:11});
    await expect(f.request(f.id,11,'cancel','4')).rejects.toMatchObject({code:'23514'});
    await f.request(f.id,11,'lookup'); await f.due(f.id); await f.run();
    const result=await f.state(f.id);
    expect(result).toMatchObject({phase:'cancelled',copy:null,generation_attempts:1,cancellation_attempts:3,lookup_attempts:1});
    expect(result.events.map((e:{code:string})=>e.code)).toEqual(['queued','claimed','verified','owner_cancel','claimed','cancel_blocked',
      'owner_cancel','claimed','declined','owner_cancel','claimed','uncertain','owner_lookup','claimed','cancelled']);
    expect(result.events.filter((e:{code:string})=>e.code==='owner_cancel').map((e:{reason_code:string})=>e.reason_code))
      .toEqual([expect.stringMatching(/^[23]$/),'2','3']);
    expect(await val(admin,'select to_jsonb(i) value from restaurant_invoices i where id=$1',[f.source])).toEqual(f.draft.source);
    expect(await pay()).toEqual(before);
    await assertNullLegalCopy(f);
    await expect(ownerSql(f.owner,'select void_restaurant_invoice($1,$2) value',[f.source,'Synthetic void after cancellation'])).rejects.toThrow(/separate operation/i);
    expect(await val(admin,'select count(*)::integer value from restaurant_notes where invoice_id=$1',[f.source])).toBe(0);
  });
  it('rechecks write entitlement before generation and cancellation, not just when work was queued',async()=>{
    const f=await queued();
    const entitlement=(entitled:boolean)=>admin.query(`update restaurants
      set trial_started_at=now()-$2::integer*interval '1 day' where id=$1`,[f.outlet,entitled?0:22]);
    await entitlement(false);
    expect(await f.run(f.id)).toBe('idle');
    expect(await f.state(f.id)).toMatchObject({phase:'queued',generation_attempts:0});
    await entitlement(true);
    expect(await f.run(f.id)).toBe('recorded');
    await f.request(f.id,2,'cancel','1'); await f.due(f.id);
    await entitlement(false);
    expect(await f.run(f.id)).toBe('idle');
    expect(await f.state(f.id)).toMatchObject({phase:'cancel_queued',cancellation_attempts:0,copy:null});
    await entitlement(true);
    expect(await f.run(f.id)).toBe('recorded');
    expect(await f.state(f.id)).toMatchObject({phase:'cancelled',generation_attempts:1,cancellation_attempts:1});
  });
  it('rejects wrong cancellation reference and restores the verified active state only if lookup proves it',async()=>{
    const f=await queued(); await f.run();
    await f.request(f.id,2,'cancel','1'); await f.due(f.id); await f.run(f.id,{cancel:'unknown'});
    let d=await f.state(f.id); expect(d).toMatchObject({phase:'cancel_ambiguous',copy:null});
    await f.request(f.id,d.revision,'lookup'); await f.due(f.id); await f.run();
    d=await f.state(f.id); expect(d).toMatchObject({phase:'accepted',copy:{tier:'simulation'}});
    await f.request(f.id,d.revision,'cancel','1'); await f.due(f.id); await f.run(f.id,{cancel:'wrong_reference'});
    d=await f.state(f.id); expect(d).toMatchObject({phase:'cancel_ambiguous',copy:null});
    expect(d.events.at(-1).code).toBe('invalid_reply');
    await f.request(f.id,d.revision,'lookup'); await f.due(f.id); await f.run();
    expect(await f.state(f.id)).toMatchObject({phase:'cancelled',copy:null});
  });
});

describe.skipIf(!url||!CLOCK_ONLY)('IRP dated boundaries (controlled native clock)',()=>{
  const clockFile=process.env.FAKETIME_TIMESTAMP_FILE;
  async function shift(iso:string) {
    if (!clockFile || !/^\/tmp\/autodine-irp-clock\.[A-Za-z0-9]+\/clock$/.test(clockFile)) throw new Error('Set a disposable native clock file');
    await writeFile(clockFile+'.next',iso+'\n'); await rename(clockFile+'.next',clockFile);
  }
  beforeAll(async()=>{ await shift('2027-01-01 12:00:00'); await setup(); });
  afterAll(async()=>{ await admin?.end(); });
  it('uses India day 30 inclusively, refuses new work on day 31, and expires cancellation at exactly 24h',async()=>{
    const first=await queued(10_000_000_000), second=await queued(10_000_000_000), next=await first.issue(), draft=await first.prepare(next);
    await shift('2027-01-30 18:29:58');
    expect(await indiaDay()).toBe('2027-01-30');
    expect(await first.run()).toBe('recorded');
    const a=await first.state(first.id);
    expect(a).toMatchObject({phase:'accepted',reporting_deadline:'2027-01-30',copy:{at:'2027-01-30T18:29:58+00:00'}});
    await shift('2027-01-30 18:30:00');
    await expect(first.queue(draft.id)).rejects.toThrow(/reporting window/i);
    expect(await second.run()).toBe('idle');
    expect(await second.state(second.id)).toMatchObject({phase:'expired',generation_attempts:0});
    await shift('2027-01-31 18:29:57');
    expect(await first.request(first.id,2,'cancel','2')).toBe(3);
    await shift('2027-01-31 18:29:58');
    expect(await first.run()).toBe('idle');
    expect(await first.state(first.id)).toMatchObject({phase:'accepted',cancellation_attempts:0});
    await expect(first.request(first.id,4,'cancel','2')).rejects.toThrow(/24-hour/i);
  });
});
