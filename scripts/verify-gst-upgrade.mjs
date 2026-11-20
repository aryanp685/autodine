/** Synthetic data for READINESS_GST_UPGRADE=1 npm run test:db:embedded.
 * Only verify-database.mjs calls these hooks, in its disposable loopback DB.
 * Seed with the old RPCs, not inserts shaped like the desired new output. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile, rename } from 'node:fs/promises';

const rows = async (db, sql, params) => (await db.query(sql, params)).rows;
const one = async (db, sql, params) => {
  const result = await rows(db, sql, params);
  assert.equal(result.length, 1);
  return result[0];
};

async function asActor(db, user, work) {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
    await db.query(user ? 'set local role authenticated' : 'set local role anon');
    const result = await work();
    await db.query('commit');
    return result;
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

async function outlet(db, kind, tax = 0) {
  const slug = `gst-upgrade-${kind}`;
  const owner = randomUUID();
  await db.query('insert into profiles(id) values ($1)', [owner]);
  const { id } = await one(db, `insert into restaurants(slug,name,address,tax_rate_bps,guest_verification_mode)
    values ($1,'Synthetic upgrade kitchen','1 Local Test Lane',$2,'scan') returning id`, [slug, tax]);
  await db.query("insert into memberships(restaurant_id,user_id,role) values($1,$2,'owner')", [id, owner]);
  const { id: menu } = await one(db, "insert into menus(restaurant_id,name,is_published) values($1,'Legacy menu',true) returning id", [id]);
  const { id: category } = await one(db, "insert into categories(restaurant_id,menu_id,name) values($1,$2,'Mains') returning id", [id, menu]);
  const { id: item } = await one(db, "insert into items(restaurant_id,category_id,name,price_paise) values($1,$2,'Fixture plate',10511) returning id", [id, category]);
  const { id: table } = await one(db, "insert into dining_tables(restaurant_id,label) values($1,'Upgrade 1') returning id", [id]);
  const { public_token: qr } = await one(db, 'select public_token from table_qr_codes where table_id=$1 and revoked_at is null', [table]);
  return { slug, owner, id, menu, item, qr };
}

async function ticket(db, f) {
  const { session_token: token } = await asActor(db, null, () => one(db, 'select session_token from open_table_session($1,$2)', [f.qr, 'd'.repeat(64)]));
  const { result } = await asActor(db, null, () => one(db, 'select place_public_order_attempt($1,$2::jsonb,null,$3,$4::uuid,null) result',
    [f.slug, JSON.stringify([{ itemId: f.item, qty: 1 }]), token, randomUUID()]));
  assert.equal(result.error, null);
  const { code } = result;
  return (await one(db, 'select order_session_id from orders where restaurant_id=$1 and code=$2', [f.id, code])).order_session_id;
}

const paid = (db, f, sitting) => asActor(db, f.owner, () => db.query('select mark_order_session_paid($1)', [sitting]));
const issue = (db, f, sitting, buyer = null) => asActor(db, f.owner, async () =>
  (await one(db, 'select close_order_session_and_issue_receipt($1,$2::jsonb) id', [sitting, buyer && JSON.stringify(buyer)])).id);

async function snapshot(db, ids) {
  // Compare full saved rows including money and numbering, ignoring ONLY the
  // new columns. The legacy values in those columns are checked separately.
  const caColumns = ['fssai_number', 'business_type', 'service_sac', 'premises_evidence', 'retail_phone'];
  const entities = [
    ['restaurant_gst_config', 'activation', ...caColumns],
    ['restaurant_gst_config_history', 'off_declared', 'off_declared_at', 'specified_premises_effective_from', 'activation', ...caColumns],
    ['orders'], ['order_items', 'is_alcoholic_snapshot'], ['payments'], ['payment_audit_events'], ['order_sessions', 'fulfilment_kind'],
    ['restaurant_invoice_series', 'series_code'], ['restaurant_invoices', 'series_code', 'series_prefix'], ['restaurant_invoice_lines'],
    ['restaurant_invoice_share_links'], ['restaurant_invoice_share_audit'], ['restaurant_publish_history'],
  ];
  // A later migration may add a defaulted column. It is not part of the
  // fixture's evidence and must not make preserved business values look edited.
  const laterColumns = { orders: ['guest_live_version'] };
  const result = {};
  for (const [table, ...newColumns] of entities) {
    newColumns.push(...(laterColumns[table] ?? []));
    const scope = table === 'order_items'
      ? 'order_id in (select id from orders where restaurant_id=any($1::uuid[]))'
      : 'restaurant_id=any($1::uuid[])';
    result[table] = await rows(db, `select (to_jsonb(t)-$2::text[])::text as row from public.${table} t
      where ${scope} order by 1`, [ids, newColumns]);
  }
  return result;
}

export async function seedPreClassificationPublish(db) {
  const f = await outlet(db, 'catalog');
  const { id: brand } = await one(db, `insert into restaurant_brand_profiles(restaurant_id,import_id,status,name,theme,menu_id)
    values($1,$2,'draft','Legacy published brand','{"accent":"forest"}', $3) returning id`, [f.id, randomUUID(), f.menu]);
  const { result } = await asActor(db, f.owner, () => one(db, 'select publish_menu_brand_pair($1,$2) result', [f.menu, brand]));
  assert.equal(result.ok, true);
  const { item } = await one(db, `select snapshot->'menu_content'->'items'->0 item from restaurant_publish_history where restaurant_id=$1`, [f.id]);
  assert.equal(item.id, f.item);
  assert.equal(Object.hasOwn(item, 'is_alcoholic'), false);
  return f;
}

export async function seedGstUpgrade(db, catalog) {
  assert.ok(catalog, 'Missing the pre-classification catalog anchor');
  await db.query('update items set is_alcoholic=true where id=$1', [catalog.item]);
  const normal = await outlet(db, 'normal', 1200);
  const regular = await outlet(db, 'regular');
  const composition = await outlet(db, 'composition');
  // An explicit old Normal declaration exists on the live row but the old
  // history trigger did not record it. Preserve that distinction on upgrade.
  await asActor(db, normal.owner, () => db.query("insert into restaurant_gst_config(restaurant_id,mode,off_declared) values($1,'off',true)", [normal.id]));
  for (const [f, mode, gstin] of [[regular, 'regular', '27AAAAN0000A1ZP'], [composition, 'composition', '27AAAAC0000B1ZY']]) {
    await asActor(db, f.owner, () => db.query(`insert into restaurant_gst_config(
      restaurant_id,mode,regular_profile,gstin,legal_name,address,state_code,pan,registration_type,composition_acknowledged)
      values($1,$2,$3,$4,'Synthetic legal name','1 Local Test Lane','27',substr($4,3,10),$2,$5)`,
    [f.id, mode, mode === 'regular' ? 'other_than_specified_premises' : null, gstin, mode === 'composition']));
  }
  const normalSitting = await ticket(db, normal);
  await paid(db, normal, normalSitting);
  const regularSitting = await ticket(db, regular);
  assert.equal(await ticket(db, regular), regularSitting);
  await paid(db, regular, regularSitting);
  const final = await issue(db, regular, regularSitting);
  const heldSitting = await ticket(db, regular);
  await paid(db, regular, heldSitting);
  const held = await issue(db, regular, heldSitting, { name: 'Synthetic buyer', gstin: '29ZZZZZ0000Z1ZM' });
  const openGstSitting = await ticket(db, regular);
  await paid(db, regular, openGstSitting);
  const supplySitting = await ticket(db, composition);
  await paid(db, composition, supplySitting);
  const supply = await issue(db, composition, supplySitting);
  const shares = [];
  for (const invoice of [final, held]) {
    const hash = randomBytes(32).toString('hex');
    await asActor(db, regular.owner, () => one(db, 'select share_link_id from create_restaurant_invoice_share_link($1,$2)', [invoice, hash]));
    shares.push(hash);
  }
  const ids = [catalog.id, normal.id, regular.id, composition.id];
  const before = await snapshot(db, ids);
  assert.equal(before.restaurant_invoices.length, 3);
  assert.equal(before.order_items.length, 6);
  assert.equal(before.payments.length, 6);
  assert.equal(before.restaurant_invoice_share_links.length, 2);
  return { catalog, normal, regular, composition, normalSitting, regularSitting, heldSitting, openGstSitting, supplySitting, final, held, supply, shares, ids, before };
}

export async function checkGstUpgrade(db, fixture) {
  assert.ok(fixture, 'Missing the pre-GST-follow-up fixture');
  const { catalog, normal, regular, composition, normalSitting, regularSitting, heldSitting, openGstSitting, supplySitting, final, held, supply, shares, ids, before } = fixture;
  assert.deepEqual(await snapshot(db, ids), before);
  assert.equal((await one(db, `select count(*)::int n from order_items i join orders o on o.id=i.order_id
    where o.restaurant_id=any($1::uuid[]) and i.is_alcoholic_snapshot is not null`, [ids])).n, 0);
  assert.equal((await one(db, `select count(*)::int n from restaurant_gst_config_history
    where restaurant_id=any($1::uuid[]) and (off_declared is not null or off_declared_at is not null or specified_premises_effective_from is not null)`, [ids])).n, 0);
  for (const table of ['restaurant_gst_config', 'restaurant_gst_config_history']) {
    assert.equal((await one(db, `select count(*)::int n from ${table} where restaurant_id=any($1::uuid[])
      and (fssai_number is not null or business_type is not null or service_sac is not null
        or premises_evidence is not null or retail_phone is not null)`, [ids])).n, 0);
  }
  assert.equal((await one(db, `select count(*)::int n from restaurant_invoices
    where restaurant_id=any($1::uuid[]) and series_code is not null`, [ids])).n, 0);
  assert.equal((await one(db, `select count(*)::int n from restaurant_invoice_series
    where restaurant_id=any($1::uuid[]) and series_code <> 'INV'`, [ids])).n, 0);
  console.log('GST upgrade: old config/history, tickets, lines, payments, documents, series, and links preserved without backfill.');

  for (const [f, sitting, id] of [[regular, regularSitting, final], [regular, heldSitting, held], [composition, supplySitting, supply]]) {
    assert.equal(await issue(db, f, sitting), id);
  }
  const readLink = async (index) => (await asActor(db, null, () => one(db, 'select read_shared_restaurant_invoice($1) payload', [shares[index]]))).payload;
  const shared = await readLink(0);
  assert.equal(shared.invoice.id, final);
  // Old SQL summed 501 per ticket. A new two-ticket document would have
  // tax 1001, but historical printed amounts must still be exactly 1002.
  assert.equal(shared.invoice.totals_snapshot.tax_paise, 1002);
  assert.equal(await readLink(1), null);
  assert.equal((await one(db, 'select access_count from restaurant_invoice_share_links where token_hash=$1', [shares[1]])).access_count, '0');
  console.log('GST upgrade: old final link keeps the original amounts; previously minted held link returns no payload.');

  const report = () => asActor(db, regular.owner, () => rows(db, `select * from report_gst_documents($1,now()-interval '1 day',now()+interval '1 day')`, [regular.id]));
  const oldReport = await report();
  assert.equal(oldReport.length, 2);
  const released = oldReport.find((row) => !row.irn_held);
  assert.deepEqual(released, {
    document_type: 'gst_tax_invoice', document_status: 'issued', rate_bps: 500, irn_held: false, document_count: 1,
    total_paise: '21022', taxable_paise: '20020', cgst_paise: '501', sgst_paise: '501', igst_paise: '0',
    rounding_delta_paise: null, missing_rounding_count: 1, financial_year: shared.invoice.financial_year, series_code: null,
  });
  assert.equal(oldReport.find((row) => row.irn_held).missing_rounding_count, 1);
  await assert.rejects(asActor(db, regular.owner, () => one(db,
    `select issue_invoice_note($1,'credit_note','other','Synthetic adjustment, no cash refund') id`, [final])),
    {code:'23514'});
  assert.deepEqual(await report(), oldReport, 'refused adjustment cannot change historical reporting');
  assert.deepEqual((await snapshot(db, ids)).payments, before.payments);
  console.log('GST upgrade: old rounding stays unknown; credit note preserves source amounts and posts no refund.');

  const beforeRefusal = await snapshot(db, ids);
  await assert.rejects(issue(db, regular, openGstSitting), { code: 'P0001', message: /unclassified historical lines/i });
  assert.deepEqual(await snapshot(db, ids), beforeRefusal, 'Refused close must not change payments, sitting or sequence');
  const normalInvoice = await issue(db, normal, normalSitting);
  const { document_type, totals_snapshot, gst_snapshot } = await one(db, 'select document_type, totals_snapshot, gst_snapshot from restaurant_invoices where id=$1', [normalInvoice]);
  assert.equal(document_type, 'receipt');
  assert.equal(gst_snapshot, null);
  assert.equal(totals_snapshot.total_paise, 11772);
  assert.equal(totals_snapshot.tax_paise, 1261);
  assert.equal(totals_snapshot.amount_paid_paise, 11772);
  assert.deepEqual((await snapshot(db, ids)).payments, before.payments);
  console.log('GST upgrade: a paid old GST sitting with no line evidence stays open; a paid Normal sitting issues its legacy amount.');

  // A legacy INV number remains reserved when this outlet is later enrolled.
  const oldInvoice = await one(db, 'select to_jsonb(i) as row from restaurant_invoices i where id=$1', [normalInvoice]);
  const version = await asActor(db, normal.owner, () => one(db, 'select save_restaurant_gst_config($1,1,$2) v', [normal.id, {
    mode: 'regular', regular_profile: 'other_than_specified_premises', registration_type: 'regular',
    gstin: '29ZZZZZ0000Z1ZM', legal_name: 'Synthetic upgrade GST identity', address: '1 Local Test Lane',
    business_type: 'standalone', fssai_number: '01234567890123', service_sac: '996331',
    activation: { confirm:true, series_confirmed:true, effective_from: new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),
      premises_state_code:'29', premises_address:'1 Local Test Lane', invoice_phone:'07120000000', series:{ INV:'INV',BOS:'BOS',RBL:'RBL',CN:'CN',DN:'DN'}, external_prefixes:[] },
  }]));
  assert.equal(version.v, 2);
  const enrolledSitting = await ticket(db, normal);
  await paid(db, normal, enrolledSitting);
  const enrolledInvoice = await issue(db, normal, enrolledSitting);
  const enrolled = await one(db, 'select series_code,sequence_number,invoice_number from restaurant_invoices where id=$1', [enrolledInvoice]);
  assert.equal(enrolled.series_code, 'INV');
  assert.equal(enrolled.sequence_number, oldInvoice.row.sequence_number + 1);
  assert.match(enrolled.invoice_number, /^[A-Z0-9/-]{1,16}$/);
  assert.deepEqual(await one(db, 'select to_jsonb(i) as row from restaurant_invoices i where id=$1', [normalInvoice]), oldInvoice);
  console.log('GST upgrade: enrolled INV series continues the legacy counter; old issued row stays byte-equivalent.');

  const brandState = () => one(db, `select r.name,i.is_alcoholic,m.is_published from restaurants r
    join items i on i.restaurant_id=r.id join menus m on m.restaurant_id=r.id where r.id=$1`, [catalog.id]);
  const beforeRollback = await brandState();
  await assert.rejects(asActor(db, catalog.owner, () => one(db, 'select rollback_last_publish($1) result', [catalog.id])), { code: '23502', column: 'is_alcoholic' });
  assert.deepEqual(await brandState(), beforeRollback);
  assert.deepEqual((await snapshot(db, ids)).restaurant_publish_history, before.restaurant_publish_history);
  console.log('GST upgrade: pre-classification catalog rollback fails atomically without relabelling the item.');
}

/** This outlet has a classified, paid, closed-but-unissued GST sitting
 * created under the 102-file contract, not a post-cutover test insert. */
