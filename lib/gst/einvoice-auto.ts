import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/database';
import { getIrpAdapter } from '@/lib/gst/adapter';
import { prepareEinvoicePayload } from '@/lib/gst/einvoice';
import { loadEinvoiceSources } from '@/lib/gst/einvoice-server';
import { fingerprint } from '@/lib/gst/irp/fingerprint';

export type AutoIrpResult = {
  attempted: boolean;
  irpStatus: 'not_required' | 'pending' | 'generated' | 'failed';
  irn: string | null;
  message: string | null;
};

/**
 * Runs server-side IRP registration immediately after an invoice is issued when
 * a live provider (e.g. `nic_gsp`) is configured and the invoice is eligible
 * (B2B regular GST tax invoice with `irp_status = 'pending'`).
 *
 * CRITICAL INVARIANT: Never throws and never voids/rolls back the issued invoice
 * if IRP fails, times out, or is disabled. Failure leaves the invoice intact
 * with `irp_status = 'failed'` or `'pending'` so staff can retry later.
 */
export async function tryAutoRegisterInvoiceIrp(input: {
  supabase: SupabaseClient<Database>;
  restaurantId: string;
  invoiceId: string;
}): Promise<AutoIrpResult> {
  const gate = getIrpAdapter();
  if (!gate.ok || gate.adapter.providerId === 'sandbox') {
    return { attempted: false, irpStatus: 'pending', irn: null, message: null };
  }

  try {
    const loaded = await loadEinvoiceSources(input.supabase, input.restaurantId, input.invoiceId);
    if (!loaded.ok) {
      return { attempted: false, irpStatus: 'pending', irn: null, message: null };
    }
    if (loaded.sources.invoice.irpStatus !== 'pending' && loaded.sources.invoice.irpStatus !== 'failed') {
      return {
        attempted: false,
        irpStatus: loaded.sources.invoice.irpStatus === 'generated' ? 'generated' : 'not_required',
        irn: null,
        message: null,
      };
    }

    const prepared = prepareEinvoicePayload({
      invoice: loaded.sources.invoice,
      profile: loaded.sources.profile,
    });
    if (!prepared.ok) {
      return { attempted: false, irpStatus: 'pending', irn: null, message: prepared.error };
    }
    const payload = prepared.payload;

    const built = await input.supabase.rpc('record_restaurant_irp_request', {
      p_invoice_id: input.invoiceId,
      p_provider: gate.adapter.providerId,
      p_payload_version: payload.schemaVersion,
      p_status: 'payload_built',
      p_request_sha256: payload.fingerprintSha256,
    });
    if (built.error) {
      return { attempted: false, irpStatus: 'pending', irn: null, message: built.error.message };
    }

    const submitted = await input.supabase.rpc('record_restaurant_irp_request', {
      p_invoice_id: input.invoiceId,
      p_provider: gate.adapter.providerId,
      p_payload_version: payload.schemaVersion,
      p_status: 'submitted',
      p_request_sha256: payload.fingerprintSha256,
    });
    if (submitted.error) {
      return { attempted: false, irpStatus: 'pending', irn: null, message: submitted.error.message };
    }

    const outcome = await gate.adapter.generateIrn(payload);
    if (outcome.ok) {
      const responseHash = fingerprint(outcome.ack);
      const saved = await input.supabase.rpc('complete_restaurant_invoice_irp', {
        p_invoice_id: input.invoiceId,
        p_provider: gate.adapter.providerId,
        p_outcome: 'generated',
        p_irn: outcome.ack.irn,
        p_ack_no: String(outcome.ack.ackNo),
        p_ack_date: outcome.ack.ackDateIso,
        p_signed_qr_payload: outcome.ack.signedQrCode,
        p_request_sha256: payload.fingerprintSha256,
        p_response_sha256: responseHash,
      });
      if (saved.error) {
        return {
          attempted: true,
          irpStatus: 'pending',
          irn: outcome.ack.irn,
          message: `IRN generated but saving to invoice failed: ${saved.error.message}`,
        };
      }
      return {
        attempted: true,
        irpStatus: 'generated',
        irn: outcome.ack.irn,
        message: 'Registered with IRP',
      };
    }

    const isTransport = outcome.code === 'ADAPTER-EXCEPTION';
    await input.supabase.rpc('complete_restaurant_invoice_irp', {
      p_invoice_id: input.invoiceId,
      p_provider: gate.adapter.providerId,
      p_outcome: isTransport ? 'transport_error' : 'failed',
      p_request_sha256: payload.fingerprintSha256,
      p_error_code: outcome.code,
      p_error_message: outcome.message,
    });

    return {
      attempted: true,
      irpStatus: 'failed',
      irn: null,
      message: `${outcome.code}: ${outcome.message}`,
    };
  } catch (error) {
    return {
      attempted: true,
      irpStatus: 'failed',
      irn: null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
