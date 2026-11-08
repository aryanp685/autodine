import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const apiUrl = process.env.API_URL ?? '';
const anonKey = process.env.ANON_KEY ?? '';
const databaseUrl = process.env.DB_URL ?? '';
const appUrl = process.env.APP_BASE_URL ?? '';
const reportFile = process.env.LOAD_REPORT_FILE ?? 'test-results/supabase-e2e/load-report.json';
const guests = Number.parseInt(process.env.LOAD_GUESTS ?? '5000', 10);
const restaurantCount = Number.parseInt(process.env.LOAD_RESTAURANTS ?? '100', 10);
const concurrency = Number.parseInt(process.env.LOAD_API_CONCURRENCY ?? '128', 10);
const fixtureEnvFile = process.env.E2E_FIXTURE_ENV_FILE;
const failures = [];
const report = {
  generatedAt: new Date().toISOString(),
  target: 'disposable local Supabase Docker stack and local AutoDine app; synthetic data only',
  configuration: { requestedGuestSessions: guests, restaurants: restaurantCount, apiConcurrency: concurrency },
  workloads: {},
  failures,
};

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
function checkLoopback(value, label, expectedProtocol) {
  const parsed = new URL(requireValue(value, label));
  if (parsed.protocol !== expectedProtocol || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error(`Refusing ${label} outside the disposable loopback environment.`);
  }
  return parsed;
}
function quantile(sorted, q) {
  if (!sorted.length) return null;
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)].toFixed(2));
}
function summarizeLatencies(values, durationMs, errorCount = 0, requested = values.length) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    requested,
    completed: values.length,
    failures: errorCount,
    durationMs: Number(durationMs.toFixed(2)),
    throughputPerSecond: durationMs > 0 ? Number((values.length * 1000 / durationMs).toFixed(2)) : 0,
    latencyMs: {
      min: sorted.length ? Number(sorted[0].toFixed(2)) : null,
      p50: quantile(sorted, 0.50),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
      max: sorted.length ? Number(sorted.at(-1).toFixed(2)) : null,
    },
  };
}
async function runPool(count, limit, operation) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(count, limit) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= count) return;
      await operation(index);
    }
  });
  await Promise.all(workers);
}
function ipHash(label) {
  return createHash('sha256').update(label).digest('hex');
}
function addFailure(stage, index, error) {
  if (failures.length < 100) {
    failures.push({ stage, index, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 300) });
  }
}

checkLoopback(apiUrl, 'Supabase API URL', 'http:');
checkLoopback(databaseUrl, 'Supabase database URL', 'postgresql:');
checkLoopback(appUrl, 'AutoDine app URL', 'http:');
if (new URL(databaseUrl).port !== '54322') throw new Error('Expected local PostgreSQL on port 54322.');
if (!Number.isInteger(guests) || guests < 1 || !Number.isInteger(restaurantCount) || restaurantCount < 1) {
  throw new Error('Guest and restaurant counts must be positive integers.');
}
if (guests % restaurantCount !== 0) throw new Error('LOAD_GUESTS must divide evenly across LOAD_RESTAURANTS.');
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 256) {
  throw new Error('LOAD_API_CONCURRENCY must be in the range 1–256.');
}

const fixtureText = await readFile(requireValue(fixtureEnvFile, 'E2E_FIXTURE_ENV_FILE'), 'utf8');
const fixture = Object.fromEntries(fixtureText.split(/\r?\n/).filter(Boolean).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1)];
}));
const ownerEmail = requireValue(fixture.E2E_OWNER_EMAIL, 'E2E_OWNER_EMAIL');
const ownerPassword = requireValue(fixture.E2E_OWNER_PASSWORD, 'E2E_OWNER_PASSWORD');

