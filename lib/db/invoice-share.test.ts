import { createHash, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ rpc }) }));

import { getSharedInvoiceData } from './invoice-share';
import { issuedDocumentTitle } from '@/lib/invoice';

const token = randomBytes(32).toString('base64url');
const base = {
  id: 'synthetic-invoice', invoice_number: 'INV/26-27/000001', status: 'issued', document_type: 'gst_tax_invoice',
  irp_status: 'not_required', issued_at: '2026-11-18T12:00:00Z', order_session_id: 'synthetic-session',
  seller_snapshot: { name: 'Synthetic outlet', address: '1 Test Lane' },
  customer_snapshot: { name: 'Synthetic buyer' },
  totals_snapshot: { subtotal_paise: 10500, total_paise: 10500, tax_paise: 500, amount_paid_paise: 10500, outstanding_paise: 0,
    ticket_discount_paise: 0, bill_discount_paise: 0, other_charges_paise: 0 },
};

beforeEach(() => rpc.mockReset());

describe('expiring receipt output boundary', () => {
  it('uses the digest and still renders a permitted snapshot', async () => {
    rpc.mockResolvedValue({ data: { invoice: base, lines: [] }, error: null });
    expect(await getSharedInvoiceData(token)).toMatchObject({ number: base.invoice_number, totals: { totalPaise: 10500 } });
    expect(rpc).toHaveBeenCalledWith('read_shared_restaurant_invoice', { p_token_hash: createHash('sha256').update(token).digest('hex') });
  });

  it('reads the saved retail identity and dates the FY number in India, not the current outlet zone', async () => {
    rpc.mockResolvedValue({ data: { timezone: 'UTC', invoice: {
      ...base, document_type: 'receipt', invoice_number: 'RBL/26-27/000001', issued_at: '2026-03-31T18:30:00Z',
      seller_snapshot: { ...base.seller_snapshot, fssai_number: '01234567890123', phone: '07120000000' },
      totals_snapshot: { ...base.totals_snapshot, tax_paise: 0 },
    }, lines: [] }, error: null });
    const invoice = await getSharedInvoiceData(token);
    expect(invoice).toMatchObject({ issuedAt: expect.stringContaining('01 Apr 2026'),
      seller: { fssaiNumber: '01234567890123', phone: '07120000000', gstin: null }, gst: null });
    expect(issuedDocumentTitle(invoice!)).toBe('RETAIL BILL / CASH MEMO');
  });

  it.each([
    { irp_status: 'pending' }, { irp_status: 'failed' }, { irp_status: 'generated' },
    { irp_status: 'cancelled' }, { irp_status: undefined }, { status: 'voided' },
  ])('refuses a held, unknown, or voided pre-upgrade API snapshot: %j', async (override) => {
    rpc.mockResolvedValue({ data: { invoice: { ...base, ...override }, lines: [] }, error: null });
    expect(await getSharedInvoiceData(token)).toBeNull();
  });

  it('does not query the API for a malformed token', async () => {
    expect(await getSharedInvoiceData('synthetic-invoice')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