export async function seedClosedLegacyGst(db) {
  const f = await outlet(db, 'closed-unissued');
  await asActor(db, f.owner, () => one(db, 'select save_restaurant_gst_config($1,0,$2) v', [f.id, {
    mode: 'regular', regular_profile: 'other_than_specified_premises', registration_type: 'regular',
    gstin: '27AAAAN0000A1ZP', legal_name: 'Synthetic pre-CA identity', address: '1 Local Test Lane',
  }]));
  const sitting = await ticket(db, f);
  await paid(db, f, sitting);
  // Model a prior close without issuance, while keeping the old ticket and
  // paid ledger. The current atomic close does not generate this state.
  await db.query("update order_sessions set status='closed',closed_at=now() where id=$1", [sitting]);
  const before = await snapshot(db, [f.id]);
  return { f, sitting, before };
}

export async function checkClosedLegacyGst(db, { f, sitting, before }) {
  assert.equal((await one(db, 'select i.is_alcoholic_snapshot from order_items i join orders o on o.id=i.order_id where o.restaurant_id=$1', [f.id])).is_alcoholic_snapshot, false);
  await assert.rejects(asActor(db, f.owner, () => one(db, 'select issue_closed_session_receipt($1) id', [sitting])),
    { code: 'P0001', message: /review its GST settings/ });
  await assert.rejects(asActor(db, f.owner, () => one(db, 'select save_restaurant_gst_config($1,1,$2) v', [f.id, {
    mode: 'regular', regular_profile: 'other_than_specified_premises', registration_type: 'regular',
    gstin: '27AAAAN0000A1ZP', legal_name: 'Synthetic pre-CA identity', address: '1 Local Test Lane',
    business_type: 'standalone', fssai_number: '01234567890123', service_sac: '996331',
  }])), { code: 'P0001', message: /closed sittings without a document/ });
  assert.deepEqual(await snapshot(db, [f.id]), before, 'Do not close, reprice, re-collect or consume a number to resolve an old sitting');
  console.log('GST upgrade: a classified paid closed GST sitting without CA evidence cannot issue or be relabelled; records remain intact.');
}

