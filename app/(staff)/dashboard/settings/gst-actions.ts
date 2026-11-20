'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { checkGstin } from '@/lib/gst/gstin';
import { checkCompositionEligibility } from '@/lib/gst/composition';
import {
  declarationWindow, gstFinancialYearStart, GST_DEFERRAL_REASONS, GST_OUTLET_STATES, GST_SERIES_KINDS, ROOM_SUPPLY_THRESHOLD_PAISE, SPECIFIED_PREMISES_NOT_BEFORE,
  validFssai, validIndianBillingDate, validServiceSac, type GstPremisesEvidence,
} from '@/lib/gst/onboarding';
import { localDateKey, RESTAURANT_TIME_ZONE } from '@/lib/db/time';
import type { Json } from '@/lib/db/types';

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
  if (staff.context.role !== 'owner') fail('Only the outlet owner can change GST settings.');
  if (!staff.context.entitlement?.canWrite) fail('This outlet is read-only. Restore access before changing GST settings.');
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
    fail('The HSN/SAC must be 4–8 digits (use the code confirmed for this supply), or left empty.');
  }
  return {
    einvoice_location: location || null,
    einvoice_pincode: pincode || null,
    einvoice_hsn_sac: hsnSac || null,
  };
}

function rupeesToPaise(raw: string, label = 'preceding-FY turnover'): number | null {
  if (!raw) return null;
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(raw.replace(/[₹,\s]/g, ''));
  if (!match) fail(`Enter the ${label} in rupees with up to two decimals.`);
  const paise = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (paise > 100_000_000_000_000n) fail(`The ${label} exceeds the supported amount.`);
  return Number(paise);
}

export async function deferGstAction(formData: FormData): Promise<void> {
  const { supabase, restaurantId } = await requireEditor();
  if (text(formData, 'gstOutletId') !== restaurantId) fail('The outlet changed. Reload GST settings before recording a deferral.');
  const version = text(formData, 'configVersion');
  const reason = text(formData, 'deferralReason');
  if (!/^\d{1,10}$/.test(version) || Number(version) > 2_147_483_647 || !Object.hasOwn(GST_DEFERRAL_REASONS, reason)) {
    fail('Reload the billing profile and select a reason for deferring onboarding.');
  }
  const { error } = await supabase.rpc('record_gst_outlet_deferral', { p_outlet: restaurantId, p_expected_version: Number(version), p_reason: reason });
  if (error) writeFailure(error);
  revalidatePath(SETTINGS_PATH);
  done('Onboarding deferred. Existing billing rules and documents were not changed.');
}

