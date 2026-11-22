'use server';

/**
 * Attempt e-Invoice (IRP) issuance for one GST tax invoice.
 *
 * The flow is gated three ways, in order:
 *   1. AUTODINE_IRP_PROVIDER must be set — otherwise no provider exists and
 *      nothing is attempted (and nothing is recorded). Today only the
 *      offline 'sandbox' provider is wired.
 *   2. The caller must be an owner or manager of the restaurant.
 *   3. The document must be an issued Regular-GST tax invoice currently
 *      recorded as IRP 'pending' or 'failed', with an applicable recorded
 *      preceding-FY turnover and a complete e-Invoice issuance profile.
 *
 * Every step IS recorded in restaurant_irp_requests through the definer RPC
 * (payload_built → submitted → accepted|rejected|transport_error) — that is
 * the point of the readiness phase. What this action Deliberately does NOT
 * do is flip the document to IRP 'generated': the database has no path for
 * that from application code, so an IRN from the offline sandbox can never
 * present itself as a filed document. Recording a live IRN is the owner's
 * explicit, separately-approved provider integration.
 */

import { revalidatePath } from 'next/cache';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { getIrpAdapter } from '@/lib/gst/adapter';
import { prepareEinvoicePayload } from '@/lib/gst/einvoice';
import { loadEinvoiceSources } from '@/lib/gst/einvoice-server';
import { fingerprint } from '@/lib/gst/irp/fingerprint';
import type { IrpCancelReason } from '@/lib/gst/irp/types';

