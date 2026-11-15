import type { Metadata } from 'next';
import { InvoiceHistoryScreen } from '@/components/screens/InvoiceHistoryScreen';
import { EinvoiceReconciliationPanel } from '@/components/screens/EinvoiceReconciliationPanel';
import { InvoiceNotesPanel, type NoteSourceDocument } from '@/components/screens/InvoiceNotesPanel';
import { getInvoiceHistory } from '@/lib/db/invoice-history';
import { getInvoiceNotes } from '@/lib/db/invoice-notes';
import { getEinvoiceReconciliation } from '@/lib/db/einvoice-reconciliation';
import { getOutletBar } from '@/lib/db/outlet-bar';

export const metadata: Metadata = { title: 'Invoice history · AutoDine', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function InvoiceHistoryPage() {
  const [result, outlet, reconciliation, notesResult] = await Promise.all([getInvoiceHistory(), getOutletBar(), getEinvoiceReconciliation(), getInvoiceNotes()]);
  const reconciliationPanel =
    reconciliation.ok && reconciliation.visible ? <EinvoiceReconciliationPanel rows={reconciliation.rows} /> : null;
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

/** Issued GST documents are the only note-eligible sources. Voided and plain
 * receipts are excluded here AND refused by the database. */
function noteSources(rows: { invoice: { id: string; number: string; status: 'issued' | 'voided'; totalPaise: number | null; documentType: 'receipt' | 'gst_tax_invoice' | 'bill_of_supply' } | null }[]): NoteSourceDocument[] {
  const seen = new Map<string, NoteSourceDocument>();
  for (const row of rows) {
    const invoice = row.invoice;
    if (!invoice || invoice.status !== 'issued') continue;
    if (invoice.documentType !== 'gst_tax_invoice' && invoice.documentType !== 'bill_of_supply') continue;
    if (!seen.has(invoice.id)) {
      seen.set(invoice.id, {
        invoiceId: invoice.id,
        number: invoice.number,
        documentType: invoice.documentType,
        totalPaise: invoice.totalPaise,
      });
    }
  }
  return [...seen.values()];
}
