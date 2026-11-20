import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syntheticGstin, SYNTHETIC_FSSAI, SYNTHETIC_SERVICE_SAC } from '@/lib/gst/test-fixtures';
import { localDateKey, RESTAURANT_TIME_ZONE } from '@/lib/db/time';
import { gstFinancialYearStart } from '@/lib/gst/onboarding';

const mocks = vi.hoisted(() => ({ staff: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/db/staff', () => ({ getStaffContextDetailed: mocks.staff }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(decodeURIComponent(url)); },
}));

import { deferGstAction, saveGstAction } from './gst-actions';

function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  const activationDate = localDateKey(RESTAURANT_TIME_ZONE, new Date());
  for (const [key, value] of Object.entries({ billingMode: 'no_gst', noGstSubtype: 'unregistered', fssaiNumber: SYNTHETIC_FSSAI, configVersion: '0', gstOutletId: 'authorized-id', activationDate,
    confirmActivation: 'on', seriesConfirmed: 'on', premisesAddress: '1 Synthetic Premises', premisesStateCode: '27', invoicePhone: '07120000000',
    seriesINV: 'INV', seriesBOS: 'BOS', seriesRBL: 'RBL', seriesCN: 'CN', seriesDN: 'DN', ...fields })) data.set(key, value);
  return data;
}

const registered = {
  gstin: syntheticGstin('27ZZZZZ0000Z1Z').toLowerCase(),
  legalName: 'Synthetic Kitchen', address: '1 Test Lane, Nagpur',
  billingMode: 'gst', businessType: 'standalone', serviceSac: SYNTHETIC_SERVICE_SAC, registrationType: 'regular',
};
const owner = (role = 'owner', canWrite = true) => ({
  ok: true, context: { role, entitlement: { canWrite }, restaurantId: 'authorized-id', supabase: { rpc: mocks.rpc } },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.staff.mockResolvedValue(owner());
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
});

