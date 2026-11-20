'use client';

import { useState } from 'react';
import { Field, Notice, Panel, inputClass } from '@/components/owner/chrome';
import { SubmitButton } from '@/components/owner/SubmitButton';
import { localDateKey, RESTAURANT_TIME_ZONE } from '@/lib/db/time';
import { COMPOSITION_ACK_TEXT } from '@/lib/gst/composition';
import { FSSAI_PATTERN, SERVICE_SAC_PATTERN, GST_DEFERRAL_REASONS, GST_OUTLET_STATES, GST_SERIES_DEFAULT, GST_SERIES_KINDS, gstFinancialYearStart, type GstBusinessType, type GstPremisesBasis } from '@/lib/gst/onboarding';
import type { GstSettingsData } from '@/lib/db/gst-settings';
import { deferGstAction, saveGstAction } from '@/app/(staff)/dashboard/settings/gst-actions';

const MODE_SUMMARY: Record<GstSettingsData['mode'], string> = {
  off: 'Unregistered retail billing',
  regular: 'Regular GST',
  composition: 'No-GST · Composition',
};

export function GstSettingsPanel({
  gst,
  outletId,
  disabled,
}: {
  gst: GstSettingsData;
  outletId: string;
  disabled: boolean;
}) {
  const [billingMode, setBillingMode] = useState<'gst' | 'no_gst'>(gst.mode === 'regular' ? 'gst' : 'no_gst');
  const [noGstSubtype, setNoGstSubtype] = useState<'unregistered' | 'composition'>(gst.mode === 'composition' ? 'composition' : 'unregistered');
  const [businessType, setBusinessType] = useState<GstBusinessType | ''>(gst.businessType);
  const [basis, setBasis] = useState<GstPremisesBasis | 'none' | ''>(gst.premisesEvidence?.basis
    ?? (gst.businessType === 'hotel' && gst.fssaiNumber && gst.regularProfile === 'other_than_specified_premises' ? 'none' : ''));
  const mode: GstSettingsData['mode'] = billingMode === 'gst' ? 'regular' : noGstSubtype === 'composition' ? 'composition' : 'off';
  const premises = gst.premisesEvidence;
  const active = gst.activation;
  const review = active?.hotel_review;
  const deferred = !active ? gst.deferrals?.find(d => d.profile_version === gst.configVersion) : undefined;
  const [hotelRoom, setHotelRoom] = useState(review?.room_basis ?? '');
  const [hotelDeclaration, setHotelDeclaration] = useState(review?.declaration_status ?? '');
  const [route, setRoute] = useState(active?.declaration_route ?? 'annexure_vii');

  const todayInIndia = localDateKey(RESTAURANT_TIME_ZONE, new Date());
  const fyStart = gstFinancialYearStart(todayInIndia);
  const proofNeedsReview = gst.mode === 'regular' && gst.businessType === 'hotel'
    && (gst.regularProfile === 'specified_premises' ? premises?.treatment_fy_start !== fyStart : review?.treatment_fy !== fyStart);
  const formDisabled = disabled || !gst.ready || !outletId;
  const registered = gst.mode !== 'off' && gst.gstin;
  const meta = !gst.ready
    ? 'Needs a database update'
    : !active
      ? deferred ? 'Onboarding deferred' : 'Onboarding required'
      : proofNeedsReview ? 'Review hotel premises evidence'
      : gst.mode === 'off'
      ? 'No-GST · Unregistered'
      : gst.mode === 'regular'
        ? `Regular GST · ${gst.regularProfile === 'specified_premises' ? '18% specified premises' : '5% no ITC'}`
        : 'Composition — Bill of Supply';

  return (
    <Panel title="GST billing" meta={meta} bodyClassName="px-5 py-5">
      <p className="m-0 max-w-[68ch] text-[12.5px] leading-[1.5] text-gink-46">
        Choose GST for regular tax invoices, or No-GST for unregistered retail billing or Composition.
        GST menu prices are tax-inclusive. Once issued, documents and their numbers do not change.
      </p>

      {!gst.ready ? (
        <Notice tone="due" label="Not available yet." className="mt-3 mb-0">
          This deployment does not have the reviewed GST database update. Ask an administrator to check it; no settings have been changed.
        </Notice>
      ) : null}

      {gst.ready && gst.fssaiNumber && proofNeedsReview ? (
        <Notice tone="due" label="Hotel premises review due">
          Confirm the actual room records and declaration status for the current financial year before accepting new orders.
        </Notice>
      ) : null}

      {gst.ready && !active ? (
        <Notice tone="due" label="Billing onboarding not saved">
          {gst.mode === 'off'
            ? 'GST is off. Existing receipts retain their legacy rules until you activate No-GST retail billing or GST for this outlet.'
            : 'This is a previous configuration. Activate the reviewed setup for new premises, series and IRP evidence; existing documents stay unchanged.'}
        </Notice>
      ) : null}

      {gst.ready && !active ? deferred ? (
        <Notice tone="plain" label="Onboarding deferred">{GST_DEFERRAL_REASONS[deferred.reason]}. This did not change the outlet’s existing billing rules.</Notice>
      ) : !formDisabled ? (
        <form action={deferGstAction} className="mt-3 grid gap-2 sm:flex sm:items-end">
          <input type="hidden" name="gstOutletId" value={outletId} />
          <input type="hidden" name="configVersion" value={gst.configVersion} />
          <Field label="Reason to defer onboarding" htmlFor="gst-deferral">
            <select name="deferralReason" id="gst-deferral" required className={inputClass} defaultValue="">
              <option value="" disabled>Select a reason</option>
              {Object.entries(GST_DEFERRAL_REASONS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          <SubmitButton pendingLabel="Recording…">Record deferral</SubmitButton>
        </form>
      ) : null : null}

      {registered ? (
        <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
          Active configuration version {gst.configVersion}. {MODE_SUMMARY[gst.mode]} · GSTIN{' '}
          <span className="font-mono">{gst.gstin}</span>
          {gst.updatedAt ? ` · updated ${new Date(gst.updatedAt).toLocaleDateString('en-IN')}` : ''}.
        </p>
      ) : null}

      {gst.ready && disabled ? (
        <Notice tone="plain" label="Read-only GST settings" className="mt-3 mb-0">
          Only the outlet owner can save GST settings, and the outlet must have write access.
        </Notice>
      ) : null}
      <form action={saveGstAction} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="configVersion" value={gst.configVersion} />
        <input type="hidden" name="gstOutletId" value={outletId} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[12.5px] font-medium text-gink-64">Billing mode</legend>
          <ModeRadio name="billingMode" value="gst" checked={billingMode === 'gst'} onChange={() => setBillingMode('gst')}
            title="GST" body="Regular · TAX INVOICE. The rate follows your business type and qualifying premises." disabled={formDisabled} />
          <ModeRadio name="billingMode" value="no_gst" checked={billingMode === 'no_gst'} onChange={() => setBillingMode('no_gst')}
            title="No-GST" body="No GST collected. Choose unregistered business or Composition below." disabled={formDisabled} />
        </fieldset>
        {billingMode === 'no_gst' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[12.5px] font-medium text-gink-64">No-GST business situation</legend>
            <ModeRadio name="noGstSubtype" value="unregistered" checked={noGstSubtype === 'unregistered'} onChange={() => setNoGstSubtype('unregistered')}
              title="Unregistered business" body="RETAIL BILL / CASH MEMO. Uses the outlet name, address and phone saved in Settings, plus FSSAI. No GSTIN." disabled={formDisabled} />
            <ModeRadio name="noGstSubtype" value="composition" checked={noGstSubtype === 'composition'} onChange={() => setNoGstSubtype('composition')}
              title="Composition dealer" body="BILL OF SUPPLY. Prints GSTIN, FSSAI and the mandatory declaration. No GST or input tax credit." disabled={formDisabled} />
          </fieldset>
        ) : null}

        <Field label="FSSAI number" htmlFor="gst-fssai" hint="Exactly 14 digits as on your outlet's food licence. This is a format check, not a licence lookup.">
          <input id="gst-fssai" name="fssaiNumber" defaultValue={gst.fssaiNumber} className={`${inputClass} tabular-nums`}
            inputMode="numeric" pattern={FSSAI_PATTERN} maxLength={14} autoComplete="off" disabled={formDisabled} required />
        </Field>

        {mode === 'off' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[12.5px] font-medium text-gink-64">Unregistered business declaration</legend>
            <label className="flex items-start gap-2.5 rounded-[10px] border border-hair bg-paper px-3 py-2.5 text-[12.5px] leading-[1.5]">
              <input type="checkbox" name="offDeclared" defaultChecked={!!gst.fssaiNumber && gst.offDeclared} disabled={formDisabled} required className="mt-0.5" />
              <span>I confirm this business is not registered or required to register for GST. Its retail bills will not charge or show GST.</span>
            </label>
            <label className="flex items-start gap-2.5 rounded-[10px] border border-[var(--p-due)] bg-paper px-3 py-2.5 text-[12.5px] leading-[1.5]">
              <input type="checkbox" name="offHasObligation" disabled={formDisabled} className="mt-0.5" />
              <span><span className="font-medium">This business is required to register for GST.</span> Selecting this blocks unregistered billing.</span>
            </label>
          </fieldset>
        ) : null}

        {mode !== 'off' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="GSTIN" htmlFor="gst-gstin" hint="15 characters. The format, checksum and state code are verified here and again in the database; registration validity is not checked against the GST portal." className="sm:col-span-1">
              <input id="gst-gstin" name="gstin" className={`${inputClass} uppercase tabular-nums`} defaultValue={gst.gstin} maxLength={15} autoComplete="off" spellCheck={false} disabled={formDisabled} required />
            </Field>
            <Field label="Registration type" htmlFor="gst-regtype" hint="Exactly as registered on the GST portal. A composition GSTIN cannot issue tax invoices; a regular GSTIN cannot issue composition bills.">
              <select id="gst-regtype" name="registrationType" className={inputClass} defaultValue={gst.registrationType} disabled={formDisabled}>
                <option value="regular">Regular</option>
                <option value="composition">Composition</option>
              </select>
            </Field>
            <Field label="Legal name (as on registration)" htmlFor="gst-legal">
              <input id="gst-legal" name="legalName" className={inputClass} defaultValue={gst.legalName} maxLength={160} autoComplete="off" disabled={formDisabled} required />
            </Field>
            <Field label="Trade name (optional)" htmlFor="gst-trade">
              <input id="gst-trade" name="tradeName" className={inputClass} defaultValue={gst.tradeName} maxLength={160} autoComplete="off" disabled={formDisabled} />
            </Field>
            <Field label="Address on the registration" htmlFor="gst-address" className="sm:col-span-2">
              <input id="gst-address" name="address" className={inputClass} defaultValue={gst.address} maxLength={300} autoComplete="off" disabled={formDisabled} required />
            </Field>
            <Field label="Preceding-FY turnover (₹, optional)" htmlFor="gst-turnover" hint="PAN-wide for the latest year only. This cannot by itself clear a B2B invoice from the IRN hold.">
              <input id="gst-turnover" name="precedingFyTurnoverRupees" className={`${inputClass} tabular-nums`} defaultValue={gst.precedingFyTurnoverRupees} inputMode="decimal" autoComplete="off" placeholder="e.g. 4000000" disabled={formDisabled} />
            </Field>
            <Field label="Service SAC" htmlFor="gst-service-sac" hint="Enter the six-digit service code confirmed for your supply. It is printed on the tax invoice or Bill of Supply.">
              <input id="gst-service-sac" name="serviceSac" defaultValue={gst.serviceSac} inputMode="numeric"
                pattern={SERVICE_SAC_PATTERN} maxLength={6} className={inputClass} disabled={formDisabled} required />
            </Field>
            {mode === 'regular' ? <>
              <Field label="e-Invoice city (optional)" htmlFor="gst-einvoice-location" hint="City/district/taluka exactly as on the GST registration — printed on IRP payloads as the seller location. Never guessed from the address block; unset means e-invoice issuance fails closed.">
                <input id="gst-einvoice-location" name="einvoiceLocation" className={inputClass} defaultValue={gst.einvoiceLocation} autoComplete="address-level2" placeholder="e.g. Nagpur" disabled={formDisabled} />
              </Field>
              <Field label="e-Invoice PIN code (optional)" htmlFor="gst-einvoice-pincode" hint="6-digit PIN of the registered outlet. Unset means e-invoice issuance fails closed.">
                <input id="gst-einvoice-pincode" name="einvoicePincode" className={`${inputClass} tabular-nums`} defaultValue={gst.einvoicePincode} inputMode="numeric" maxLength={6} autoComplete="postal-code" placeholder="e.g. 440001" disabled={formDisabled} />
              </Field>
              <Field label="e-Invoice HSN/SAC (optional)" htmlFor="gst-einvoice-hsn" hint="Legacy optional IRP profile field. If entered, it must match the reviewed service SAC above.">
                <input id="gst-einvoice-hsn" name="einvoiceHsnSac" className={`${inputClass} tabular-nums`} defaultValue={gst.einvoiceHsnSac} inputMode="numeric" maxLength={8} autoComplete="off" placeholder="e.g. 996331" disabled={formDisabled} />
              </Field>
            </> : null}
          </div>
        ) : null}

        {mode === 'regular' ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-[12.5px] font-medium text-gink-64">GST business type and profile</legend>
            <Field label="Business type" htmlFor="gst-business-type">
              <select id="gst-business-type" name="businessType" value={businessType} className={inputClass} required disabled={formDisabled}
                onChange={(event) => {
                  const type = event.target.value as GstBusinessType | '';
                  setBusinessType(type);
                  if (type !== businessType) setBasis('');
                }}>
                <option value="">Select business type</option>
                <option value="standalone">Standalone restaurant</option>
                <option value="hotel">Hotel restaurant</option>
              </select>
            </Field>

            {businessType === 'hotel' ? (
              <Field label="Specified Premises evidence" htmlFor="gst-premises-basis" hint="Confirm the actual basis for this premises and year. This does not check a government filing.">
                <select id="gst-premises-basis" name="premisesBasis" className={inputClass} value={basis} disabled={formDisabled} required
                  onChange={(event) => setBasis(event.target.value as GstPremisesBasis | 'none' | '')}>
                  <option value="">Confirm the applicable basis</option>
                  <option value="none">Not qualified — 5% without ITC</option>
                  <option value="room_supply">Preceding FY actual room supply above ₹7,500 per unit per day</option>
                  <option value="opt_in">Valid opt-in declaration filed within applicable period</option>
                </select>
              </Field>
            ) : null}
            {businessType === 'hotel' && basis === 'none' ? (
              <fieldset disabled={formDisabled} className="grid gap-3 sm:grid-cols-2">
                <Field label="Preceding FY start (room records)" htmlFor="gst-hotel-room-fy">
                  <input id="gst-hotel-room-fy" name="hotelRoomFy" type="number" defaultValue={review?.room_fy ?? fyStart - 1} className={inputClass} required />
                </Field>
                <Field label="Actual room supply review" htmlFor="gst-hotel-room">
                  <select id="gst-hotel-room" name="hotelRoomBasis" value={hotelRoom} onChange={(e) => setHotelRoom(e.target.value as typeof hotelRoom)} className={inputClass} required>
                    <option value="">Select evidence type</option><option value="actual">Reviewed actual supplies</option><option value="no_supplies">No room supplies in the year</option>
                  </select>
                </Field>
                {hotelRoom === 'actual' ? <Field label="Highest actual room value (₹ per unit per day)" htmlFor="gst-hotel-room-max">
                  <input id="gst-hotel-room-max" name="hotelMaxRoomRupees" inputMode="decimal" className={inputClass} defaultValue={review?.max_room_paise != null ? (review.max_room_paise / 100).toFixed(2) : ''} required />
                </Field> : null}
                <Field label="Private room evidence reference" htmlFor="gst-hotel-room-ref">
                  <input id="gst-hotel-room-ref" name="hotelReviewRef" minLength={2} maxLength={120} className={inputClass} defaultValue={review?.reference} required />
                </Field>
                <Field label="Declaration status for this FY" htmlFor="gst-hotel-declaration">
                  <select id="gst-hotel-declaration" name="hotelDeclarationStatus" value={hotelDeclaration} onChange={(e) => setHotelDeclaration(e.target.value as typeof hotelDeclaration)} className={inputClass} required>
                    <option value="">Confirm status</option><option value="none_in_force">No opt-in in force</option><option value="opted_out">Annexure IX opt-out in force</option>
                  </select>
                </Field>
                {hotelDeclaration === 'opted_out' ? <>
                  <Field label="First opt-out treatment FY start" htmlFor="gst-hotel-out-fy"><input id="gst-hotel-out-fy" name="optOutFy" type="number" min="2025" max={fyStart} defaultValue={review?.opt_out_fy ?? fyStart} className={inputClass} required /></Field>
                  <Field label="Opt-out filed on" htmlFor="gst-hotel-out-date"><input id="gst-hotel-out-date" name="optOutFiled" type="date" defaultValue={review?.opt_out_filed ?? ''} className={inputClass} required /></Field>
                  <Field label="Private opt-out reference" htmlFor="gst-hotel-out-ref"><input id="gst-hotel-out-ref" name="optOutReference" minLength={2} maxLength={120} defaultValue={review?.opt_out_reference ?? ''} className={inputClass} required /></Field>
                </> : null}
                <label className="flex items-start gap-2 text-[12.5px] sm:col-span-2">
                  <input type="checkbox" name="hotelReviewConfirmed" required />
                  <span>I reviewed the whole preceding FY and confirm the declaration status for this specific premises. Opt-out does not override an actual room value above ₹7,500.</span>
                </label>
              </fieldset>
            ) : null}
            {businessType === 'hotel' && basis && basis !== 'none' ? (
              <>
                <Notice tone="plain" label="18% with ITC only after qualification">
                  A room tariff alone does not qualify. Keep evidence of the actual value or applicable filed declaration.
                </Notice>
                <Field label="Treatment financial year start" htmlFor="gst-premises-fy" hint={`Use the year beginning 1 April ${fyStart}. Review the evidence at every FY change.`}>
                  <input id="gst-premises-fy" name="premisesTreatmentFy" inputMode="numeric" pattern="[0-9]{4}" maxLength={4}
                    className={inputClass} defaultValue={premises?.treatment_fy_start ?? fyStart} disabled={formDisabled} required />
                </Field>
                <Field label="Premises evidence reference" htmlFor="gst-premises-ref" hint="Use a restricted evidence reference, not a certificate, customer data or credentials.">
                  <input id="gst-premises-ref" name="premisesEvidenceRef" minLength={2} maxLength={120} className={inputClass}
                    defaultValue={premises?.reference ?? ''} disabled={formDisabled} required />
                </Field>
                {basis === 'room_supply' ? (
                  <>
                    <Field label="Previous financial year start" htmlFor="gst-room-fy">
                      <input id="gst-room-fy" name="roomSupplyFy" inputMode="numeric" pattern="[0-9]{4}" maxLength={4}
                        className={inputClass} defaultValue={premises?.basis === 'room_supply' ? premises.room_supply_fy_start : fyStart - 1} disabled={formDisabled} required />
                    </Field>
                    <Field label="Actual room supply value (₹ per unit per day)" htmlFor="gst-room-value">
                      <input id="gst-room-value" name="roomSupplyValueRupees" inputMode="decimal" className={inputClass}
                        defaultValue={premises?.basis === 'room_supply' ? (premises.room_value_paise / 100).toFixed(2) : ''} disabled={formDisabled} required />
                    </Field>
                  </>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Declaration filed on" htmlFor="gst-premises-filed">
                      <input id="gst-premises-filed" name="premisesFiledOn" type="date" max={todayInIndia} className={inputClass}
                        defaultValue={premises?.basis === 'opt_in' ? premises.filed_on : ''} disabled={formDisabled} required />
                    </Field>
                    <Field label="Declaration route" htmlFor="gst-declaration-route">
                      <select id="gst-declaration-route" name="declarationRoute" value={route} onChange={(event) => setRoute(event.target.value as typeof route)} className={inputClass} disabled={formDisabled}>
                        <option value="annexure_vii">Annexure VII — already registered</option>
                        <option value="annexure_viii">Annexure VIII — newly registered</option>
                      </select>
                    </Field>
                    <Field label="First treatment FY start" htmlFor="gst-declaration-fy" hint="For carry-forward, record the original treatment year and confirm it is still in force.">
                      <input id="gst-declaration-fy" name="declarationFy" type="number" min="2025" max={fyStart} defaultValue={active?.declaration_fy ?? fyStart} className={inputClass} disabled={formDisabled} required />
                    </Field>
                    {route === 'annexure_viii' ? (<>
                      <Field label="Registration application acknowledged on" htmlFor="gst-arn-date">
                        <input id="gst-arn-date" name="registrationAcknowledgedOn" type="date" defaultValue={premises?.basis === 'opt_in' ? premises.filing_from : ''} className={inputClass} disabled={formDisabled} required />
                      </Field>
                      <Field label="Registration effective date" htmlFor="gst-reg-date">
                        <input id="gst-reg-date" name="registrationEffectiveOn" type="date" defaultValue={active?.registration_effective_on ?? ''} className={inputClass} disabled={formDisabled} required />
                      </Field>
                    </>) : null}
                  </div>
                )}
                <Field label="Specified Premises effective from" htmlFor="gst-premises-from">
                  <input id="gst-premises-from" name="specifiedPremisesEffectiveFrom" type="date" min={`${fyStart}-04-01`} max={todayInIndia}
                    key={basis} defaultValue={basis === 'room_supply' ? `${fyStart}-04-01` : premises?.basis === 'opt_in' ? gst.specifiedPremisesEffectiveFrom : ''} disabled={formDisabled} className={inputClass} required />
                </Field>
                <label className="flex items-start gap-2.5 rounded-lg border border-hair bg-paper px-3 py-2.5 text-[12.5px]">
                  <input type="checkbox" name="specifiedPremisesAttested" defaultChecked={gst.specifiedPremisesAttested && !proofNeedsReview && premises?.basis === basis}
                    key={basis} disabled={formDisabled} required />
                  <span>I confirm this premises evidence, its treatment and dates apply to this outlet, and the declaration has not been opted out of.</span>
                </label>
              </>
            ) : businessType === 'standalone' || (businessType === 'hotel' && basis === 'none') ? (
              <Notice tone="plain" label="5% GST without ITC">
                Applies to dine-in, takeaway and delivery. There is no independent 18% rate selector.
              </Notice>
            ) : null}
          </fieldset>
        ) : null}

        {mode === 'composition' ? (
          <label className="flex items-start gap-2.5 rounded-[10px] border border-hair bg-paper px-3 py-2.5 text-[12.5px] leading-[1.5]">
            <input type="checkbox" name="compositionAcknowledged" defaultChecked={gst.compositionAcknowledged} disabled={formDisabled} className="mt-0.5" />
            <span><span className="font-medium">Composition ineligibility acknowledgment.</span> {COMPOSITION_ACK_TEXT}</span>
          </label>
        ) : null}

        {mode === 'regular' ? (
          <details className="rounded-[10px] border border-hair px-3 py-2" open={Boolean(active?.aato)}>
            <summary className="cursor-pointer text-[12.5px] font-medium">B2B e-invoice evidence (when known)</summary>
            <p className="my-2 text-gink-64">Review PAN-wide turnover in every preceding FY from 2017–18. If incomplete, leave it unset; an uncertain B2B document stays on hold.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Highest prior-FY turnover (₹)" htmlFor="gst-prior-max">
                <input id="gst-prior-max" name="highestPriorFyRupees" className={inputClass} inputMode="decimal" defaultValue={active?.aato ? (active.aato.highest_prior_fy_paise / 100).toFixed(2) : ''} disabled={formDisabled} />
              </Field>
              <Field label="PAN-wide evidence reference" htmlFor="gst-aato-ref">
                <input id="gst-aato-ref" name="aatoReference" className={inputClass} maxLength={120} defaultValue={active?.aato?.reference} disabled={formDisabled} />
              </Field>
              <Field label="Confirmed IRP reporting category" htmlFor="gst-irap-category">
                <select id="gst-irap-category" name="reportingCategory" className={inputClass} defaultValue={active?.aato?.reporting_category ?? 'unknown'} disabled={formDisabled}>
                  <option value="unknown">Unknown</option><option value="under_10cr">Below ₹10 crore</option><option value="at_least_10cr">₹10 crore and above · 30-day window</option>
                </select>
              </Field>
            </div>
          </details>
        ) : null}

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-[12.5px] font-medium text-gink-64">Licensed premises and effective date</legend>
          <Field label="Premises address" htmlFor="gst-premises-address" hint="As listed for this outlet on the food-business licence. The registered seller address above can differ.">
            <input id="gst-premises-address" name="premisesAddress" className={inputClass} minLength={5} maxLength={300} defaultValue={active?.premises_address} disabled={formDisabled} required />
          </Field>
          <Field label="Premises state (place of supply)" htmlFor="gst-premises-state" hint="Direct service at the selected premises. Not the buyer's state.">
            <select id="gst-premises-state" name="premisesStateCode" className={inputClass} defaultValue={active?.premises_state_code ?? gst.stateCode} disabled={formDisabled} required>
              <option value="">Select state</option>
              {Object.entries(GST_OUTLET_STATES).sort(([a], [b]) => a.localeCompare(b)).map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
            </select>
          </Field>
          <Field label="Invoice phone" htmlFor="gst-invoice-phone">
            <input type="tel" id="gst-invoice-phone" name="invoicePhone" className={inputClass} defaultValue={active?.invoice_phone} maxLength={24} disabled={formDisabled} required />
          </Field>
          <Field label="Activation date (India)" htmlFor="gst-activation-date" hint="Select today's date when you are ready to switch. No backdating or scheduling.">
            <input id="gst-activation-date" name="activationDate" type="date" min={todayInIndia} max={todayInIndia} className={inputClass} disabled={formDisabled} required />
          </Field>
          <Field label="Adviser review reference (optional)" htmlFor="gst-review-ref">
            <input id="gst-review-ref" name="adviserReference" className={inputClass} maxLength={120} defaultValue={active?.adviser_reference ?? ''} disabled={formDisabled} />
          </Field>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-[12.5px] font-medium text-gink-64">Document numbering</legend>
          {GST_SERIES_KINDS.map((kind) => (
            <Field key={kind} label={`${kind} series prefix`} htmlFor={`gst-series-${kind}`}>
              <input id={`gst-series-${kind}`} name={`series${kind}`} className={`${inputClass} uppercase`} maxLength={3} pattern="[A-Za-z1-9][A-Za-z0-9]{1,2}"
                defaultValue={active?.series[kind] ?? GST_SERIES_DEFAULT[kind]} disabled={formDisabled} required />
            </Field>
          ))}
          <Field label="External prefixes (comma separated)" htmlFor="gst-external-series" hint="List the 2–3 character prefixes reserved by other books using this number format. Check other external ranges separately.">
            <input id="gst-external-series" name="externalSeries" className={inputClass} maxLength={119} defaultValue={active?.external_prefixes.join(', ')} disabled={formDisabled} />
          </Field>
          <label className="flex gap-2 sm:col-span-2">
            <input type="checkbox" name="seriesConfirmed" disabled={formDisabled} required />
            <span>I reserved these series and checked for overlap with other outlets and external books. Existing numbers and counters are retained.</span>
          </label>
        </fieldset>

        <Notice tone="plain" label="Review before activation">
          {mode === 'regular' ? `TAX INVOICE · ${businessType === 'hotel' && basis && basis !== 'none' ? '18% with ITC if qualified' : '5% without ITC if eligible'}`
            : mode === 'composition' ? 'BILL OF SUPPLY · no GST collected' : 'RETAIL BILL / CASH MEMO · no GST collected'}.
          Applies only to this outlet on the chosen date. Check the details and series above; no existing ticket or document will be converted.
          {active ? ` Last activation: ${active.effective_from} (India), configuration v${gst.configVersion}. ` : ' Not yet activated under this setup. '}
        </Notice>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="confirmActivation" required disabled={formDisabled} />
          <span>I confirm the registration status, licence mapping and profile for this outlet and authorize this configuration for direct restaurant sales.</span>
        </label>
        <div>
          <SubmitButton pendingLabel="Saving GST configuration…" disabled={formDisabled} tone="solid">
            Save GST configuration and activate
          </SubmitButton>
        </div>
      </form>
      {gst.history?.length ? <details className="mt-4 rounded-[10px] border border-hair px-3 py-2 text-[12.5px]">
        <summary className="cursor-pointer font-medium">Recent configuration changes</summary>
        <ol className="mt-2 divide-y divide-hair">{gst.history.map((event) => <li key={event.version} className="py-2">
          <b>v{event.version} · {MODE_SUMMARY[event.mode]}</b>
          <span className="block text-gink-64">{event.effective ? `Active ${event.effective} (India)` : 'Legacy · activation not recorded'} · {new Date(event.changedAt).toLocaleString('en-IN', {timeZone:'Asia/Kolkata'})}
            {event.actor ? ` · User ${event.actor.slice(0,8)}` : ''}</span>
        </li>)}</ol>
      </details> : null}

      {gst.deferrals?.length ? <details className="mt-3 rounded-lg border border-hair p-3 text-[12.5px]">
        <summary>Recorded deferrals</summary>
        {gst.deferrals.map(d => <p key={d.profile_version}>v{d.profile_version} · {GST_DEFERRAL_REASONS[d.reason]} · {localDateKey(RESTAURANT_TIME_ZONE,new Date(d.recorded_at))} · User {d.recorded_by.slice(0,8)}</p>)}
      </details> : null}
      <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
        Finish active sittings and review any closed sittings without a document before saving changes. Existing tickets and issued
        documents keep their original amounts. You can consult an adviser where needed; AutoDine checks the supplied details, not your government registration or eligibility.
      </p>
    </Panel>
  );
}

function ModeRadio({
  name, value, checked, onChange, title, body, disabled,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  body: string;
  disabled: boolean;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5 transition-colors ${checked ? 'border-grass bg-[color-mix(in_oklab,var(--p-accent-wash)_45%,transparent)]' : 'border-hair bg-paper hover:border-hair-strong'} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} className="mt-1" />
      <span>
        <span className="block text-[12.5px] font-medium text-gink">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-[1.5] text-gink-46">{body}</span>
      </span>
    </label>
  );
}
