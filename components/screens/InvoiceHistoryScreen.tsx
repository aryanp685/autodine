import Link from 'next/link';
import { OwnerPage, PageHead } from '@/components/owner/chrome';
import type { InvoiceHistoryRow } from '@/lib/db/invoice-history';
import { formatBillMoney } from '@/lib/bill';
import type { OutletBar } from '@/lib/outlets';

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function InvoiceHistoryScreen({ rows, outlet }: { rows: InvoiceHistoryRow[]; outlet: OutletBar | null }) {
  return (
    <OwnerPage active="invoices" outlet={outlet} signOut wide>
      <PageHead
        kicker="Service · closed table sessions"
        title="Invoice history"
        meta="The latest 100 closed sessions for this restaurant. Receipt snapshots are immutable; a missing receipt means issuance did not complete."
      />
      {!rows.length ? (
        <section className="rounded-[14px] border border-hair bg-card p-6" aria-label="No closed sessions">
          <h2 className="text-[15px] font-semibold">No closed table sessions yet</h2>
          <p className="mt-2 text-[12.5px] text-gink-64">Closed sittings and their receipts will appear here.</p>
        </section>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-hair bg-card">
          <table className="w-full min-w-[760px] border-collapse text-left text-[12.5px]">
            <thead className="border-b border-hair text-[10px] font-semibold tracking-[0.1em] text-gink-46 uppercase">
              <tr>
                <th className="px-4 py-3">Receipt</th>
                <th className="px-4 py-3">Table</th>
                <th className="px-4 py-3">Opened</th>
                <th className="px-4 py-3">Closed</th>
                <th className="px-4 py-3 text-right">Final total</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Session</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => <HistoryRow key={row.sessionId} row={row} />)}
            </tbody>
          </table>
        </div>
      )}
    </OwnerPage>
  );
}

function HistoryRow({ row }: { row: InvoiceHistoryRow }) {
  const receiptLabel = row.invoice
    ? `${row.invoice.number}${row.invoice.status === 'voided' ? ' · voided' : ''}`
    : 'Not issued';
  return (
    <tr className="border-b border-hair last:border-0">
      <td className="px-4 py-3 font-medium">
        {row.invoice
          ? <Link className="underline decoration-hair-strong underline-offset-2" href={`/invoice/${row.invoice.id}`}>{receiptLabel}</Link>
          : receiptLabel}
      </td>
      <td className="px-4 py-3">{row.tableLabel ? `Table ${row.tableLabel}` : 'Table (label unavailable)'}</td>
      <td className="px-4 py-3 text-gink-64">{when(row.openedAt)}</td>
      <td className="px-4 py-3 text-gink-64">{when(row.closedAt)}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {row.invoice?.totalPaise == null ? '—' : formatBillMoney(row.invoice.totalPaise)}
      </td>
      <td className="px-4 py-3">{row.invoice?.paymentStatus ?? (row.invoice ? 'Unverified snapshot' : 'No receipt')}</td>
      <td className="px-4 py-3 font-mono text-[10px] text-gink-46">{row.sessionId.slice(0, 8).toUpperCase()}</td>
    </tr>
  );
}
