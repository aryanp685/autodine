import { dbErrorReference } from '@/lib/db/error-reference';
import { directFulfilmentLabel } from '@/lib/gst/place-of-supply';
import { readPrivateIrpCopy } from './irp-document';
import type { VerifiedIrpCopy } from '@/lib/gst/irp/execution/presentation';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { RESTAURANT_TIME_ZONE } from '@/lib/db/time';
import { publicAssetUrl } from '@/lib/storage/assets';
import type { RestaurantInvoice, RestaurantInvoiceLine, RestaurantPaymentReceipt } from '@/lib/db/types';

export type GstSnapshotData = {
  mode: 'regular' | 'composition';
  regularProfile: 'other_than_specified_premises' | 'specified_premises' | null;
  profileNotification: string | null;
  serviceSac?: string | null;
  rateBps: number;
  cgstBps: number;
  sgstBps: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  placeOfSupplyStateCode: string | null;
  interState: boolean;
  reverseCharge?: boolean;
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
  retailBill?: boolean;
  documentType: 'receipt' | 'gst_tax_invoice' | 'bill_of_supply';
  /** e-Invoice state. B2C documents in this build are always 'not_required'. */
  irpStatus: GstIrnStatus;
  irn: string | null;
  verifiedIrp?: VerifiedIrpCopy | null;
  /** B2B buyer details, present only on regular GST tax invoices issued for a business customer. */
  recipient: {
    name: string;
    gstin: string | null;
    stateCode: string;
    address: string | null;
    email: string | null;
    location?: string | null;
    pincode?: string | null;
    phone?: string | null;
    deliveryAddress?: string | null;
  } | null;
  /** Immutable GST decomposition; null for non-GST receipts. */
  gst: GstSnapshotData | null;
  status: 'issued' | 'voided';
  issuedAt: string;
  issuedBy: string | null;
  supersedesInvoiceId: string | null;
  voidReason: string | null;
  tableLabel: string | null;
  fulfilmentLabel?: string | null;
  privateDeliveryCopy?: boolean;
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
    premisesAddress?: string | null;
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
  shareLinks?: InvoiceShareLinkData[];
  lines: InvoiceLineData[];
};

export type InvoiceResult =
  | { ok: true; invoice: ReceiptData; /** Staff role of the viewer (drives UI affordances; the server re-checks). */ role: string; canWrite?: boolean }
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
    serviceSac: nullableText(snap.service_sac),
    rateBps: integer(snap.rate_bps),
    cgstBps: integer(snap.cgst_bps),
    sgstBps: integer(snap.sgst_bps),
    taxablePaise: integer(snap.taxable_paise),
    cgstPaise: integer(snap.cgst_paise),
    sgstPaise: integer(snap.sgst_paise),
    igstPaise: integer(snap.igst_paise),
    placeOfSupplyStateCode: nullableText(snap.place_of_supply_state_code),
    interState: snap.inter_state === true,
    ...(typeof snap.reverse_charge === 'boolean' ? { reverseCharge: snap.reverse_charge } : {}),
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

/** The token-scoped and staff reads use the same immutable payload parser.
 * The formatted number already identifies the series, including legacy INV.
 */
export type InvoiceSnapshot = Pick<RestaurantInvoice,
  'id' | 'restaurant_id' | 'order_session_id' | 'invoice_number' | 'financial_year' | 'document_type'
  | 'irp_status' | 'gst_snapshot' | 'status' | 'issued_at' | 'issued_by' | 'table_label_snapshot'
  | 'session_opened_at' | 'session_closed_at' | 'seller_snapshot' | 'customer_snapshot' | 'totals_snapshot'
  | 'payment_snapshot' | 'supersedes_invoice_id' | 'void_reason'>;

