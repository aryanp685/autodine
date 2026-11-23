import { getStaffContextDetailed } from '@/lib/db/staff';
import { qrSvg } from '@/lib/qr';
import { publicAssetUrl } from '@/lib/storage/assets';
import type { RestaurantInvoice, RestaurantInvoiceLine, RestaurantPaymentReceipt } from '@/lib/db/types';

export type GstSnapshotData = {
  mode: 'regular' | 'composition';
  regularProfile: 'other_than_specified_premises' | 'specified_premises' | null;
  profileNotification: string | null;
  rateBps: number;
  cgstBps: number;
  sgstBps: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  placeOfSupplyStateCode: string | null;
  interState: boolean;
  configVersion: number;
  notice: string | null;
};

export type GstIrnStatus = 'not_required' | 'pending' | 'generated' | 'failed' | 'cancelled';

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

export type InvoiceShareLinkData = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
};

export type ReceiptData = {
  id: string;
  restaurantId: string;
  number: string;
  financialYear: string;
  documentType: 'receipt' | 'gst_tax_invoice' | 'bill_of_supply';
  /** e-Invoice state. */
  irpStatus: GstIrnStatus;
  irn: string | null;
  ackNo?: string | null;
  ackDate?: string | null;
  signedQrPayload?: string | null;
  signedQrSvg?: string | null;
  irpProvider?: string | null;
  irpGeneratedAt?: string | null;
  irpCancelledAt?: string | null;
  irpCancelReason?: string | null;
  /** B2B buyer details, present only on regular GST tax invoices issued for a business customer. */
  recipient: {
    name: string;
    gstin: string;
    stateCode: string;
    address: string | null;
    email: string | null;
  } | null;
  /** Immutable GST decomposition; null for non-GST receipts. */
  gst: GstSnapshotData | null;
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
    /** GST identity, present only on GST documents. */
    gstin: string | null;
    legalName: string | null;
    tradeName: string | null;
    stateCode: string | null;
    fssaiNumber?: string | null;
    billFooterNote?: string | null;
    orderChannel?: string | null;
  };
  totals: {
    subtotalPaise: number;
    ticketDiscountPaise: number;
    billDiscountPaise: number;
    serviceChargePaise?: number;
    packagingChargePaise?: number;
    deliveryChargePaise?: number;
    roundOffPaise?: number;
    taxablePaise: number | null;
    taxPaise: number;
    otherChargesPaise: number;
    totalPaise: number;
    paidPaise: number;
    outstandingPaise: number;
    paymentStatus: 'paid' | 'unpaid';
  };
  printCount?: number;
  payments: InvoicePaymentData[];
  paymentReceipts: InvoicePaymentReceiptData[];
  shareLinks?: InvoiceShareLinkData[];
  lines: InvoiceLineData[];
};

export type InvoiceResult =
  | { ok: true; invoice: ReceiptData; /** Staff role of the viewer (drives UI affordances; the server re-checks). */ role: string }
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
const signedInteger = (value: unknown): number => {
  if (value == null) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('The saved receipt contains an invalid round-off value.');
  }
  return parsed;
};
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

function parseGstSnapshot(value: unknown): GstSnapshotData | null {
  if (value === null || value === undefined) return null;
  const snap = object(value);
  if (!Object.keys(snap).length) return null;
  const mode = snap.mode;
  if (mode !== 'regular' && mode !== 'composition') {
    throw new Error('The saved document carries an unknown GST mode.');
  }
  const regularProfile = snap.regular_profile;
  if (
    regularProfile !== null && regularProfile !== 'other_than_specified_premises' && regularProfile !== 'specified_premises'
  ) {
    throw new Error('The saved document carries an unknown GST profile.');
  }
  return {
    mode,
    regularProfile: regularProfile ?? null,
    profileNotification: nullableText(snap.profile_notification),
    rateBps: integer(snap.rate_bps),
    cgstBps: integer(snap.cgst_bps),
    sgstBps: integer(snap.sgst_bps),
    taxablePaise: integer(snap.taxable_paise),
    cgstPaise: integer(snap.cgst_paise),
    sgstPaise: integer(snap.sgst_paise),
    igstPaise: integer(snap.igst_paise),
    placeOfSupplyStateCode: nullableText(snap.place_of_supply_state_code),
    interState: snap.inter_state === true,
    configVersion: integer(snap.config_version),
    notice: nullableText(snap.notice),
  };
}

const IRP_STATUSES: readonly GstIrnStatus[] = ['not_required', 'pending', 'generated', 'failed', 'cancelled'];

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