/** Populated 104 -> workstream boundary, including CA-profile INV, CN and RBL. */
export async function seedGstWorkstreamUpgrade(db) {
  const reg = await outlet(db, 'pre-activation-regular');
  const retail = await outlet(db, 'pre-activation-retail');
  await db.query("update restaurants set phone='07120000000' where id=$1", [retail.id]);
  await db.query('update items set is_alcoholic=false where id=any($1::uuid[])', [[reg.item, retail.item]]);
  const common = { fssai_number:'01234567890123' };
  await asActor(db, reg.owner, () => one(db,'select save_restaurant_gst_config($1,0,$2) v',[reg.id,{
    ...common,mode:'regular',regular_profile:'other_than_specified_premises',registration_type:'regular',
    gstin:'27ZZZZZ0000Z1ZQ',legal_name:'Synthetic 104 Regular',address:'1 Synthetic Test Lane',business_type:'standalone',service_sac:'996331',
  }]));
  await asActor(db,retail.owner,() => one(db,'select save_restaurant_gst_config($1,0,$2) v',[retail.id,{
    ...common,mode:'off',off_declared:true,off_has_obligation:false,
  }]));
  const a = await ticket(db,reg), b = await ticket(db,retail);
  await paid(db,reg,a); await paid(db,retail,b);
  const inv = await issue(db,reg,a), rbl = await issue(db,retail,b);
  const {id:cn} = await asActor(db,reg.owner,() => one(db,"select issue_invoice_note($1,'credit_note','other','Synthetic 104 original adjustment') id",[inv]));
  const tables = ['restaurant_gst_config','restaurant_gst_config_history','restaurant_invoices','restaurant_invoice_lines','restaurant_notes','restaurant_note_events','restaurant_invoice_series','restaurant_note_series','payments','orders','order_sessions'];
  const stripped = (table) => ['activation', 'series_prefix', 'fulfilment_kind',
    ...(table === 'orders' ? ['guest_live_version'] : [])];
  const report = async () => {
    const data = {};
    for (const table of tables) {
      data[table] = await rows(db, `select (to_jsonb(t)-$2::text[])::text evidence from public.${table} t
        where restaurant_id=any($1::uuid[]) order by 1`, [[reg.id, retail.id], stripped(table)]);
    }
    return data;
  };
  return {reg,retail,inv,rbl,cn,report,before:await report()};
}