export function parseInvoice(
  row: InvoiceSnapshot,
  rows: RestaurantInvoiceLine[],
  paymentReceiptRows: RestaurantPaymentReceipt[],
  timezone: string,
): ReceiptData {
  const seller = object(row.seller_snapshot);
  const fssaiNumber = nullableText(seller.fssai_number);
  // Reviewed numbers use the India FY even if an outlet's display zone changes.
  const documentZone = fssaiNumber ? RESTAURANT_TIME_ZONE : timezone;
  const totals = object(row.totals_snapshot);
  const payments = Array.isArray(row.payment_snapshot)
    ? row.payment_snapshot
        .map((payment) => parsePayment(payment, timezone))
        .filter((payment): payment is InvoicePaymentData => payment !== null)
    : [];
  const lineData = rows.map(parseLine);

  const irpStatus = IRP_STATUSES.includes(row.irp_status) ? row.irp_status
    : row.document_type === 'gst_tax_invoice' ? 'pending' : 'not_required';
  const customer = object(row.customer_snapshot);
  const recipientGstin = row.document_type === 'gst_tax_invoice' ? nullableText(customer.gstin) : null;
  const recipient = recipientGstin || (row.document_type === 'gst_tax_invoice' && customer.recipient_type === 'consumer')
    ? {
        name: requiredText(customer.name, 'the buyer legal name'),
        gstin: recipientGstin,
        stateCode: nullableText(customer.state_code) ?? recipientGstin?.slice(0, 2) ?? '',
        address: nullableText(customer.address),
        email: nullableText(customer.email),
        ...(customer.location ? { location: nullableText(customer.location), pincode: nullableText(customer.pincode), phone: nullableText(customer.phone) } : {}),
        ...(customer.delivery_address ? { deliveryAddress: nullableText(customer.delivery_address) } : {}),
      }
    : null;
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    number: row.invoice_number,
    financialYear: row.financial_year,
    ...(seller.retail_bill === true ? { retailBill:true } : {}),
    documentType: row.document_type,
    irpStatus,
    irn: null, // a legacy string is not evidence
    recipient,
    gst: parseGstSnapshot(row.gst_snapshot),
    status: row.status,
    issuedAt: formatWhen(row.issued_at, documentZone),
    issuedBy: row.issued_by,
    supersedesInvoiceId: row.supersedes_invoice_id,
    voidReason: row.void_reason,
    tableLabel: row.table_label_snapshot,
    ...(seller.fulfilment_kind ? {fulfilmentLabel: directFulfilmentLabel(seller.fulfilment_kind),
      ...(seller.fulfilment_kind === 'direct_delivery' && customer.recipient_type === 'consumer' ? {privateDeliveryCopy:true} : {})} : {}),
    sessionReference: row.order_session_id,
    sessionOpenedAt: formatWhen(row.session_opened_at, documentZone),
    sessionClosedAt: formatWhen(row.session_closed_at, documentZone),
    seller: {
      name: requiredText(seller.name, 'the restaurant name'),
      address: requiredText(seller.address, 'the restaurant address'),
      phone: nullableText(seller.phone),
      logoUrl: publicAssetUrl(nullableText(seller.logo_path)),
      gstin: row.document_type === 'receipt' ? null : nullableText(seller.gstin),
      fssaiNumber,
      ...(seller.premises_address ? { premisesAddress: nullableText(seller.premises_address) } : {}),
      legalName: nullableText(seller.legal_name),
      tradeName: nullableText(seller.trade_name),
      stateCode: nullableText(seller.state_code),
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
      'id, restaurant_id, order_session_id, invoice_number, financial_year, sequence_number, document_type, status, issued_at, issued_by, table_label_snapshot, session_opened_at, session_closed_at, seller_snapshot, customer_snapshot, totals_snapshot, payment_snapshot, source_order_ids, supersedes_invoice_id, voided_at, voided_by, void_reason, created_at, gst_snapshot, irp_status'
    )
    .eq('id', invoiceId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the receipt: ${dbErrorReference(error)}`);
  if (!invoice) return { ok: false, reason: 'not-found' };

  const { data: lines, error: linesError } = await supabase
    .from('restaurant_invoice_lines')
    .select('id, invoice_id, restaurant_id, line_number, source_order_id, source_order_item_id, line_snapshot, created_at')
    .eq('invoice_id', invoice.id)
    .eq('restaurant_id', restaurantId)
    .order('line_number', { ascending: true });
  if (linesError) throw new Error(`Could not load receipt items: ${dbErrorReference(linesError)}`);

  const { data: paymentReceipts, error: paymentReceiptsError } = await supabase
    .from('restaurant_payment_receipts')
    .select('id, restaurant_id, invoice_id, payment_id, sequence_number, receipt_reference, issued_at, snapshot, created_at')
    .eq('invoice_id', invoice.id)
    .eq('restaurant_id', restaurantId)
    .order('sequence_number', { ascending: true });
  if (paymentReceiptsError) throw new Error(`Could not load supplemental payment receipts: ${dbErrorReference(paymentReceiptsError)}`);

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

  const copy = invoice.status==='issued' && invoice.document_type==='gst_tax_invoice' && ['pending','failed','generated'].includes(invoice.irp_status)
    ? await readPrivateIrpCopy(staff.context, invoice.id,'invoice') : null;
  return {
    ok: true,
    role: staff.context.role,
    canWrite: staff.context.entitlement?.canWrite === true,
    invoice: {
      ...parseInvoice(
        invoice as unknown as RestaurantInvoice,
        (lines ?? []) as unknown as RestaurantInvoiceLine[],
        (paymentReceipts ?? []) as unknown as RestaurantPaymentReceipt[],
        timezone,
      ),
      shareLinks,
      ...(copy ? {verifiedIrp:copy,irn:copy.reference} : {}),
    },
  };
}