export type EinvoiceAttemptResult =
  | {
      ok: true;
      outcome: 'accepted' | 'rejected' | 'transport_error';
      /** True when the outcome row was written to restaurant_irp_requests. */
      recorded: boolean;
      invoiceNumber: string;
      irn: string | null;
      message: string;
    }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function attemptEinvoiceAction(invoiceId: string): Promise<EinvoiceAttemptResult> {
  const id = String(invoiceId ?? '').trim();
  if (!UUID.test(id)) return { ok: false, error: 'This document is invalid. Refresh and try again.' };

  const gate = getIrpAdapter();
  if (!gate.ok) return { ok: false, error: gate.error };

  const staff = await getStaffContextDetailed();
  if (!staff.ok) {
    if (staff.reason === 'signed-out') return { ok: false, error: 'Sign in to attempt e-invoice issuance.' };
    return { ok: false, error: 'This account is not a member of any restaurant yet.' };
  }
  if (staff.context.role !== 'owner' && staff.context.role !== 'manager') {
    return { ok: false, error: 'Only the owner or a manager can attempt e-invoice issuance.' };
  }
  const { supabase, restaurantId } = staff.context;

  const loaded = await loadEinvoiceSources(supabase, restaurantId, id);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const prepared = prepareEinvoicePayload({
    invoice: loaded.sources.invoice,
    profile: loaded.sources.profile,
  });
  if (!prepared.ok) return { ok: false, error: prepared.error };
  const payload = prepared.payload;

  const record = async (
    status: 'payload_built' | 'submitted' | 'accepted' | 'rejected' | 'transport_error',
    extra: { requestHash?: string; responseHash?: string | null; errorCode?: string | null; errorMessage?: string | null } = {},
  ) => {
    return supabase.rpc('record_restaurant_irp_request', {
      p_invoice_id: id,
      p_provider: gate.adapter.providerId,
      p_payload_version: payload.schemaVersion,
      p_status: status,
      p_request_sha256: extra.requestHash ?? payload.fingerprintSha256,
      p_response_sha256: extra.responseHash ?? null,
      p_error_code: extra.errorCode ?? null,
      p_error_message: extra.errorMessage ?? null,
    });
  };

  const built = await record('payload_built');
  if (built.error) {
    return { ok: false, error: `The attempt could not be recorded before submission: ${built.error.message}` };
  }
  const submitted = await record('submitted');
  if (submitted.error) {
    // Fail closed: no unrecorded submission reaches the provider.
    return { ok: false, error: `The submission could not be recorded, so no provider was called: ${submitted.error.message}` };
  }

  let outcome: Awaited<ReturnType<typeof gate.adapter.generateIrn>>;
  try {
    outcome = await gate.adapter.generateIrn(payload);
  } catch (error) {
    outcome = {
      ok: false,
      code: 'ADAPTER-EXCEPTION',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const isSandbox = gate.adapter.providerId === 'sandbox';
  const sandboxNote = isSandbox ? ' The offline sandbox is not an IRP: this IRN is not valid anywhere and the document stays marked IRP-pending.' : '';

  if (outcome.ok) {
    const responseHash = fingerprint(outcome.ack);
    const recorded = isSandbox
      ? await record('accepted', { responseHash })
      : await supabase.rpc('complete_restaurant_invoice_irp', {
          p_invoice_id: id,
          p_provider: gate.adapter.providerId,
          p_outcome: 'generated',
          p_irn: outcome.ack.irn,
          p_ack_no: String(outcome.ack.ackNo),
          p_ack_date: outcome.ack.ackDateIso,
          p_signed_qr_payload: outcome.ack.signedQrCode,
          p_request_sha256: payload.fingerprintSha256,
          p_response_sha256: responseHash,
        });

    if (!isSandbox && !recorded.error) {
      try {
        revalidatePath(`/invoice/${id}`);
        revalidatePath('/dashboard/invoices');
      } catch {
        // Non-Next test runtime
      }
    }

    return {
      ok: true,
      outcome: 'accepted',
      recorded: !recorded.error,
      invoiceNumber: payload.documentNumber,
      irn: outcome.ack.irn,
      message: recorded.error
        ? `The provider accepted the document, but recording the attempt failed (${recorded.error.message}). Keep the IRN and tell your operator.`
        : isSandbox
          ? `Provider '${gate.adapter.providerId}' accepted the document. IRN: ${outcome.ack.irn}.${sandboxNote}`
          : `IRN registered with ${gate.adapter.providerId}. Ack #${outcome.ack.ackNo}.`,
    };
  }

  if (outcome.code === 'ADAPTER-EXCEPTION') {
    const recorded = isSandbox
      ? await record('transport_error', { errorCode: outcome.code, errorMessage: outcome.message })
      : await supabase.rpc('complete_restaurant_invoice_irp', {
          p_invoice_id: id,
          p_provider: gate.adapter.providerId,
          p_outcome: 'transport_error',
          p_request_sha256: payload.fingerprintSha256,
          p_error_code: outcome.code,
          p_error_message: outcome.message,
        });
    return {
      ok: true,
      outcome: 'transport_error',
      recorded: !recorded.error,
      invoiceNumber: payload.documentNumber,
      irn: null,
      message: `The provider could not be reached (${outcome.message}). The attempt was recorded as a transport error.${sandboxNote}`,
    };
  }

  const recorded = isSandbox
    ? await record('rejected', { errorCode: outcome.code, errorMessage: outcome.message })
    : await supabase.rpc('complete_restaurant_invoice_irp', {
        p_invoice_id: id,
        p_provider: gate.adapter.providerId,
        p_outcome: 'failed',
        p_request_sha256: payload.fingerprintSha256,
        p_error_code: outcome.code,
        p_error_message: outcome.message,
      });
  return {
    ok: true,
    outcome: 'rejected',
    recorded: !recorded.error,
    invoiceNumber: payload.documentNumber,
    irn: null,
    message: `The provider rejected the document (${outcome.code}: ${outcome.message}). The attempt was recorded; fix the cause and retry.${sandboxNote}`,
  };
}

export type EinvoiceCancelResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function cancelEinvoiceAction(input: {
  invoiceId: string;
  reasonCode: IrpCancelReason;
  remark: string;
}): Promise<EinvoiceCancelResult> {
  const id = String(input.invoiceId ?? '').trim();
  if (!UUID.test(id)) return { ok: false, error: 'This document is invalid.' };

  const remark = String(input.remark ?? '').trim();
  if (remark.length < 3 || remark.length > 100) {
    return { ok: false, error: 'Enter a cancellation remark between 3 and 100 characters.' };
  }
  if (!['1', '2', '3', '4'].includes(input.reasonCode)) {
    return { ok: false, error: 'Choose a valid IRP cancellation reason.' };
  }

  const gate = getIrpAdapter();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (gate.adapter.providerId === 'sandbox') {
    return { ok: false, error: 'Offline sandbox cannot cancel live IRNs.' };
  }

  const staff = await getStaffContextDetailed();
  if (!staff.ok) return { ok: false, error: 'Sign in as an owner or manager to cancel an IRN.' };
  if (staff.context.role !== 'owner' && staff.context.role !== 'manager') {
    return { ok: false, error: 'Only an owner or manager can cancel an e-Invoice IRN.' };
  }

  const { supabase, restaurantId } = staff.context;
  const { data: inv, error: invError } = await supabase
    .from('restaurant_invoices')
    .select('id, irn, irp_status')
    .eq('id', id)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (invError) return { ok: false, error: `Could not load invoice: ${invError.message}` };
  if (!inv || inv.irp_status !== 'generated' || !inv.irn) {
    return { ok: false, error: 'Only an invoice with an active generated IRN can be cancelled.' };
  }

  const cancelOutcome = await gate.adapter.cancelIrn({
    irn: inv.irn,
    reason: input.reasonCode,
    remark,
  });
  if (!cancelOutcome.ok) {
    return { ok: false, error: `IRP rejected cancellation (${cancelOutcome.code}): ${cancelOutcome.message}` };
  }

  const saved = await supabase.rpc('cancel_restaurant_invoice_irp', {
    p_invoice_id: id,
    p_provider: gate.adapter.providerId,
    p_reason_code: input.reasonCode,
    p_remark: remark,
    p_cancelled_at: cancelOutcome.cancelDateIso,
  });

  if (saved.error) {
    return { ok: false, error: `Cancelled on IRP, but saving locally failed: ${saved.error.message}` };
  }

  try {
    revalidatePath(`/invoice/${id}`);
    revalidatePath('/dashboard/invoices');
  } catch {
    // Non-Next test runtime
  }
  return { ok: true, message: 'IRN cancelled with IRP and recorded on this invoice.' };
}
