/** Test-only loopback HTTP → PostgreSQL adapter for the journey rehearsal.
 * This is not PostgREST or Supabase Auth: only the query shapes below are
 * modelled. Every Data API operation runs as the actual anon/authenticated
 * role (no bypass or canned business results). The runner owns the database.
 */
import { createServer, request as upstream } from 'node:http';
import { startRealtime } from './realtime.mjs';
import pg from 'pg';
import { PRIVATE_DETAIL } from './sentinel.mjs';

const tables = new Set(`memberships restaurants menus categories items item_variants item_addon_groups item_addons
  restaurant_brand_profiles restaurant_brand_assets orders order_items orders_finance order_items_finance payments
  order_sessions dining_tables table_waiter_calls restaurant_invoices restaurant_invoice_lines
  restaurant_payment_receipts restaurant_verification_settings outlet_live_revisions`.split(/\s+/));
const sets = new Set(`public_restaurant_profile public_storefront_status public_qr_intro current_table_session
  open_table_session verify_table_qr_with_code public_order_pricing current_verification_code
  list_restaurant_invoice_share_links create_restaurant_invoice_share_link list_gst_direct_prep_routes
  list_my_waiter_outlets list_order_floor_labels table_order_activity`.split(/\s+/));
const scalars = new Set(`get_public_order restaurant_access report_sales list_gst_direct_destinations place_public_order_attempt cancel_order set_order_line_quantities cancel_staff_order
  restaurant_can_write confirm_table_orders reject_table_orders claim_kitchen_order_announcement
  record_kitchen_announcement_result record_counter_payment mark_order_session_paid close_order_session_and_issue_receipt
  read_shared_restaurant_invoice revoke_restaurant_invoice_share_link place_gst_direct_ticket
  get_guest_order_status set_guest_order_lines_at_version read_outlet_live_version floor_service_snapshot transfer_open_sitting
  report_irp_register read_irp_dispatch choose_irp_route queue_irp_dispatch request_irp_dispatch_action record_gst_irp_preflight
  read_active_irp_document
  call_waiter call_verified_waiter_at read_verified_waiter_state acknowledge_waiter_call finish_waiter_call resolve_table_waiter_call
  claim_table_waiter_call_announcement record_table_waiter_call_announcement`.split(/\s+/));
const ident = (name) => {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new InputError('Unsupported identifier');
  return `"${name}"`;
};
class InputError extends Error {}

function selectList(value, relation) {
  return (value ?? '*').replaceAll(/\s/g, '').split(/,(?![^()]*\))/).map(field => {
    if (field === 'restaurants(name,slug,timezone,tagline)' && relation === 'memberships') {
      return '(select json_build_object(\'name\',r.name,\'slug\',r.slug,\'timezone\',r.timezone,\'tagline\',r.tagline) from public.restaurants r where r.id=t.restaurant_id) as restaurants';
    }
    if (relation === 'items' && ['item_variants(*)','item_variants(id,name,price_paise,sort_order)'].includes(field)) {
      const variant = field === 'item_variants(*)' ? 'v' : `json_build_object('id',v.id,'name',v.name,'price_paise',v.price_paise,'sort_order',v.sort_order)`;
      return `coalesce((select json_agg(${variant} order by v.sort_order) from public.item_variants v where v.item_id=t.id), '[]'::json) as item_variants`;
    }
    return field === '*' ? 't.*' : `t.${ident(field)}`;
  }).join(', ');
}

function bind(values, value) {
  values.push(value);
  return `$${values.length}`;
}

function filter(column, expression, values) {
  const c = `t.${ident(column)}`;
  const match = /^([a-z]+)\.(.*)$/.exec(expression);
  if (!match) throw new InputError('Unsupported filter');
  const [, op, value] = match;
  if (op === 'is' && value === 'null') return `${c} is null`;
  if (op === 'not' && value === 'is.null') return `${c} is not null`;
  if (op === 'in' && /^\([\w, -]+\)$/.test(value)) return `${c}=any(${bind(values, value.slice(1, -1).split(','))})`;
  const operator = new Map([['eq','='],['neq','<>'],['gt','>'],['gte','>='],['lt','<'],['lte','<=']]).get(op);
  if (!operator) throw new InputError('Unsupported comparison');
  return `${c} ${operator} ${bind(values, value)}`;
}

