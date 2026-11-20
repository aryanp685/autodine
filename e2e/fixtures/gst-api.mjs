/** Loopback synthetic responses for the GST browser contract. No DB, real
 * Auth, provider, or real details. Save responses exercise the wire format
 * only; a tiny IRP UI scenario updates memory (no DML, signatures, or transport).
 * An unmodelled request always fails. */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const origin = 'http://127.0.0.1:3118';
const quotes = new Map([
  ['fixture-regular5', ['inclusive', 500]],
  ['fixture-regular18', ['inclusive', 1800]],
  ['fixture-composition', ['none', 0]],
]);
const invoiceStates = ['regular', 'composition', 'pending', 'voided', 'retail', 'buyer', 'custom-retail', 'historical-composition'];
const invoiceDigests = invoiceStates.map((_, index) => createHash('sha256')
  .update(Buffer.alloc(32, index + 1).toString('base64url')).digest('hex'));

const outlets = Object.fromEntries(['a', 'b'].map((key, i) => [key, {
  id: `00000000-0000-4000-8000-00000000000${i + 1}`,
  name: `Fixture outlet ${key.toUpperCase()}`, slug: `fixture-outlet-${key}`,
  timezone: 'Asia/Kolkata', address: '1 Synthetic Test Lane', tax_rate_bps: 0, guest_verification_mode: 'scan',
}]));
const staff = new Map(Object.entries({ owner: ['a', 'b'], solo: ['a'], manager: ['a'], cashier: ['a'], kitchen: ['a'], unassigned: [], expired: ['a'] })
  .map(([name, keys], i) => [`Bearer gst-fixture-token-${name}`, {
    user: { id: `11000000-0000-4000-8000-00000000000${i + 1}`, aud: 'authenticated', role: 'authenticated', email: `${name}@fixture.invalid` },
    role: ['solo', 'expired'].includes(name) ? 'owner' : name,
    expired: name === 'expired',
    restaurants: keys.map((key) => outlets[key]),
  }]));

function receipt(kind) {
  const historical = kind === 'historical-composition';
  const composition = kind === 'composition' || historical;
  const retail = kind === 'retail' || kind === 'custom-retail';
  return {
    invoice: {
      id: 'synthetic-invoice', invoice_number: `${retail ? kind === 'custom-retail' ? 'RX2' : 'RBL' : composition ? 'BOS' : 'INV'}/26-27/000001`, financial_year: '26-27',
      document_type: retail ? 'receipt' : composition ? 'bill_of_supply' : 'gst_tax_invoice',
      status: kind === 'voided' ? 'voided' : 'issued', irp_status: kind === 'pending' ? 'pending' : 'not_required',
      issued_at: '2026-11-18T12:00:00Z', order_session_id: 'synthetic-session',
      seller_snapshot: {
        name: 'GST fixture kitchen', address: 'Synthetic test address', phone: '07120000000', fssai_number: '01234567890123',
        ...(retail ? { retail_bill: true } : { gstin: '27AAAAN0000A1ZP' }),
      },
      customer_snapshot: kind === 'buyer' ? { name:'Synthetic registered buyer',gstin:'29AAAAA0000B1ZW',state_code:'29',address:'1 Synthetic Buyer Lane',location:'Synthetic City',pincode:'560001',phone:'08020112233',email:'synthetic-buyer@fixture.invalid' } : null,
      gst_snapshot: retail ? null : {
        service_sac: historical ? null : '996331', reverse_charge: false,
        mode: composition ? 'composition' : 'regular', regular_profile: composition ? null : 'other_than_specified_premises',
        rate_bps: composition ? 0 : 500, cgst_bps: composition ? 0 : 250, sgst_bps: composition ? 0 : 250,
        taxable_paise: composition ? 10500 : 10000, cgst_paise: composition ? 0 : 250, sgst_paise: composition ? 0 : 250,
        igst_paise: 0, config_version: 1, place_of_supply_state_code: '27',
        notice: composition ? 'Composition taxable person, not eligible to collect tax on supplies' : null,
      },
      totals_snapshot: {
        subtotal_paise: 10500, total_paise: 10500, tax_paise: composition || retail ? 0 : 500, amount_paid_paise: 10500,
        outstanding_paise: 0, ticket_discount_paise: 0, bill_discount_paise: 0, other_charges_paise: 0, payment_status: 'paid',
      },
    },
    lines: [{ id: 'fixture-line', line_snapshot: { ticket_code: 'AD001', item_name: 'Fixture meal', quantity: 1, unit_price_paise: 10500, amount_paise: 10500, is_veg: true } }],
  };
}

