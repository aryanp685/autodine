/** Fixture-only Phoenix subset. Wakes from PostgreSQL's commit-gated NOTIFY;
 * checks actual SELECT RLS when each row is read for delivery. Not Supabase
 * Realtime, WAL decoding, authentication, or a production server. */
import pg from 'pg';
import { WebSocketServer, WebSocket } from 'ws';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function installRealtimeFixture(db) {
  await db.query(`create function public.journey_notify_live_revision() returns trigger language plpgsql as $$
    begin perform pg_notify('journey_live', new.outlet_id::text); return null; end; $$;
    create trigger journey_revision_notify after insert or update on public.outlet_live_revisions
      for each row execute function public.journey_notify_live_revision();`);
}

export async function startRealtime({ listener, connectionString, pool, appKey, identities }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8_192 });
  const listen = new pg.Client({ connectionString });
  await listen.connect();
  await listen.query('listen journey_live');
  const clients = new Map();
  let serial = 0;
  let deliveryMode = 'normal';
  let unavailable = false;
  let prior = null;
  const counts = { joined: 0, refused: 0, emitted: 0, dropped: 0, duplicated: 0, reordered: 0 };

  const dispatch = (socket, msg) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); };
  const membershipRead = async (user, query, outlet) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      const r = await client.query(query, [outlet]);
      await client.query('commit');
      return r.rows[0];
    } catch { await client.query('rollback').catch(() => undefined); return null; }
    finally { client.release(); }
  };
  listen.on('notification', async ({ payload: outlet }) => {
    if (!uuid.test(outlet)) return;
    if (unavailable || deliveryMode === 'drop') { counts.dropped++; return; }
    // No unrestricted owner lookup. Tokio/scheduling can coalesce committed
    // revs before this query; test clients must not require a gapless stream.
    const state = { mode: deliveryMode, before: prior };
    for (const [socket, topics] of clients) for (const [topic, sub] of topics) {
      if (sub.outlet !== outlet || !sub.actor) continue;
      const row = await membershipRead(sub.actor, 'select outlet_id,event_id,version::text,changed_at from public.outlet_live_revisions where outlet_id=$1', outlet);
      if (!row || topics.get(topic) !== sub || unavailable) continue;
      const emit = r => dispatch(socket, [sub.join, null, topic, 'postgres_changes', { ids: [sub.id], data: {
        schema: 'public', table: 'outlet_live_revisions', type: 'UPDATE', commit_timestamp: r.changed_at,
        record: r, columns: [], errors: [],
      } }]);
      emit(row); counts.emitted++;
      if (state.mode === 'duplicate') { emit(row); counts.duplicated++; }
      if (state.mode === 'reorder' && state.before?.outlet_id === outlet && BigInt(state.before.version) < BigInt(row.version)) {
        emit(state.before); counts.reordered++;
      }
      prior = row;
    }
  });
  listener.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/realtime/v1/websocket' || url.searchParams.get('apikey') !== appKey || unavailable || clients.size >= 24) {
      socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', socket => {
    const topics = new Map();
    clients.set(socket, topics);
    socket.on('error', () => undefined);
    socket.on('close', () => clients.delete(socket));
    socket.on('message', async (bytes, binary) => {
      if (binary) return;
      let z;
      try { z = JSON.parse(bytes.toString()); } catch { return; }
      if (!Array.isArray(z) || z.length !== 5) return;
      const [join, ref, topic, event, payload] = z;
      const reply = (status, response = {}) => dispatch(socket, [join, ref, topic, 'phx_reply', { status, response }]);
      if (event === 'heartbeat') return reply('ok');
      if (event === 'phx_leave') { topics.delete(topic); return reply('ok'); }
      if (event === 'access_token') {
        const sub = topics.get(topic);
        if (sub) sub.actor = identities.get(payload?.access_token)?.id;
        return;
      }
      if (event !== 'phx_join' || topics.size >= 3) return;
      const filters = payload?.config?.postgres_changes;
      const filter = Array.isArray(filters) && filters.length === 1 ? filters[0] : null;
      const outlet = typeof filter?.filter === 'string' && filter.filter.startsWith('outlet_id=eq.') ? filter.filter.slice(13) : '';
      const actor = identities.get(payload?.access_token)?.id;
      if (!actor || !uuid.test(outlet) || filter.schema !== 'public' || filter.table !== 'outlet_live_revisions' || filter.event !== '*' ||
          !await membershipRead(actor, 'select public.read_outlet_live_version($1) as version', outlet)) {
        counts.refused++; reply('error', { reason: 'Subscription refused' }); return;
      }
      if (socket.readyState !== WebSocket.OPEN) return;
      const id = ++serial;
      topics.set(topic, { id, outlet, actor, join });
      counts.joined++;
      reply('ok', { postgres_changes: [{ ...filter, id }] });
      dispatch(socket, [join, null, topic, 'system', { status: 'ok', message: 'Subscribed', extension: 'postgres_changes', channel: topic }]);
    });
  });
  return {
    status: () => ({ ...counts, connected: clients.size, subscriptions: [...clients.values()].reduce((n, m) => n + m.size, 0) }),
    fault(mode) {
      if (mode === 'disconnect') {
        unavailable = true;
        for (const socket of clients.keys()) socket.close(1012, 'Fixture restart');
      } else if (mode === 'normal') { unavailable = false; deliveryMode = mode; }
      else if (['drop', 'duplicate', 'reorder'].includes(mode)) deliveryMode = mode;
      else return false;
      return true;
    },
    close: async () => {
      for (const ws of wss.clients) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      await listen.end();
    },
  };
}
