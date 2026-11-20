'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { callWaiterAction } from '@/app/menu/waiter-actions';
import { liveIdentifier } from '@/lib/realtime-revisions';

type State = 'idle' | 'waiting' | 'acknowledged' | 'expired';
const STATES: State[] = ['idle', 'waiting', 'acknowledged', 'expired'];

/** All visible states come from the verified physical table, not a local
 * "called" flag that gets stuck until the guest reloads. */
export function CallWaiterButton({ slug, table }: { slug: string; table: string }) {
  const key = `ad_waiter:${slug}:${table}`;
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>('idle');
  const [hint, setHint] = useState('');
  const current = useRef<State>('idle');
  const attempt = useRef('');
  const writing = useRef(false);
  const generation = useRef(0);
  const recheck = useRef<() => void>(() => undefined);
  const applyState = (next: State) => { current.current = next; setState(next); };

  useEffect(() => {
    if (!slug || !table) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    let failures = 0;
    const visible = () => !document.hidden && navigator.onLine;
    const tick = async () => {
      if (!active || !visible() || controller) return;
      const request = new AbortController();
      controller = request;
      const before = generation.current;
      try {
        const response = await fetch('/menu/waiter/status', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify({ slug, table }), signal: AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]),
        });
        const data = await response.json();
        if (!response.ok || data.ok !== true || !STATES.includes(data.state)) throw new Error('waiter status unavailable');
        if (!active || request.signal.aborted || writing.current || before !== generation.current) return;
        failures = 0;
        const prior = current.current;
        const next = data.state as State;
        if (next === 'idle' && (prior === 'waiting' || prior === 'acknowledged')) {
          attempt.current = '';
          try { sessionStorage.removeItem(key); } catch { /* absent storage */ }
          setHint('The call was cleared. You can call again if you still need help.');
        } else if (next !== 'idle') setHint('');
        applyState(next);
      } catch {
        if (!request.signal.aborted) failures = Math.min(failures + 1, 4);
      } finally {
        if (controller === request) controller = null;
        if (active && visible() && !request.signal.aborted && current.current !== 'expired') {
          const interval = failures ? Math.min(60_000, 4_000 * 2 ** failures) : current.current === 'idle' ? 8_000 : 3_000;
          timer = setTimeout(() => void tick(), interval);
        }
      }
    };
    const wake = () => { clearTimeout(timer); if (visible()) void tick(); else { controller?.abort(); controller = null; } };
    recheck.current = wake;
    wake();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('offline', wake);
    return () => {
      active = false;
      controller?.abort();
      clearTimeout(timer);
      recheck.current = () => undefined;
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', wake);
    };
  }, [slug, table, key]);

  const call = () => {
    if (writing.current || current.current !== 'idle') return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (liveIdentifier(saved?.id) && Date.now() - saved.at < 120_000) attempt.current ||= saved.id;
    } catch { /* retry in memory if storage is unavailable */ }
    if (!attempt.current) attempt.current = crypto.randomUUID();
    try { sessionStorage.setItem(key, JSON.stringify({ id: attempt.current, at: Date.now() })); } catch { /* optional */ }
    writing.current = true;
    generation.current++;
    setHint('');
    startTransition(async () => {
      try {
        const result = await callWaiterAction(attempt.current, slug, table);
        if (!result.ok) { setHint(result.error); return; }
        if (result.state === 'already_handled') {
          attempt.current = '';
          try { sessionStorage.removeItem(key); } catch { /* optional */ }
          setHint('This request was already handled.');
        } else applyState('waiting');
      } catch { setHint('We could not verify the request. Retry the same call or ask someone on the floor.'); }
      finally { generation.current++; writing.current = false; recheck.current(); }
    });
  };

  const message = state === 'waiting' ? 'A staff member has been called. Please wait at your table.'
    : state === 'acknowledged' ? 'Staff acknowledged your call.'
    : state === 'expired' ? 'Scan the table card again before calling a waiter.' : hint;
  return (
    <div data-call-waiter="" data-waiter-state={state} className="mt-3">
      <button type="button" onClick={call} disabled={pending || state !== 'idle' || !slug} aria-busy={pending || undefined}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-hair bg-card px-4 py-2 text-[13px] font-semibold text-gink transition-colors hover:bg-paper disabled:cursor-not-allowed disabled:opacity-65">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M4 12h3l2-6 4 12 2-6h5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {pending ? 'Calling…' : state === 'waiting' ? 'Waiter called' : state === 'acknowledged' ? 'Call acknowledged' : 'Call a waiter'}
      </button>
      {message ? <p role="status" className="mt-2 text-[12.5px] leading-[1.45] text-gink-64">{message}</p> : null}
    </div>
  );
}