export function parseInvoice(
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

  const irpStatus = IRP_STATUSES.includes(row.irp_status) ? row.irp_status : 'not_required';
  const customer = object(row.customer_snapshot);
  const recipientGstin = nullableText(customer.gstin);
  const recipient = recipientGstin
    ? {
        name: requiredText(customer.name, 'the buyer legal name'),
        gstin: recipientGstin,
        stateCode: nullableText(customer.state_code) ?? recipientGstin.slice(0, 2),
        address: nullableText(customer.address),
        email: nullableText(customer.email),
      }
    : null;
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    number: row.invoice_number,
    financialYear: row.financial_year,
    documentType: row.document_type,
    irpStatus,
    irn: nullableText(row.irn),
    ackNo: nullableText(row.ack_no),
    ackDate: row.ack_date ? formatWhen(row.ack_date, timezone) : null,
    signedQrPayload: nullableText(row.signed_qr_payload),
    irpProvider: nullableText(row.irp_provider),
    irpGeneratedAt: row.irp_generated_at ?? null,
    irpCancelledAt: row.irp_cancelled_at ? formatWhen(row.irp_cancelled_at, timezone) : null,
    irpCancelReason: nullableText(row.irp_cancel_reason),
    recipient,
    gst: parseGstSnapshot(row.gst_snapshot),
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
      gstin: nullableText(seller.gstin),
      legalName: nullableText(seller.legal_name),
      tradeName: nullableText(seller.trade_name),
      stateCode: nullableText(seller.state_code),
      fssaiNumber: nullableText(seller.fssai_number),
      billFooterNote: nullableText(seller.bill_footer_note),
      orderChannel: nullableText(seller.order_channel),
    },
    totals: {
      subtotalPaise: integer(totals.subtotal_paise),
      ticketDiscountPaise: integer(totals.ticket_discount_paise),
      billDiscountPaise: integer(totals.bill_discount_paise),
      serviceChargePaise: totals.service_charge_paise != null ? integer(totals.service_charge_paise) : 0,
      packagingChargePaise: totals.packaging_charge_paise != null ? integer(totals.packaging_charge_paise) : 0,
      deliveryChargePaise: totals.delivery_charge_paise != null ? integer(totals.delivery_charge_paise) : 0,
      roundOffPaise: signedInteger(totals.round_off_paise),
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

  const baseSelect =
    'id, restaurant_id, order_session_id, invoice_number, financial_year, sequence_number, document_type, status, issued_at, issued_by, table_label_snapshot, session_opened_at, session_closed_at, seller_snapshot, customer_snapshot, totals_snapshot, payment_snapshot, source_order_ids, supersedes_invoice_id, voided_at, voided_by, void_reason, created_at, gst_snapshot, irn, irp_status';
  const extendedSelect = `${baseSelect}, ack_no, ack_date, signed_qr_payload, irp_provider, irp_generated_at, irp_cancelled_at, irp_cancel_reason`;

  let { data: invoice, error } = await supabase
    .from('restaurant_invoices')
    .select(extendedSelect)
    .eq('id', invoiceId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (error && /ack_no|signed_qr_payload|does not exist|schema cache/i.test(error.message)) {
    const fallback = await supabase
      .from('restaurant_invoices')
      .select(baseSelect)
      .eq('id', invoiceId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    invoice = fallback.data as typeof invoice;
    error = fallback.error;
  }

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

  // Older non-production stacks may not have the share-link migration yet.
  // Receipt viewing must continue to work there; create/revoke actions will
  // report the missing function if an operator explicitly tries to use them.
  const shareLinksResult = await supabase.rpc('list_restaurant_invoice_share_links', {
    p_invoice_id: invoice.id,
  });
  const shareLinks = (shareLinksResult.error ? [] : (shareLinksResult.data ?? [])).map((link) => ({
    id: link.id,
    createdAt: link.created_at,
    expiresAt: link.expires_at,
    revokedAt: link.revoked_at,
    lastAccessedAt: link.last_accessed_at,
    accessCount: Number(link.access_count),
  }));

  const reprintResult = await supabase
    .from('restaurant_invoice_reprints')
    .select('copy_number')
    .eq('invoice_id', invoice.id)
    .order('copy_number', { ascending: false })
    .limit(1);
  const printCount = reprintResult.error ? 0 : Number(reprintResult.data?.[0]?.copy_number ?? 0);

  const parsed = parseInvoice(
    invoice as unknown as RestaurantInvoice,
    (lines ?? []) as unknown as RestaurantInvoiceLine[],
    (paymentReceipts ?? []) as unknown as RestaurantPaymentReceipt[],
    timezone,
  );
  const signedQrSvg = parsed.signedQrPayload ? await qrSvg(parsed.signedQrPayload) : null;

  return {
    ok: true,
    role: staff.context.role,
    invoice: {
      ...parsed,
      signedQrSvg,
      shareLinks,
      printCount,
    },
  };
}