export async function checkGstWorkstreamUpgrade(db, fixture) {
  assert.ok(fixture,'missing populated CA-profile fixture');
  const {before,report,reg,retail,inv,rbl,cn} = fixture;
  assert.deepEqual(await report(),before,'workstream migrations must not rewrite original identity, amounts, numbering or history');
  const legacy = await rows(db, 'select series_code,series_prefix from restaurant_invoices where id=any($1::uuid[]) order by series_code',[[inv,rbl]]);
  assert.deepEqual(legacy,[{series_code:'INV',series_prefix:null},{series_code:'RBL',series_prefix:null}]);
  assert.equal((await one(db,'select series_prefix from restaurant_notes where id=$1',[cn])).series_prefix,null);
  assert.equal((await one(db,'select count(*)::int n from restaurant_gst_config where restaurant_id=any($1::uuid[]) and activation is not null',[[reg.id,retail.id]])).n,0);
  console.log('GST 104 → current upgrade: populated CA INV, RBL, CN, fiscal snapshots, audit, counters, payments preserved; no implied v2 activation.');
}


/** At 108 the new activation, buyer, share and preflight RPCs already exist.
 * Compare populated saved records before and after only migrations 012–015. */
export async function seedGstClosureUpgrade(db, { tag = 'pre-closure', gstin = '27TTTTT9876T1ZY', identified = false, expectedActivationVersion = 2 } = {}) {
  const f = await outlet(db,tag);
  await db.query('update items set is_alcoholic=false where id=$1',[f.item]);
  const { today } = await one(db,"select ((now() at time zone 'Asia/Kolkata')::date)::text as today");
  await asActor(db,f.owner,() => one(db,'select save_restaurant_gst_config($1,0,$2) v',[f.id,{
    mode:'regular',regular_profile:'other_than_specified_premises',registration_type:'regular',gstin,
    legal_name:'Synthetic 108 Supplier',address:'1 Synthetic Test Lane',business_type:'standalone',
    service_sac:'996331',fssai_number:'01234567890123',einvoice_location:'Nagpur',einvoice_pincode:'440001',einvoice_hsn_sac:'996331',
    activation:{confirm:true,effective_from:today,premises_address:'1 Synthetic Test Lane',premises_state_code:'27',invoice_phone:'07120000000',series_confirmed:true,external_prefixes:[],
      series:{INV:'V18',BOS:'BOS',RBL:'RBL',CN:'CN',DN:'DN'},aato:{highest_prior_fy_paise:6000000000,reference:'Local synthetic 108 fixture',reporting_category:'under_10cr'}},
  }]));
  const buyer={name:'Synthetic upgrade B2B buyer',gstin:'29ZZZZZ0000Z1ZM',address:'2 Synthetic Test Lane',location:'Synthetic City',pincode:'560001',state_code:'29'};
  await asActor(db,f.owner,()=>one(db,'select save_restaurant_gst_buyer($1,0,$2) buyer',[f.id,buyer]));
  const pendingSitting=await ticket(db,f); await paid(db,f,pendingSitting);
  const held=await issue(db,f,pendingSitting,buyer);
  const {invoice_number:number,gst_snapshot:gst} = await one(db,'select invoice_number,gst_snapshot from restaurant_invoices where id=$1',[held]);
  const wire={Version:'1.1',TranDtls:{TaxSch:'GST',SupTyp:'B2B',RegRev:'N',IgstOnIntra:'N'},DocDtls:{Typ:'INV',No:number,Dt:today.split('-').reverse().join('/')},
    SellerDtls:{Gstin:gstin,LglNm:'Synthetic 108 Supplier',Addr1:'1 Synthetic Test Lane',Loc:'Nagpur',Pin:440001,Stcd:'27',Ph:'07120000000'},
    BuyerDtls:{Gstin:buyer.gstin,LglNm:buyer.name,Addr1:buyer.address,Loc:buyer.location,Pin:560001,Stcd:'29',Pos:'27'},
    ItemList:[{SlNo:'1',PrdDesc:'Fixture plate',IsServc:'Y',HsnCd:'996331',Qty:1,UnitPrice:gst.taxable_paise/100,TotAmt:gst.taxable_paise/100,
      Discount:0,AssAmt:gst.taxable_paise/100,GstRt:5,CgstAmt:gst.cgst_paise/100,SgstAmt:gst.sgst_paise/100,IgstAmt:0,TotItemVal:105.11}],
    ValDtls:{AssVal:gst.taxable_paise/100,CgstVal:gst.cgst_paise/100,SgstVal:gst.sgst_paise/100,IgstVal:0,TotInvVal:105.11}};
  const {preflight}=await asActor(db,f.owner,()=>one(db,"select record_gst_irp_preflight($1,$2,'invoice',$3,$4) preflight",[f.id,held,'a'.repeat(64),wire]));
  assert.equal(preflight.status,'prepared_offline');
  const finalSitting=await ticket(db,f); await paid(db,f,finalSitting);
  const final=await issue(db,f,finalSitting,identified?{recipient_type:'consumer',name:'Synthetic upgrade final buyer',address:'4 Synthetic Test Lane',state_code:'27'}:null);
  const {note}=await asActor(db,f.owner,()=>one(db,"select issue_invoice_note($1,'credit_note','other','Synthetic pre-closure credit note') note",[final]));
  const hash=randomBytes(32).toString('hex');
  await asActor(db,f.owner,()=>one(db,'select share_link_id from create_restaurant_invoice_share_link($1,$2)',[final,hash]));
  const openSitting=await ticket(db,f); await paid(db,f,openSitting);
  // At this anchor activation, fiscal prefix and namespace already exist.
  // Compare them rather than using the earlier migration's stripped snapshot.
  const tables = ['restaurant_gst_config','restaurant_gst_config_history','restaurant_gst_number_namespaces',
    'restaurant_gst_buyers','restaurant_gst_buyer_history','restaurant_invoice_series','restaurant_invoices',
    'restaurant_notes','restaurant_note_series','restaurant_note_events'];
  const fx=async()=>({
    ...await snapshot(db,[f.id]),
    ...Object.fromEntries(await Promise.all(tables.map(async table=>[table,await rows(db,
      `select (to_jsonb(t)-$2::text[])::text row from public.${table} t where restaurant_id=$1 order by 1`,
      [f.id, table === 'orders' ? ['guest_live_version'] : []])]))),
    jobs:await rows(db,"select (to_jsonb(j)-'revision')::text row from restaurant_irp_jobs j where outlet_id=$1 order by 1",[f.id]),
  });
  const before=await fx();
  assert.equal(before.restaurant_gst_config.length,1);
  assert.equal(JSON.parse(before.restaurant_gst_config[0].row).activation.version,expectedActivationVersion);
  assert.ok(before.restaurant_gst_number_namespaces.some(entry=>JSON.parse(entry.row).prefix==='V18'));
  assert.equal(before.restaurant_gst_buyer_history.length,1);
  return {f,held,final,note,hash,today,preflight,openSitting,fx,before};
}