const db = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
const anon = createClient(apiUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
await db.connect();
try {
  const prefix = `load-${randomUUID().slice(0, 8)}`;
  const restaurantRows = await db.query(
    `insert into public.restaurants
       (slug, name, timezone, is_active, trial_started_at, guest_verification_mode)
     select $1 || '-' || lpad(n::text, 3, '0'), 'Synthetic peak-load restaurant ' || n,
            'Asia/Kolkata', true, now(), 'scan'
       from generate_series(1, $2::integer) as n
     returning id, slug`,
    [prefix, restaurantCount],
  );
  if (restaurantRows.rowCount !== restaurantCount) throw new Error('Could not create all synthetic load restaurants.');
  restaurantRows.rows.sort((a, b) => a.slug.localeCompare(b.slug));
  const restaurantIds = restaurantRows.rows.map((row) => row.id);
  const guestsPerRestaurant = guests / restaurantCount;

  const ownerAuth = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: ownerResult, error: signInError } = await ownerAuth.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
  if (signInError || !ownerResult.user || !ownerResult.session) throw signInError ?? new Error('Synthetic owner sign-in returned no session.');
  await db.query('insert into public.memberships (restaurant_id, user_id, role) values ($1, $2, \'owner\')', [restaurantIds[0], ownerResult.user.id]);

  const menus = await db.query(
    `insert into public.menus (restaurant_id, name, is_published, sort_order)
     select id, 'Synthetic peak-load menu', true, 0 from public.restaurants where id = any($1::uuid[])
     returning id, restaurant_id`,
    [restaurantIds],
  );
  const categories = await db.query(
    `insert into public.categories (restaurant_id, menu_id, name, sort_order)
     select restaurant_id, id, 'Synthetic dishes', 0 from public.menus where id = any($1::uuid[])
     returning id, restaurant_id`,
    [menus.rows.map((row) => row.id)],
  );
  const items = await db.query(
    `insert into public.items (restaurant_id, category_id, name, price_paise, is_veg, is_available, sort_order)
     select restaurant_id, id, 'Synthetic load dish', 49900, true, true, 0
       from public.categories where id = any($1::uuid[])
     returning id, restaurant_id`,
    [categories.rows.map((row) => row.id)],
  );
  const itemByRestaurant = new Map(items.rows.map((row) => [row.restaurant_id, row.id]));

  const tables = await db.query(
    `insert into public.dining_tables (restaurant_id, label, seats, is_active)
     select r.id, 'Load-' || lpad(n::text, 4, '0'), 4, true
       from unnest($1::uuid[]) as r(id)
       cross join generate_series(1, $2::integer) as n
     returning id, restaurant_id`,
    [restaurantIds, guestsPerRestaurant],
  );
  if (tables.rowCount !== guests) throw new Error(`Expected ${guests} load cards, found ${tables.rowCount}.`);

  const cards = await db.query(
    `select t.restaurant_id, q.public_token
       from public.dining_tables t
       join public.table_qr_codes q on q.table_id = t.id and q.revoked_at is null
       join public.restaurants r on r.id = t.restaurant_id
      where t.restaurant_id = any($1::uuid[]) and t.label like 'Load-%'
      order by r.slug, t.label`,
    [restaurantIds],
  );
  if (cards.rowCount !== guests) throw new Error(`Expected ${guests} live QR tokens, found ${cards.rowCount}.`);
  const guestsData = cards.rows.map((row, index) => ({
    index,
    restaurantId: row.restaurant_id,
    publicToken: row.public_token,
    restaurant: restaurantRows.rows.find((restaurant) => restaurant.id === row.restaurant_id),
    itemId: itemByRestaurant.get(row.restaurant_id),
  }));
  if (guestsData.some((guest) => !guest.restaurant || !guest.itemId)) throw new Error('Synthetic load menu fixture is incomplete.');

  console.log(`Prepared ${restaurantCount} synthetic restaurants, ${guests} QR cards, and one menu per restaurant.`);

  const sessions = new Array(guests);
  const openLatencies = [];
  let openErrors = 0;
  const openStart = performance.now();
  await runPool(guests, concurrency, async (index) => {
    const guest = guestsData[index];
    const start = performance.now();
    const { data, error } = await anon.rpc('open_table_session', {
      p_public_token: guest.publicToken,
      p_ip_hash: ipHash(`load-session:${prefix}:${index}`),
    });
    openLatencies.push(performance.now() - start);
    const row = Array.isArray(data) ? data[0] : data;
    if (error || row?.status !== 'opened' || !row.session_token) {
      openErrors += 1;
      addFailure('open_table_session', index, error ?? new Error(`Unexpected session result: ${JSON.stringify(row)}`));
      return;
    }
    sessions[index] = row.session_token;
  });
  report.workloads.tableSessions = summarizeLatencies(openLatencies, performance.now() - openStart, openErrors, guests);
  report.workloads.tableSessions.status = 'open_table_session RPC';
  report.workloads.tableSessions.concurrency = concurrency;

  const guestTokens = new Array(guests);
  const orderLatencies = [];
  let orderErrors = 0;
  const orderStart = performance.now();
  await runPool(guests, concurrency, async (index) => {
    const guest = guestsData[index];
    const sessionToken = sessions[index];
    if (!sessionToken) {
      orderErrors += 1;
      return;
    }
    const guestToken = randomUUID();
    const start = performance.now();
    const { data, error } = await anon.rpc('place_public_order', {
      p_slug: guest.restaurant.slug,
      p_lines: [{ itemId: guest.itemId, qty: 1 }],
      p_note: 'Disposable synthetic concurrent guest load',
      p_session_token: sessionToken,
      p_guest_token: guestToken,
      p_ip_hash: ipHash(`load-order:${prefix}:${index}`),
    });
    orderLatencies.push(performance.now() - start);
    if (error || typeof data !== 'string' || !data) {
      orderErrors += 1;
      addFailure('place_public_order', index, error ?? new Error(`Unexpected order result: ${JSON.stringify(data)}`));
      return;
    }
    guestTokens[index] = guestToken;
  });
  report.workloads.orderCreation = summarizeLatencies(orderLatencies, performance.now() - orderStart, orderErrors, guests);
  report.workloads.orderCreation.status = 'place_public_order RPC; priced by database';
  report.workloads.orderCreation.concurrency = concurrency;

  const appLatencies = [];
  let appErrors = 0;
  const appRequests = Math.min(guests, 1000);
  const appStart = performance.now();
  await runPool(appRequests, Math.min(concurrency, 64), async (index) => {
    const restaurant = restaurantRows.rows[index % restaurantRows.rowCount];
    const start = performance.now();
    try {
      const response = await fetch(`${appUrl}/menu?s=${encodeURIComponent(restaurant.slug)}`, { redirect: 'manual' });
      appLatencies.push(performance.now() - start);
      if (response.status !== 200) {
        appErrors += 1;
        addFailure('app_menu_ssr', index, new Error(`HTTP ${response.status}`));
      }
      await response.body?.cancel();
    } catch (error) {
      appLatencies.push(performance.now() - start);
      appErrors += 1;
      addFailure('app_menu_ssr', index, error);
    }
  });
  report.workloads.appMenuReads = summarizeLatencies(appLatencies, performance.now() - appStart, appErrors, appRequests);
  report.workloads.appMenuReads.status = 'Next.js /menu server-rendered reads';
  report.workloads.appMenuReads.concurrency = Math.min(concurrency, 64);

  const { data: staffResult, error: staffError } = await ownerAuth.auth.getSession();
  const staffSession = staffResult?.session;
  if (staffError || !staffSession?.access_token) {
    addFailure('kitchen_auth', null, staffError ?? new Error('Could not read synthetic owner session.'));
  } else {
    const realtimeClientCount = 20;
    const updateOrderCount = Math.min(25, guestsPerRestaurant);
    const updateGuests = guestsData.slice(0, updateOrderCount).filter((_, index) => guestTokens[index]);
    const updateTokenSet = updateGuests.map((guest) => guestTokens[guest.index]);
    let updateOrders = [];
    if (updateTokenSet.length) {
      const query = await db.query(
        `select id, guest_token from public.orders where guest_token = any($1::uuid[]) order by placed_at, id`,
        [updateTokenSet],
      );
      updateOrders = query.rows;
    }

    const staff = createClient(apiUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { authorization: `Bearer ${staffSession.access_token}` } },
    });
    const rtClients = [];
    const channels = [];
    const received = [];
    const eventErrors = [];
    const kitchenUpdateLatencies = [];
    let kitchenUpdateFailures = 0;
    let subscribedCount = 0;
    let subscriptionError = null;
    let currentWave = null;
    const restaurantId = restaurantIds[0];

    try {
      if (updateOrders.length !== updateOrderCount) throw new Error(`Expected ${updateOrderCount} kitchen orders, found ${updateOrders.length}.`);
      const subscriptions = Array.from({ length: realtimeClientCount }, async (_, index) => {
        const rt = createClient(apiUrl, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        await rt.realtime.setAuth(staffSession.access_token);
        rtClients.push(rt);
        const channel = rt.channel(`load-kitchen-${prefix}-${index}`)
          .on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}`,
          }, (payload) => {
            if (!currentWave) return;
            const id = payload.new?.id;
            const status = payload.new?.prep_status;
            const key = `${id}:${status}`;
            const sentAt = currentWave.sentAt.get(key);
            if (sentAt !== undefined) {
              const eventKey = `${index}:${key}`;
              if (!currentWave.seen.has(eventKey)) {
                currentWave.seen.add(eventKey);
                received.push(performance.now() - sentAt);
              }
            }
          })
          .subscribe((status, error) => {
            if (status === 'SUBSCRIBED') {
              subscribedCount += 1;
              return;
            }
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              const message = `${status}${error?.message ? `: ${error.message}` : ''}`;
              eventErrors.push(message);
              subscriptionError ??= message;
            }
          });
        channels.push(channel);
      });
      await Promise.all(subscriptions);
      // The callback is the acknowledgement that each socket joined; do not
      // begin kitchen updates until every synthetic dashboard is subscribed.
      const subscribedDeadline = performance.now() + 30_000;
      while (subscribedCount < realtimeClientCount && !subscriptionError && performance.now() < subscribedDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (subscriptionError) throw new Error(`Realtime subscription failed: ${subscriptionError}`);
      if (subscribedCount < realtimeClientCount) throw new Error(`Only ${subscribedCount}/${realtimeClientCount} kitchen clients subscribed.`);

      const waveResults = [];
      const kitchenUpdatesStarted = performance.now();
      for (const prepStatus of ['preparing', 'ready', 'served']) {
        const sentAt = new Map();
        for (const order of updateOrders) sentAt.set(`${order.id}:${prepStatus}`, performance.now());
        const priorEvents = received.length;
        const waveStart = performance.now();
        currentWave = { sentAt, seen: new Set() };
        const updates = await Promise.all(updateOrders.map(async (order) => {
          const requestStarted = performance.now();
          const { data, error } = await staff.from('orders')
            .update({ prep_status: prepStatus })
            .eq('id', order.id)
            .select('id')
            .maybeSingle();
          kitchenUpdateLatencies.push(performance.now() - requestStarted);
          if (error || !data?.id) {
            kitchenUpdateFailures += 1;
            addFailure(`kitchen_update_${prepStatus}`, order.id, error ?? new Error('Update returned no row.'));
            return false;
          }
          return true;
        }));
        const expectedEvents = updateOrders.length * realtimeClientCount;
        const deadline = performance.now() + 30_000;
        while (received.length - priorEvents < expectedEvents && performance.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        waveResults.push({
          status: prepStatus,
          requestedOrderUpdates: updateOrders.length,
          successfulOrderUpdates: updates.filter(Boolean).length,
          expectedRealtimeEvents: expectedEvents,
          receivedRealtimeEvents: received.length - priorEvents,
          durationMs: Number((performance.now() - waveStart).toFixed(2)),
        });
        currentWave = null;
      }
      const kitchenUpdateDuration = performance.now() - kitchenUpdatesStarted;
      report.workloads.kitchenDashboard = {
        subscribers: realtimeClientCount,
        restaurantCount: 1,
        concurrentOrderUpdates: updateOrderCount,
        ordersUpdatedThroughAuthenticatedPostgREST: waveResults.reduce((sum, wave) => sum + wave.successfulOrderUpdates, 0),
        apiUpdateRequests: summarizeLatencies(
          kitchenUpdateLatencies,
          kitchenUpdateDuration,
          kitchenUpdateFailures,
          updateOrderCount * 3,
        ),
        realtimeFanoutEventsPerSecond: kitchenUpdateDuration > 0
          ? Number((received.length * 1000 / kitchenUpdateDuration).toFixed(2))
          : 0,
        updateWaves: waveResults,
        realtimeEventsReceived: received.length,
        realtimeEventsExpected: updateOrderCount * 3 * realtimeClientCount,
        realtimeEventLatencyMs: {
          p50: quantile([...received].sort((a, b) => a - b), 0.50),
          p95: quantile([...received].sort((a, b) => a - b), 0.95),
          p99: quantile([...received].sort((a, b) => a - b), 0.99),
          max: received.length ? Number(Math.max(...received).toFixed(2)) : null,
        },
        failures: eventErrors.length + kitchenUpdateFailures + waveResults.reduce((sum, wave) => sum + Math.max(0, wave.expectedRealtimeEvents - wave.receivedRealtimeEvents), 0),
      };
      if (report.workloads.kitchenDashboard.failures) {
        addFailure('kitchen_realtime', null, new Error(`${report.workloads.kitchenDashboard.failures} expected realtime/update events failed.`));
      }
    } catch (error) {
      addFailure('kitchen_realtime', null, error);
      report.workloads.kitchenDashboard = {
        subscribers: realtimeClientCount,
        restaurantCount: 1,
        ordersUpdatedThroughAuthenticatedPostgREST: 0,
        realtimeEventsReceived: received.length,
        failures: 1,
        errors: eventErrors.slice(0, 10),
      };
    } finally {
      currentWave = null;
      await Promise.all(channels.map((channel, index) => rtClients[index]?.removeChannel(channel).catch(() => undefined)));
      await Promise.all(rtClients.map((client) => client.removeAllChannels().catch(() => undefined)));
      await staff.removeAllChannels().catch(() => undefined);
      await ownerAuth.auth.signOut().catch(() => undefined);
    }
  }
} catch (error) {
  addFailure('setup_or_load', null, error);
} finally {
  await db.end().catch(() => undefined);
  const outputPath = path.resolve(reportFile);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`Load evidence written to ${outputPath}`);
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}
