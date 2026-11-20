import type { Metadata } from 'next';
import Link from 'next/link';
import { InvoiceHistoryScreen } from '@/components/screens/InvoiceHistoryScreen';
import { EinvoiceReconciliationPanel } from '@/components/screens/EinvoiceReconciliationPanel';
import { InvoiceNotesPanel, type NoteSourceDocument } from '@/components/screens/InvoiceNotesPanel';
import { hasIrnHold } from '@/lib/invoice';
import { getInvoiceHistory, type InvoiceHistoryRow } from '@/lib/db/invoice-history';
import { getInvoiceNotes } from '@/lib/db/invoice-notes';
import { getEinvoiceReconciliation } from '@/lib/db/einvoice-reconciliation';
import { getOutletBar } from '@/lib/db/outlet-bar';

export const metadata: Metadata = { title: 'Invoice history · AutoDine', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function InvoiceHistoryPage() {
  const [result, outlet, reconciliation, notesResult] = await Promise.all([getInvoiceHistory(), getOutletBar(), getEinvoiceReconciliation(), getInvoiceNotes()]);
  const reconciliationPanel =
    reconciliation.ok && reconciliation.visible ? <>
      <Link className="mb-3 inline-block text-sm font-semibold underline underline-offset-2" href="/dashboard/reports/irp">Open E-invoice / IRP register</Link>
      <EinvoiceReconciliationPanel rows={reconciliation.rows} />
    </> : null;
  if (!result.ok) {
    const message = result.reason === 'role-denied'
      ? 'Invoice history is available only to owner, manager and cashier roles.'
      : result.reason === 'unconfigured'
        ? 'Connect the restaurant database to view saved invoice history.'
        : 'Sign in with an authorized restaurant account to view invoice history.';
    return (
      <main data-surface="owner" className="min-h-dvh bg-paper-deep p-6 text-gink">
        <section className="mx-auto max-w-[620px] rounded-[14px] border border-hair bg-card p-6">
          <h1 className="text-[20px] font-semibold">Invoice history unavailable</h1>
          <p className="mt-2 text-[13px] text-gink-64">{message}</p>
        </section>
      </main>
    );
  }
  // Notes are owner/manager-only; cashiers keep plain invoice history. If the
  // notes migration has not been applied, say so — never pretend notes don't exist.
  const notesPanel = notesResult.ok
    ? (
      <InvoiceNotesPanel
        notes={notesResult.notes}
        sources={noteSources(result.rows)}
        mayWrite={notesResult.canWrite}
        owner={notesResult.role === 'owner'}
      />
    )
    : notesResult.reason === 'unconfigured'
      ? (
        <section aria-label="Credit and debit notes unavailable" className="mb-6 rounded-[14px] border border-hair bg-card p-5">
          <h2 className="text-[13px] font-semibold tracking-[0.02em] text-gink">Credit &amp; debit notes unavailable</h2>
          <p className="mt-2 text-[11.5px] leading-[1.5] text-gink-64">
            This deployment does not have the credit/debit-note tables yet (migration 20261114000500, not applied
            outside the disposable test environment). No note can be issued or shown here.
          </p>
        </section>
      )
      : null;
  return <InvoiceHistoryScreen rows={result.rows} outlet={outlet} einvoiceFollowUps={<>{reconciliationPanel}{notesPanel}</>} />;
}

/** Restrict the picker to saved Rule 53 facts. The issue RPC is authoritative. */
function noteSources(rows: InvoiceHistoryRow[]): NoteSourceDocument[] {
  const seen = new Map<string, NoteSourceDocument>();
  for (const row of rows) {
    const invoice = row.invoice;
    if (!invoice || invoice.status !== 'issued') continue;
    if (invoice.documentType !== 'gst_tax_invoice' || !invoice.noteParticularsRecorded) continue;
    if (!seen.has(invoice.id)) {
      seen.set(invoice.id, {
        invoiceId: invoice.id,
        number: invoice.number,
        documentType: invoice.documentType,
        totalPaise: invoice.totalPaise,
        irnHeld: hasIrnHold(invoice),
        activated: invoice.activated,
      });
    }
  }
  return [...seen.values()];
}