export async function checkGstClosureUpgrade(db,{f,held,final,note,hash,today,preflight,openSitting,fx,before}) {
  assert.deepEqual(await fx(),before,'108 → current: saved outlet, buyer, receipt, payment, share and preflight evidence changed');
  assert.deepEqual(await one(db,'select revision,environment,status from restaurant_irp_jobs where id=$1',[preflight.id]),
    {revision:0,environment:'offline',status:'prepared_offline'});
  assert.equal((await one(db,'select fulfilment_kind from order_sessions where id=$1',[openSitting])).fulfilment_kind,null);
  assert.equal((await one(db,'select count(*)::int n from restaurant_direct_fulfilments')).n,0);
  const {result}=await asActor(db,f.owner,()=>one(db,"select report_gst_finance($1,$2,$2::date+1,p_detail_limit=>10,p_scope=>'account') result",[f.id,today]));
  assert.ok(result.documents.some(d=>d.id===held && d.lifecycle==='held'));
  assert.ok(result.documents.some(d=>d.id===final && d.lifecycle==='issued'));
  assert.ok(result.documents.some(d=>d.id===note && d.source_id===final && d.lifecycle==='issued'));
  assert.ok(result.payments.some(p=>p.linked_to==='no_document' && p.amount_paise===10511));
  const {bill}=await asActor(db,null,()=>one(db,'select read_shared_restaurant_invoice($1) bill',[hash]));
  assert.equal(bill.invoice.id,final);
  const post=await issue(db,f,openSitting);
  assert.match((await one(db,'select invoice_number from restaurant_invoices where id=$1',[post])).invoice_number,/^V18\/\d{2}-\d{2}\/000003$/);
  console.log('GST 108 → current upgrade: populated activation, buyer, held/offline job, final/share, linked note, namespaces, table IDs and payment rows preserved; open paid sitting continued the saved series.');
}

