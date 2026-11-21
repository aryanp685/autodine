import Link from 'next/link';

import type { EinvoiceReconciliationRow } from '@/lib/db/einvoice-reconciliation';

/**
 * e-Invoice follow-ups: documents issued as IRP pending/failed that are not
 * yet valid tax invoices. Rendered owner/manager-only on the invoice history
 * screen; the server re-checks the role and RLS scopes the rows.
 */
export function EinvoiceReconciliationPanel({ rows }: { rows: EinvoiceReconciliationRow[] }) {
  return (
    <section aria-label="e-Invoice follow-ups" className="mb-6 rounded-[14px] border border-hair bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold tracking-[0.02em] text-gink">e-Invoice follow-ups</h2>
        <p className="text-[10.5px] text-gink-46">
          B2B documents not valid until an IRP issues the IRN · attempting records the result in the e-invoice audit
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-64">No documents are waiting for an IRN.</p>
      ) : (
        <ul className="mt-3 divide-y divide-hair">
          {rows.map((row) => (
            <li key={row.invoiceId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="font-mono text-[12px] text-gink">{row.invoiceNumber}</p>
                <p className="mt-0.5 text-[10.5px] text-gink-46">
                  {row.documentType === 'gst_tax_invoice' ? 'Tax invoice' : row.documentType}
                  {row.isB2b ? ' · B2B' : ''} · issued {row.issuedAt ? new Date(row.issuedAt).toLocaleDateString('en-IN') : '—'} ·{' '}
                  {row.attemptCount === 0 ? 'never attempted' : `${row.attemptCount} attempt${row.attemptCount === 1 ? '' : 's'}`}
                  {row.lastAttemptAt ? ` · last ${new Date(row.lastAttemptAt).toLocaleString('en-IN')}` : ''}
                </p>
              </div>
              <span className="flex items-center gap-3">
                <span
                  className={`text-[10.5px] font-semibold uppercase tracking-[0.14em] ${
                    row.irpStatus === 'failed' ? 'text-[var(--p-due)]' : 'text-gink-46'
                  }`}
                >
                  {row.irpStatus === 'failed' ? 'IRP failed' : 'IRN pending'}
                </span>
                <Link href={`/invoice/${row.invoiceId}`} className="text-[11px] font-medium text-gink-64 underline underline-offset-2 hover:text-gink">
                  Open
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