const direct = {
  session:'61000000-0000-4000-8000-000000000001',order:'61000000-0000-4000-8000-000000000002',
  item:'61000000-0000-4000-8000-000000000003',address:'99 Synthetic Direct Lane',
};
const directCopy = {
  ...receipt('regular').invoice, id:'61000000-0000-4000-8000-000000000004',restaurant_id:outlets.a.id, order_session_id:direct.session,
  seller_snapshot:{...receipt('regular').invoice.seller_snapshot,fulfilment_kind:'direct_delivery'},
  gst_snapshot:{...receipt('regular').invoice.gst_snapshot,taxable_paise:20021,cgst_paise:501,sgst_paise:500},
  customer_snapshot:{recipient_type:'consumer',name:'Synthetic customer',address:'Synthetic billing lane',state_code:'27',delivery_address:direct.address},
  totals_snapshot:{...receipt('regular').invoice.totals_snapshot,subtotal_paise:21022,total_paise:21022,tax_paise:1001,amount_paid_paise:21022},
};
const paymentCopy = {
  id:'61000000-0000-4000-8000-000000000005',restaurant_id:outlets.a.id,invoice_id:'61000000-0000-4000-8000-000000000006',
  receipt_reference:'PR/26-27/000019-01',issued_at:'2026-11-18T16:00:00Z',snapshot:{
    invoice_number:'INV/26-27/000019',seller:{name:'Saved receipt kitchen',address:'Saved receipt address',fssai_number:'11234567890123'},
    payment_method:'cash',payment_received_at:'2026-11-18T16:00:00Z',payment_amount_paise:10511,total_paid_paise:10511,outstanding_paise:10511,
    payment_status:'partially_paid',table_label:'T3',
  },
};
const irpBase='73000000-0000-4000-8000-00000000000';
const irpSource=irpBase+'1', irpDraft=irpBase+'2', irpRoute=irpBase+'3', irpQueued=irpBase+'4', irpUncertain=irpBase+'5';
const irpTime=new Date().toISOString(), irpDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(irpTime));
const irpCopy={...receipt('buyer').invoice,id:irpSource,restaurant_id:outlets.a.id,issue_date:irpDay,issued_at:irpTime,irp_status:'pending',
  seller_snapshot:{...receipt('buyer').invoice.seller_snapshot,registration_type:'regular',legal_name:'Synthetic Fixture Seller',state_code:'27',
    premises_state_code:'27',einvoice_location:'Nagpur',einvoice_pincode:'440001'},
  gst_snapshot:{...receipt('buyer').invoice.gst_snapshot,issued_local_date:irpDay,
    irp_evidence:{rule_version:'13-2020-amended-10-2023',applicability:'required',reporting_category:'under_10cr'}},
};
// Only for testing the Next screens and request shapes. These are not DB/IRP outcomes.
let irpUi={routing:{route:null,revision:0,available:false},prepared:false,queued:false,lookup:false};
const irpRow=(id)=>{
  const queued=id===irpQueued;
  return {id,document_id:irpSource,preflight_id:irpDraft,kind:'invoice',number:queued?irpCopy.invoice_number:'IX9/26-27/000042',
    issue_date:irpDay,tier:'simulation',phase:queued?'queued':irpUi.lookup?'lookup_queued':'ambiguous',provider_key:'sim-local',provider:'sim-local',
    api_version:'synthetic-1',schema_version:'1.1',rule_version:'13-2020-amended-10-2023',reporting_category:'under_10cr',reporting_deadline:null,
    revision:queued?0:irpUi.lookup?3:2,created_at:irpTime,updated_at:irpTime,next_action_at:irpTime,last_code:queued?'queued':irpUi.lookup?'owner_lookup':'uncertain',
    generation_attempts:queued?0:1,cancellation_attempts:0,lookup_attempts:0,verified_active:false,route_available:true,route_selected:irpUi.routing.available};
};
const irpFinance=(actor,outlet)=>['owner','manager'].includes(actor?.role) && actor.restaurants.some(r=>r.id===outlet);
const reads = new Map([
  ['menus', [{ id: 'fixture-menu' }]],
  ['categories', [{ id: 'fixture-category' }]],
  ['items', [
    { id: 'meal', name: 'Fixture meal', price_paise: 10511, is_alcoholic: false, is_available: true, is_veg: true },
  ]],
  ['item_addon_groups', []],
]);

createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  const path = url.pathname;
  const json = (data, status = 200) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
  if (request.method === 'GET' && path === '/ready') return json({ fixture: true });
  if (request.headers.apikey !== 'sb_publishable_local_gst_fixture') return json({ message: 'Fixture only' }, 401);
  const actor = staff.get(request.headers.authorization);
  if (request.method === 'GET' && path === '/auth/v1/user') {
    return actor ? json(actor.user) : json({ message: 'Not a fixture user' }, 401);
  }
  if (request.method === 'GET' && path.startsWith('/rest/v1/')) {
    const name = path.slice(9);
    const match = (column, value) => url.searchParams.get(column) === `eq.${value}`;
    if (actor) {
      const accessible = actor.restaurants.find((outlet) => match('restaurant_id', outlet.id) || match('id', outlet.id));
      if (name === 'memberships' && match('user_id', actor.user.id)) return json(actor.restaurants.map((outlet) => ({
        restaurant_id: outlet.id, role: actor.role, restaurants: outlet,
      })));
      if (actor.role === 'kitchen' && accessible?.id === outlets.a.id) {
        if (name === 'orders' && !url.searchParams.get('select')?.includes('order_session_id')) {
          return url.searchParams.get('prep_status') === 'eq.cancelled' ? json([])
            : json([{id:direct.order,code:'DSIM01',table_id:null,prep_status:'new',placed_at:new Date().toISOString(),hold_required:false}]);
        }
        if (name === 'table_waiter_calls') return json([]);
      }
      if (actor.role === 'kitchen' && name === 'order_items' && url.searchParams.get('order_id') === `in.(${direct.order})`) {
        return json([{order_id:direct.order,qty:2,name_snapshot:'Fixture counter meal',variant_snapshot:null,addons_snapshot:[],sort_order:0,is_veg:true}]);
      }
      if (actor.role === 'cashier' && actor.restaurants.length === 1) {
        const a = actor.restaurants[0];
        if (name === 'order_sessions' && match('restaurant_id',a.id)) return json([{
          id:direct.session,table_id:null,fulfilment_kind:'direct_delivery',opened_at:new Date().toISOString(),paid_at:null,
        }]);
        if (name === 'orders_finance' && match('restaurant_id',a.id)) return json([{
          id:direct.order,code:'DSIM01',table_id:null,order_session_id:direct.session,total_paise:21022,prep_status:'new',
          payment_status:'pending',gst_mode_snapshot:'regular',tax_rate_bps_snapshot:500,placed_at:new Date().toISOString(),
        }]);
        if (name === 'order_items' || name === 'order_items_finance') return json([{
          id:'fixture-direct-item',order_id:direct.order,name_snapshot:'Fixture counter meal',qty:2,unit_price_paise:10511,
          variant_snapshot:null,addons_snapshot:[],sort_order:0,
        }]);
        if (name === 'payments') return json([]);
        if (name === 'dining_tables') return json({message:'Off-table loads must not query dining_table IDs'},500);
      }
      if (actor.role === 'cashier' && name === 'items' && url.searchParams.get('category_id') === 'in.(fixture-category)') {
        return json([{id:direct.item,name:'Fixture counter meal',price_paise:10511,is_alcoholic:false,is_available:true,is_veg:true}]);
      }
      if (accessible) {
        if (name === 'restaurants') return json([accessible]);
        const mayReadPrivate = accessible.id === outlets.a.id && ['owner','manager','cashier'].includes(actor.role);
        if (name === 'restaurant_invoices') return json(!mayReadPrivate?[]:match('id',directCopy.id)?[directCopy]:match('id',irpSource)?[irpCopy]:[]);
        if (name === 'restaurant_invoice_lines') return json(mayReadPrivate && match('invoice_id',irpSource)?receipt('buyer').lines:
          mayReadPrivate && match('invoice_id',directCopy.id) ? [{
          id:'saved-counter-line',line_snapshot:{ticket_code:'DSIM01',item_name:'Fixture counter meal',quantity:2,unit_price_paise:10511,amount_paise:21022,is_veg:true},
        }] : []);
        if (name === 'restaurant_payment_receipts') return json(mayReadPrivate && match('id',paymentCopy.id) ? [paymentCopy] : []);
        if (name === 'restaurant_invites' || name === 'restaurant_gst_config_history') return json([]);
        if (name === 'restaurant_notes') {
          const id = url.searchParams.get('id')?.slice(3);
          const final = id === '60000000-0000-4000-8000-000000000001';
          const pending = id === '60000000-0000-4000-8000-000000000002';
          const cancelled = id === '60000000-0000-4000-8000-000000000004';
          const identified = id === '60000000-0000-4000-8000-000000000005';
          const historical = id === '60000000-0000-4000-8000-000000000006';
          if ((!final && !pending && !cancelled && !identified && !historical) || !['owner','manager'].includes(actor.role) || accessible.id !== outlets.a.id) return json([]);
          const original = receipt('buyer').invoice;
          return json([{id,restaurant_id:outlets.a.id,document_type:'credit_note',status:'issued',irp_status:cancelled ? 'cancelled' : pending ? 'pending' : 'not_required',
            document_number:`CN/26-27/00000${final ? 1 : 2}`,source_document_number:original.invoice_number, source_issued_at:original.issued_at,
            invoice_id:'60000000-0000-4000-8000-000000000003',issued_at:'2026-11-19T12:00:00Z',reason:'Synthetic full adjustment',void_reason:null,
            taxable_paise:10000,cgst_paise:250,sgst_paise:250,igst_paise:0,total_paise:10500,
            seller_snapshot:original.seller_snapshot,
            customer_snapshot:historical ? null : identified ? {recipient_type:'consumer',name:'Synthetic consumer buyer',address:'1 Synthetic billing lane',
              delivery_address:'2 Original Synthetic Handoff Lane',state_code:'29'} : original.customer_snapshot,
            gst_snapshot:{...original.gst_snapshot,source_document_type:'gst_tax_invoice'} }]);
        }
        if (name === 'restaurant_gst_config') return json([{
          mode: 'regular', config_version: 1, gstin: '27AAAAN0000A1ZP', state_code: '27', pan: 'AAAAN0000A',
          legal_name: `${accessible.name} Registration`, address: accessible.address,
          registration_type: 'regular', regular_profile: 'other_than_specified_premises',
          fssai_number: '01234567890123', business_type: 'standalone', service_sac: '996331',
        }]);
      }
    }
    if (reads.has(name)) return json(reads.get(name));
  }
  if (request.method !== 'POST' || !path.startsWith('/rest/v1/rpc/')) return json({ message: 'Not a fixture request' }, 404);
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const quote = quotes.get(body.p_slug);
    switch (path.slice(13)) {
      case 'restaurant_access':
        return actor?.restaurants.some((outlet) => outlet.id === body.p_restaurant_id)
          ? json({ can_write: !actor.expired, read_only: actor.expired, features: [] }) : json(null);
      case 'list_restaurant_invoice_share_links': return json([]);
      case 'read_active_irp_document':
        // Empty evidence intentionally, even for a simulated dispatch. Never emit fake IRN/QR.
        return json(null);
      case 'record_gst_irp_preflight': {
        const r=body.p_payload;
        if (!irpFinance(actor,body.p_outlet)||actor.role!=='owner'||actor.expired||body.p_outlet!==outlets.a.id||body.p_document!==irpSource
          ||body.p_kind!=='invoice'||!(/^[a-f0-9]{64}$/).test(body.p_canonical_sha256)||r?.DocDtls?.No!==irpCopy.invoice_number
          ||r?.BuyerDtls?.Pos!=='27'||r?.ItemList?.[0]?.HsnCd!=='996331'||r?.ValDtls?.TotInvVal!==105) return json({code:'23514'},400);
        const duplicate=irpUi.prepared; irpUi.prepared=true;
        return json({id:irpDraft,status:'prepared_offline',duplicate});
      }
      case 'report_irp_register': {
        if (!irpFinance(actor,body.p_outlet)) return json({code:'42501'},403);
        const a=body.p_outlet===outlets.a.id, current=a?[...(irpUi.queued?[irpRow(irpQueued)]:[]),irpRow(irpUncertain)]:[];
        const datesOk=(!body.p_from || (body.p_from<=irpDay && body.p_until>irpDay));
        const rows=datesOk?current:[];
        return json({outlet:body.p_outlet,as_of_india:irpDay,total:rows.length,rows:rows.slice(body.p_offset??0),verified_authority:0,verified_simulation:0,
          missing_count:a&&!irpUi.prepared?1:0,missing:a&&!irpUi.prepared?[irpRow(irpQueued)]:[],breakdown:[],
          drafts:a && irpUi.prepared && !irpUi.queued?[{id:irpDraft,created_at:irpTime,document_id:irpSource,kind:'invoice',number:irpCopy.invoice_number,payload_version:'1.1'}]:[],
          routing:a?irpUi.routing:{route:null,revision:0,available:false},routes:a?[{id:irpRoute,provider:'sim-local',tier:'simulation',api_version:'synthetic-1',schema_version:'1.1'}]:[],
          eligibility:{mode:'regular',version:3,review_fy:Number(irpDay.slice(0,4))-(irpDay.slice(5,10)<'04-01'?1:0),reporting_category:'under_10cr',mandate:'required'},
          providers:a && datesOk?[{provider_key:'sim-local',api_version:'synthetic-1',tier:'simulation',calls:1,latency_mean_ms:10,latency_max_ms:10,failures:1}]:[]});
      }
      case 'read_irp_dispatch': {
        if (!irpFinance(actor,body.p_outlet)) return json({code:'42501'},403);
        const id=body.p_job;
        if (body.p_outlet!==outlets.a.id || (id!==irpUncertain && (id!==irpQueued || !irpUi.queued))) return json(null);
        const row=irpRow(id);
        return json({...row,copy:null,events:[{revision:row.revision,code:row.last_code,phase:row.phase,at:irpTime,latency_ms:id===irpUncertain&&!irpUi.lookup?10:null}]});
      }
      case 'choose_irp_route': {
        if (!irpFinance(actor,body.p_outlet)||actor.role!=='owner'||actor.expired||body.p_outlet!==outlets.a.id||body.p_route!==irpRoute || body.p_revision!==irpUi.routing.revision) return json({code:'40001'},409);
        irpUi={...irpUi,routing:{route:irpRoute,revision:irpUi.routing.revision+1,available:true}};
        return json(irpUi.routing.revision);
      }
      case 'queue_irp_dispatch': {
        if (!irpFinance(actor,body.p_outlet)||actor.role!=='owner'||actor.expired||body.p_outlet!==outlets.a.id||body.p_preflight!==irpDraft||!irpUi.prepared||!irpUi.routing.available) return json({code:'23514'},400);
        irpUi.queued=true;
        return json(irpQueued);
      }
      case 'request_irp_dispatch_action': {
        if (!irpFinance(actor,body.p_outlet)||actor.role!=='owner'||actor.expired||body.p_outlet!==outlets.a.id||body.p_job!==irpUncertain||body.p_action!=='lookup'||body.p_revision!==2||irpUi.lookup) return json({code:'40001'},409);
        irpUi.lookup=true;
        return json(3);
      }
      case 'list_staff_members': return json([]);
      case 'save_restaurant_gst_config': {
        // Deliberately no role check in this non-persisting response: a
        // wrongly forwarded request must fail the action-denial assertion.
        const settings = body.p_settings;
        const matchesContract = body.p_restaurant_id === outlets.a.id && body.p_expected_version === 1
          && settings?.mode === 'off' && settings.fssai_number === '01234567890123' && settings.off_declared === true && settings.off_has_obligation === false
          && settings.activation?.confirm === true && settings.activation?.series_confirmed === true && settings.activation.series.RBL === 'RBL';
        return matchesContract ? json(2) : json({ message: 'Unexpected fixture settings payload' }, 400);
      }
      case 'list_gst_outlet_deferrals':
        // Model a separate existing-config outlet with a saved deferral. A
        // POST on outlet A does not persist anything in this fixture server.
        return actor?.restaurants.some(outlet => outlet.id === body.p_outlet) && body.p_outlet === outlets.b.id
          ? json([{profile_version:1,reason:'premises',recorded_at:'2026-11-19T10:00:00Z',recorded_by:actor.user.id}]) : json([]);
      case 'record_gst_outlet_deferral':
        return body.p_outlet === outlets.a.id && body.p_expected_version === 1 && body.p_reason === 'premises'
          ? json({profile_version:1,reason:'premises'}) : json({message:'Unexpected deferral payload'},400);
      case 'place_gst_direct_ticket': {
        const good = actor?.role === 'cashier' && actor.restaurants[0].id === body.p_outlet && /^[0-9a-f-]{36}$/i.test(body.p_attempt)
          && body.p_channel === 'direct_delivery' && body.p_attested === true && body.p_delivery_address === direct.address
          && JSON.stringify(body.p_lines) === JSON.stringify([{item_id:direct.item,qty:2}]);
        return good && body.p_delivery_state === '27' ? json(direct.session)
          : json({code:'23514',message:'Do not echo this private fixture RPC detail'},400);
      }
      case 'restaurant_can_write': return json(actor?.restaurants.some(outlet => outlet.id === body.p_restaurant_id) && !actor.expired);
      case 'list_gst_direct_prep_routes':
        return actor?.role === 'kitchen' && body.p_outlet === outlets.a.id && JSON.stringify(body.p_orders) === JSON.stringify([direct.order])
          ? json([{order_id:direct.order,fulfilment_kind:'direct_delivery'}]) : json({code:'42501'},403);
      case 'list_gst_direct_destinations':
        return actor?.role === 'cashier' && body.p_outlet === outlets.a.id
          ? json([{session_id:direct.session,state_code:'27',delivery_address:direct.address}]) : json({code:'42501'},403);
      case 'report_gst_finance': {
        if (body.p_outlet !== outlets.a.id || body.p_from !== '2026-11-18' || body.p_until !== '2026-11-19' || body.p_audience !== 'B2B' || body.p_series !== 'IX2') {
          return json({ message: 'Unexpected synthetic ledger parameters' }, 400);
        }
        const expanded = body.p_scope === 'account' && actor?.role === 'owner' && actor.restaurants.length === 2;
        const held = {outlet_id:outlets.a.id, lifecycle:'held', profile:'other_than_specified_premises', id:'fixture-pending',number:'IX2/26-27/000002',kind:'gst_tax_invoice',financial_year:'26-27',series:'IX2',billing:'regular',audience:'B2B',
          status:'issued',irp_status:'pending',effective_from:'2026-11-18',buyer_gstin:'29AAAAA0000B1ZW',source_number:null,
          issued_at:'2026-11-18T12:30:00Z',gross:10500,taxable:10000,cgst:250,sgst:250,igst:0,paid_at_issue:10500,rounding_delta:0};
        const documents = expanded ? [held,{...held,outlet_id:outlets.b.id,id:'fixture-cancelled',number:'IX2/26-27/000006',lifecycle:'cancelled',irp_status:'cancelled'}] : [held];
        return json({ schema_version:2,outlet:outlets.a.id,scope:body.p_scope,outlets:expanded ? [outlets.a,outlets.b] : [outlets.a],document_count:documents.length,
          documents,payments:[{outlet_id:outlets.a.id,status:'refunded',linked_to:'issued_sitting',count:1,amount_paise:6500}],buckets:[] });
      }
      case 'report_gst_documents': {
        if (![outlets.a.id, outlets.b.id].includes(body.p_restaurant_id)) return json({ message: 'Unknown fixture outlet' }, 400);
        return json([{
          series_code: 'INV', financial_year: '26-27', document_type: 'gst_tax_invoice', document_status: 'issued', rate_bps: 500, irn_held: false, document_count: 1,
          total_paise: body.p_restaurant_id === outlets.a.id ? 21022 : 10511, taxable_paise: 20021,
          cgst_paise: 501, sgst_paise: 500, igst_paise: 0, rounding_delta_paise: -1, missing_rounding_count: 0,
        }, {
          series_code: 'RBL', financial_year: '26-27', document_type: 'retail_bill', document_status: 'voided', rate_bps: null, irn_held: false, document_count: 1,
          total_paise: body.p_restaurant_id === outlets.a.id ? 10500 : 10511, taxable_paise: null,
          cgst_paise: null, sgst_paise: null, igst_paise: null, rounding_delta_paise: null, missing_rounding_count: 0,
        }]);
      }
      case 'current_table_session': {
        const tokenSlugs = [...quotes.keys()];
        const slug = tokenSlugs.find((_, index) => String(index + 1).repeat(64) === body.p_token);
        return json(slug ? [{ restaurant_slug: slug, table_label: 'Fixture 1', expires_at: new Date(Date.now() + 3600000).toISOString() }] : []);
      }
      case 'public_restaurant_profile': {
        const selected = actor?.restaurants.find(r => r.slug === body.p_slug);
        return json(selected ? [{...selected,is_active:true}] : quote ? [{ id:'fixture-outlet',slug:body.p_slug,name:'GST fixture kitchen',is_active:true }] : []);
      }
      case 'public_order_pricing': return json(quote ? [{ tax_treatment: quote[0], tax_rate_bps: quote[1] }] : []);
      case 'read_shared_restaurant_invoice': {
        const state = invoiceStates[invoiceDigests.indexOf(body.p_token_hash)];
        // Include held/void snapshots as if returned by an older API. The new
        // SQL denying these links is checked separately against PostgreSQL.
        return json(state ? receipt(state) : null);
      }
      default: return json({ message: 'No unmodelled RPC is permitted in this fixture' }, 404);
    }
  } catch {
    return json({ message: 'Invalid fixture request' }, 400);
  }
}).listen(3118, '127.0.0.1');