/** At 112 take an issued BOS, its historical ledger note and a paid but
 * unissued sitting through the particulars gate without inferring a SAC. */
export async function seedGstParticularsUpgrade(db) {
  const f = await outlet(db,'pre-particulars-composition');
  await db.query('update items set is_alcoholic=false where id=$1',[f.item]);
  const { today } = await one(db,"select ((now() at time zone 'Asia/Kolkata')::date)::text as today");
  await asActor(db,f.owner,()=>one(db,'select save_restaurant_gst_config($1,0,$2) v',[f.id,{
    mode:'composition',registration_type:'composition',composition_acknowledged:true,gstin:'27UUUUU2468U1Z7',
    legal_name:'Synthetic prior Composition Supplier',address:'1 Synthetic Test Lane',fssai_number:'01234567890123',
    activation:{confirm:true,effective_from:today,premises_address:'1 Synthetic Test Lane',premises_state_code:'27',invoice_phone:'07120000000',series_confirmed:true,external_prefixes:[],
      series:{INV:'INV',BOS:'BOS',RBL:'RBL',CN:'CN',DN:'DN'}},
  }]));
  const original=await ticket(db,f); await paid(db,f,original);
  const bos=await issue(db,f,original);
  const {note}=await asActor(db,f.owner,()=>one(db,"select issue_invoice_note($1,'debit_note','other','Pre-guard synthetic historical note') note",[bos]));
  const hash=randomBytes(32).toString('hex');
  await asActor(db,f.owner,()=>one(db,'select share_link_id from create_restaurant_invoice_share_link($1,$2)',[bos,hash]));
  const waiting=await ticket(db,f); await paid(db,f,waiting);
  const full = async () => Object.fromEntries(await Promise.all(['restaurant_gst_config','restaurant_gst_config_history',
    'restaurant_gst_number_namespaces','orders','order_sessions','payments','payment_audit_events','restaurant_invoices','restaurant_invoice_lines','restaurant_invoice_series',
    'restaurant_notes','restaurant_note_series','restaurant_note_events','restaurant_invoice_share_links','restaurant_invoice_share_audit']
    .map(async table=>[table,await rows(db,`select (to_jsonb(t)-$2::text[])::text row from public.${table} t where restaurant_id=$1 order by 1`,
      [f.id, table === 'orders' ? ['guest_live_version'] : []])])));
  return {f,original,bos,note,hash,waiting,full,before:await full()};
}

