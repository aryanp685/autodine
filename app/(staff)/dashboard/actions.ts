'use server';

import { revalidatePath } from 'next/cache';
import { getInvoiceData } from '@/lib/db/invoice';
import { loadRestaurantPrinters } from '@/lib/db/printers';
import { CASHIER_ROLES, getStaffContext } from '@/lib/db/staff';
import { isCounterMethod } from '@/lib/payment-methods';
import { checkGstin } from '@/lib/gst/gstin';
import { tryAutoRegisterInvoiceIrp } from '@/lib/gst/einvoice-auto';
import { buildThermalPrintJob, type PrintBridgeJob } from '@/lib/print-bridge';

export type MarkSessionPaidResult =
  | { ok: true; paidAt: string }
  | { ok: false; error: string };

export type CheckoutSessionResult =
  | {
      ok: true;
      invoiceId: string;
      invoiceUrl: string;
      irpStatus?: 'not_required' | 'pending' | 'generated' | 'failed';
      irn?: string | null;
      irpMessage?: string | null;
      printJob?: PrintBridgeJob | null;
    }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mark one table's open session paid with the method the guest actually paid
 * by (cash, card or UPI — same contract the cashier screen records). The
 * SECURITY DEFINER RPC resolves the restaurant, actor, ticket amounts and
 * ledger entries transactionally.
 */
export async function markSessionPaidAction(
  sessionId: string,
  method: unknown,
  upiRef?: unknown,
): Promise<MarkSessionPaidResult> {
  const id = String(sessionId ?? '').trim();
  if (!UUID.test(id)) return { ok: false, error: 'This table session is invalid. Refresh the dashboard.' };
  if (!isCounterMethod(method)) {
    return { ok: false, error: 'Choose how the guest paid: Cash, Card or UPI.' };
  }

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Sign in to mark this table paid.' };
  if (!CASHIER_ROLES.includes(staff.role)) {
    return { ok: false, error: `Your role (${staff.role}) cannot mark payments. Ask an owner or manager.` };
  }

  const { data, error } = await staff.supabase.rpc('mark_order_session_paid', {
    p_order_session_id: id,
    p_method: method,
    p_upi_ref: typeof upiRef === 'string' && upiRef.trim() !== '' ? upiRef.trim() : null,
  });

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'The paid status could not be verified. Refresh and check the table.' };

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  revalidatePath('/cashier');
  return { ok: true, paidAt: data };
}

/** Optional B2B buyer details for Regular-GST tax invoices. */
export type CheckoutRecipient = {
  name: string;
  gstin: string;
  address?: string;
  email?: string;
};

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/** Close a table and issue its immutable final receipt atomically. */
export async function checkoutSessionAction(sessionId: string, recipient?: CheckoutRecipient): Promise<CheckoutSessionResult> {
  const id = String(sessionId ?? '').trim();
  if (!UUID.test(id)) return { ok: false, error: 'This table session is invalid. Refresh the dashboard.' };

  let pRecipient: { name: string; gstin: string; address?: string; email?: string } | null = null;
  if (recipient) {
    const name = String(recipient.name ?? '').trim();
    const gstin = String(recipient.gstin ?? '').trim().toUpperCase();
    const address = String(recipient.address ?? '').trim();
    const email = String(recipient.email ?? '').trim().toLowerCase();
    // An incomplete buyer block is fail-closed: better to stop the cashier than issue a half-recorded B2B invoice.
    if (name.length < 2) return { ok: false, error: 'Enter the buyer legal name, or clear the buyer details to issue a B2C invoice.' };
    if (!GSTIN_PATTERN.test(gstin)) return { ok: false, error: 'The buyer GSTIN does not match the 15-character GSTIN layout.' };
    const gstinCheck = checkGstin(gstin);
    if (!gstinCheck.ok) return { ok: false, error: `The buyer GSTIN is not usable: ${gstinCheck.reason}` };
    if (address && address.length < 5) return { ok: false, error: 'The buyer address must be at least 5 characters, or left blank.' };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'The buyer email address does not look usable.' };
    pRecipient = { name, gstin, ...(address ? { address } : {}), ...(email ? { email } : {}) };
  }

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: 'Sign in to check out this table.' };
  if (!CASHIER_ROLES.includes(staff.role)) {
    return { ok: false, error: `Your role (${staff.role}) cannot check out tables. Ask an owner or manager.` };
  }

  const { data, error } = await staff.supabase.rpc('close_order_session_and_issue_receipt', {
    p_order_session_id: id,
    ...(pRecipient ? { p_recipient: pRecipient } : {}),
  });
  if (error) return { ok: false, error: error.message };
  if (typeof data !== 'string' || !UUID.test(data)) {
    return { ok: false, error: 'Checkout could not be verified. Refresh and check the table before trying again.' };
  }

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  revalidatePath('/cashier');
  revalidatePath(`/invoice/${data}`);

  const baseResult: CheckoutSessionResult = {
    ok: true,
    invoiceId: data,
    invoiceUrl: `/invoice/${data}`,
  };

  if (typeof staff.supabase.from !== 'function') {
    return baseResult;
  }

  const [autoIrp, printers] = await Promise.all([
    tryAutoRegisterInvoiceIrp({
      supabase: staff.supabase,
      restaurantId: staff.restaurantId,
      invoiceId: data,
    }),
    loadRestaurantPrinters(staff.supabase, staff.restaurantId),
  ]);

  const autoPrinter = printers.find((p) => p.autoPrintOnClose) ?? null;
  if (!autoIrp.attempted && !autoPrinter) {
    return baseResult;
  }

  let printJob: PrintBridgeJob | null = null;
  if (autoPrinter) {
    try {
      const invRes = await getInvoiceData(data);
      if (invRes.ok) {
        printJob = buildThermalPrintJob(invRes.invoice, {
          widthMm: autoPrinter.paperWidth === '58mm' ? 58 : 80,
          paperFormat: autoPrinter.paperWidth,
          copyNumber: 1,
          printerTarget: {
            printerId: autoPrinter.id,
            printerName: autoPrinter.name,
            connectionType: autoPrinter.connectionType,
            bridgePrinterName: autoPrinter.bridgePrinterName,
            networkHost: autoPrinter.networkHost,
            networkPort: autoPrinter.networkPort,
          },
        });
      }
    } catch {
      // Never fail checkout if pre-building the print job raises.
    }
  }

  return {
    ...baseResult,
    ...(autoIrp.attempted
      ? { irpStatus: autoIrp.irpStatus, irn: autoIrp.irn, irpMessage: autoIrp.message }
      : {}),
    ...(printJob ? { printJob } : {}),
  };
}
