/**
 * GST configuration for the Settings screen.
 *
 * One row per restaurant in restaurant_gst_config (migration 20261113000100).
 * The DEFAULT with no row is mode='off' — normal non-GST receipts, the
 * historical behaviour.
 *
 * A database without the migration yet is reported as `ready: false`, and the
 * screen says so honestly instead of rendering a form that cannot be saved.
 * The restaurant details form (name/GSTIN/address) keeps working regardless —
 * invoices addressed to the business need those even in non-GST mode.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { GstMode } from '@/lib/gst/profiles';
import type { GstActivation, GstBusinessType, GstDeferral, GstPremisesEvidence } from '@/lib/gst/onboarding';
export type { GstMode } from '@/lib/gst/profiles';
export type GstRegularProfile = 'other_than_specified_premises' | 'specified_premises';

export type GstSettingsData = {
  /** False when the GST migration has not been applied to this database. */
  ready: boolean;
  mode: GstMode;
  regularProfile: GstRegularProfile;
  gstin: string;
  fssaiNumber: string;
  businessType: GstBusinessType | '';
  serviceSac: string;
  premisesEvidence: GstPremisesEvidence | null;
  legalName: string;
  tradeName: string;
  address: string;
  stateCode: string;
  pan: string;
  registrationType: 'regular' | 'composition';
  compositionAcknowledged: boolean;
  specifiedPremisesAttested: boolean;
  /** ISO date (YYYY-MM-DD) the 18% specified-premises treatment has applied from. */
  specifiedPremisesEffectiveFrom: string;
  /** Owner recorded the Normal-Billing declaration (mode 'off'). */
  offDeclared: boolean;
  offDeclaredAt: string | null;
  /** Preceding-FY aggregate annual turnover in rupees (display string), '' when unset. */
  precedingFyTurnoverRupees: string;
  /** e-Invoice issuance profile (migration 20261114000600). All empty until the owner records them; the issuance service fails closed without them. */
  einvoiceLocation: string;
  einvoicePincode: string;
  einvoiceHsnSac: string;
  configVersion: number;
  updatedAt: string | null;
  deferrals?: GstDeferral[];
  activation?: GstActivation | null;
  history?: Array<{ version: number; mode: GstMode; changedAt: string; actor: string | null; effective: string | null }>;
};

const EMPTY: GstSettingsData = {
  ready: true,
  mode: 'off',
  regularProfile: 'other_than_specified_premises',
  gstin: '',
  fssaiNumber: '',
  businessType: '',
  serviceSac: '',
  premisesEvidence: null,
  legalName: '',
  tradeName: '',
  address: '',
  stateCode: '',
  pan: '',
  registrationType: 'regular',
  compositionAcknowledged: false,
  specifiedPremisesAttested: false,
  specifiedPremisesEffectiveFrom: '2025-04-01',
  offDeclared: false,
  offDeclaredAt: null,
  precedingFyTurnoverRupees: '',
  einvoiceLocation: '',
  einvoicePincode: '',
  einvoiceHsnSac: '',
  configVersion: 0,
  updatedAt: null,
};

export const NOT_READY: GstSettingsData = { ...EMPTY, ready: false };

/** Accepts the untyped supabase client shape used by the settings loader. */
export async function loadGstSettings(
  supabase: SupabaseClient,
  restaurantId: string,
): Promise<GstSettingsData> {
  const { data, error } = await supabase
    .from('restaurant_gst_config')
    .select(
      'mode, regular_profile, gstin, fssai_number, business_type, service_sac, premises_evidence, legal_name, trade_name, address, state_code, pan, registration_type, composition_acknowledged, specified_premises_attested, specified_premises_effective_from, off_declared, off_declared_at, preceding_fy_turnover_paise, einvoice_location, einvoice_pincode, einvoice_hsn_sac, config_version, updated_at, activation',
    )
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (error) {
    // 42P01 = undefined_table, 42703 = undefined_column: the migration is not
    // applied to this database yet. Anything else is a real failure.
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) {
      return NOT_READY;
    }
    throw new Error(`Could not load the GST configuration: ${error.message}`);
  }
  const { data: decisions } = await supabase.rpc('list_gst_outlet_deferrals', { p_outlet: restaurantId });
  const deferrals = Array.isArray(decisions) ? decisions as GstDeferral[] : [];
  if (!data) return { ...EMPTY, deferrals };

  const row = data as Record<string, unknown>;
  const { data: history, error: historyError } = await supabase.from('restaurant_gst_config_history')
    .select('config_version,mode,changed_at,changed_by,activation').eq('restaurant_id', restaurantId)
    .order('config_version', { ascending:false }).limit(10);
  const historyRows = historyError || !Array.isArray(history) ? undefined : history.map((h) => ({
    version: h.config_version as number, mode: h.mode as GstMode, changedAt: h.changed_at as string,
    actor: h.changed_by as string | null, effective: (h.activation as GstActivation | null)?.effective_from ?? null,
  }));
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const mode = row.mode === 'regular' || row.mode === 'composition' ? row.mode : 'off';
  const regularProfile: GstRegularProfile =
    row.regular_profile === 'specified_premises' ? 'specified_premises' : 'other_than_specified_premises';
  const turnover = row.preceding_fy_turnover_paise == null ? null : Number(row.preceding_fy_turnover_paise);
  return {
    ready: true,
    mode,
    deferrals,
    ...(historyRows ? {history:historyRows} : {}),
    regularProfile,
    gstin: mode === 'off' ? '' : text(row.gstin),
    fssaiNumber: text(row.fssai_number),
    businessType: row.business_type === 'hotel' || row.business_type === 'standalone' ? row.business_type : '',
    serviceSac: text(row.service_sac),
    // This object is shaped by the versioned save and DB evidence guard.
    premisesEvidence: (row.premises_evidence as GstPremisesEvidence | null | undefined) ?? null,
    legalName: text(row.legal_name),
    tradeName: text(row.trade_name),
    address: text(row.address),
    stateCode: text(row.state_code),
    pan: text(row.pan),
    registrationType: row.registration_type === 'composition' ? 'composition' : 'regular',
    compositionAcknowledged: row.composition_acknowledged === true,
    specifiedPremisesAttested: row.specified_premises_attested === true,
    specifiedPremisesEffectiveFrom:
      typeof row.specified_premises_effective_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.specified_premises_effective_from)
        ? row.specified_premises_effective_from
        : '2025-04-01',
    offDeclared: row.off_declared === true,
    offDeclaredAt: typeof row.off_declared_at === 'string' ? row.off_declared_at : null,
    precedingFyTurnoverRupees:
      turnover !== null && Number.isSafeInteger(turnover) ? (turnover / 100).toFixed(2) : '',
    einvoiceLocation: text(row.einvoice_location),
    einvoicePincode: text(row.einvoice_pincode),
    einvoiceHsnSac: text(row.einvoice_hsn_sac),
    configVersion: typeof row.config_version === 'number' ? row.config_version : 1,
    activation: (row.activation as GstActivation | null | undefined) ?? null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}