export async function checkGstParticularsUpgrade(db,{f,original,bos,note,hash,waiting,full,before}) {
  assert.deepEqual(await full(),before,'112 → current may not backfill Composition, payments, note or share evidence');
  assert.equal(await issue(db,f,original),bos,'retry must return the same historical document');
  await assert.rejects(issue(db,f,waiting), {message:/requires a reviewed service SAC/});
  await assert.rejects(asActor(db,f.owner,()=>one(db,"select issue_invoice_note($1,'credit_note','other','Unsafe new adjustment review') id",[bos])),
    {code:'23514',message:/Bill of Supply corrections/});
  assert.deepEqual(await full(),before,'blocked close/issue and note may not consume a number or touch payment rows');
  const source=await one(db,'select gst_snapshot,status from restaurant_invoices where id=$1',[bos]);
  assert.equal(source.gst_snapshot.service_sac,null);
  assert.equal((await one(db,'select source_document_number from restaurant_notes where id=$1',[note])).source_document_number,
    (await one(db,'select invoice_number from restaurant_invoices where id=$1',[bos])).invoice_number);
  const {bill}=await asActor(db,null,()=>one(db,'select read_shared_restaurant_invoice($1) bill',[hash]));
  assert.equal(bill.invoice.id,bos);
  console.log('GST 112 → current: prior SAC-less BOS, note/share, activation and paid open sitting preserved; unsafe new issue/adjustment refused without new numbers or payments.');
}

/** Only the child PostgreSQL process clock is controlled; neither issue RPC
 * accepts a test date. No source row or counter timestamp is rewritten. */
export async function checkGstFiscalRollover(db, clockFile) {
  if (!/^\/tmp\/autodine-gst-fiscal\.[A-Za-z0-9]+\/clock$/.test(clockFile)) throw new Error('Require a disposable fiscal clock file.');
  const pin = async (utc, india) => {
    await writeFile(`${clockFile}.new`,`${utc}\n`);
    await rename(`${clockFile}.new`,clockFile);
    assert.equal((await one(db,"select ((statement_timestamp() at time zone 'Asia/Kolkata')::date)::text today")).today,india,
      'The disposable native PostgreSQL clock must cross the boundary');
  };
  await pin('2027-03-31 18:29:59','2027-03-31');
  const f=await outlet(db,'fiscal-clock-regular');
  // Keep only this synthetic outlet entitled across the deliberate date jump.
  await db.query("update restaurants set plan='starter',plan_status='active' where id=$1",[f.id]);
  await db.query('update items set is_alcoholic=false where id=$1',[f.item]);
  await asActor(db,f.owner,()=>one(db,'select save_restaurant_gst_config($1,0,$2) v',[f.id,{
    mode:'regular',registration_type:'regular',regular_profile:'other_than_specified_premises',gstin:'27AAAAN0000A1ZP',
    fssai_number:'01234567890123',service_sac:'996331',business_type:'standalone',legal_name:'Synthetic fiscal clock kitchen',address:'1 Local Test Lane',
    activation:{confirm:true,effective_from:'2027-03-31',premises_address:'1 Local Test Lane',premises_state_code:'27',invoice_phone:'07120000000',series_confirmed:true,
      external_prefixes:[],series:{INV:'IT7',BOS:'BOS',RBL:'RBL',CN:'CT7',DN:'DT7'}},
  }]));
  const consumer={recipient_type:'consumer',name:'Synthetic fiscal copy recipient',address:'2 Local Test Lane',state_code:'29'};
  const sale=async () => {
    const sitting=await ticket(db,f); await paid(db,f,sitting);
    const id=await issue(db,f,sitting,consumer);
    assert.equal(await issue(db,f,sitting,consumer),id);
    return id;
  };
  const note=(id,kind) => asActor(db,f.owner,()=>one(db,
    'select issue_invoice_note($1,$2,\'returned_supply\',\'Synthetic fiscal test only\') id',[id,kind])).then(x=>x.id);
  const invNumber=async id=>(await one(db,'select invoice_number from restaurant_invoices where id=$1',[id])).invoice_number;
  const noteRow=id=>one(db,'select document_number,source_document_number from restaurant_notes where id=$1',[id]);
  const oldSale=await sale(), crossSource=await sale(), cutoffSource=await sale(), pastCutoffSource=await sale();
  const oldNote=await note(oldSale,'credit_note');
  assert.equal(await invNumber(oldSale),'IT7/26-27/000001');
  assert.equal(await invNumber(pastCutoffSource),'IT7/26-27/000004');
  assert.equal((await noteRow(oldNote)).document_number,'CT7/26-27/000001');
  await pin('2027-03-31 18:30:01','2027-04-01');
  const {order_session_id: oldSitting} = await one(db,'select order_session_id from restaurant_invoices where id=$1',[oldSale]);
  assert.equal(await issue(db,f,oldSitting,consumer),oldSale);
  await assert.rejects(issue(db,f,oldSitting,{...consumer,address:'A different synthetic address'}),
    {code:'P0001',message:/immutable document with another recipient/});
  const current=await sale(), linked=await note(crossSource,'credit_note');
  assert.equal(await invNumber(current),'IT7/27-28/000001');
  assert.deepEqual(await noteRow(linked),{document_number:'CT7/27-28/000001',source_document_number:'IT7/26-27/000002'});
  await assert.rejects(note(crossSource,'credit_note'),{code:'P0001',message:/already has a live note/});
  await pin('2027-11-30 18:29:59','2027-11-30');
  assert.equal((await noteRow(await note(cutoffSource,'credit_note'))).document_number,'CT7/27-28/000002');
  await pin('2027-11-30 18:30:01','2027-12-01');
  await assert.rejects(note(pastCutoffSource,'credit_note'),{code:'23514',message:/reporting cutoff passed/});
  assert.equal((await noteRow(await note(pastCutoffSource,'debit_note'))).document_number,'DT7/27-28/000001');
  assert.deepEqual(await rows(db,'select financial_year,next_number from restaurant_invoice_series where restaurant_id=$1 order by 1',[f.id]),
    [{financial_year:'26-27',next_number:5},{financial_year:'27-28',next_number:2}]);
  assert.deepEqual(await rows(db,'select financial_year,document_type,next_number from restaurant_note_series where restaurant_id=$1 order by 1,2',[f.id]),
    [{financial_year:'26-27',document_type:'credit_note',next_number:2},{financial_year:'27-28',document_type:'credit_note',next_number:3},
      {financial_year:'27-28',document_type:'debit_note',next_number:2}]);
  assert.equal((await one(db,'select count(*)::int n from payments where restaurant_id=$1',[f.id])).n,5);
  console.log('Native fiscal rollover: March 31 → April 1 in India using unmodified issuance RPCs; INV/CN counters, source-link FY, immutable retry, separate DN numbering and Nov 30 → Dec 1 cutoff passed.');
}

