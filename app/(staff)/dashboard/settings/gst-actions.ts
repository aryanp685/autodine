/**
 * Saving the GST configuration.
 *
 * WHAT THIS IS
 *
 * The database migration 20261113000100 validates everything again (mode-
 * dependent requireds, state-code/GSTIN agreement, PAN/GSTIN agreement, the
 * specified-premises attestation and the composition acknowledgment). This
 * action exists so the owner gets a readable refusal instead of a Postgres
 * error, and so normalization (uppercase, trimming, deriving the state code
 * and PAN from the GSTIN) happens once, here.
 *
 * WHAT IT IS NOT
 *
 * It does not decide GST policy. The only regular profiles are the two
 * notified ones, composition is a status with the registration type and the
 * owner's acknowledgment, and 'off' means normal non-GST receipts. If a
 * restaurant needs anything else, that is a conversation with an adviser,
 * not a form field.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { canEditSettings } from '@/lib/settings-input';
import { checkGstin, panMatchesGstin } from '@/lib/gst/gstin';
import { checkCompositionEligibility } from '@/lib/gst/composition';
import { REGULAR_PROFILES, type GstProfileId } from '@/lib/gst/profiles';

const SETTINGS_PATH = '/dashboard/settings';
const AFFECTED_PATHS = ['/dashboard/settings', '/dashboard', '/menu', '/menu/cart', '/menu/checkout'];

function fail(message: string): never {
  redirect(`${SETTINGS_PATH}?error=${encodeURIComponent(message)}`);
}

function done(message: string): never {
  redirect(`${SETTINGS_PATH}?notice=${encodeURIComponent(message)}`);
}

async function requireEditor() {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) {
    if (staff.reason === 'signed-out') fail('You need to be signed in to change settings.');
    if (staff.reason === 'no-membership') fail('This account is not a member of any restaurant yet.');
    fail('The database is not connected, so there is nothing to save to.');
  }
  if (!canEditSettings(staff.context.role)) {
    fail('Only the owner or a manager can change these settings. Ask them to make this change.');
  }
  return staff.context;
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function checkbox(formData: FormData, key: string): boolean {
  return formData.get(key) === 'on' || formData.get(key) === 'true';
}

const PINCODE = /^[1-9][0-9]{5}$/;
const HSN_SAC = /^[0-9]{4,8}$/;

/** Optional e-Invoice issuance profile fields; empty means "leave unset" and the issuance service fails closed. */
function einvoiceProfile(formData: FormData): { einvoice_location: string | null; einvoice_pincode: string | null; einvoice_hsn_sac: string | null } {
  const location = text(formData, 'einvoiceLocation');
  const pincode = text(formData, 'einvoicePincode');
  const hsnSac = text(formData, 'einvoiceHsnSac');
  if (location && (location.length < 2 || location.length > 120)) {
    fail('The e-Invoice location (city/district/taluka, as on the GST registration) must be 2–120 characters, or left empty.');
  }
  if (pincode && !PINCODE.test(pincode)) {
    fail('The e-Invoice PIN code must be exactly 6 digits and not start with 0, or be left empty.');
  }
  if (hsnSac && !HSN_SAC.test(hsnSac)) {
    fail('The HSN/SAC must be 4–8 digits (996331 is the restaurant-service SAC), or left empty.');
  }
  return {
    einvoice_location: location || null,
    einvoice_pincode: pincode || null,
    einvoice_hsn_sac: hsnSac || null,
  };
}

function rupeesToPaise(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[₹,\s]/g, '');
  const rupees = Number(cleaned);
  if (!Number.isFinite(rupees) || rupees < 0 || rupees > 1_000_000_000_000) {
    fail('Enter the preceding-FY turnover as a plain number of rupees, or leave it empty.');
  }
  return Math.round(rupees * 100);
}