async function rest(client, method, path, query, payload) {
  const values = [];
  if (path.startsWith('rpc/')) {
    if (method !== 'POST') throw new InputError('Only POST RPCs are modelled');
    const name = path.slice(4);
    if (!sets.has(name) && !scalars.has(name)) throw new InputError('Unmodelled RPC');
    const args = Object.entries(payload).map(([key, value]) => {
      if (!key.startsWith('p_')) throw new InputError('Unsupported RPC argument');
      const json = value && typeof value === 'object' && !['p_orders'].includes(key);
      return `${ident(key)} => ${bind(values, json ? JSON.stringify(value) : value)}${json ? '::jsonb' : ''}`;
    }).join(', ');
    const call = `public.${ident(name)}(${args})`;
    const { rows } = await client.query(sets.has(name) ? `select row_to_json(t) as data from ${call} t` : `select to_json(${call}) as data`, values);
    return sets.has(name) ? rows.map(r => r.data) : rows[0].data;
  }
  if (!tables.has(path)) throw new InputError('Unmodelled relation');
  const relation = `public.${ident(path)} t`;
  const select = selectList(query.get('select'), path);
  const clauses = [];
  for (const [column, expression] of query) {
    if (['select','order','offset','limit'].includes(column)) continue;
    if (path === 'payments' && column === 'or') {
      // Dashboard collection window: prefer the recorded instant, falling
      // back to creation only on legacy rows without recorded_at.
      const dates = /^\(recorded_at\.gte\.([\d:T.Z-]+),and\(recorded_at\.is\.null,created_at\.gte\.([\d:T.Z-]+)\)\)$/.exec(expression);
      if (!dates) throw new InputError('Unmodelled payment window');
      clauses.push(`(t.recorded_at>=${bind(values, dates[1])} or (t.recorded_at is null and t.created_at>=${bind(values, dates[2])}))`);
    } else clauses.push(filter(column, expression, values));
  }
  const where = clauses.length ? ` where ${clauses.join(' and ')}` : '';
  if (method === 'PATCH' && path === 'orders' && Object.keys(payload).join() === 'prep_status' && clauses.length) {
    const { rows } = await client.query(`with updated as (update ${relation} set prep_status=${bind(values, payload.prep_status)}${where} returning ${select}) select row_to_json(updated) as data from updated`, values);
    return rows.map(r => r.data);
  }
  if (method !== 'GET' && method !== 'HEAD') throw new InputError('Unmodelled write');
  const order = query.get('order')?.split(',').map(field => {
    const [column, direction, nulls, ...rest] = field.split('.');
    if (!['asc', 'desc', undefined].includes(direction) || !['nullsfirst','nullslast',undefined].includes(nulls) || rest.length) throw new InputError('Unsupported ordering');
    return `t.${ident(column)} ${direction ?? 'asc'}${nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : ''}`;
  }).join(', ');
  const limit = Math.min(Number(query.get('limit') ?? 1000), 1000);
  const offset = Number(query.get('offset') ?? 0);
  if (![limit, offset].every(n => Number.isSafeInteger(n) && n >= 0)) throw new InputError('Unsupported range');
  const { rows } = await client.query(`select row_to_json(r) as data from (select ${select} from ${relation}${where}${order ? ` order by ${order}` : ''} limit ${bind(values, limit)} offset ${bind(values, offset)}) r`, values);
  return rows.map(r => r.data);
}

async function body(request) {
  const parts = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 128_000) throw new InputError('Fixture body too large');
    parts.push(chunk);
  }
  const value = bytes ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Expected an object');
  return value;
}