/** At 114 this is a populated predecessor: issued/held/void-independent
 * fiscal records plus its existing private, non-attesting rehearsal. */
export async function seedIrpExecutionUpgrade(db) {
  const {f,held,preflight}=await seedGstClosureUpgrade(db,{tag:'pre-irp-execution',gstin:'27UUUUU9876U1ZP',identified:true,expectedActivationVersion:3});
  const saved=await one(db,'select document_key,request_sha256,request_payload from restaurant_irp_jobs where id=$1',[preflight.id]);
  const {job} = await one(db,'select reserve_gst_irp_rehearsal($1,$2,$3,$4,$5,$6) job',[
    preflight.id,f.id,saved.document_key,'rehearsal-upgrade',saved.request_sha256,saved.request_payload,
  ]);
  assert.equal(job.state,'prepared');
  // Compare complete records at the new boundary, not the earlier comparison's
  // omit-list. No release is implied from the existing preparation or history.
  const names=['restaurant_gst_config','restaurant_gst_config_history','restaurant_gst_buyers','restaurant_gst_buyer_history',
    'restaurant_gst_number_namespaces','restaurant_invoices','restaurant_invoice_lines','restaurant_invoice_series',
    'restaurant_notes','restaurant_note_events','restaurant_note_series','restaurant_irp_jobs','restaurant_irp_job_events','restaurant_irp_requests',
    'order_sessions','orders','order_items','payments','payment_audit_events','restaurant_payment_receipts','restaurant_invoice_share_links',
    'restaurant_invoice_share_audit'];
  // Pin the predecessor's column set: a later migration may add a nullable or
  // defaulted column, but that must not look like a change to these rows.
  const pinned={};
  for (const table of names) {
    pinned[table]=(await rows(db,`select column_name from information_schema.columns
      where table_schema='public' and table_name=$1 order by ordinal_position`,[table])).map(r=>r.column_name);
  }
  const capture=async()=>{
    const data={};
    for (const table of names) {
      const columns=pinned[table].map(name=>`"${name}"`).join(',');
      data[table]=await rows(db,`select to_jsonb(x)::text as row from (select ${columns} from public.${table}) x order by 1`);
    }
    return data;
  };
  const before=await capture();
  for (const name of ['restaurant_invoices','restaurant_notes','restaurant_irp_jobs','restaurant_irp_job_events','payments','restaurant_invoice_share_links']) assert.ok(before[name].length,name);
  return {f,held,preflight,before,capture};
}
export async function checkIrpExecutionUpgrade(db, fixture) {
  assert.ok(fixture,'No populated Priority 2 boundary fixture');
  const {f,held,preflight,before,capture}=fixture;
  assert.deepEqual(await capture(),before,'114 → 116 must preserve all pre-existing fiscal, payment, share and IRP evidence bytes');
  for (const name of ['irp_routes','irp_route_choices','irp_route_events','irp_dispatches','irp_dispatch_events','irp_verified_artifacts']) {
    assert.equal((await one(db,`select count(*)::int n from public.${name}`)).n,0);
  }
  const read=async(q,args)=>asActor(db,f.owner,()=>one(db,q,args));
  const {register}=await read('select report_irp_register($1) register',[f.id]);
  assert.equal(register.total,0); assert.equal(register.verified_authority,0); assert.equal(register.verified_simulation,0);
  assert.ok(register.drafts.some(d=>d.id===preflight.id && d.document_id===held));
  assert.equal((await read("select read_active_irp_document($1,$2,'invoice') copy",[f.id,held])).copy,null);
  await assert.rejects(read('select queue_irp_dispatch($1,$2) job',[f.id,preflight.id]),/No approved compatible route/);
  console.log('IRP 114 → 116 populated replay: complete fiscal, numbering, payments, links, preflight and old rehearsal rows unchanged; no route, dispatch, artifact or automatic release.');
}