export async function saveGstAction(formData: FormData): Promise<void> {
  const { supabase, restaurantId } = await requireEditor();

  // This is a precondition, not a selector or a permission. Two outlets
  // can have the same version; an old tab must not save into the newly
  // selected outlet. Only the server-resolved membership supplies the ID.
  if (text(formData, 'gstOutletId') !== restaurantId) {
    fail('The outlet for this GST form changed. Reload GST settings for the selected outlet before saving.');
  }

  const billingMode = text(formData, 'billingMode');
  const subtype = text(formData, 'noGstSubtype');
  const mode = billingMode === 'gst' ? 'regular'
    : billingMode === 'no_gst' && subtype === 'composition' ? 'composition'
    : billingMode === 'no_gst' && subtype === 'unregistered' ? 'off'
    : fail('Choose GST or No-GST. For No-GST, select unregistered or Composition.');
  const versionText = text(formData, 'configVersion');
  if (!/^\d{1,10}$/.test(versionText) || Number(versionText) > 2_147_483_647) {
    fail('Reload GST settings before saving.');
  }
  const version = Number(versionText);
  const fssaiNumber = formData.get('fssaiNumber');
  if (typeof fssaiNumber !== 'string' || !validFssai(fssaiNumber)) fail('Enter an FSSAI number with exactly 14 digits.');

  const today = localDateKey(RESTAURANT_TIME_ZONE, new Date());
  const fyStart = gstFinancialYearStart(today);
  async function save(settings: Record<string, Json>) {
    if (!checkbox(formData, 'confirmActivation') || !checkbox(formData, 'seriesConfirmed')) {
      fail('Confirm activation for this outlet and confirm the numbering is reserved across your external books.');
    }
    const effectiveFrom = text(formData, 'activationDate');
    if (effectiveFrom !== today) fail('Choose today in India as the activation date. Backdating and scheduled activation are not supported.');
    const premisesAddress = text(formData, 'premisesAddress');
    const state = text(formData, 'premisesStateCode');
    const phone = text(formData, 'invoicePhone');
    if (!Object.hasOwn(GST_OUTLET_STATES, state) || premisesAddress.length < 5 || premisesAddress.length > 300
        || !/^[+0-9][0-9 ()+.-]{5,23}$/.test(phone)) fail('Enter the licensed premises address, supported state and invoice phone.');
    if (typeof settings.gstin === 'string' && settings.gstin.slice(0, 2) !== state) {
      fail('The outlet state must match the supplier GSTIN. This workflow supports direct same-state restaurant service only.');
    }
    const series = Object.fromEntries(GST_SERIES_KINDS.map((key) => [key, text(formData, `series${key}`).toUpperCase()]));
    const externalPrefixes = [...new Set(text(formData, 'externalSeries').toUpperCase().split(/[\s,]+/).filter(Boolean))];
    const ownPrefixes = Object.values(series);
    if (ownPrefixes.some((prefix) => !/^[A-Z1-9][A-Z0-9]{1,2}$/.test(prefix)) || new Set(ownPrefixes).size !== 5
        || externalPrefixes.length > 30 || externalPrefixes.some((prefix) => !/^[A-Z1-9][A-Z0-9]{1,2}$/.test(prefix))) {
      fail('Enter five distinct two- or three-character series prefixes and valid external prefixes (A–Z, 0–9).');
    }
    if (externalPrefixes.some((prefix) => ownPrefixes.includes(prefix))) fail('A numbering prefix overlaps the external series list.');
    const maxTurnover = mode === 'regular' ? rupeesToPaise(text(formData, 'highestPriorFyRupees'), 'highest prior-FY turnover') : null;
    const adviserRef = text(formData, 'adviserReference');
    if (adviserRef.length > 120) fail('The optional adviser reference must be 120 characters or fewer.');
    const optIn = typeof settings.premises_evidence === 'object' && settings.premises_evidence !== null
      && !Array.isArray(settings.premises_evidence) && settings.premises_evidence.basis === 'opt_in';
    const aatoRef = text(formData, 'aatoReference');
    if (maxTurnover !== null && (aatoRef.length < 2 || aatoRef.length > 120)) fail('Add an evidence reference for the complete PAN-wide prior-FY review.');
    let hotelReview: Json = null;
    if (settings.business_type === 'hotel' && settings.regular_profile === 'other_than_specified_premises') {
      const roomBasis = text(formData, 'hotelRoomBasis');
      const reviewRef = text(formData, 'hotelReviewRef');
      const declaration = text(formData, 'hotelDeclarationStatus');
      if (!checkbox(formData,'hotelReviewConfirmed') || reviewRef.length < 2 || reviewRef.length > 120
        || text(formData,'hotelRoomFy') !== String(fyStart - 1) || !['actual','no_supplies'].includes(roomBasis)
        || !['none_in_force','opted_out'].includes(declaration)) fail('Record the preceding FY room evidence and confirm the declaration status for this hotel premises.');
      const room = roomBasis === 'actual' ? rupeesToPaise(text(formData,'hotelMaxRoomRupees'), 'highest actual room value') : null;
      if (roomBasis === 'actual' && (room === null || room < 1 || room > ROOM_SUPPLY_THRESHOLD_PAISE)) {
        fail('The 5% hotel profile cannot be used if any preceding-FY actual room value exceeded ₹7,500 per unit per day.');
      }
      const optOutFy = declaration === 'opted_out' ? Number(text(formData,'optOutFy')) : null;
      const optOutFiled = optOutFy === null ? null : text(formData,'optOutFiled');
      const optOutReference = optOutFy === null ? null : text(formData,'optOutReference');
      const window = optOutFy === null ? null : declarationWindow('annexure_ix', optOutFy, '');
      if (optOutFy !== null && (optOutFy > fyStart || !window || !optOutFiled || !validIndianBillingDate(optOutFiled) || optOutFiled < window.from
        || optOutFiled > window.through || optOutFiled > today || !optOutReference || optOutReference.length < 2 || optOutReference.length > 120)) {
        fail('Record the Annexure IX reference and a filing from 1 January through 31 March before its first treatment FY.');
      }
      hotelReview = { treatment_fy:fyStart, room_fy:fyStart-1, reference:reviewRef, confirmed:true,
        room_basis:roomBasis,max_room_paise:room,declaration_status:declaration,opt_out_fy:optOutFy,
        opt_out_filed:optOutFiled,opt_out_reference:optOutReference };
    }
    const activation: Json = {
      confirm: true, series_confirmed: true, effective_from: today, premises_address: premisesAddress,
      premises_state_code: state, invoice_phone: phone, series, external_prefixes: externalPrefixes,
      adviser_reference: adviserRef || null,
      declaration_route: optIn ? text(formData, 'declarationRoute') : null,
      declaration_fy: optIn ? Number(text(formData, 'declarationFy')) : null,
      registration_effective_on: optIn && text(formData,'declarationRoute') === 'annexure_viii' ? text(formData,'registrationEffectiveOn') : null,
      hotel_review: hotelReview,
      aato: maxTurnover === null ? null : { highest_prior_fy_paise: maxTurnover,
        reference: aatoRef, reporting_category: text(formData, 'reportingCategory') || 'unknown' },
    };
    const { data, error } = await supabase.rpc('save_restaurant_gst_config', {
      p_restaurant_id: restaurantId,
      p_expected_version: version,
      p_settings: { ...settings, activation },
    });
    if (error) writeFailure(error);
    if (!Number.isInteger(data) || !data || data < 1) fail('The save could not be verified. Reload GST settings before trying again.');
    for (const path of AFFECTED_PATHS) revalidatePath(path);
    return data;
  }

  if (mode === 'off') {
    if (text(formData, 'gstin')) fail('Unregistered retail billing cannot carry a GSTIN.');
    if (checkbox(formData, 'offHasObligation')) {
      fail('You marked that this business is required to be registered for GST. It cannot use unregistered retail billing.');
    }
    if (!checkbox(formData, 'offDeclared')) {
      fail('Confirm the No-GST unregistered declaration: this business is not registered or required to register for GST.');
    }
    await save({ mode, fssai_number: fssaiNumber, off_declared: true, off_has_obligation: false });
    done('No-GST retail billing is on. New orders use menu prices with no GST or legacy add-on tax.');
  }

  const issuance = mode === 'regular' ? einvoiceProfile(formData)
    : { einvoice_location: null, einvoice_pincode: null, einvoice_hsn_sac: null };
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
  if (legalName.length < 2 || legalName.length > 160 || tradeName.length > 160) fail('Enter the legal name exactly as on the GST registration (2–160 characters).');
  if (address.length < 5 || address.length > 300) fail('Enter the registered address (5–300 characters).');
  if (registrationType !== 'regular' && registrationType !== 'composition') {
    fail('Say whether this GSTIN is on a regular or a Composition Scheme registration.');
  }

  const base = {
    ...issuance,
    fssai_number: fssaiNumber,
    gstin: gstinRaw,
    legal_name: legalName,
    trade_name: tradeName || null,
    address,
    registration_type: registrationType as 'regular' | 'composition',
    preceding_fy_turnover_paise: turnoverPaise,
  };

  const serviceSac = text(formData, 'serviceSac');
  if (!validServiceSac(serviceSac)) fail('Enter the applicable six-digit restaurant service SAC.');

  let patch: { [key: string]: Json };
  if (mode === 'regular') {
    if (registrationType !== 'regular') {
      fail('GST tax invoices require a regular registration. Use No-GST → Composition for a Composition GSTIN.');
    }
    const businessType = text(formData, 'businessType');
    if (businessType !== 'standalone' && businessType !== 'hotel') fail('Choose the restaurant business type.');
    const premisesBasis = text(formData, 'premisesBasis');
    if (businessType === 'hotel' && !premisesBasis) fail('Confirm whether the hotel restaurant qualifies as Specified Premises.');
    const basis = premisesBasis || 'none';
    let evidence: GstPremisesEvidence | null = null;
    let effectiveFrom = SPECIFIED_PREMISES_NOT_BEFORE;
    if (basis !== 'none') {
      if (businessType !== 'hotel') fail('A standalone restaurant cannot use the 18% Specified Premises profile.');
      if (!checkbox(formData, 'specifiedPremisesAttested')) fail('Confirm the Specified Premises evidence for this outlet.');
      const reference = text(formData, 'premisesEvidenceRef');
      if (reference.length < 2 || reference.length > 120) fail('Enter the reference to the signed premises evidence (2–120 characters).');
      if (text(formData, 'premisesTreatmentFy') !== String(fyStart)) fail('Use the current Indian financial year for the Specified Premises treatment.');
      const reviewed = { reference, treatment_fy_start: fyStart };
      if (basis === 'room_supply') {
        const value = rupeesToPaise(text(formData, 'roomSupplyValueRupees'), 'actual room supply value');
        if (text(formData, 'roomSupplyFy') !== String(fyStart - 1) || value === null || value <= ROOM_SUPPLY_THRESHOLD_PAISE) {
          fail('The actual room supply must exceed ₹7,500 per unit per day in the preceding financial year.');
        }
        evidence = { ...reviewed, basis, room_supply_fy_start: fyStart - 1, room_value_paise: value };
      } else if (basis === 'opt_in') {
        const filed = text(formData, 'premisesFiledOn');
        const route = text(formData, 'declarationRoute');
        const declaredFy = Number(text(formData, 'declarationFy'));
        const window = declarationWindow(route, declaredFy, text(formData, 'registrationAcknowledgedOn'));
        if (!window || !validIndianBillingDate(filed) || filed < window.from || filed > window.through || filed > today
            || declaredFy > fyStart || (declaredFy === 2025 && fyStart > 2025)) {
          fail('Enter the filed date within the notified Annexure VII or VIII period and use current applicable evidence.');
        }
        evidence = { ...reviewed, basis, filed_on: filed, filing_from: window.from, filing_through: window.through };
      } else {
        fail('Choose an approved Specified Premises evidence basis.');
      }
      effectiveFrom = text(formData, 'specifiedPremisesEffectiveFrom');
      if (!validIndianBillingDate(effectiveFrom) || effectiveFrom < SPECIFIED_PREMISES_NOT_BEFORE
          || effectiveFrom > today || gstFinancialYearStart(effectiveFrom) !== fyStart) {
        fail('Enter a reviewed effective date (YYYY-MM-DD) in this financial year, on or after 2025-04-01 and not in the future.');
      }
    }
    if (evidence?.basis === 'room_supply' && effectiveFrom !== `${fyStart}-04-01`) {
      fail('The preceding-FY room test classifies this treatment FY from 1 April. Use the separate activation date for new billing.');
    }
    if (evidence?.basis === 'opt_in') {
      const route = text(formData, 'declarationRoute');
      const carried = Number(text(formData, 'declarationFy')) !== fyStart;
      const reg = text(formData,'registrationEffectiveOn');
      if (route === 'annexure_viii' && (!validIndianBillingDate(reg) || reg > today || reg < SPECIFIED_PREMISES_NOT_BEFORE
          || gstFinancialYearStart(reg) !== Number(text(formData,'declarationFy')))) fail('Record the registration effective date in the original declaration financial year.');
      if ((route === 'annexure_vii' || carried) ? effectiveFrom !== `${fyStart}-04-01` : effectiveFrom !== reg) {
        fail('The treatment effective date does not match the recorded declaration and registration.');
      }
    }
    if (issuance.einvoice_hsn_sac && issuance.einvoice_hsn_sac !== serviceSac) fail('The e-invoice SAC must match the saved restaurant service SAC.');
    patch = {
      ...base,
      mode: 'regular',
      business_type: businessType,
      service_sac: serviceSac,
      regular_profile: evidence ? 'specified_premises' : 'other_than_specified_premises',
      premises_evidence: evidence,
      specified_premises_attested: evidence !== null,
      specified_premises_effective_from: effectiveFrom,
      composition_acknowledged: false,
    };
  } else {
    // composition
    const acknowledged = checkbox(formData, 'compositionAcknowledged');
    const eligibility = checkCompositionEligibility({
      registrationType,
      ineligibilityAcknowledged: acknowledged,
    });
    if (!eligibility.ok) fail(eligibility.reasons[0]);
    patch = {
      ...base,
      mode: 'composition',
      service_sac: serviceSac,
      regular_profile: null,
      specified_premises_attested: false,
      specified_premises_effective_from: '2025-04-01',
      composition_acknowledged: acknowledged,
    };
  }

  const savedVersion = await save(patch);
  done(
    mode === 'regular'
      ? `GST tax invoices are on (${patch.regular_profile === 'specified_premises' ? '18%, specified premises' : '5%, no ITC'}). New orders bill tax-inclusive at the profile rate; already-placed tickets keep their pricing. Configuration version ${savedVersion}.`
      : `Composition billing is on. New documents are Bills of Supply; no GST is collected and no ITC can be claimed. Configuration version ${savedVersion}.`,
  );
}

function writeFailure(error: { code?: string; message: string }): never {
  if (error.code === '42501') fail('Only the outlet owner can change GST settings.');
  if (error.code === 'P0001' || error.code === '22023' || error.code === '23514') {
    // Custom validation messages contain no registration details. Generic
    // constraints/casts may echo user input; never log or forward their row data.
    fail(error.message.startsWith('new row for relation')
      ? 'The database refused that configuration. Check the registered details and profile.' : error.message);
  }
  if (['42703', '42883', 'PGRST202', '42P01'].includes(error.code ?? '')) {
    fail('GST settings are unavailable until this deployment has the reviewed database update. Nothing was changed.');
  }
  console.error('[gst] configuration save failed', { code: error.code ?? 'unknown' });
  fail('We could not save that. Nothing was changed — please try again.');
}
