import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock('@/app/(staff)/dashboard/note-actions', () => ({
  issueInvoiceNoteAction: vi.fn(async () => ({ ok: true, id: 'note-1' })),
  voidInvoiceNoteAction: vi.fn(async () => ({ ok: true, id: 'note-1' })),
}));

import { InvoiceNotesPanel, type NoteSourceDocument } from './InvoiceNotesPanel';
import type { InvoiceNoteRow } from '@/lib/db/invoice-notes';

const source: NoteSourceDocument = {
  invoiceId: '9c5fbf7d-b990-45d3-88c1-27690f8cd736',
  number: 'TI/26-27/00042',
  documentType: 'gst_tax_invoice',
  totalPaise: 118000,
};

const liveNote: InvoiceNoteRow = {
  id: 'note-1',
  invoiceId: source.invoiceId,
  documentType: 'credit_note',
  documentNumber: 'CN/26-27/000007',
  status: 'issued',
  reasonCode: 'returned_supply',
  reason: 'Guest returned the full supply',
  totalPaise: 118000,
  taxablePaise: 100000,
  cgstPaise: 9000,
  sgstPaise: 9000,
  igstPaise: 0,
  irpStatus: 'pending',
  sourceDocumentNumber: 'TI/26-27/00042',
  issuedAt: '2026-11-10T10:00:00.000Z',
  voidedAt: null,
  voidReason: null,
};

describe('InvoiceNotesPanel', () => {
  it('offers both note kinds against an eligible GST document', () => {
    const html = renderToStaticMarkup(<InvoiceNotesPanel notes={[]} sources={[source]} />);
    expect(html).toContain('Credit &amp; debit notes');
    expect(html).toContain('TI/26-27/00042');
    expect(html).toContain('aria-label="Issue credit note for TI/26-27/00042"');
    expect(html).toContain('aria-label="Issue debit note for TI/26-27/00042"');
    // Honest boundary copy is present, always.
    expect(html).toContain('whole source document');
    expect(html).not.toContain('partial line');
  });

  it('disables the note kind that already has a live note', () => {
    const html = renderToStaticMarkup(<InvoiceNotesPanel notes={[liveNote]} sources={[source]} />);
    const creditTag = html.match(/<button[^>]*aria-label="Issue credit note[^"]*"[^>]*>/)?.[0] ?? '';
    const debitTag = html.match(/<button[^>]*aria-label="Issue debit note[^"]*"[^>]*>/)?.[0] ?? '';
    expect(html).toContain('Credit note live');
    expect(creditTag).toContain('disabled=""');
    expect(debitTag).not.toContain('disabled=""');
  });

  it('shows an issued note in the ledger with its IRP-pending honesty label', () => {
    const html = renderToStaticMarkup(<InvoiceNotesPanel notes={[liveNote]} sources={[]} />);
    expect(html).toContain('CN/26-27/000007');
    expect(html).toContain('IRN pending — not a valid e-invoice until generated');
    expect(html).toContain('Against TI/26-27/00042');
    expect(html).toContain('Void note');
  });

  it('explains that no issued GST documents means no notes', () => {
    const html = renderToStaticMarkup(<InvoiceNotesPanel notes={[]} sources={[]} />);
    expect(html).toContain('No issued GST documents');
  });

  it('renders a voided note without a void control', () => {
    const html = renderToStaticMarkup(
      <InvoiceNotesPanel notes={[{ ...liveNote, status: 'voided', voidedAt: '2026-11-11T10:00:00.000Z', voidReason: 'Issued against the wrong document' }]} sources={[source]} />,
    );
    expect(html).toContain('voided');
    expect(html).toContain('Issued against the wrong document');
    const voidButtons = html.match(/Void note/g) ?? [];
    expect(voidButtons.length).toBe(0);
  });
});
