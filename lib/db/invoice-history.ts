import { CASHIER_ROLES, getStaffContextDetailed } from '@/lib/db/staff';
import type { MemberRole } from '@/lib/db/database';
import type { OrderSession, RestaurantInvoice } from '@/lib/db/types';

type TotalsSnapshot = {
  total_paise?: unknown;
  payment_status?: unknown;
};

export type InvoiceHistoryRow = {
  sessionId: string;
  tableLabel: string | null;
  openedAt: string;
  closedAt: string;
  invoice: null | {
    id: string;
    number: string;
    status: 'issued' | 'voided';
    issuedAt: string;
    totalPaise: number | null;
    paymentStatus: 'paid' | 'unpaid' | null;
  };
};

export type InvoiceHistoryResult =
  | { ok: true; rows: InvoiceHistoryRow[] }
  | { ok: false; reason: 'unconfigured' | 'signed-out' | 'no-membership' | 'role-denied' };

function positiveMoney(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function toHistoryRow(
  session: OrderSession,
  tableLabel: string | null,
  invoice: RestaurantInvoice | undefined,
): InvoiceHistoryRow {
  const totals = (invoice?.totals_snapshot ?? {}) as TotalsSnapshot;
  const totalPaise = positiveMoney(totals.total_paise);
  return {
    sessionId: session.id,
    tableLabel,
    openedAt: session.opened_at,
    closedAt: session.closed_at ?? session.opened_at,
    invoice: invoice ? {
      id: invoice.id,
      number: invoice.invoice_number,
      status: invoice.status,
      issuedAt: invoice.issued_at,
      totalPaise,
      paymentStatus: totals.payment_status === 'paid' || totals.payment_status === 'unpaid'
        ? totals.payment_status
        : null,
    } : null,
  };
}

/**
 * Closed table sittings are retained independently of invoice issuance. This
 * lets finance staff find sessions where final receipt creation was blocked,
 * while the invoice link itself remains protected by the financial-read RLS.
 */
export async function getInvoiceHistory(): Promise<InvoiceHistoryResult> {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) return { ok: false, reason: staff.reason };
  const { supabase, restaurantId, role } = staff.context;
  if (!(CASHIER_ROLES as readonly MemberRole[]).includes(role)) {
    return { ok: false, reason: 'role-denied' };
  }

  const { data: sessions, error: sessionsError } = await supabase
    .from('order_sessions')
    .select('id, restaurant_id, table_id, opened_at, closed_at, closed_by, paid_at, paid_by, status')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(100);
  if (sessionsError) throw new Error(`Could not load closed table sessions: ${sessionsError.message}`);

  const sessionRows = (sessions ?? []) as unknown as OrderSession[];
  if (!sessionRows.length) return { ok: true, rows: [] };

  const sessionIds = sessionRows.map((session) => session.id);
  const tableIds = [...new Set(sessionRows.map((session) => session.table_id))];
  const [tablesResult, invoicesResult] = await Promise.all([
    supabase.from('dining_tables').select('id, label').eq('restaurant_id', restaurantId).in('id', tableIds),
    supabase
      .from('restaurant_invoices')
      .select('id, restaurant_id, order_session_id, invoice_number, financial_year, sequence_number, document_type, status, issued_at, issued_by, table_label_snapshot, session_opened_at, session_closed_at, seller_snapshot, customer_snapshot, totals_snapshot, payment_snapshot, source_order_ids, supersedes_invoice_id, voided_at, voided_by, void_reason, created_at')
      .eq('restaurant_id', restaurantId)
      .in('order_session_id', sessionIds)
      .order('issued_at', { ascending: false }),
  ]);
  if (tablesResult.error) throw new Error(`Could not load session table labels: ${tablesResult.error.message}`);
  if (invoicesResult.error) throw new Error(`Could not load invoice history: ${invoicesResult.error.message}`);

  const labels = new Map((tablesResult.data ?? []).map((table) => [table.id, table.label]));
  const invoices = new Map<string, RestaurantInvoice>();
  for (const row of (invoicesResult.data ?? []) as unknown as RestaurantInvoice[]) {
    // Keep the latest replacement/void record for a session; it contains the
    // full immutable invoice history by its supersedes link in the receipt.
    if (!invoices.has(row.order_session_id)) invoices.set(row.order_session_id, row);
  }

  return {
    ok: true,
    rows: sessionRows.map((session) =>
      toHistoryRow(session, labels.get(session.table_id) ?? null, invoices.get(session.id)),
    ),
  };
}
