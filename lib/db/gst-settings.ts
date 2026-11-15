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

export type GstMode = 'off' | 'regular' | 'composition';
export type GstRegularProfile = 'other_than_specified_premises' | 'specified_premises';

export type GstSettingsData = {
  /** False when the GST migration has not been applied to this database. */
  ready: boolean;
  mode: GstMode;
  regularProfile: GstRegularProfile;
  gstin: string;
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
};

const EMPTY: GstSettingsData = {
  ready: true,
  mode: 'off',
  regularProfile: 'other_than_specified_premises',
  gstin: '',
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
      'mode, regular_profile, gstin, legal_name, trade_name, address, state_code, pan, registration_type, composition_acknowledged, specified_premises_attested, specified_premises_effective_from, off_declared, off_declared_at, preceding_fy_turnover_paise, einvoice_location, einvoice_pincode, einvoice_hsn_sac, config_version, updated_at',
    )
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (error) {
    // 42P01 = undefined_table, 42703 = undefined_column: the migration is not
    // applied to this database yet. Anything else is a real failure.
    if (error.code === '42P01' || error.code === '42703' || /restaurant_gst_config/.test(error.message)) {
      return NOT_READY;
    }
    throw new Error(`Could not load the GST configuration: ${error.message}`);
  }
  if (!data) return { ...EMPTY };

  const row = data as Record<string, unknown>;
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const mode = row.mode === 'regular' || row.mode === 'composition' ? row.mode : 'off';
  const regularProfile: GstRegularProfile =
    row.regular_profile === 'specified_premises' ? 'specified_premises' : 'other_than_specified_premises';
  const turnover = row.preceding_fy_turnover_paise;
  return {
    ready: true,
    mode,
    regularProfile,
    gstin: text(row.gstin),
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
      typeof turnover === 'number' && Number.isFinite(turnover) ? String(Math.floor(turnover / 100)) : '',
    einvoiceLocation: text(row.einvoice_location),
    einvoicePincode: text(row.einvoice_pincode),
    einvoiceHsnSac: text(row.einvoice_hsn_sac),
    configVersion: typeof row.config_version === 'number' ? row.config_version : 1,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

/**
 * Minimal mode read for the checkout button: which document mode will this
 * billing produce? A database without the GST migration reports 'off'.
 */
export async function loadGstMode(
  supabase: SupabaseClient,
  restaurantId: string,
): Promise<GstMode> {
  const { data, error } = await supabase
    .from('restaurant_gst_config')
    .select('mode')
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (error) {
    if (error.code === '42P01' || error.code === '42703' || /restaurant_gst_config/.test(error.message)) {
      return 'off';
    }
    throw new Error(`Could not load the GST mode: ${error.message}`);
  }
  const mode = (data as Record<string, unknown> | null)?.mode;
  return mode === 'regular' || mode === 'composition' ? mode : 'off';
}
