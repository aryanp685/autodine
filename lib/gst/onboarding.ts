/** Local format and evidence checks. Neither identifier nor premises records
 * are authenticated against external authorities by this application. */
export const FSSAI_PATTERN = '[0-9]{14}';
export const SERVICE_SAC_PATTERN = '[0-9]{6}';
export const ROOM_SUPPLY_THRESHOLD_PAISE = 750_000;
export const SPECIFIED_PREMISES_NOT_BEFORE = '2025-04-01';

export type GstBusinessType = 'standalone' | 'hotel';
export type GstPremisesBasis = 'room_supply' | 'opt_in';
type EvidenceBase = { reference: string; treatment_fy_start: number };
export type GstPremisesEvidence = EvidenceBase & (
  | { basis: 'room_supply'; room_supply_fy_start: number; room_value_paise: number }
  | { basis: 'opt_in'; filed_on: string; filing_from: string; filing_through: string }
);

export function validFssai(value: string): boolean {
  return value.length === 14 && /^[0-9]+$/.test(value);
}

export function validServiceSac(value: string): boolean {
  return value.length === 6 && /^[0-9]+$/.test(value);
}

export function gstFinancialYearStart(indiaDate: string): number {
  return Number(indiaDate.slice(0, 4)) - (indiaDate.slice(5, 7) < '04' ? 1 : 0);
}

export function validIndianBillingDate(value: string): boolean {
  if (!/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const GST_SERIES_DEFAULT = { INV: 'INV', BOS: 'BOS', RBL: 'RBL', CN: 'CN', DN: 'DN' } as const;
export type GstSeriesKind = keyof typeof GST_SERIES_DEFAULT;
export const GST_SERIES_KINDS = Object.keys(GST_SERIES_DEFAULT) as GstSeriesKind[];

// Direct same-State CGST/SGST scope. Codes for UTGST, legacy territories,
// and special/unrecognized registrations are deliberately not a default.
export const GST_OUTLET_STATES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar',
  '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '27': 'Maharashtra',
  '29': 'Karnataka', '30': 'Goa', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '36': 'Telangana', '37': 'Andhra Pradesh',
};
// Recipient/display codes are not an expansion of supported supplier or PoS
// states. Codes 25 and 28 are historical and are not offered for new B2C.
const GST_STATE_NAMES: Readonly<Record<string, string>> = {
  ...GST_OUTLET_STATES, '04': 'Chandigarh', '25': 'Daman and Diu (historical)',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '28': 'Andhra Pradesh (historical)',
  '31': 'Lakshadweep', '35': 'Andaman and Nicobar Islands', '38': 'Ladakh',
};
export function gstStateLabel(code: string | null | undefined): string | null {
  if (!code || !Object.hasOwn(GST_STATE_NAMES, code)) return null;
  return `${GST_STATE_NAMES[code]} (${code})`;
}

export type ReportingCategory = 'under_10cr' | 'at_least_10cr' | 'unknown';
export const GST_DEFERRAL_REASONS = {
  registration: 'Registration details pending', premises: 'Premises or licence evidence pending',
  series: 'Numbering reservations pending', review: 'Owner review pending',
} as const;
export type GstDeferral = { profile_version: number; reason: keyof typeof GST_DEFERRAL_REASONS; recorded_by: string; recorded_at: string };
export type GstHotelReview = {
  treatment_fy: number; room_fy: number; reference: string; confirmed: true;
  room_basis: 'actual' | 'no_supplies'; max_room_paise: number | null;
  declaration_status: 'none_in_force' | 'opted_out'; opt_out_fy: number | null;
  opt_out_filed: string | null; opt_out_reference: string | null;
};
export type GstActivation = {
  version: 2 | 3;
  effective_from: string;
  confirmed_at: string;
  premises_address: string;
  premises_state_code: string;
  invoice_phone: string;
  review_status: 'owner_attested' | 'adviser_reference_recorded';
  adviser_reference: string | null;
  declaration_route: 'annexure_vii' | 'annexure_viii' | null;
  declaration_fy: number | null;
  registration_effective_on: string | null;
  hotel_not_specified_confirmed: boolean;
  hotel_review?: GstHotelReview | null;
  series: Record<GstSeriesKind, string>;
  external_prefixes: string[];
  aato: { highest_prior_fy_paise: number; reference: string; reporting_category: ReportingCategory; review_fy: number } | null;
};

export function addBillingDays(value: string, days: number): string {
  if (!validIndianBillingDate(value)) throw new RangeError('A real India calendar date is required.');
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function declarationWindow(route: string, declarationFy: number, arnDate: string) {
  if (!Number.isInteger(declarationFy) || declarationFy < 2025 || declarationFy > 9999) return null;
  if (route === 'annexure_vii' || route === 'annexure_ix') return { from: `${declarationFy}-01-01`, through: `${declarationFy}-03-31` };
  if (route === 'annexure_viii' && validIndianBillingDate(arnDate)) return { from: arnDate, through: addBillingDays(arnDate, 15) };
  return null;
}
