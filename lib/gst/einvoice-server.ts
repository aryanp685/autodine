/**
 * Loads exactly what the e-Invoice issuance step needs, through the caller's
 * RLS-scoped staff client. Kept out of lib/gst/einvoice.ts so that module
 * stays pure and unit-testable without a database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EinvoiceInvoiceInput, EinvoiceProfileInput } from './einvoice';

export type EinvoiceSources = {
  invoice: EinvoiceInvoiceInput;
  profile: EinvoiceProfileInput;
  /** Restaurant IANA timezone, used to derive issuedLocalDate. */
  timeZone: string;
};

export type LoadEinvoiceSourcesResult =
  | { ok: true; sources: EinvoiceSources }
  | { ok: false; error: string };

/** The outlet-local calendar date (YYYY-MM-DD) for an instant. */
export function localDateInTimeZone(iso: string, timeZone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  for (const zone of [timeZone, 'Asia/Kolkata', 'UTC']) {
    try {
      // en-CA formats as YYYY-MM-DD.
      const formatted = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
      if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
    } catch {
      // try the next zone
    }
  }
  return null;
}

export async function loadEinvoiceSources(
  supabase: SupabaseClient,
  restaurantId: string,
  invoiceId: string,
): Promise<LoadEinvoiceSourcesResult> {
  const { data: invoice, error } = await supabase
    .from('restaurant_invoices')
    .select(
      'id, restaurant_id, invoice_number, document_type, status, issued_at, totals_snapshot, gst_snapshot, recipient_name, recipient_gstin, recipient_address, recipient_email, seller_snapshot, irp_status'
    )
    .eq('id', invoiceId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (error) return { ok: false, error: `Could not load the document: ${error.message}` };
  if (!invoice) return { ok: false, error: 'This document does not exist, or it belongs to a different restaurant.' };

  const { data: lines, error: linesError } = await supabase
    .from('restaurant_invoice_lines')
    .select('line_number, line_snapshot')
    .eq('invoice_id', invoice.id)
    .eq('restaurant_id', restaurantId)
    .order('line_number', { ascending: true });
  if (linesError) return { ok: false, error: `Could not load the document lines: ${linesError.message}` };

  const { data: profileRow, error: profileError } = await supabase
    .from('restaurant_gst_config')
    .select('mode, registration_type, gstin, legal_name, trade_name, address, state_code, preceding_fy_turnover_paise, einvoice_location, einvoice_pincode, einvoice_hsn_sac')
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (profileError) return { ok: false, error: `Could not load the GST configuration: ${profileError.message}` };
  if (!profileRow) {
    return { ok: false, error: 'This restaurant has no GST configuration row yet. Complete the GST settings first.' };
  }

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('timezone')
    .eq('id', restaurantId)
    .maybeSingle();
  if (restaurantError) return { ok: false, error: `Could not load the restaurant: ${restaurantError.message}` };
  const timeZone = typeof restaurant?.timezone === 'string' && restaurant.timezone.trim() ? restaurant.timezone.trim() : 'Asia/Kolkata';

  const issuedIso = String(invoice.issued_at ?? '');
  const issuedLocalDate = localDateInTimeZone(issuedIso, timeZone);
  if (!issuedLocalDate) {
    return { ok: false, error: 'The document issue timestamp is unreadable. Nothing was attempted.' };
  }

  const totals = (invoice.totals_snapshot ?? {}) as Record<string, unknown>;
  const gstSnap = invoice.gst_snapshot as Record<string, unknown> | null;
  const sellerSnap = (invoice.seller_snapshot ?? {}) as Record<string, unknown>;
  const num = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');

  const mappedLines = (lines ?? []).map((line, index) => {
    const snap = (line.line_snapshot ?? {}) as Record<string, unknown>;
    return {
      itemName: text(snap.item_name).trim() || `Item ${index + 1}`,
      quantity: num(snap.quantity),
      unitPricePaise: num(snap.unit_price_paise),
      amountPaise: num(snap.amount_paise),
    };
  });
  if (mappedLines.length === 0) {
    return { ok: false, error: 'The document has no lines. It cannot be prepared for e-invoicing.' };
  }
  if (mappedLines.some((l) => !Number.isFinite(l.quantity) || l.quantity <= 0 || !Number.isFinite(l.unitPricePaise) || !Number.isFinite(l.amountPaise))) {
    return { ok: false, error: 'A document line is unreadable (quantity or paise value). Nothing was attempted.' };
  }

  return {
    ok: true,
    sources: {
      timeZone,
      invoice: {
        invoiceNumber: text(invoice.invoice_number),
        issuedLocalDate,
        irpStatus: text(invoice.irp_status) || 'not_required',
        status: text(invoice.status),
        documentType: text(invoice.document_type),
        gst: gstSnap
          ? {
              rateBps: num(gstSnap.rate_bps) || 0,
              taxablePaise: typeof gstSnap.taxable_paise === 'number' ? gstSnap.taxable_paise : null,
              cgstPaise: num(gstSnap.cgst_paise) || 0,
              sgstPaise: num(gstSnap.sgst_paise) || 0,
              igstPaise: num(gstSnap.igst_paise) || 0,
              placeOfSupplyStateCode: typeof gstSnap.place_of_supply_state_code === 'string' ? gstSnap.place_of_supply_state_code : null,
            }
          : null,
        totals: {
          subtotalPaise: num(totals.subtotal_paise) || 0,
          taxPaise: num(totals.tax_paise) || 0,
          totalPaise: num(totals.total_paise) || 0,
        },
        seller: {
          name: text(sellerSnap.name),
          tradeName: typeof sellerSnap.trade_name === 'string' ? sellerSnap.trade_name : null,
          address: text(sellerSnap.address),
          phone: typeof sellerSnap.phone === 'string' ? sellerSnap.phone : null,
        },
        recipient:
          invoice.recipient_gstin != null
            ? {
                name: text(invoice.recipient_name),
                gstin: text(invoice.recipient_gstin),
                address: typeof invoice.recipient_address === 'string' ? invoice.recipient_address : null,
                email: typeof invoice.recipient_email === 'string' ? invoice.recipient_email : null,
              }
            : null,
        lines: mappedLines,
      },
      profile: {
        mode: typeof profileRow.mode === 'string' ? profileRow.mode : null,
        registrationType: typeof profileRow.registration_type === 'string' ? profileRow.registration_type : null,
        gstin: typeof profileRow.gstin === 'string' ? profileRow.gstin : null,
        legalName: typeof profileRow.legal_name === 'string' ? profileRow.legal_name : null,
        tradeName: typeof profileRow.trade_name === 'string' ? profileRow.trade_name : null,
        address: typeof profileRow.address === 'string' ? profileRow.address : null,
        stateCode: typeof profileRow.state_code === 'string' ? profileRow.state_code : null,
        precedingFyTurnoverPaise: typeof profileRow.preceding_fy_turnover_paise === 'number' ? profileRow.preceding_fy_turnover_paise : null,
        einvoiceLocation: typeof profileRow.einvoice_location === 'string' ? profileRow.einvoice_location : null,
        einvoicePincode: typeof profileRow.einvoice_pincode === 'string' ? profileRow.einvoice_pincode : null,
        einvoiceHsnSac: typeof profileRow.einvoice_hsn_sac === 'string' ? profileRow.einvoice_hsn_sac : null,
      },
    },
  };
}
