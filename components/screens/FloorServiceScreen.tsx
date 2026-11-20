'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { btn, Card, Empty, Notice, PageHead, SectionHead, Tag } from '@/components/owner/chrome';
import { transferSitting, workWaiterCall, type FloorResult } from '@/app/(staff)/waiter/actions';
import type { FloorSnapshot } from '@/lib/db/floor-service';

function MoveTable({ outlet, table, available, run, busy }: {
  outlet: string; table: FloorSnapshot['tables'][number]; available: FloorSnapshot['tables'];
  run: (work: () => Promise<FloorResult>) => void; busy: boolean;
}) {
  const [to, setTo] = useState('');
  const attempt = useRef<{ to: string; request: string } | null>(null);
  if (!table.sitting || !available.length) return null;
  const sitting = table.sitting;
  return <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={event => {
    event.preventDefault();
    if (!available.some(target => target.id === to) || !globalThis.crypto?.randomUUID) return;
    if (!attempt.current || attempt.current.to !== to) attempt.current = { to, request: crypto.randomUUID() };
    const request = attempt.current.request;
    run(() => transferSitting({ outlet, sitting, from: table.id, to, request }));
  }}>
    <select aria-label={`Move ${table.label} to`} value={to} onChange={event => setTo(event.target.value)}
      disabled={busy} className="rounded-[var(--p-r-control)] border border-hair bg-card px-2 py-2 text-[12.5px]">
      <option value="">Choose a table</option>
      {available.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}
    </select>
    <button className={btn('ghost', 'sm')} disabled={busy || !to}>Move sitting</button>
  </form>;
}

export function FloorServiceScreen({ data, outlet, name, canTransfer }: {
  data: FloorSnapshot | null; outlet?: string; name?: string; canTransfer?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<FloorResult>();
  const lock = useRef(false);
  const run = (work: () => Promise<FloorResult>) => {
    if (lock.current) return;
    lock.current = true;
    setResult(undefined);
    startTransition(async () => {
      try { setResult(await work()); }
      catch { setResult({ ok: false, message: 'Could not verify the change. Check the floor before retrying.' }); }
      finally { lock.current = false; router.refresh(); }
    });
  };
  const available = (data?.tables ?? []).filter(table => table.active && !table.sitting);
  return <div className="flex flex-col gap-5">
    <PageHead kicker="Service · Floor" title="Floor service" meta={name ?? 'Table occupancy and waiter calls'} />
    {result && <Notice tone={result.ok ? 'plain' : 'due'} role={result.ok ? 'status' : 'alert'}>{result.message}</Notice>}
    {!data || !outlet ? <Notice tone="due" label="The floor could not be read.">Check the connection and sign in with a staff account for this outlet.</Notice> : <>
      {!data.canWork && <Notice tone="due" label="Read-only floor">An owner can restore access before staff can change the floor.</Notice>}
      <section aria-label="Waiter calls">
        <SectionHead title="Waiter calls" meta={`${data.calls.length}${data.callsTruncated ? '+' : ''} open`} />
        {data.callsTruncated && <p className="mb-2 text-[12.5px] text-gink-64">Showing the oldest calls first.</p>}
        {data.calls.length === 0 ? <Empty>No open waiter calls.</Empty> : <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
          {data.calls.map(call => <li key={call.id} data-floor-call={call.id}>
            <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div><strong className="mr-2 text-[13.5px] text-gink">{call.table}</strong>
                <Tag tone={call.acknowledgedAt ? 'neutral' : 'due'}>{call.acknowledgedAt ? 'Acknowledged' : 'Waiting'}</Tag></div>
              <div className="flex flex-wrap gap-2">
                {!call.acknowledgedAt && <button type="button" className={btn('ghost', 'sm')} disabled={pending || !data.canWork}
                  onClick={() => run(() => workWaiterCall({ outlet, call: call.id, operation: 'acknowledge' }))}>Acknowledge</button>}
                <button type="button" className={btn('solid', 'sm')} disabled={pending || !data.canWork}
                  onClick={() => run(() => workWaiterCall({ outlet, call: call.id, operation: 'resolve' }))}>Resolve</button>
              </div>
            </Card>
          </li>)}
        </ul>}
      </section>
      <section aria-label="Table occupancy">
        <SectionHead title="Table occupancy" />
        {data.tablesTruncated && <Notice tone="due" label="Only the first 200 tables are shown.">Review the complete floor in Tables &amp; QR.</Notice>}
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {data.tables.map(table => <li key={table.id} data-floor-table={table.label}>
            <Card className="p-3">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-[13.5px] text-gink">{table.label}</strong>
                <Tag tone={table.sitting ? 'work' : 'neutral'}>{table.sitting ? 'Occupied · open sitting' : table.active ? 'Available' : 'Off floor'}</Tag>
              </div>
              {table.sitting && !table.active && <p className="mt-1 text-[12.5px] text-gink-64">New scans disabled</p>}
              {canTransfer && data.canWork && <MoveTable key={table.sitting} outlet={outlet} table={table} available={available} run={run} busy={pending} />}
            </Card>
          </li>)}
        </ul>
        {data.tables.length === 0 && <Empty>No tables have been added.</Empty>}
      </section>
    </>}
  </div>;
}
