import { getStaffContextDetailed } from '@/lib/db/staff';
import { publicAssetUrl } from '@/lib/storage/assets';
import type { RestaurantPaymentReceipt } from '@/lib/db/types';

export type PaymentReceiptData = {
  id: string;
  restaurantId: string;
  invoiceId: string;
  reference: string;
  invoiceNumber: string;
  issuedAt: string;
  seller: { name: string; address: string; phone: string | null; logoUrl: string | null };
  tableLabel: string | null;
  method: string;
  amountPaise: number;
  receivedAt: string;
  totalPaidPaise: number;
  outstandingPaise: number;
  paymentStatus: 'paid' | 'partially_paid';
};

export type PaymentReceiptResult =
  | { ok: true; receipt: PaymentReceiptData }
  | { ok: false; reason: 'unconfigured' | 'signed-out' | 'no-membership' | 'not-found' };

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const required = (value: unknown, field: string): string => {
  const parsed = text(value).trim();
  if (!parsed) throw new Error(`The payment receipt is missing ${field}.`);
  return parsed;
};
const money = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('The payment receipt contains an invalid amount.');
  }
  return parsed;
};

function formatWhen(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: timezone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function parseReceipt(row: RestaurantPaymentReceipt, timezone: string): PaymentReceiptData {
  const snapshot = object(row.snapshot);
  const seller = object(snapshot.seller);
  const paidOutstanding = money(snapshot.outstanding_paise);
  const status = snapshot.payment_status === 'paid' ? 'paid' : 'partially_paid';
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    invoiceId: row.invoice_id,
    reference: row.receipt_reference,
    invoiceNumber: required(snapshot.invoice_number, 'the invoice reference'),
    issuedAt: formatWhen(row.issued_at, timezone),
    seller: {
      name: required(seller.name, 'the restaurant name'),
      address: required(seller.address, 'the restaurant address'),
      phone: typeof seller.phone === 'string' ? seller.phone : null,
      logoUrl: publicAssetUrl(typeof seller.logo_path === 'string' ? seller.logo_path : null),
    },
    tableLabel: typeof snapshot.table_label === 'string' ? snapshot.table_label : null,
    method: required(snapshot.payment_method, 'the payment method'),
    amountPaise: money(snapshot.payment_amount_paise),
    receivedAt: formatWhen(required(snapshot.payment_received_at, 'the payment time'), timezone),
    totalPaidPaise: money(snapshot.total_paid_paise),
    outstandingPaise: paidOutstanding,
    paymentStatus: status,
  };
}

export async function getPaymentReceiptData(receiptId: string): Promise<PaymentReceiptResult> {
  if (!receiptId) return { ok: false, reason: 'not-found' };
  const staff = await getStaffContextDetailed();
  if (!staff.ok) return { ok: false, reason: staff.reason };
  const { supabase, restaurantId, timezone } = staff.context;

  const { data, error } = await supabase
    .from('restaurant_payment_receipts')
    .select('id, restaurant_id, invoice_id, payment_id, sequence_number, receipt_reference, issued_at, snapshot, created_at')
    .eq('id', receiptId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the payment receipt: ${error.message}`);
  if (!data) return { ok: false, reason: 'not-found' };

  return {
    ok: true,
    receipt: parseReceipt(data as unknown as RestaurantPaymentReceipt, timezone),
  };
}
