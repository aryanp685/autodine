import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InvoiceHistoryScreen } from './InvoiceHistoryScreen';

const row = {
  sessionId: 'a3f2ee50-284a-4e56-b751-8abf2e1ac2cf',
  tableLabel: 'T-4',
  openedAt: '2026-10-28T10:00:00.000Z',
  closedAt: '2026-10-28T10:30:00.000Z',
  invoice: {
    id: '9c5fbf7d-b990-45d3-88c1-27690f8cd736',
    number: 'AD/26-27/00042',
    status: 'issued' as const,
    issuedAt: '2026-10-28T10:31:00.000Z',
    totalPaise: 12500,
    paymentStatus: 'paid' as const,
  },
};

describe('InvoiceHistoryScreen', () => {
  it('links the immutable receipt and shows closed-session and payment details', () => {
    const html = renderToStaticMarkup(<InvoiceHistoryScreen rows={[row]} outlet={null} />);
    expect(html).toContain('Invoice history');
    expect(html).toContain('Table T-4');
    expect(html).toContain('AD/26-27/00042');
    expect(html).toContain('href="/invoice/9c5fbf7d-b990-45d3-88c1-27690f8cd736"');
    expect(html).toContain('paid');
    expect(html).toContain('T-4');
  });

  it('keeps closed sessions visible when receipt issuance was blocked', () => {
    const html = renderToStaticMarkup(
      <InvoiceHistoryScreen rows={[{ ...row, invoice: null }]} outlet={null} />,
    );
    expect(html).toContain('Not issued');
    expect(html).toContain('Table T-4');
    expect(html).not.toContain('href="/invoice/');
  });

  it('renders a clear empty state', () => {
    const html = renderToStaticMarkup(<InvoiceHistoryScreen rows={[]} outlet={null} />);
    expect(html).toContain('No closed table sessions yet');
  });
});