export async function saveGstAction(formData: FormData): Promise<void> {
  const { supabase, restaurantId } = await requireEditor();

  const mode = text(formData, 'mode');
  if (mode !== 'off' && mode !== 'regular' && mode !== 'composition') {
    fail('Choose one of the three billing modes: normal receipts, composition, or regular GST.');
  }

  if (mode === 'off') {
    // Normal Billing is a deliberate recorded choice, never a silent default.
    // The owner must declare they are not issuing GST documents for this
    // restaurant — and must NOT declare an unmet GST obligation.
    const declaresObligation = checkbox(formData, 'offHasObligation');
    if (declaresObligation) {
      fail('You marked that this restaurant is required to be registered for GST. Normal receipts cannot carry GST — choose Regular GST or Composition instead.');
    }
    const declared = checkbox(formData, 'offDeclared');
    if (!declared) {
      fail('Confirm the Normal-Billing declaration: this restaurant is not issuing GST documents (it is not registered for GST, or it is registered but issues ordinary receipts without GST).');
    }
    const { data: saved, error } = await supabase
      .from('restaurant_gst_config')
      .upsert(
        { restaurant_id: restaurantId, mode: 'off', off_declared: true, off_declared_at: new Date().toISOString() },
        { onConflict: 'restaurant_id' },
      )
      .select('restaurant_id');
    if (error) writeFailure('switching GST off', error);
    if (!saved || saved.length === 0) fail('Nothing was saved.');
    for (const path of AFFECTED_PATHS) revalidatePath(path);
    done('GST is off. New documents are normal non-GST receipts; menu prices bill as they always have.');
  }

  const issuance = einvoiceProfile(formData);
  const gstinRaw = text(formData, 'gstin').toUpperCase();
  const legalName = text(formData, 'legalName');
  const tradeName = text(formData, 'tradeName');
  const address = text(formData, 'address');
  const registrationType = text(formData, 'registrationType');
  const turnoverPaise = rupeesToPaise(text(formData, 'precedingFyTurnoverRupees'));

  const gstinCheck = checkGstin(gstinRaw);
  if (!gstinCheck.ok) {
    fail(`The GSTIN is not usable: ${gstinCheck.reason} This checks format, checksum and state code — it cannot see the GST portal, so confirm the registration there.`);
  }
  if (legalName.length < 2) fail('Enter the legal name exactly as on the GST registration.');
  if (address.length < 5) fail('Enter the address exactly as on the GST registration.');
  const stateCode = gstinCheck.parts.stateCode;
  const pan = gstinCheck.parts.pan;
  if (registrationType !== 'regular' && registrationType !== 'composition') {
    fail('Say whether this GSTIN is on a regular or a Composition Scheme registration.');
  }
  // The PAN embedded in the GSTIN is authoritative; no separate entry to mistype.
  if (!panMatchesGstin(pan, gstinRaw)) fail('The PAN embedded in the GSTIN did not verify.');

  const base = {
    restaurant_id: restaurantId,
    ...issuance,
    gstin: gstinRaw,
    legal_name: legalName,
    trade_name: tradeName || null,
    address,
    state_code: stateCode,
    pan,
    registration_type: registrationType as 'regular' | 'composition',
    preceding_fy_turnover_paise: turnoverPaise,
  };

  let patch: Record<string, unknown>;
  if (mode === 'regular') {
    const profile = text(formData, 'regularProfile') as GstProfileId;
    if (!Object.prototype.hasOwnProperty.call(REGULAR_PROFILES, profile)) {
      fail('Choose a GST profile: 5% (other than specified premises) or 18% (specified premises).');
    }
    if (registrationType !== 'regular') {
      fail('A Composition Scheme GSTIN cannot issue GST tax invoices. Choose composition mode, or fix the registration type.');
    }
    const specifiedPremisesAttested = checkbox(formData, 'specifiedPremisesAttested');
    if (profile === 'specified_premises' && !specifiedPremisesAttested) {
      fail('The 18% profile is only for restaurants in specified premises (hotel accommodation above the notified threshold in the preceding FY, with a declaration from the eligible hotel supplier). Tick the attestation — declaring it without holding that declaration is not permitted — or choose 5%.');
    }
    let effectiveFrom = text(formData, 'specifiedPremisesEffectiveFrom');
    if (profile === 'specified_premises') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(effectiveFrom))) {
        fail('Enter the date the specified-premises treatment has applied from (YYYY-MM-DD). Notification No. 05/2025-CT(Rate) applies from 2025-04-01.');
      }
      if (effectiveFrom < '2025-04-01') {
        fail('The specified-premises treatment cannot apply before 2025-04-01, the effective date of Notification No. 05/2025-CT(Rate).');
      }
    } else {
      effectiveFrom = '2025-04-01';
    }
    patch = {
      ...base,
      mode: 'regular',
      regular_profile: profile,
      specified_premises_attested: specifiedPremisesAttested,
      specified_premises_effective_from: effectiveFrom,
      composition_acknowledged: false,
      // Regular mode means the owner is issuing GST documents.
      off_declared: false,
      off_declared_at: null,
    };
  } else {
    // composition
    const acknowledged = checkbox(formData, 'compositionAcknowledged');
    const eligibility = checkCompositionEligibility({
      registrationType,
      ineligibilityAcknowledged: acknowledged,
    });
    if (!eligibility.ok) fail(eligibility.reasons[0]);
    const { count: alcoholCount, error: alcoholError } = await supabase
      .from('items')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .eq('is_alcoholic', true);
    if (alcoholError) {
      console.error('[gst] composition alcohol check failed', alcoholError);
      fail('We could not verify whether this restaurant sells alcoholic items. Nothing was saved — please try again.');
    }
    if ((alcoholCount ?? 0) > 0) {
      fail('This restaurant has alcoholic items on the menu. The Composition Scheme does not permit alcoholic liquor — switch them off the menu first, or choose Regular GST.');
    }
    patch = {
      ...base,
      mode: 'composition',
      regular_profile: null,
      specified_premises_attested: false,
      specified_premises_effective_from: '2025-04-01',
      composition_acknowledged: acknowledged,
      off_declared: false,
      off_declared_at: null,
    };
  }

  const { data: saved, error } = await supabase
    .from('restaurant_gst_config')
    .upsert(patch, { onConflict: 'restaurant_id' })
    .select('restaurant_id, config_version');
  if (error) writeFailure('saving the GST configuration', error);
  if (!saved || saved.length === 0) {
    fail('Nothing was saved. Your account can see this restaurant but is not allowed to change its GST settings.');
  }

  for (const path of AFFECTED_PATHS) revalidatePath(path);

  const version = Number(saved[0]?.config_version ?? 0);
  done(
    mode === 'regular'
      ? `GST tax invoices are on (${patch.regular_profile === 'specified_premises' ? '18%, specified premises' : '5%, no ITC'}). New orders bill tax-inclusive at the profile rate; already-placed tickets keep their pricing. Configuration version ${version}.`
      : `Composition billing is on. New documents are Bills of Supply; no GST is collected and no ITC can be claimed. Configuration version ${version}.`,
  );
}

function writeFailure(context: string, error: { code?: string; message: string }): never {
  if (error.code === '42501') {
    fail('The database refused this change for your account. Only the owner or a manager can change GST settings.');
  }
  if (error.code === '23514' || error.code === '23502') {
    // The database's own mode-dependent validation spoke. Its messages are
    // written for owners, so they are passed through.
    console.error(`[gst] ${context} refused by the database`, error);
    const message = error.message.replace(/^.*?(, )?/, '').replace(/^new row for relation "restaurant_gst_config" violates check constraint "[^"]+"\s*/, '');
    fail(message.length > 20 ? message : 'The database refused that configuration. Check the GSTIN, state code, profile and acknowledgments.');
  }
  if (error.code === '42703' || error.code === 'PGRST204' || error.code === '42P01') {
    fail('GST settings need a database update that has not been applied to this deployment yet. Nothing was changed.');
  }
  console.error(`[gst] ${context} failed`, error);
  fail('We could not save that. Nothing was changed — please try again.');
}