export async function startBridge({ connectionString, key, identities, sessions, control, appPort }) {
  const pool = new pg.Pool({ connectionString, max: 12 });
  const requests = new Set();
  const unsupported = new Set();
  let fault = null;
  let realtime;
  const renewal = new Map(Object.values(sessions).map(session => [session.refresh_token, session]));
  const listener = createServer(async (req, res) => {
    const json = (data, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
    const { pathname, searchParams } = new URL(req.url, 'http://127.0.0.1');
    if (pathname === '/__journey' && req.headers['x-journey-control'] === control) {
      if (req.method === 'GET') return json({ requests: [...requests], unsupported: [...unsupported], realtime: realtime.status() });
      const data = await body(req);
      if (req.method === 'POST' && data.realtime) return json({ ok: realtime.fault(data.realtime) });
      if (req.method === 'POST' && (scalars.has(data.rpc) || sets.has(data.rpc)) && ['after-commit','before-query','transient','private-error'].includes(data.mode)) {
        fault = { ...data, remaining: Number.isInteger(data.count) && data.count >= 1 && data.count <= 3 ? data.count : 1 };
        return json({ ok: true });
      }
      return json({ ok: false }, 400);
    }
    if (!/^\/(auth|rest|realtime)\/v1(?:\/|$)/.test(pathname) && pathname !== '/__journey') {
      // One origin for Chromium, including WebSocket, so no test-only CSP
      // exception, local HTTP CORS, or separate client-facing backend address.
      const headers = { ...req.headers, 'x-forwarded-host': req.headers.host };
      const request = upstream({ host: '127.0.0.1', port: appPort, method: req.method, path: req.url, headers }, source => {
        const headers = { ...source.headers };
        // Next can build an absolute redirect from its own listen address. The
        // browser must stay on this one origin or its port-scoped basket and
        // this origin's WebSocket silently diverge mid-journey.
        if (headers.location) {
          const target = new URL(headers.location, `http://127.0.0.1:${appPort}`);
          if (target.port === String(appPort) && ['127.0.0.1', 'localhost'].includes(target.hostname)) {
            headers.location = `${target.pathname}${target.search}${target.hash}`;
          }
        }
        res.writeHead(source.statusCode, headers); source.pipe(res);
      });
      request.on('error', () => { if (!res.headersSent) json({ ok: false }, 502); else res.destroy(); });
      res.on('close', () => request.destroy());
      req.pipe(request);
      return;
    }
    if (req.headers.apikey !== key) return json({ message: 'Unknown local fixture key' }, 401);
    const token = req.headers.authorization?.slice(7);
    const actor = identities.get(token);
    if (pathname === '/auth/v1/user') return actor ? json(actor) : json({ message: 'No fixture user' }, 401);
    if (pathname === '/auth/v1/token' && searchParams.get('grant_type') === 'refresh_token') {
      const data = await body(req).catch(() => null);
      const session = renewal.get(data?.refresh_token);
      return session ? json(session) : json({ error_code: 'refresh_token_not_found', message: 'Invalid fixture refresh' }, 400);
    }
    // Other Auth operations (real refresh, signing and magic links) are not modelled.
    if (token !== key && !actor) return json({ message: 'Unknown fixture session' }, 401);
    const path = pathname.startsWith('/rest/v1/') ? pathname.slice(9) : '';
    const label = `${req.method} ${path}`;
    requests.add(label);
    const inject = fault && path === `rpc/${fault.rpc}` ? fault : null;
    if (inject && --fault.remaining <= 0) fault = null;
    if (inject?.mode === 'private-error') return json({ code: 'P0001', message: PRIVATE_DETAIL, details: PRIVATE_DETAIL, hint: PRIVATE_DETAIL }, 400);
    if (inject?.mode === 'before-query') return res.destroy();
    if (inject?.mode === 'transient') return json({ code: 'PGRST002', message: 'Synthetic temporary database interruption' }, 503);
    let client;
    try {
      const payload = req.method === 'GET' || req.method === 'HEAD' ? {} : await body(req);
      client = await pool.connect();
      await client.query('begin');
      await client.query(actor ? 'set local role authenticated' : 'set local role anon');
      await client.query(`select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)`, [actor?.id ?? '', actor ? 'authenticated' : 'anon']);
      let result = await rest(client, req.method, path, searchParams, payload);
      await client.query('commit');
      if (inject?.mode === 'after-commit') return res.destroy();
      if (Array.isArray(result) && req.headers.accept === 'application/vnd.pgrst.object+json') {
        if (result.length !== 1) return json({ code: 'PGRST116', message: 'Expected one row', details: `The result contains ${result.length} rows`, hint: null }, 406);
        result = result[0];
      }
      return json(result);
    } catch (error) {
      await client?.query('rollback').catch(() => undefined);
      if (error instanceof InputError || !error.code || ['42703','42883','42P01','42P02'].includes(error.code)) {
        // Record only a controlled route shape and error class, never request data.
        unsupported.add(`${tables.has(path) || sets.has(path.slice(4)) || scalars.has(path.slice(4)) ? label : '(unmodelled endpoint)'} ${error.code ?? error.constructor.name}`);
      }
      return json({ code: error.code ?? 'FIXTURE_INPUT', message: error.message, details: error.detail ?? null, hint: error.hint ?? null }, error.code === '42501' ? actor ? 403 : 401 : 400);
    } finally { client?.release(); }
  });
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  realtime = await startRealtime({ listener, connectionString, pool, appKey: key, identities });
  return {
    origin: `http://localhost:${listener.address().port}`,
    unsupported,
    close: async () => { await realtime.close(); await new Promise(resolve => listener.close(resolve)); await pool.end(); },
  };
}
