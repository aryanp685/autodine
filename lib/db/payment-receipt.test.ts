import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const builder = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  for (const method of ['from', 'select', 'eq'] as const) builder[method].mockReturnValue(builder);
  return {
    builder,
    staffResult: null as unknown,
    queryResult: null as unknown,
  };
});

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: async () => mocks.staffResult,
}));
vi.mock('@/lib/storage/assets', () => ({
  publicAssetUrl: (path: string | null) => path ? `https://assets.example/${path}` : null,
}));

import { getPaymentReceiptData } from './payment-receipt';

const ID = 'receipt-1';
const ROW = {
  id: ID,
  restaurant_id: 'restaurant-1',
  invoice_id: 'invoice-1',
  payment_id: 'payment-1',
  sequence_number: 1,
  receipt_reference: 'PR/26-27/000001-01',
  issued_at: '2026-11-08T14:35:00.000Z',
  snapshot: {
    invoice_number: 'INV/26-27/000001',
    seller: {
      name: 'Maddi',
      address: '12 Baner Road, Pune',
      phone: '9876543210',
      logo_path: 'restaurant-1/logo.webp',
    },
    table_label: 'T3',
    payment_method: 'upi',
    payment_amount_paise: 50000,
    payment_received_at: '2026-11-08T14:35:00.000Z',
    total_paid_paise: 50000,
    outstanding_paise: 60853,
    payment_status: 'partially_paid',
  },
  created_at: '2026-11-08T14:35:00.000Z',
};

beforeEach(() => {
  mocks.builder.from.mockClear();
  mocks.builder.select.mockClear();
  mocks.builder.eq.mockClear();
  mocks.builder.maybeSingle.mockReset();
  mocks.staffResult = {
    ok: true,
    context: {
      supabase: mocks.builder,
      restaurantId: 'restaurant-1',
      timezone: 'Asia/Kolkata',
    },
  };
  mocks.builder.maybeSingle.mockResolvedValue({ data: ROW, error: null });
});

describe('getPaymentReceiptData', () => {
  it('loads the supplemental receipt only inside the active restaurant and parses its frozen snapshot', async () => {
    expect(await getPaymentReceiptData(ID)).toEqual({
      ok: true,
      receipt: expect.objectContaining({
        id: ID,
        restaurantId: 'restaurant-1',
        invoiceId: 'invoice-1',
        reference: 'PR/26-27/000001-01',
        invoiceNumber: 'INV/26-27/000001',
        seller: expect.objectContaining({
          name: 'Maddi',
          logoUrl: 'https://assets.example/restaurant-1/logo.webp',
        }),
        tableLabel: 'T3',
        method: 'upi',
        amountPaise: 50000,
        totalPaidPaise: 50000,
        outstandingPaise: 60853,
        paymentStatus: 'partially_paid',
      }),
    });
    expect(mocks.builder.from).toHaveBeenCalledWith('restaurant_payment_receipts');
    expect(mocks.builder.eq).toHaveBeenCalledWith('restaurant_id', 'restaurant-1');
  });

  it('does not reveal a receipt from another restaurant', async () => {
    mocks.builder.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getPaymentReceiptData(ID)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('rejects an empty id before resolving staff context', async () => {
    expect(await getPaymentReceiptData('')).toEqual({ ok: false, reason: 'not-found' });
    expect(mocks.builder.from).not.toHaveBeenCalled();
  });
});
