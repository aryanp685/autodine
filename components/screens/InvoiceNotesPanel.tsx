'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { formatBillMoney } from '@/lib/bill';
import { NOTE_REASON_CODES, NOTE_REASON_LABELS, type NoteDocumentType, type NoteReasonCode } from '@/lib/gst/notes';
import type { InvoiceNoteRow } from '@/lib/db/invoice-notes';
import { issueInvoiceNoteAction, voidInvoiceNoteAction } from '@/app/(staff)/dashboard/note-actions';

export type NoteSourceDocument = {
  invoiceId: string;
  number: string;
  documentType: 'gst_tax_invoice' | 'bill_of_supply';
  totalPaise: number | null;
};

const IRP_LABEL: Record<InvoiceNoteRow['irpStatus'], string> = {
  not_required: 'B2C · no IRN required',
  pending: 'IRN pending — not a valid e-invoice until generated',
  generated: 'IRN generated',
  failed: 'IRP failed — never treat as valid',
  cancelled: 'IRN cancelled',
};

function kindLabel(kind: NoteDocumentType): string {
  return kind === 'credit_note' ? 'Credit note' : 'Debit note';
}

/**
 * Credit/debit notes against GST documents, owner/manager only.
 *
 * Honest boundaries, deliberate:
 *   * FULL-document notes only — no line-level or partial-amount adjustment;
 *     a partial correction is void + re-issue, same as the rest of AutoDine.
 *   * Only issued GST tax invoices / Bills of Supply admit a note; a plain
 *     receipt never does (the database refuses it too).
 *   * The app invents no GST rate, threshold or liability rule; amounts are
 *     copied from the immutable parent snapshot by the database.
 *   * An e-invoice-applicable parent forces its note to `pending` — it is not
 *     valid until an IRN exists. No IRN is ever minted in this build.
 */
