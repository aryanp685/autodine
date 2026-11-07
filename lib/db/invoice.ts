import { getStaffContextDetailed } from '@/lib/db/staff';
import { publicAssetUrl } from '@/lib/storage/assets';
import type { RestaurantInvoice, RestaurantInvoiceLine, RestaurantPaymentReceipt } from '@/lib/db/types';

export type InvoiceLineData = {
  id: string;
  ticketCode: string;
  itemName: string;
  variant: string | null;
  addons: string[];
  quantity: number;
  unitPricePaise: number;
  amountPaise: number;
  isVeg: boolean;
};

export type InvoicePaymentData = {
  method: string;
  amountPaise: number;
  receivedAt: string;
};

export type InvoicePaymentReceiptData = {
  id: string;
  reference: string;
  amountPaise: number;
  receivedAt: string;
};

export type ReceiptData = {
  id: string;
  restaurantId: string;
  number: string;
  financialYear: string;
  documentType: 'receipt' | 'gst_tax_invoice';
  status: 'issued' | 'voided';
  issuedAt: string;
  issuedBy: string | null;
  supersedesInvoiceId: string | null;
  voidReason: string | null;
  tableLabel: string | null;
  sessionReference: string;
  sessionOpenedAt: string;
  sessionClosedAt: string;
  seller: {
    name: string;
    address: string;
    phone: string | null;
    logoUrl: string | null;
  };
  totals: {
    subtotalPaise: number;
    ticketDiscountPaise: number;
    billDiscountPaise: number;
    taxablePaise: number | null;
    taxPaise: number;
    otherChargesPaise: number;
    totalPaise: number;
    paidPaise: number;
    outstandingPaise: number;
    paymentStatus: 'paid' | 'unpaid';
  };
  payments: InvoicePaymentData[];
  paymentReceipts: InvoicePaymentReceiptData[];
  lines: InvoiceLineData[];
};

export type InvoiceResult =
  | { ok: true; invoice: ReceiptData }
  | { ok: false; reason: 'unconfigured' | 'signed-out' | 'no-membership' | 'not-found' };

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const nullableText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;
const integer = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('The saved receipt contains an invalid money or quantity value.');
  }
  return parsed;
};
const nullableInteger = (value: unknown): number | null =>
  value == null ? null : integer(value);
const requiredText = (value: unknown, field: string): string => {
  const parsed = text(value).trim();
  if (!parsed) throw new Error(`The saved receipt is missing ${field}.`);
  return parsed;
};

