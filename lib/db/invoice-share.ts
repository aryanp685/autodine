import { createHash } from 'node:crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseInvoice, type ReceiptData } from '@/lib/db/invoice';
import type { RestaurantInvoice, RestaurantInvoiceLine } from '@/lib/db/types';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const nullableText = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;

/** Public receipt view; authorization is the expiring share credential in SQL. */
export async function getSharedInvoiceData(token: string): Promise<ReceiptData | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data, error } = await supabase.rpc('read_shared_restaurant_invoice', {
    p_token_hash: tokenHash,
  });
  if (error || !data) return null;

  const payload = object(data);
  const rawInvoice = object(payload.invoice);
  const invoiceId = text(rawInvoice.id);
  const issuedAt = text(rawInvoice.issued_at);
  if (!invoiceId || !issuedAt) return null;

  const invoice = {
    id: invoiceId,
    restaurant_id: '',
    order_session_id: text(rawInvoice.order_session_id),
    invoice_number: text(rawInvoice.invoice_number),
    financial_year: text(rawInvoice.financial_year),
    sequence_number: 0,
    document_type: rawInvoice.document_type === 'gst_tax_invoice' ? 'gst_tax_invoice' : 'receipt',
    status: rawInvoice.status === 'voided' ? 'voided' : 'issued',
    issued_at: issuedAt,
    issued_by: null,
    table_label_snapshot: nullableText(rawInvoice.table_label_snapshot),
    session_opened_at: text(rawInvoice.session_opened_at),
    session_closed_at: text(rawInvoice.session_closed_at),
    seller_snapshot: rawInvoice.seller_snapshot,
    customer_snapshot: null,
    totals_snapshot: rawInvoice.totals_snapshot,
    payment_snapshot: rawInvoice.payment_snapshot,
    source_order_ids: [],
    supersedes_invoice_id: nullableText(rawInvoice.supersedes_invoice_id),
    voided_at: null,
    voided_by: null,
    void_reason: nullableText(rawInvoice.void_reason),
    created_at: issuedAt,
  } as RestaurantInvoice;

  const lines = Array.isArray(payload.lines)
    ? payload.lines.map((value, index) => {
        const line = object(value);
        return {
          id: text(line.id),
          invoice_id: invoiceId,
          restaurant_id: '',
          line_number: index + 1,
          source_order_id: '',
          source_order_item_id: null,
          line_snapshot: line.line_snapshot,
          created_at: issuedAt,
        } as RestaurantInvoiceLine;
      })
    : [];
  const timezone = text(payload.timezone) || 'Asia/Kolkata';
  return parseInvoice(invoice, lines, [], timezone);
}