describe('GST configuration server action', () => {
  it.each(['manager', 'cashier', 'kitchen'])('denies %s before making any write', async (role) => {
    mocks.staff.mockResolvedValue(owner(role));
    await expect(saveGstAction(form({ offDeclared: 'on' }))).rejects.toThrow(/only the outlet owner/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['signed-out', /signed in/i], ['no-membership', /not a member/i], ['unconfigured', /not connected/i],
  ])('rejects %s before looking at the submitted outlet or making any write', async (reason, message) => {
    mocks.staff.mockResolvedValue({ ok: false, reason });
    await expect(saveGstAction(form({ offDeclared: 'on', gstOutletId: 'foreign-id' }))).rejects.toThrow(message);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(['', 'first-outlet', 'foreign-outlet'])('rejects a missing or mismatched binding (%s), even when the version could match', async (gstOutletId) => {
    await expect(saveGstAction(form({ offDeclared: 'on', gstOutletId }))).rejects.toThrow(/outlet for this GST form changed/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('denies read-only accounts and attempts to declare a GST obligation in Normal Billing', async () => {
    mocks.staff.mockResolvedValueOnce(owner('owner', false));
    await expect(saveGstAction(form({ offDeclared: 'on' }))).rejects.toThrow(/read-only/i);
    await expect(saveGstAction(form())).rejects.toThrow(/unregistered declaration/i);
    await expect(saveGstAction(form({ offDeclared: 'on', offHasObligation: 'on' }))).rejects.toThrow(/required to be registered|is required to register/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sends the saved form version plus verified outlet, never client tenant or amount fields', async () => {
    await expect(saveGstAction(form({ offDeclared: 'on', configVersion: '7', restaurantId: 'foreign-id' }))).rejects.toThrow(/notice=No-GST retail billing is on/);
    expect(mocks.rpc).toHaveBeenCalledWith('save_restaurant_gst_config', {
      p_restaurant_id: 'authorized-id', p_expected_version: 7,
      p_settings: { mode: 'off', fssai_number: SYNTHETIC_FSSAI, off_declared: true, off_has_obligation: false,
        activation: expect.objectContaining({ confirm: true, premises_state_code: '27', series: {INV:'INV',BOS:'BOS',RBL:'RBL',CN:'CN',DN:'DN'}, adviser_reference: null }) },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/menu/checkout');
  });

  it.each(['', '1234567890123', '123456789012345', '0123456789012X', ' 01234567890123'])('rejects invalid FSSAI in either mode without writing (%s)', async (fssaiNumber) => {
    await expect(saveGstAction(form({ offDeclared: 'on', fssaiNumber }))).rejects.toThrow(/14 digits/i);
    await expect(saveGstAction(form({ ...registered, fssaiNumber }))).rejects.toThrow(/14 digits/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires a valid GSTIN only for registered situations and cannot choose Composition as a top-level mode', async () => {
    await expect(saveGstAction(form({ ...registered, gstin: 'bad' }))).rejects.toThrow(/GSTIN is not usable/i);
    await expect(saveGstAction(form({ offDeclared: 'on', gstin: registered.gstin }))).rejects.toThrow(/cannot carry a GSTIN/i);
    await expect(saveGstAction(form({ billingMode: 'composition' }))).rejects.toThrow(/choose GST or No-GST/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await expect(saveGstAction(form({ ...registered, billingMode: 'no_gst', noGstSubtype: 'composition', registrationType: 'composition', compositionAcknowledged: 'on' })))
      .rejects.toThrow(/notice=Composition billing is on/);
    expect(mocks.rpc).toHaveBeenCalledWith('save_restaurant_gst_config', expect.objectContaining({
      p_settings: expect.objectContaining({ mode: 'composition', fssai_number: SYNTHETIC_FSSAI, regular_profile: null }),
    }));
  });

  it('requires an owner-supplied Composition service SAC without adding a tax profile', async () => {
    const fields = { ...registered, billingMode:'no_gst', noGstSubtype:'composition', registrationType:'composition', compositionAcknowledged:'on' };
    for (const serviceSac of ['', '99633', 'abc123']) await expect(saveGstAction(form({...fields,serviceSac}))).rejects.toThrow(/six-digit.*SAC/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await expect(saveGstAction(form({...fields,serviceSac:'996332'}))).rejects.toThrow(/notice=Composition billing is on/);
    expect(mocks.rpc).toHaveBeenCalledWith('save_restaurant_gst_config',expect.objectContaining({p_settings:expect.objectContaining({
      mode:'composition',regular_profile:null,service_sac:'996332',einvoice_hsn_sac:null,
    })}));
  });

  it('derives 18% only for a hotel with valid reviewed proof and preserves the threshold in paise', async () => {
    const today = localDateKey(RESTAURANT_TIME_ZONE, new Date());
    const fy = gstFinancialYearStart(today);
    const fields = { ...registered, premisesBasis: 'room_supply', premisesTreatmentFy: String(fy), roomSupplyFy: String(fy - 1),
      roomSupplyValueRupees: '7500.01', specifiedPremisesAttested: 'on', premisesEvidenceRef: 'Signed synthetic packet', specifiedPremisesEffectiveFrom: `${fy}-04-01` };
    await expect(saveGstAction(form(fields))).rejects.toThrow(/standalone/i);
    const hotel = { ...fields, businessType: 'hotel' };
    await expect(saveGstAction(form({ ...hotel, specifiedPremisesAttested: '' }))).rejects.toThrow(/premises evidence/i);
    await expect(saveGstAction(form({ ...hotel, specifiedPremisesEffectiveFrom: '2026-02-31' }))).rejects.toThrow(/YYYY-MM-DD/i);
    await expect(saveGstAction(form({ ...hotel, specifiedPremisesEffectiveFrom: '2099-01-01' }))).rejects.toThrow(/not in the future/i);
    await expect(saveGstAction(form({ ...hotel, roomSupplyValueRupees: '7500.00' }))).rejects.toThrow(/must exceed/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await expect(saveGstAction(form(hotel))).rejects.toThrow(/notice=GST tax invoices are on.*18%/);
    expect(mocks.rpc).toHaveBeenLastCalledWith('save_restaurant_gst_config', expect.objectContaining({
      p_settings: expect.objectContaining({ premises_evidence: expect.objectContaining({ basis: 'room_supply', room_value_paise: 750001 }) }),
    }));
    const opt = { ...hotel, premisesBasis: 'opt_in', declarationRoute: 'annexure_vii', declarationFy: String(fy), premisesFiledOn: `${fy}-03-31`, specifiedPremisesEffectiveFrom: `${fy}-04-01` };
    await expect(saveGstAction(form({ ...opt, premisesFiledOn: `${fy}-04-02` }))).rejects.toThrow(/filed date within/i);
    await expect(saveGstAction(form(opt))).rejects.toThrow(/notice=GST tax invoices are on.*18%/);
    expect(mocks.rpc).toHaveBeenLastCalledWith('save_restaurant_gst_config', expect.objectContaining({
      p_settings: expect.objectContaining({ premises_evidence: expect.objectContaining({ basis: 'opt_in', filed_on: opt.premisesFiledOn }) }),
    }));
  });

  it('cannot override the 5% profile with a supplied rate or profile name', async () => {
    await expect(saveGstAction(form({ ...registered, regularProfile: 'specified_premises', roomSupplyValueRupees: '8000' })))
      .rejects.toThrow(/notice=GST tax invoices are on.*5%, no ITC/);
    expect(mocks.rpc).toHaveBeenCalledWith('save_restaurant_gst_config', expect.objectContaining({
      p_settings: expect.objectContaining({ regular_profile: 'other_than_specified_premises', premises_evidence: null }),
    }));
  });

  it('preserves paise at the turnover threshold and does not invent a registration detail', async () => {
    const fields = { ...registered, precedingFyTurnoverRupees: '5,00,00,000.01' };
    await expect(saveGstAction(form(fields))).rejects.toThrow(/notice=GST tax invoices are on/);
    expect(mocks.rpc).toHaveBeenCalledWith('save_restaurant_gst_config', expect.objectContaining({
      p_settings: expect.objectContaining({ gstin: registered.gstin.toUpperCase(), preceding_fy_turnover_paise: 5_000_000_001 }),
    }));
  });

  it.each([
    [{ confirmActivation: '' }, /confirm activation/i],
    [{ activationDate: '2025-04-01' }, /today in India/i],
    [{ premisesStateCode: '29' }, /must match/i],
    [{ seriesDN: 'CN' }, /distinct/i],
    [{ externalSeries: 'INV' }, /overlap/i],
  ] as const)('refuses invalid activation %j before RPC', async (patch, pattern) => {
    await expect(saveGstAction(form({ ...registered, ...patch }))).rejects.toThrow(pattern);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not retry a rejected or stale save through a direct table write', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Reload before saving.' } });
    await expect(saveGstAction(form({ offDeclared: 'on' }))).rejects.toThrow(/error=Reload before saving/);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('records only a scoped versioned deferral and refuses Manager or stale outlet form', async () => {
    mocks.staff.mockResolvedValueOnce(owner('manager'));
    await expect(deferGstAction(form({deferralReason:'premises'}))).rejects.toThrow(/only the outlet owner/i);
    await expect(deferGstAction(form({deferralReason:'premises',gstOutletId:'stale'}))).rejects.toThrow(/outlet changed/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await expect(deferGstAction(form({deferralReason:'premises',configVersion:'2'}))).rejects.toThrow(/onboarding deferred/i);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('record_gst_outlet_deferral',{p_outlet:'authorized-id',p_expected_version:2,p_reason:'premises'});
  });
  it('requires actual preceding-FY review before using the five percent hotel profile', async () => {
    const fy = gstFinancialYearStart(localDateKey(RESTAURANT_TIME_ZONE,new Date()));
    const hotel={...registered,businessType:'hotel',premisesBasis:'none',hotelRoomBasis:'actual',hotelRoomFy:String(fy-1),
      hotelReviewRef:'Synthetic full-year evidence',hotelReviewConfirmed:'on',hotelDeclarationStatus:'none_in_force'};
    await expect(saveGstAction(form({...hotel,hotelMaxRoomRupees:'7500.01'}))).rejects.toThrow(/exceeded ₹7,500/);
    await expect(saveGstAction(form({...hotel,hotelRoomFy:String(fy),hotelMaxRoomRupees:'7300'}))).rejects.toThrow(/preceding FY/);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await expect(saveGstAction(form({...hotel,hotelMaxRoomRupees:'7500.00'}))).rejects.toThrow(/notice=GST tax invoices are on/);
    expect(mocks.rpc).toHaveBeenCalledWith('save_restaurant_gst_config',expect.objectContaining({p_settings:expect.objectContaining({activation:expect.objectContaining({
      hotel_review:expect.objectContaining({treatment_fy:fy,room_fy:fy-1,max_room_paise:750000})})})}));
  });

});