function formatWhen(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone,
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

function parseLine(row: RestaurantInvoiceLine): InvoiceLineData {
  const line = object(row.line_snapshot);
  const addons = Array.isArray(line.addons)
    ? line.addons.filter((value): value is string => typeof value === 'string')
    : [];
  const quantity = integer(line.quantity);
  if (quantity === 0) throw new Error('The saved receipt contains an invalid item quantity.');
  return {
    id: row.id,
    ticketCode: requiredText(line.ticket_code, 'a ticket reference'),
    itemName: requiredText(line.item_name, 'an item name'),
    variant: nullableText(line.variant),
    addons,
    quantity,
    unitPricePaise: integer(line.unit_price_paise),
    amountPaise: integer(line.amount_paise),
    isVeg: line.is_veg === true,
  };
}

function parsePayment(value: unknown, timezone: string): InvoicePaymentData | null {
  const payment = object(value);
  if (typeof payment.method !== 'string') return null;
  const at = text(payment.received_at);
  return {
    method: payment.method,
    amountPaise: integer(payment.amount_paise),
    receivedAt: at ? formatWhen(at, timezone) : '—',
  };
}

function parsePaymentReceipt(row: RestaurantPaymentReceipt, timezone: string): InvoicePaymentReceiptData {
  const snapshot = object(row.snapshot);
  const receivedAt = text(snapshot.payment_received_at) || row.issued_at;
  return {
    id: row.id,
    reference: requiredText(row.receipt_reference, 'a payment receipt reference'),
    amountPaise: integer(snapshot.payment_amount_paise),
    receivedAt: formatWhen(receivedAt, timezone),
  };
}

function parseInvoice(
  row: RestaurantInvoice,
  rows: RestaurantInvoiceLine[],
  paymentReceiptRows: RestaurantPaymentReceipt[],
  timezone: string,
): ReceiptData {
  const seller = object(row.seller_snapshot);
  const totals = object(row.totals_snapshot);
  const payments = Array.isArray(row.payment_snapshot)
    ? row.payment_snapshot
        .map((payment) => parsePayment(payment, timezone))
        .filter((payment): payment is InvoicePaymentData => payment !== null)
    : [];
  const lineData = rows.map(parseLine);

  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    number: row.invoice_number,
    financialYear: row.financial_year,
    documentType: row.document_type,
    status: row.status,
    issuedAt: formatWhen(row.issued_at, timezone),
    issuedBy: row.issued_by,
    supersedesInvoiceId: row.supersedes_invoice_id,
    voidReason: row.void_reason,
    tableLabel: row.table_label_snapshot,
    sessionReference: row.order_session_id,
    sessionOpenedAt: formatWhen(row.session_opened_at, timezone),
    sessionClosedAt: formatWhen(row.session_closed_at, timezone),
    seller: {
      name: requiredText(seller.name, 'the restaurant name'),
      address: requiredText(seller.address, 'the restaurant address'),
      phone: nullableText(seller.phone),
      logoUrl: publicAssetUrl(nullableText(seller.logo_path)),
    },
    totals: {
      subtotalPaise: integer(totals.subtotal_paise),
      ticketDiscountPaise: integer(totals.ticket_discount_paise),
      billDiscountPaise: integer(totals.bill_discount_paise),
      taxablePaise: nullableInteger(totals.taxable_paise),
      taxPaise: integer(totals.tax_paise),
      otherChargesPaise: integer(totals.other_charges_paise),
      totalPaise: integer(totals.total_paise),
      paidPaise: integer(totals.amount_paid_paise),
      outstandingPaise: integer(totals.outstanding_paise),
      paymentStatus: totals.payment_status === 'paid' ? 'paid' : 'unpaid',
    },
    payments,
    paymentReceipts: paymentReceiptRows.map((payment) => parsePaymentReceipt(payment, timezone)),
    lines: lineData,
  };
}

export async function getInvoiceData(invoiceId: string): Promise<InvoiceResult> {
  if (!invoiceId) return { ok: false, reason: 'not-found' };
  const staff = await getStaffContextDetailed();
  if (!staff.ok) return { ok: false, reason: staff.reason };
  const { supabase, restaurantId, timezone } = staff.context;

  const { data: invoice, error } = await supabase
    .from('restaurant_invoices')
    .select(
      'id, restaurant_id, order_session_id, invoice_number, financial_year, sequence_number, document_type, status, issued_at, issued_by, table_label_snapshot, session_opened_at, session_closed_at, seller_snapshot, customer_snapshot, totals_snapshot, payment_snapshot, source_order_ids, supersedes_invoice_id, voided_at, voided_by, void_reason, created_at'
    )
    .eq('id', invoiceId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the receipt: ${error.message}`);
  if (!invoice) return { ok: false, reason: 'not-found' };

  const { data: lines, error: linesError } = await supabase
    .from('restaurant_invoice_lines')
    .select('id, invoice_id, restaurant_id, line_number, source_order_id, source_order_item_id, line_snapshot, created_at')
    .eq('invoice_id', invoice.id)
    .eq('restaurant_id', restaurantId)
    .order('line_number', { ascending: true });
  if (linesError) throw new Error(`Could not load receipt items: ${linesError.message}`);

  const { data: paymentReceipts, error: paymentReceiptsError } = await supabase
    .from('restaurant_payment_receipts')
    .select('id, restaurant_id, invoice_id, payment_id, sequence_number, receipt_reference, issued_at, snapshot, created_at')
    .eq('invoice_id', invoice.id)
    .eq('restaurant_id', restaurantId)
    .order('sequence_number', { ascending: true });
  if (paymentReceiptsError) throw new Error(`Could not load supplemental payment receipts: ${paymentReceiptsError.message}`);

  return {
    ok: true,
    invoice: parseInvoice(
      invoice as unknown as RestaurantInvoice,
      (lines ?? []) as unknown as RestaurantInvoiceLine[],
      (paymentReceipts ?? []) as unknown as RestaurantPaymentReceipt[],
      timezone,
    ),
  };
}

