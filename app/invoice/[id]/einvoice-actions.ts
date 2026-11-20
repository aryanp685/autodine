'use server';

import { getStaffContextDetailed } from '@/lib/db/staff';
import { getIrpPreflightGate } from '@/lib/gst/adapter';
import { prepareEinvoicePayload } from '@/lib/gst/einvoice';
import { loadEinvoiceSources, localDateInTimeZone } from '@/lib/gst/einvoice-server';
import { prepareOfflineIrp } from '@/lib/gst/irp/sandbox';
import { reportingWindow } from '@/lib/gst/applicability';
import { GST_UUID } from '@/lib/gst/buyer';

export type EinvoiceAttemptResult = { ok: true; duplicate: boolean; message: string } | { ok: false; error: string };

export async function attemptEinvoiceAction(documentId: string, kind: 'invoice' | 'note' = 'invoice'): Promise<EinvoiceAttemptResult> {
  if (typeof documentId !== 'string' || !GST_UUID.test(documentId) || !['invoice','note'].includes(kind)) {
    return { ok: false, error: 'This document is invalid. Refresh and try again.' };
  }
  const gate = getIrpPreflightGate();
  if (!gate.ok) return gate;
  const staff = await getStaffContextDetailed();
  if (!staff.ok || staff.context.role !== 'owner' || !staff.context.entitlement?.canWrite) {
    return { ok: false, error: 'Only an entitled owner can record offline IRP preparation.' };
  }
  const { supabase, restaurantId } = staff.context;
  const loaded = await loadEinvoiceSources(supabase, restaurantId, documentId, kind);
  if (!loaded.ok) return loaded;
  const prepared = prepareEinvoicePayload(loaded.sources);
  if (!prepared.ok) return prepared;
  const window = reportingWindow(prepared.payload.issuedDate, localDateInTimeZone(new Date().toISOString(), 'Asia/Kolkata') ?? '',
    loaded.sources.invoice.irpEvidence?.reportingCategory ?? 'unknown');
  if (!window.ok) return { ok: false, error: window.code === 'reporting_window_expired'
    ? `The 30-day IRP reporting window ended on ${window.lastDate}. Reconcile this held document.`
    : 'The reporting window cannot be verified. This document remains on hold.' };
  const result = prepareOfflineIrp(prepared.payload);
  if (!result.ok) return result;
  const { data, error } = await supabase.rpc('record_gst_irp_preflight', {
    p_outlet: restaurantId, p_document: documentId, p_kind: kind,
    p_canonical_sha256: prepared.payload.fingerprintSha256, p_payload: result.request,
  });
  if (error || !data || typeof data !== 'object' || Array.isArray(data) || data.status !== 'prepared_offline') {
    return { ok: false, error: 'Offline preparation was not verified. No provider was contacted and the hold is unchanged.' };
  }
  return { ok: true, duplicate: data.duplicate === true,
    message: data.duplicate === true ? 'Identical preparation already recorded. Not submitted; the IRN hold remains.'
      : 'INV-01 payload validated and preparation recorded. Not submitted; the IRN hold remains.' };
}