export function InvoiceNotesPanel({ notes, sources }: { notes: InvoiceNoteRow[]; sources: NoteSourceDocument[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [issueFor, setIssueFor] = useState<{ invoiceId: string; kind: NoteDocumentType } | null>(null);
  const [voidFor, setVoidFor] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState<NoteReasonCode>('returned_supply');
  const [reason, setReason] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const liveNotes = new Map<string, Set<NoteDocumentType>>();
  for (const note of notes) {
    if (note.status !== 'issued') continue;
    const set = liveNotes.get(note.invoiceId) ?? new Set<NoteDocumentType>();
    set.add(note.documentType);
    liveNotes.set(note.invoiceId, set);
  }

  const submitIssue = (invoiceId: string, kind: NoteDocumentType) => {
    setMessage(null);
    startTransition(async () => {
      const result = await issueInvoiceNoteAction({ invoiceId, documentType: kind, reasonCode, reason });
      if (result.ok) {
        setIssueFor(null);
        setReason('');
        setReasonCode('returned_supply');
        setMessage({ tone: 'ok', text: `${kindLabel(kind)} issued. It now appears in the ledger below.` });
        router.refresh();
      } else {
        setMessage({ tone: 'err', text: result.error });
      }
    });
  };

  const submitVoid = (noteId: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await voidInvoiceNoteAction({ noteId, reason: voidReason });
      if (result.ok) {
        setVoidFor(null);
        setVoidReason('');
        setMessage({ tone: 'ok', text: 'Note voided. It remains in the ledger, marked voided.' });
        router.refresh();
      } else {
        setMessage({ tone: 'err', text: result.error });
      }
    });
  };

  return (
    <section aria-label="Credit and debit notes" className="mb-6 rounded-[14px] border border-hair bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold tracking-[0.02em] text-gink">Credit &amp; debit notes</h2>
        <p className="text-[10.5px] text-gink-46">
          Full-document adjustments against GST tax invoices / Bills of Supply · owner/manager only
        </p>
      </div>

      <p className="mt-2 max-w-[72ch] text-[11.5px] leading-[1.5] text-gink-64">
        A note covers the whole source document; partial corrections are void + re-issue. The app does not
        decide whether one is legally due — amounts and tax come from the immutable parent snapshot. Notes
        against e-invoice-applicable documents stay IRN-pending until a provider issues one; none is issued here.
      </p>

      {message ? (
        <p role={message.tone === 'err' ? 'alert' : 'status'}
           className={`mt-3 rounded-[var(--p-r-control)] border px-3 py-2 text-[12px] ${message.tone === 'err' ? 'border-[var(--p-due)] text-[var(--p-due)]' : 'border-hair text-gink'}`}>
          {message.text}
        </p>
      ) : null}

      {sources.length === 0 ? (
        <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-64">
          No issued GST documents on this screen yet. Plain receipts never admit a note; once a GST tax
          invoice or Bill of Supply exists here, notes can be issued against it.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-hair">
          {sources.map((source) => {
            const live = liveNotes.get(source.invoiceId) ?? new Set<NoteDocumentType>();
            const open = issueFor?.invoiceId === source.invoiceId ? issueFor : null;
            return (
              <li key={source.invoiceId} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[12px] text-gink">{source.number}</p>
                    <p className="mt-0.5 text-[10.5px] text-gink-46">
                      {source.documentType === 'gst_tax_invoice' ? 'Tax invoice' : 'Bill of Supply'}
                      {source.totalPaise != null ? ` · ${formatBillMoney(source.totalPaise)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {(['credit_note', 'debit_note'] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        disabled={pending || live.has(kind)}
                        aria-label={`Issue ${kindLabel(kind).toLowerCase()} for ${source.number}`}
                        onClick={() => { setIssueFor({ invoiceId: source.invoiceId, kind }); setMessage(null); }}
                        className="rounded-[var(--p-r-control)] border border-hair px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gink-64 transition hover:text-gink disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {live.has(kind) ? `${kind === 'credit_note' ? 'Credit' : 'Debit'} note live` : kind === 'credit_note' ? 'Credit note' : 'Debit note'}
                      </button>
                    ))}
                  </div>
                </div>
                {open ? (
                  <form
                    className="mt-3 flex flex-col gap-2 rounded-[var(--p-r-control)] border border-hair bg-paper-deep p-3"
                    onSubmit={(event) => { event.preventDefault(); submitIssue(source.invoiceId, open.kind); }}
                  >
                    <p className="text-[11px] font-semibold text-gink">{kindLabel(open.kind)} for {source.number} — full document</p>
                    <label className="text-[11px] text-gink-64">
                      Reason
                      <select
                        value={reasonCode}
                        onChange={(event) => setReasonCode(event.target.value as NoteReasonCode)}
                        className="mt-1 block w-full rounded-[var(--p-r-control)] border border-hair bg-card px-2 py-2 text-[12px] text-gink"
                        required
                      >
                        {NOTE_REASON_CODES.map((code) => (
                          <option key={code} value={code}>{NOTE_REASON_LABELS[code]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] text-gink-64">
                      Details (5–500 characters)
                      <textarea
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        minLength={5}
                        maxLength={500}
                        required
                        rows={2}
                        className="mt-1 block w-full rounded-[var(--p-r-control)] border border-hair bg-card px-2 py-2 text-[12px] text-gink"
                        placeholder="Why this note is being issued"
                      />
                    </label>
                    <div className="flex items-center gap-2">
                      <button type="submit" disabled={pending}
                        className="rounded-[var(--p-r-control)] bg-grass px-3 py-2 text-[11.5px] font-semibold text-cream disabled:opacity-50">
                        Issue {kindLabel(open.kind).toLowerCase()}
                      </button>
                      <button type="button" onClick={() => setIssueFor(null)}
                        className="px-3 py-2 text-[11.5px] font-medium text-gink-64 hover:text-gink">
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {notes.length > 0 ? (
        <div className="mt-4 border-t border-hair pt-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gink-46">Note ledger</h3>
          <ul className="mt-2 divide-y divide-hair">
            {notes.map((note) => (
              <li key={note.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[12px] text-gink">
                      {note.documentNumber}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${note.status === 'issued' ? 'bg-grass/10 text-grass' : 'bg-paper-deep text-gink-46'}`}>
                        {note.status}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-gink-46">
                      Against {note.sourceDocumentNumber} · {formatBillMoney(note.totalPaise)} · {NOTE_REASON_LABELS[note.reasonCode]} — {note.reason}
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-gink-46">
                      {IRP_LABEL[note.irpStatus]} · issued {new Date(note.issuedAt).toLocaleString('en-IN')}
                      {note.status === 'voided' && note.voidReason ? ` · voided: ${note.voidReason}` : ''}
                    </p>
                  </div>
                  {note.status === 'issued' ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => { setVoidFor(note.id); setMessage(null); }}
                      className="rounded-[var(--p-r-control)] border border-hair px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gink-64 hover:text-gink disabled:opacity-40"
                    >
                      Void note
                    </button>
                  ) : null}
                </div>
                {voidFor === note.id ? (
                  <form
                    className="mt-3 flex flex-col gap-2 rounded-[var(--p-r-control)] border border-hair bg-paper-deep p-3"
                    onSubmit={(event) => { event.preventDefault(); submitVoid(note.id); }}
                  >
                    <p className="text-[11px] font-semibold text-gink">Void {note.documentNumber} — it stays in the ledger</p>
                    <label className="text-[11px] text-gink-64">
                      Void reason (5–500 characters)
                      <textarea
                        value={voidReason}
                        onChange={(event) => setVoidReason(event.target.value)}
                        minLength={5}
                        maxLength={500}
                        required
                        rows={2}
                        className="mt-1 block w-full rounded-[var(--p-r-control)] border border-hair bg-card px-2 py-2 text-[12px] text-gink"
                        placeholder="Why this note is being voided"
                      />
                    </label>
                    <div className="flex items-center gap-2">
                      <button type="submit" disabled={pending}
                        className="rounded-[var(--p-r-control)] bg-grass px-3 py-2 text-[11.5px] font-semibold text-cream disabled:opacity-50">
                        Void note
                      </button>
                      <button type="button" onClick={() => setVoidFor(null)}
                        className="px-3 py-2 text-[11.5px] font-medium text-gink-64 hover:text-gink">
                        Keep note
                      </button>
                    </div>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
