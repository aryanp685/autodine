'use client';

import { useState } from 'react';
import { Field, Notice, Panel, inputClass } from '@/components/owner/chrome';
import { SubmitButton } from '@/components/owner/SubmitButton';
import { COMPOSITION_ACK_TEXT } from '@/lib/gst/composition';
import type { GstSettingsData } from '@/lib/db/gst-settings';
import { saveGstAction } from '@/app/(staff)/dashboard/settings/gst-actions';

const MODE_SUMMARY: Record<GstSettingsData['mode'], string> = {
  off: 'Normal receipts',
  regular: 'Regular GST',
  composition: 'Composition',
};

export function GstSettingsPanel({
  gst,
  disabled,
}: {
  gst: GstSettingsData;
  disabled: boolean;
}) {
  const [mode, setMode] = useState<GstSettingsData['mode']>(gst.mode);
  const [profile, setProfile] = useState<GstSettingsData['regularProfile']>(gst.regularProfile);

  const formDisabled = disabled || !gst.ready;
  const registered = gst.mode !== 'off' && gst.gstin;
  const meta = !gst.ready
    ? 'Needs a database update'
    : gst.mode === 'off'
      ? 'Off — normal receipts'
      : gst.mode === 'regular'
        ? `Regular GST · ${gst.regularProfile === 'specified_premises' ? '18% specified premises' : '5% no ITC'}`
        : 'Composition — Bill of Supply';

  return (
    <Panel title="GST billing" meta={meta} bodyClassName="px-5 py-5">
      <p className="m-0 max-w-[68ch] text-[12.5px] leading-[1.5] text-gink-46">
        How the documents your counter issues are labelled and numbered. Normal receipts are the
        historical behaviour and collect no GST. Composition issues a Bill of Supply — never a tax
        invoice — and collects nothing. Regular GST issues GST tax invoices: menu prices are treated
        as tax-inclusive and the tax is extracted at document level. Issued documents are immutable;
        a correction voids and reissues with the next number.
      </p>

      {!gst.ready ? (
        <Notice tone="due" label="Not available yet." className="mt-3 mb-0">
          The GST settings table does not exist in this deployment&apos;s database yet. Apply
          migration 20261113000100 (it is forward-only) and reload this screen. Nothing was changed.
        </Notice>
      ) : null}

      {registered ? (
        <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
          Active configuration version {gst.configVersion}. {MODE_SUMMARY[gst.mode]} · GSTIN{' '}
          <span className="font-mono">{gst.gstin}</span>
          {gst.updatedAt ? ` · updated ${new Date(gst.updatedAt).toLocaleDateString('en-IN')}` : ''}.
        </p>
      ) : null}

      <form action={saveGstAction} className="mt-4 flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[12.5px] font-medium text-gink-64">Billing mode</legend>
          <ModeRadio
            name="mode" value="off" checked={mode === 'off'} onChange={() => setMode('off')}
            title="Normal receipts (no GST)"
            body="What this restaurant has always issued. Format and numbering are unchanged; no GST appears on any document."
            disabled={formDisabled}
          />
          <ModeRadio
            name="mode" value="composition" checked={mode === 'composition'} onChange={() => setMode('composition')}
            title="Composition Scheme — Bill of Supply"
            body="For restaurants registered on the composition scheme. No GST is collected, no ITC can be claimed, and every document prints the statutory composition notice."
            disabled={formDisabled}
          />
          <ModeRadio
            name="mode" value="regular" checked={mode === 'regular'} onChange={() => setMode('regular')}
            title="Regular GST — tax invoice"
            body="GST tax invoices with CGST/SGST breakdown, seller GSTIN and place of supply. Menu prices are the bill; tax is extracted from them at document level."
            disabled={formDisabled}
          />
        </fieldset>

        {mode === 'off' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[12.5px] font-medium text-gink-64">Normal-Billing declaration</legend>
            <label className="flex items-start gap-2.5 rounded-[10px] border border-hair bg-paper px-3 py-2.5 text-[12.5px] leading-[1.5]">
              <input type="checkbox" name="offDeclared" defaultChecked={gst.offDeclared} disabled={formDisabled} className="mt-0.5" />
              <span><span className="font-medium">I confirm this restaurant is not issuing GST documents.</span> It is not registered for GST, or it is registered but issues ordinary receipts without GST. I understand these receipts cannot carry GST, cannot claim ITC, and are not evidence of a decision not to register.</span>
            </label>
            <label className="flex items-start gap-2.5 rounded-[10px] border border-[var(--p-due)] bg-paper px-3 py-2.5 text-[12.5px] leading-[1.5]">
              <input type="checkbox" name="offHasObligation" disabled={formDisabled} className="mt-0.5" />
              <span><span className="font-medium">This restaurant IS required to be registered under GST.</span> Ticking this refuses to save Normal Billing — choose Regular GST or Composition instead. (Leave unticked if you are not required to register.)</span>
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
              <input id="gst-legal" name="legalName" className={inputClass} defaultValue={gst.legalName} autoComplete="off" disabled={formDisabled} required />
            </Field>
            <Field label="Trade name (optional)" htmlFor="gst-trade">
              <input id="gst-trade" name="tradeName" className={inputClass} defaultValue={gst.tradeName} autoComplete="off" disabled={formDisabled} />
            </Field>
            <Field label="Address on the registration" htmlFor="gst-address" className="sm:col-span-2">
              <input id="gst-address" name="address" className={inputClass} defaultValue={gst.address} autoComplete="off" disabled={formDisabled} required />
            </Field>
            <Field label="Preceding-FY turnover (₹, optional)" htmlFor="gst-turnover" hint="Aggregate annual turnover of the preceding financial year, in rupees. Above ₹5 crore, B2B tax invoices become e-invoice applicable (IRP). Leave empty if unknown — B2B issuance then fails closed rather than guess.">
              <input id="gst-turnover" name="precedingFyTurnoverRupees" className={`${inputClass} tabular-nums`} defaultValue={gst.precedingFyTurnoverRupees} inputMode="numeric" autoComplete="off" placeholder="e.g. 4000000" disabled={formDisabled} />
            </Field>
            <Field label="e-Invoice city (optional)" htmlFor="gst-einvoice-location" hint="City/district/taluka exactly as on the GST registration — printed on IRP payloads as the seller location. Never guessed from the address block; unset means e-invoice issuance fails closed.">
              <input id="gst-einvoice-location" name="einvoiceLocation" className={inputClass} defaultValue={gst.einvoiceLocation} autoComplete="address-level2" placeholder="e.g. Nagpur" disabled={formDisabled} />
            </Field>
            <Field label="e-Invoice PIN code (optional)" htmlFor="gst-einvoice-pincode" hint="6-digit PIN of the registered outlet. Unset means e-invoice issuance fails closed.">
              <input id="gst-einvoice-pincode" name="einvoicePincode" className={`${inputClass} tabular-nums`} defaultValue={gst.einvoicePincode} inputMode="numeric" maxLength={6} autoComplete="postal-code" placeholder="e.g. 440001" disabled={formDisabled} />
            </Field>
            <Field label="e-Invoice HSN/SAC (optional)" htmlFor="gst-einvoice-hsn" hint="Default HSN/SAC for restaurant services on this outlet's documents (996331 unless your adviser says otherwise). Unset means e-invoice issuance fails closed.">
              <input id="gst-einvoice-hsn" name="einvoiceHsnSac" className={`${inputClass} tabular-nums`} defaultValue={gst.einvoiceHsnSac} inputMode="numeric" maxLength={8} autoComplete="off" placeholder="e.g. 996331" disabled={formDisabled} />
            </Field>
          </div>
        ) : null}

        {mode === 'regular' ? (
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-1 text-[12.5px] font-medium text-gink-64">GST profile (closed set — nothing else exists)</legend>
            <ModeRadio
              name="regularProfile" value="other_than_specified_premises" checked={profile === 'other_than_specified_premises'} onChange={() => setProfile('other_than_specified_premises')}
              title="5% — restaurant, other than specified premises (no ITC)"
              body="Notification No. 11/2017-CT(Rate), Sl. 7(i), as amended. Most restaurants: 2.5% CGST + 2.5% SGST, input tax credit not available."
              disabled={formDisabled}
            />
            <ModeRadio
              name="regularProfile" value="specified_premises" checked={profile === 'specified_premises'} onChange={() => setProfile('specified_premises')}
              title="18% — specified premises (hotel accommodation above the band)"
              body="Notification No. 05/2025-CT(Rate), w.e.f. 2025-04-01. For restaurants in specified premises only: 9% CGST + 9% SGST, ITC subject to the statutory rules. A standalone restaurant cannot self-declare into this profile."
              disabled={formDisabled}
            />
            {profile === 'specified_premises' ? (
              <>
                <label className="flex items-start gap-2.5 rounded-[10px] border border-hair bg-paper px-3 py-2.5 text-[12.5px] leading-[1.5]">
                  <input type="checkbox" name="specifiedPremisesAttested" defaultChecked={gst.specifiedPremisesAttested} disabled={formDisabled} className="mt-0.5" />
                  <span><span className="font-medium">Specified-premises attestation.</span> I confirm that (a) this restaurant supplies services in specified premises — a hotel whose declared tariff means accommodation supply above the notified threshold in the preceding financial year within the meaning of Notification No. 05/2025-CT(Rate) — and (b) I hold a written declaration from that hotel supplier to this effect. I understand the 18% rate with ITC is not available to any other restaurant, and that without this declaration the profile cannot be saved.</span>
                </label>
                <Field label="Specified-premises effective from" htmlFor="gst-premises-from" hint="Notification No. 05/2025-CT(Rate) applies from 2025-04-01. Your supply must fall on or after this date for the 18% treatment.">
                  <input id="gst-premises-from" name="specifiedPremisesEffectiveFrom" type="date" min="2025-04-01" defaultValue={gst.specifiedPremisesEffectiveFrom} disabled={formDisabled} className={`${inputClass} tabular-nums`} required />
                </Field>
              </>
            ) : null}
          </fieldset>
        ) : null}

        {mode === 'composition' ? (
          <label className="flex items-start gap-2.5 rounded-[10px] border border-hair bg-paper px-3 py-2.5 text-[12.5px] leading-[1.5]">
            <input type="checkbox" name="compositionAcknowledged" defaultChecked={gst.compositionAcknowledged} disabled={formDisabled} className="mt-0.5" />
            <span><span className="font-medium">Composition ineligibility acknowledgment.</span> {COMPOSITION_ACK_TEXT}</span>
          </label>
        ) : null}

        <div>
          <SubmitButton pendingLabel="Saving GST configuration…" disabled={formDisabled} tone="solid">
            Save GST configuration
          </SubmitButton>
        </div>
      </form>

      <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
        Switching modes never recalculates an already-issued document. Tickets sitting open in this
        restaurant keep the pricing mode they were taken under, and a bill cannot be issued across
        modes. Regular profiles: 5% without ITC per Notification No. 11/2017-CT(Rate) as amended, or
        18% with ITC in specified premises per Notification No. 05/2025-CT(Rate), w.e.f. 1 April 2025.
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
