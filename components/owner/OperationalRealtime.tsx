'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { createRealtimeMonitor, type RealtimeDelivery } from '@/lib/realtime-monitor';
import { createRevisionCursor, parseOutletSignal, revisionNumber } from '@/lib/realtime-revisions';
import { shouldSkipRefresh } from './AutoRefresh';

export type LiveSurface = 'kitchen' | 'counter' | 'floor' | 'owner';
const FALLBACK_MS: Record<LiveSurface, number> = { kitchen: 5_000, counter: 10_000, floor: 10_000, owner: 15_000 };
const RESYNC_MS = 45_000;
const COALESCE_MS = 250;
let channelSerial = 0;

/** One read-only channel per working page/outlet. Sequence numbers coalesce
 * invalidations; reconnect and the periodic safety read don't depend on replay.
 * A missed final message and a failed Next refresh are both recoverable. */
export function OperationalRealtime({ outletId, surface }: { outletId: string; surface: LiveSurface }) {
  const router = useRouter();
  const [delivery, setDelivery] = useState<RealtimeDelivery | 'offline' | 'ended'>('connecting');
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  useEffect(() => { busy.current = pending; }, [pending]);

  useEffect(() => {
    const browserClient = getSupabaseBrowser();
    if (!browserClient) return;
    const client = browserClient;
    let alive = true;
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wakeTimer: ReturnType<typeof setTimeout> | undefined;
    let connectingTimer: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof client.channel> | null = null;
    let request: AbortController | null = null;
    let joined = false;
    let ended = false;
    let failures = 0;
    let lastRefresh = 0;

    const visible = () => !document.hidden && navigator.onLine && !ended;
    const flush = () => {
      wakeTimer = undefined;
      if (!alive || !dirty || !visible() || shouldSkipRefresh(document)) return;
      if (busy.current) { wakeTimer = setTimeout(flush, 500); return; }
      dirty = false;
      lastRefresh = Date.now();
      startTransition(() => router.refresh());
    };
    const enqueue = () => {
      dirty = true;
      if (!wakeTimer && visible()) wakeTimer = setTimeout(flush, COALESCE_MS);
    };
    const cursor = createRevisionCursor(enqueue);
    const monitor = createRealtimeMonitor({
      onDelivery: value => { if (alive && visible()) setDelivery(value); },
      onSignal: signal => {
        if (surface !== 'kitchen' || !alive || !visible()) return;
        void fetch('/api/ops/realtime-alert', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signal),
          signal: AbortSignal.timeout(4_000),
        }).catch(() => undefined);
      },
    });

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (alive && visible()) timer = setTimeout(() => void readPersisted(), ms);
    };
    const stopChannel = () => {
      const old = channel;
      channel = null;
      joined = false;
      clearTimeout(connectingTimer);
      if (old) void client.removeChannel(old).catch(() => undefined);
    };
    async function readPersisted(force = false) {
      if (!alive || !visible()) return;
      if (force) enqueue();
      if (request) return;
      const controller = new AbortController();
      request = controller;
      try {
        const { data, error, status } = await client.rpc('read_outlet_live_version', { p_outlet: outletId })
          .abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]));
        if (!alive || controller.signal.aborted || !visible()) return;
        if (status === 401 || status === 403 || error?.code === '42501') {
          // Stop listening immediately; re-render the role/auth gate so stale
          // operational data isn't left exposed after membership expiry.
          stopChannel();
          monitor.dispose();
          setDelivery('ended');
          startTransition(() => router.refresh());
          ended = true;
          return;
        }
        if (error) throw new Error('revision unavailable');
        const version = revisionNumber(data);
        if (version === null) throw new Error('revision invalid');
        failures = 0;
        cursor.observe(version);
        if (Date.now() - lastRefresh >= RESYNC_MS) {
          enqueue();
        }
        // Don't say push is back until we have a verified persisted read too.
        monitor.onStatus(joined ? 'SUBSCRIBED' : 'CHANNEL_ERROR');
      } catch {
        if (!alive || controller.signal.aborted || !visible()) return;
        failures = Math.min(failures + 1, 4);
        monitor.onStatus('CHANNEL_ERROR');
        // Version unavailable (including app ahead of schema): continue safe
        // server snapshots with backoff rather than render fake empty queues.
        enqueue();
      } finally {
        if (request === controller) request = null;
        if (!controller.signal.aborted) schedule(failures ? Math.min(60_000, FALLBACK_MS[surface] * 2 ** (failures - 1))
          : joined ? RESYNC_MS : FALLBACK_MS[surface]);
      }
    }

    function connect() {
      if (!alive || !visible() || channel) return;
      // Supabase's browser client renews the session and updates the socket
      // credential; RLS is evaluated for each row, and confirmed by resync.
      const current = client.channel(`ops:v1:${outletId}:${++channelSerial}`);
      channel = current;
      connectingTimer = setTimeout(() => { if (!joined && visible()) monitor.onStatus('TIMED_OUT'); }, 8_000);
      current.on('postgres_changes', {
        event: '*', schema: 'public', table: 'outlet_live_revisions', filter: `outlet_id=eq.${outletId}`,
      }, payload => {
        if (alive && channel === current && visible()) cursor.observe(parseOutletSignal(outletId, payload.new));
      }).subscribe(status => {
        if (!alive || channel !== current || !visible()) return;
        clearTimeout(connectingTimer);
        joined = status === 'SUBSCRIBED';
        if (!joined) {
          monitor.onStatus('CHANNEL_ERROR');
          schedule(0);
          if (status === 'CLOSED') {
            stopChannel();
            connectingTimer = setTimeout(connect, FALLBACK_MS[surface]);
          }
        } else void readPersisted(true);
      });
    }
    const pause = () => {
      clearTimeout(timer);
      clearTimeout(wakeTimer);
      wakeTimer = undefined;
      request?.abort();
      request = null;
      stopChannel();
      monitor.dispose();
    };
    const resume = () => {
      if (!alive) return;
      if (!navigator.onLine) { pause(); setDelivery('offline'); return; }
      if (document.hidden) { pause(); return; }
      ended = false;
      if (!channel) setDelivery('connecting');
      connect();
      void readPersisted(true);
    };
    const onBlur = () => { if (dirty) enqueue(); };
    const offline = () => { pause(); setDelivery('offline'); };
    document.addEventListener('visibilitychange', resume);
    document.addEventListener('focusout', onBlur);
    window.addEventListener('online', resume);
    window.addEventListener('offline', offline);
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', resume);
    resume();
    return () => {
      alive = false;
      pause();
      document.removeEventListener('visibilitychange', resume);
      document.removeEventListener('focusout', onBlur);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', offline);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('pageshow', resume);
    };
  }, [outletId, surface, router, startTransition]);

  return (
    <p data-live-delivery={delivery} role="status" className="mb-2 text-[11.5px] text-gink-64">
      {delivery === 'live' ? 'Live updates connected' : delivery === 'polling' ? 'Checking for updates — live connection interrupted'
        : delivery === 'offline' ? 'Offline — showing the last received state' : delivery === 'ended' ? 'Live session ended — sign in again'
        : 'Connecting live updates…'}
    </p>
  );
}
