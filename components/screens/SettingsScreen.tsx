import Link from 'next/link';
import { SignInPrompt } from '@/components/SignInPrompt';
import { CopyButton } from '@/components/CopyButton';
import { MenuQrActions } from '@/components/MenuQrActions';
import { PrintButton } from '@/components/PrintButton';
import { SubmitButton } from '@/components/owner/SubmitButton';
import type { ReactNode } from 'react';
import type { OutletBar } from '@/lib/outlets';
import {
  entitlementBlockedReason,
  entitlementSummary,
  type OutletEntitlement,
} from '@/lib/access';
import type { SettingsScreenData } from '@/lib/db/settings-screen';
import type { TeamScreenData } from '@/lib/db/team';
import type { InviteFlash } from '@/lib/team-invite';
import { PeoplePanel } from '@/components/owner/PeoplePanel';
import { OperationsPanel } from '@/components/owner/OperationsPanel';
import { OperatingModePanel } from '@/components/screens/OperatingModePanel';
import { PrintingDevicesPanel } from '@/components/screens/PrintingDevicesPanel';
import { formatTaxPercent, taxExamplePaise } from '@/lib/settings-input';
import {
  saveBillingDefaultsAction,
  saveCouponAction,
  saveDetailsAction,
  saveGuestVerificationAction,
  saveTaxAction,
  toggleCouponAction,
} from '@/app/(staff)/dashboard/settings/actions';
import { GstSettingsPanel } from '@/components/screens/GstSettingsPanel';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';
import {
  OwnerPage,
  PageHead,
  Card,
  Panel,
  Notice,
  btn,
  Field,
  inputClass,
  Tag,
} from '@/components/owner/chrome';

/**
 * Restaurant settings: the details guests and bills read, the tax rate, the
 * payment switches, and the QR that opens the public menu.
 *
 * WHAT THIS SCREEN IS
 *
 * Five forms that write to the same row. Everything on the page is an
 * explanation of what happens when one of them is saved, which is why it is
 * the longest screen in the product and the one where drift shows first.
 *
 * THE AUDIT (2026-10-24) FOUND
 *
 *   - Nine hand-drawn callouts — read-only notice, database notice, tax-zero
 *     warning, tax example, retired gateway settings, "off", the UPI caveat, the
 *     unpublished-menu warning, and the save banner — in four different radii
 *     and three different tones of red. They said the same two things the kit's
 *     Notice says, badly.
 *   - The tax field asked for `w-[140px]` on top of the kit's `w-full`. Two
 *     width utilities on one element is decided by stylesheet order, not by
 *     class order, so the field's width was whatever Tailwind happened to
 *     emit last.
 *   - Five cards of identical weight in one column, with no way to see what
 *     was on the page or jump to it: saving the UPI card at the bottom meant
 *     scrolling past four other cards to reach it again.
 *   - The two aside cards were hand-built while every other card on the page
 *     was a Panel, so their headers were a different size and a different
 *     colour from the five beside them.
 *
 * WHAT CHANGED
 *
 *   - Three named groups (what guests see, what the bill charges, the account)
 *     and a "On this page" index that links to each — real anchors, no script.
 *   - Every callout is the kit's Notice, with a tone that means something:
 *     `due` for something that is costing money or blocking a scan, `accent`
 *     for a save that landed, `plain` for a fact.
 *   - One save button per form, all the filled accent button at the same size, so
 *     "which control commits this card" is answered the same way five times.
 *   - The aside is two Panels, matching the five beside them.
 *
 * WHAT DID NOT CHANGE
 *
 * Every form, field name, action, default value, disabled condition and the
 * POST to /dashboard/outlet/new. The server is the guard for all of it; this
 * file only decides what an owner sees and what they are told.
 *
 * THREE STATES, AND THEY MUST LOOK DIFFERENT
 *
 *   no database   -> the form is rendered but disabled, with a note saying so.
 *                    Not sample data: a form pre-filled with a fictional
 *                    restaurant's name and tax rate is a form that can be
 *                    saved over a real one.
 *   signed out    -> SignInPrompt, no form at all. An empty settings form
 *                    reads as "my restaurant has no name".
 *   signed in but not owner/manager -> the form is shown with real values and
 *                    every control disabled, so a cashier can read the tax
 *                    rate without being able to change it.
 *
 * WHERE THE TAX EXAMPLE COMES FROM
 *
 * The "a ₹100 dish bills at ₹118" line is computed with lib/money, the same
 * rounding the order uses. An example that disagreed with the bill by a paisa
 * is exactly what makes an owner stop trusting the number on this screen.
 */

/** The page index. Every id here is rendered below; a test pins the pair. */
const SECTIONS = [
  { id: 'settings-details', label: 'Restaurant details' },
  { id: 'settings-money', label: 'Tax and money' },
  { id: 'settings-outlets', label: 'Outlets' },
  { id: 'settings-people', label: 'People' },
  { id: 'settings-coupons', label: 'Promo codes' },
  { id: 'settings-printers', label: 'Printing & devices' },
  { id: 'settings-operating-mode', label: 'Operating path & POS' },
  { id: 'settings-operations', label: 'Operations' },
  { id: 'settings-qr', label: 'Menu QR' },
] as const;

/**
 * One numbered section of the page.
 *
 * The screen is three long runs of forms, and the old version separated them
 * with a heading the same size as a panel's title -- so the eye saw seven equal
 * headings in a column and no structure at all. A number, a heavier title and a
 * hairline that runs to the meta line give the page a spine the reader can
 * follow without reading a word of it.
 *
 * `scroll-mt` is what makes the anchor from the index land BELOW the sticky app
 * bar instead of underneath it.
 */
function PageSection({
  n,
  id,
  title,
  meta,
  children,
}: {
  n: string;
  id: string;
  title: string;
  meta: string;
  children: ReactNode;
}) {
  return (
    <section className="scroll-mt-24">
      <div className="mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="tnum text-[10.5px] font-semibold tracking-[0.14em] text-[var(--p-accent)]">
          {n}
        </span>
        <h2 id={id} className="text-[15px] font-semibold tracking-[-0.025em] text-gink">
          {title}
        </h2>
        <span aria-hidden="true" className="hidden h-px min-w-6 flex-1 bg-hair sm:block" />
        <span className="text-[12.5px] text-gink-46">{meta}</span>
      </div>
      {children}
    </section>
  );
}

/**
 * A named run of fields inside one panel.
 *
 * Eleven fields in one column is not a form, it is a list: "Restaurant name",
 * "Tagline", "Address", "Phone", "GSTIN" and "Public web address" were all the
 * same thing to the eye. Three groups -- what is printed on the menu, what is
 * printed on the bill, and the link guests open -- turn the card into
 * something that can be read, and each one is separated by the quietest line
 * on the surface.
 */
function FieldGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-[var(--p-line-soft)] pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-[12.5px] font-semibold tracking-[0.01em] text-gink">{title}</h3>
      {hint ? <p className="mt-0.5 mb-3 text-[11.5px] leading-[1.5] text-gink-46">{hint}</p> : null}
      <div className={hint ? 'flex flex-col gap-3.5' : 'mt-3 flex flex-col gap-3.5'}>{children}</div>
    </div>
  );
}

export function SettingsScreen({
  data,
  outlet,
  error,
  notice,
  team = null,
  teamFlash = null,
  origin = '',
}: {
  data?: SettingsScreenData | null;
  /** Who works here. Null when the database is not connected. */
  team?: TeamScreenData | null;
  /** A link minted in the last ten minutes, and only then. */
  teamFlash?: InviteFlash | null;
  /** Absolute origin, so a copied invitation link works pasted into a chat. */
  origin?: string;
  /** Which outlet is open, for the switcher in the bar. */
  outlet?: OutletBar | null;
  error?: string;
  notice?: string;
}) {
  /**
   * Outlets, and what the account's plan allows.
   *
   * The entitlement is read from the account (Model C): one subscription, one
   * allowance, every outlet counted against it. `null` means the read did not
   * happen, so the screen offers the form and lets the database decide --
   * the server refuses an over-limit create either way.
   */
  const entitlement: OutletEntitlement | null = data?.outletEntitlement ?? null;
  const outletCount = data?.outlets?.length ?? 0;
  const outletBlocked = entitlementBlockedReason(entitlement);

  // Blocked callers get the prompt only. See the note above.
  if (data?.blocked) {
    return (
      <OwnerPage active="settings" outlet={outlet}>
        <SignInPrompt reason={data.blocked} screen="settings screen" />
      </OwnerPage>
    );
  }

  const live = Boolean(data);
  const canEdit = Boolean(data?.canEdit);
  const details = data?.details ?? {
    name: '',
    tagline: '',
    address: '',
    phone: '',
    gstin: '',
    slug: '',
  };
  const taxBps = data?.taxRateBps ?? 0;
  const example = taxExamplePaise(taxBps);
  const disabled = !live || !canEdit;
  const noPublishedMenu = live && (data?.publishedMenus ?? 0) === 0;

  return (
    <OwnerPage active="settings" outlet={outlet}>
      {/* Everything but the menu card is screen-only. The card is print-only. */}
      <div className="print:hidden">
        <PageHead
          kicker="Settings"
          title={details.name || 'Your restaurant'}
          meta="What guests see, what the bill charges, and the code that opens your menu. Changes take effect immediately — the guest menu reads these the next time somebody scans."
        />

        {/* The result of a save belongs under the title, not above it: a page
            that opens on a red band reads as broken before it reads as fixed.
            It is also STICKY under the app bar, because this page is five
            forms tall and four of them end far below the fold -- saving the
            UPI details used to write the answer off-screen, so the honest
            reading of the screen was "nothing happened". */}
        {error || notice ? (
          /* Opaque, not blurred: the staff surface is paper, and the design
             guard counts every glass panel drawn on it. */
          <div className="sticky top-14 z-20 mb-3 space-y-2 bg-paper">
            {error ? (
              <Notice
                tone="due"
                role="alert"
                label="Nothing was saved."
                className="mb-0"
              >
                {error}
              </Notice>
            ) : null}
            {notice ? (
              <Notice tone="accent" role="status" label="Saved." className="mb-0">
                {notice}
              </Notice>
            ) : null}
          </div>
        ) : null}

        {!live ? (
          <Notice tone="due" label="The database is not connected.">
            These fields are empty because there is no restaurant to read, and they cannot be saved.
            Nothing here is sample data — that is the point.
          </Notice>
        ) : null}

        {live && !canEdit ? (
          <Notice tone="plain" label={<Tag tone="neutral">{data?.role ?? 'staff'}</Tag>}>
            <strong className="font-semibold text-gink">Read-only for your role.</strong> Your
            restaurant&apos;s name, address and web address are changed by the owner or a manager.
            Only the owner changes the tax rate and GSTIN. You can see these settings here so the
            tax on a bill is never a mystery.
          </Notice>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_318px] lg:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            {/* -------------------------------------------------- what guests see */}
            <PageSection
              n="01"
              id="settings-details"
              title="What guests see"
              meta="Name, address and the link that opens your menu"
            >

              <Panel
                title="Restaurant details"
                meta="Name, address and what the bill carries"
                bodyClassName="px-5 py-5"
              >
                <form action={saveDetailsAction} className="flex flex-col gap-5">
                  <FieldGroup title="On the menu" hint="The first two things a guest reads when the code opens.">
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <Field label="Restaurant name" htmlFor="settings-name">
                      <input
                        id="settings-name"
                        className={inputClass}
                        name="name"
                        type="text"
                        defaultValue={details.name}
                        maxLength={80}
                        required
                        disabled={disabled}
                        autoComplete="organization"
                      />
                    </Field>

                    <Field
                      label="Tagline"
                      htmlFor="settings-tagline"
                      hint="Shown under your name on the guest menu. Optional."
                    >
                      <input
                        id="settings-tagline"
                        className={inputClass}
                        name="tagline"
                        type="text"
                        defaultValue={details.tagline}
                        maxLength={120}
                        disabled={disabled}
                        placeholder="Bombay street food, made fresh"
                      />
                    </Field>
                  </div>
                  </FieldGroup>

                  <FieldGroup title="On the bill" hint="Printed under the restaurant name, and on the menu card you can print from this page.">
                  <Field
                    label="Address"
                    htmlFor="settings-address"
                    hint="Printed on the bill, under the restaurant name, and on the menu card you can print from this page. A missing address is called out on the bill rather than left blank silently."
                  >
                    <input
                      id="settings-address"
                      className={inputClass}
                      name="address"
                      type="text"
                      defaultValue={details.address}
                      maxLength={200}
                      disabled={disabled}
                      autoComplete="street-address"
                    />
                  </Field>

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <Field label="Phone" htmlFor="settings-phone">
                      <input
                        id="settings-phone"
                        className={inputClass}
                        name="phone"
                        type="tel"
                        defaultValue={details.phone}
                        maxLength={24}
                        disabled={disabled}
                        autoComplete="tel"
                        placeholder="+91 98765 43210"
                      />
                    </Field>

                    <Field
                      label="GSTIN"
                      htmlFor="settings-gstin"
                      hint="Owner-only billing detail. The 15-character format is checked here; saving a GSTIN does not enable GST tax invoices."
                    >
                      <input
                        id="settings-gstin"
                        className={inputClass}
                        name="gstin"
                        type="text"
                        defaultValue={details.gstin}
                        maxLength={15}
                        disabled={disabled || data?.role !== 'owner'}
                        autoCapitalize="characters"
                        placeholder="22AAAAA0000A1Z5"
                      />
                    </Field>
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <Field
                      label="FSSAI license number (optional)"
                      htmlFor="settings-fssai"
                      hint="14-digit FSSAI registration number printed on customer bills, tax invoices and PDFs when set."
                    >
                      <input
                        id="settings-fssai"
                        className={`${inputClass} tabular-nums`}
                        name="fssaiNumber"
                        type="text"
                        inputMode="numeric"
                        maxLength={14}
                        defaultValue={details.fssaiNumber ?? ''}
                        disabled={disabled}
                        placeholder="11524001000123"
                      />
                    </Field>

                    <Field
                      label="Bill footer / thank-you note (optional)"
                      htmlFor="settings-bill-footer"
                      hint="Short message printed at the bottom of 58mm, 80mm, A4 and shared bills (max 240 chars)."
                    >
                      <input
                        id="settings-bill-footer"
                        className={inputClass}
                        name="billFooterNote"
                        type="text"
                        maxLength={240}
                        defaultValue={details.billFooterNote ?? ''}
                        disabled={disabled}
                        placeholder="Thank you for dining with us! Visit again."
                      />
                    </Field>
                  </div>
                  </FieldGroup>

                  <FieldGroup title="The link guests open" hint="One address, one restaurant. It is what the QR below encodes.">
                  <Field
                    label="Public web address"
                    htmlFor="settings-slug"
                    hint={`/menu?s=${details.slug || 'your-address'} — the one link that names your restaurant.`}
                  >
                    <input
                      id="settings-slug"
                      className={inputClass}
                      name="slug"
                      type="text"
                      defaultValue={details.slug}
                      maxLength={48}
                      disabled={disabled}
                      spellCheck={false}
                    />
                  </Field>

                  {canEdit ? (
                    <label className="flex items-start gap-2.5 rounded-[var(--p-r-control)] border border-hair bg-paper-deep px-3 py-2.5">
                      <input
                        type="checkbox"
                        name="slugConfirm"
                        className="mt-[2px] size-4 shrink-0 accent-[var(--p-accent)]"
                      />
                      <span className="text-[11.5px] leading-[1.5] text-gink-64">
                        I changed the web address and understand that existing links, bookmarks and
                        printed standees with the old one stop working.
                      </span>
                    </label>
                  ) : null}
                  </FieldGroup>

                  {/* One commit control, at the bottom, full stop. Everything
                      above it is one write, so there is exactly one button that
                      writes it -- and it sits at the end of the group it saves
                      rather than floating beside a field. */}
                  <div className="flex flex-wrap items-center gap-3 border-t border-[var(--p-line-soft)] pt-4">
                    <SubmitButton pendingLabel="Saving details…" disabled={disabled} tone="solid">
                      Save details
                    </SubmitButton>
                    <span className="text-[11.5px] leading-[1.45] text-gink-46">
                      Applies to the menu, the bill and the QR immediately.
                    </span>
                  </div>
                </form>
              </Panel>
            </PageSection>

            {/* -------------------------------------------- what the bill charges */}
            <PageSection
              n="02"
              id="settings-money"
              title="What the bill charges"
              meta="Tax and guest verification"
            >

              <div className="flex flex-col gap-4">
                <Panel
                  title="Tax"
                  meta={taxBps === 0 ? '0% — nothing added' : `${formatTaxPercent(taxBps)}%`}
                  bodyClassName="px-5 py-5"
                >
                  <p className="m-0 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                    The per-order rate used while GST is off, added on top of menu prices. Only the
                    owner can change this billing setting; AutoDine does not infer a rate.
                  </p>

                  {(data?.gst.mode ?? 'off') !== 'off' && (
                    <Notice tone="due" label="GST billing is active" className="mt-3 mb-0">
                      {data?.gst.mode === 'regular'
                        ? 'Regular GST is active: menu prices include GST and this rate is not added to new bills.'
                        : 'Composition scheme is active: bills of supply charge no GST, and this rate is not added to new bills.'}
                    </Notice>
                  )}

                  {taxBps === 0 ? (
                    <Notice tone="due" label="Tax is 0%." className="mt-3 mb-0">
                      New orders currently use the menu price with no tax.
                    </Notice>
                  ) : (
                    <Notice tone="plain" label="Example" className="mt-3 mb-0">
                      A dish priced {inr(100)} currently bills {inr(paiseToRupees(example.totalPaise))}{' '}
                      — {inr(100)} plus {inr(paiseToRupees(example.taxPaise))} tax.
                    </Notice>
                  )}

                  <Notice tone="plain" label="This rate is the GST-off rate" className="mt-3 mb-0">
                    GST invoicing is configured in the GST billing panel below. This rate applies only
                    while GST is off; once a GST mode is active, that mode&rsquo;s approved rules price
                    new bills instead.
                  </Notice>

                  <form action={saveTaxAction} className="mt-3.5 flex flex-col gap-3">
                    <Field
                      label="Tax rate (%)"
                      htmlFor="settings-tax"
                      hint={`Up to two decimals, 0 to ${formatTaxPercent(3000)}. Used only while GST is off; menu prices are then treated as tax-exclusive and this rate is added at checkout.`}
                    >
                      {/* `w-[180px]!` and not `w-[180px]`: the kit input is
                          `w-full`, and Tailwind sorts `.w-[180px]` BEFORE
                          `.w-full` in the stylesheet, so appending it silently
                          does nothing. The `!` suffix is the explicit
                          override. See the kit note in owner/chrome.tsx. */}
                      <input
                        id="settings-tax"
                        className={`${inputClass} w-[180px]! max-w-full tabular-nums`}
                        name="taxRate"
                        type="text"
                        inputMode="decimal"
                        pattern="(?:30(?:\.0{1,2})?|(?:\d|[12]\d)(?:\.\d{1,2})?)%?"
                        title="Enter a percentage from 0 to 30 with up to two decimal places."
                        maxLength={7}
                        defaultValue={formatTaxPercent(taxBps)}
                        disabled={disabled || data?.role !== 'owner'}
                        required
                      />
                    </Field>

                    <div>
                      <SubmitButton pendingLabel="Saving rate…" disabled={disabled || data?.role !== 'owner'} tone="solid">
                        Save tax rate
                      </SubmitButton>
                    </div>
                  </form>

                  <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                    Orders already placed keep the tax they were charged — a bill is a record of the
                    rate at that moment, not a live calculation. New orders use the new rate
                    immediately.
                  </p>
                </Panel>

                {/* ------------------------------------------------------ GST billing */}
                <GstSettingsPanel gst={data?.gst ?? { ready: false, mode: 'off', regularProfile: 'other_than_specified_premises', gstin: '', legalName: '', tradeName: '', address: '', stateCode: '', pan: '', registrationType: 'regular', compositionAcknowledged: false, specifiedPremisesAttested: false, specifiedPremisesEffectiveFrom: '2025-04-01', offDeclared: false, offDeclaredAt: null, precedingFyTurnoverRupees: '', einvoiceLocation: '', einvoicePincode: '', einvoiceHsnSac: '', configVersion: 0, updatedAt: null }} disabled={disabled} />

                {/* ------------------------------------ Default charges & round-off */}
                <Panel
                  title="Bill charges & round-off"
                  meta={data?.billingDefaults?.roundOffEnabled ? 'Auto round-off ON' : 'Defaults'}
                  bodyClassName="px-5 py-5"
                >
                  <p className="m-0 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                    Optional default charges applied to new counter orders (cashier can override per
                    bill) and automatic integer-rupee round-off. Owner-only.
                  </p>
                  <form action={saveBillingDefaultsAction} className="mt-4 flex flex-col gap-3.5">
                    <div className="grid gap-3.5 sm:grid-cols-3">
                      <Field label="Service charge (%)" htmlFor="settings-svc-charge" hint="Optional dine-in charge (0–20%).">
                        <input
                          id="settings-svc-charge"
                          name="serviceChargePercent"
                          type="text"
                          inputMode="decimal"
                          defaultValue={formatTaxPercent(data?.billingDefaults?.serviceChargeBps ?? 0)}
                          disabled={disabled || data?.role !== 'owner'}
                          className={`${inputClass} tabular-nums`}
                        />
                      </Field>
                      <Field label="Packaging charge (₹)" htmlFor="settings-pkg-charge" hint="Default for takeaway & delivery.">
                        <input
                          id="settings-pkg-charge"
                          name="packagingChargeRupees"
                          type="number"
                          min={0}
                          max={500}
                          step="1"
                          defaultValue={paiseToRupees(data?.billingDefaults?.packagingChargePaise ?? 0)}
                          disabled={disabled || data?.role !== 'owner'}
                          className={`${inputClass} tabular-nums`}
                        />
                      </Field>
                      <Field label="Delivery charge (₹)" htmlFor="settings-del-charge" hint="Default for delivery orders.">
                        <input
                          id="settings-del-charge"
                          name="deliveryChargeRupees"
                          type="number"
                          min={0}
                          max={1000}
                          step="1"
                          defaultValue={paiseToRupees(data?.billingDefaults?.deliveryChargePaise ?? 0)}
                          disabled={disabled || data?.role !== 'owner'}
                          className={`${inputClass} tabular-nums`}
                        />
                      </Field>
                    </div>
                    <label className="flex items-start gap-2.5 rounded-[var(--p-r-control)] border border-hair bg-paper-deep px-3 py-2.5 text-[12.5px] leading-[1.5]">
                      <input
                        type="checkbox"
                        name="roundOffEnabled"
                        defaultChecked={data?.billingDefaults?.roundOffEnabled ?? false}
                        disabled={disabled || data?.role !== 'owner'}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium text-gink">Auto round-off net bill to nearest ₹1</span>
                        <span className="mt-0.5 block text-[11.5px] text-gink-46">
                          Round-off (−₹0.50 to +₹0.50) is printed as a separate line on bills and invoices.
                        </span>
                      </span>
                    </label>
                    <div>
                      <SubmitButton pendingLabel="Saving defaults…" disabled={disabled || data?.role !== 'owner'} tone="solid">
                        Save charges &amp; rounding
                      </SubmitButton>
                    </div>
                  </form>
                </Panel>

                {/* ------------------------------------------- how guests verify */}
                <Panel
                  title="How guests verify they are at a table"
                  meta={
                    data?.guestVerificationMode === 'scan'
                      ? 'Scan only'
                      : data?.guestVerificationMode === 'scan_confirm'
                        ? 'Scan + one tap'
                        : 'Six-digit code'
                  }
                  bodyClassName="px-5 py-5"
                >
                  <p className="m-0 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                    A printed QR code can be photographed, so on its own it proves somebody saw the
                    card, not that they are sitting at the table. Pick what has to happen before a
                    guest&apos;s order reaches the kitchen.
                  </p>

                  <form action={saveGuestVerificationAction} className="mt-3.5 flex flex-col gap-2.5">
                    {[
                      {
                        value: 'code' as const,
                        title: 'Six-digit code on the screen at the counter',
                        body: 'A guest enters the digits showing in the room, once per sitting. The only option where something about the physical room is checked. Nothing about your current setup changes.',
                        risk: 'Safe default',
                      },
                      {
                        value: 'scan_confirm' as const,
                        title: 'Scan, then one tap from staff per table',
                        body: 'The guest scans and orders. The first order at each table waits on the kitchen board for one tap; after that, orders from the same sitting go straight through. One tap per table, not per order.',
                        risk: 'A photographed card can reach your board',
                      },
                      {
                        value: 'scan' as const,
                        title: 'Scan only, nothing waits',
                        body: 'Fastest for the guest and the least checked. Anyone holding a photograph of one of your table cards can place an order at that table within the session window.',
                        risk: 'No human check at all',
                      },
                    ].map((option) => (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-start gap-2.5 rounded-[var(--p-r-control)] border border-hair bg-paper-deep px-3 py-2.5 has-[:checked]:border-[var(--p-accent)]"
                      >
                        <input
                          type="radio"
                          name="guestVerificationMode"
                          value={option.value}
                          disabled={disabled}
                          defaultChecked={data?.guestVerificationMode === option.value}
                          className="mt-[3px] size-4 shrink-0 accent-[var(--p-accent)]"
                        />
                        <span className="min-w-0">
                          <span className="block text-[12.5px] font-semibold text-gink">
                            {option.title}
                          </span>
                          <span className="mt-0.5 block text-[11.5px] leading-[1.5] text-gink-46">
                            {option.body}
                          </span>
                          {option.value !== 'code' ? (
                            <span className="mt-1 block text-[11.5px] font-medium text-[var(--p-due)]">
                              {option.risk}. This cannot claim the guest was in the room.
                            </span>
                          ) : (
                            <span className="mt-1 block text-[11.5px] font-medium text-[var(--p-live)]">
                              {option.risk}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}

                    <div>
                      <SubmitButton tone="solid" pendingLabel="Saving setting…" disabled={disabled}>
                        Save verification setting
                      </SubmitButton>
                    </div>
                  </form>

                  <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                    Changing this never releases an order that is already waiting, and never holds
                    one that has already been accepted. Restaurants on the code keep the counter
                    display at{' '}
                    <span className="font-medium text-gink">Dashboard → Guest code display</span>.
                  </p>
                </Panel>

                
              </div>
            </PageSection>

            {/* ------------------------------------------------------------ account */}
            <PageSection
              n="03"
              id="settings-outlets"
              title="Account"
              meta="Every outlet carries its own menu, tables and money"
            >

              <Panel
                title="Outlets"
                meta={
                  live
                    ? entitlement
                      ? `${outletCount} on this account · ${entitlementSummary(entitlement)}`
                      : `${outletCount} on this account`
                    : 'none'
                }
                bodyClassName="px-5 py-5"
              >
                <p className="m-0 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                  Every outlet has its own menu, tables, QR codes, orders and bills. Whatever is open
                  here is what the rest of the dashboard shows.
                </p>

                {!live ? (
                  <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                    The database is not connected, so there are no outlets to list and none can be
                    added. The sample restaurant elsewhere in this preview is a single outlet.
                  </p>
                ) : null}

                {live ? (
                  <ul className="m-0 mt-3 flex list-none flex-col p-0">
                    {(data?.outlets ?? []).map((entry) => (
                      <li
                        key={entry.id}
                        className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hair py-2 text-[12.5px] text-gink last:border-b-0"
                      >
                        <span className="font-medium">{entry.name}</span>
                        <span className="flex items-center gap-2 text-[11.5px] text-gink-46">
                          {entry.role}
                          {entry.id === data?.activeOutletId ? <Tag tone="live">Open now</Tag> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {live && data?.role === 'owner' && outletBlocked ? (
                  <p className="mt-3 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-64">
                    {outletBlocked} Every outlet above is still open and still taking orders.
                  </p>
                ) : null}

                {live && data?.role === 'owner' && !outletBlocked ? (
                  <form
                    className="mt-3 flex flex-col gap-2.5"
                    method="post"
                    action="/dashboard/outlet/new"
                  >
                    <Field
                      label="Add another outlet"
                      htmlFor="new-outlet-name"
                      hint={
                        entitlement
                          ? `${entitlementSummary(entitlement)} on this plan. A new outlet starts empty, with its own web address and a 0% tax rate to set.`
                          : 'A new outlet starts empty, with its own web address and a 0% tax rate to set.'
                      }
                    >
                      <input
                        id="new-outlet-name"
                        className={inputClass}
                        name="name"
                        placeholder="Maddi — Baner"
                        minLength={2}
                        maxLength={80}
                        required
                      />
                    </Field>
                    <div>
                      <SubmitButton tone="solid" pendingLabel="Creating…">
                        Create outlet
                      </SubmitButton>
                    </div>
                  </form>
                ) : null}

                {live && data?.role !== 'owner' ? (
                  <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                    Only an owner can add an outlet. You are signed in as {data?.role ?? 'staff'}.
                  </p>
                ) : null}
              </Panel>
            </PageSection>

            {/* -------------------------------------------------------------- people */}
            <PageSection
              n="04"
              id="settings-people"
              title="People"
              meta="Who can sign in, and what their role can open"
            >
              <PeoplePanel
                data={team}
                flash={teamFlash}
                origin={origin}
                disabled={!live}
                timeZone={data?.timezone ?? 'Asia/Kolkata'}
              />
            </PageSection>

            {/* -------------------------------------------------------------- coupons */}
            <PageSection
              n="05"
              id="settings-coupons"
              title="Promo codes"
              meta="Create restaurant coupons for counter billing with minimum order and cap rules"
            >
              <Panel
                title="Coupons & promo codes"
                meta={`${(data?.coupons ?? []).filter((c) => c.isActive).length} active`}
              >
                <form action={saveCouponAction} className="grid gap-3 sm:grid-cols-2">
                  <Field label="Promo code" htmlFor="coupon-code" hint="Letters, numbers, - or _ (e.g. WELCOME10).">
                    <input
                      id="coupon-code"
                      name="code"
                      type="text"
                      required
                      maxLength={24}
                      disabled={disabled}
                      placeholder="WELCOME10"
                      className={`${inputClass} uppercase font-mono`}
                    />
                  </Field>
                  <Field label="Short note (optional)" htmlFor="coupon-desc">
                    <input
                      id="coupon-desc"
                      name="description"
                      type="text"
                      maxLength={120}
                      disabled={disabled}
                      placeholder="10% off welcome offer"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Discount type" htmlFor="coupon-type">
                    <select id="coupon-type" name="discountType" defaultValue="percent" disabled={disabled} className={inputClass}>
                      <option value="percent">Percentage (%)</option>
                      <option value="flat">Flat amount (₹)</option>
                    </select>
                  </Field>
                  <Field label="Value (% or ₹)" htmlFor="coupon-value">
                    <input
                      id="coupon-value"
                      name="discountValue"
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      disabled={disabled}
                      placeholder="10"
                      className={`${inputClass} tabular-nums`}
                    />
                  </Field>
                  <Field label="Min order (₹, optional)" htmlFor="coupon-min">
                    <input
                      id="coupon-min"
                      name="minOrderRupees"
                      type="number"
                      step="1"
                      min="0"
                      disabled={disabled}
                      placeholder="299"
                      className={`${inputClass} tabular-nums`}
                    />
                  </Field>
                  <Field label="Max discount cap (₹, optional)" htmlFor="coupon-cap">
                    <input
                      id="coupon-cap"
                      name="maxDiscountRupees"
                      type="number"
                      step="1"
                      min="1"
                      disabled={disabled}
                      placeholder="150"
                      className={`${inputClass} tabular-nums`}
                    />
                  </Field>
                  <Field label="Max total uses (optional)" htmlFor="coupon-uses">
                    <input
                      id="coupon-uses"
                      name="maxUses"
                      type="number"
                      step="1"
                      min="1"
                      disabled={disabled}
                      placeholder="100"
                      className={`${inputClass} tabular-nums`}
                    />
                  </Field>
                  <Field label="Expires on (optional)" htmlFor="coupon-until">
                    <input
                      id="coupon-until"
                      name="validUntil"
                      type="date"
                      disabled={disabled}
                      className={inputClass}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <SubmitButton tone="solid" disabled={disabled} pendingLabel="Saving…">
                      Save promo code
                    </SubmitButton>
                  </div>
                </form>

                {(data?.coupons ?? []).length > 0 ? (
                  <ul className="m-0 mt-4 flex list-none flex-col divide-y divide-hair border-t border-hair p-0">
                    {(data?.coupons ?? []).map((coupon) => {
                      const valLabel =
                        coupon.discountType === 'percent'
                          ? `${(coupon.discountValue / 100).toFixed(coupon.discountValue % 100 === 0 ? 0 : 2)}% off`
                          : `₹${(coupon.discountValue / 100).toFixed(0)} off`;
                      return (
                        <li key={coupon.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[12.5px]">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-semibold text-gink">{coupon.code}</span>
                              <Tag tone={coupon.isActive ? 'live' : 'neutral'}>
                                {coupon.isActive ? 'Active' : 'Paused'}
                              </Tag>
                              <span className="text-[11.5px] text-gink-64">{valLabel}</span>
                              {coupon.minOrderPaise > 0 ? (
                                <span className="text-[11.5px] text-gink-46">
                                  Min ₹{Math.round(coupon.minOrderPaise / 100)}
                                </span>
                              ) : null}
                              {coupon.maxDiscountPaise ? (
                                <span className="text-[11.5px] text-gink-46">
                                  Cap ₹{Math.round(coupon.maxDiscountPaise / 100)}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 text-[11.5px] text-gink-46">
                              Used {coupon.usesCount}
                              {coupon.maxUses ? ` / ${coupon.maxUses}` : ''} times
                              {coupon.description ? ` · ${coupon.description}` : ''}
                            </div>
                          </div>
                          {live && data?.canEdit ? (
                            <form action={toggleCouponAction}>
                              <input type="hidden" name="couponId" value={coupon.id} />
                              <input type="hidden" name="isActive" value={coupon.isActive ? 'false' : 'true'} />
                              <button type="submit" className={btn('quiet', 'sm')}>
                                {coupon.isActive ? 'Pause' : 'Activate'}
                              </button>
                            </form>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-3 text-[11.5px] text-gink-46">
                    No promo codes created yet. Create one above to let cashiers apply pre-tax discounts at the counter.
                  </p>
                )}
              </Panel>
            </PageSection>

            {/* --------------------------------------------------- printing & devices */}
            <PageSection
              n="06"
              id="settings-printers"
              title="Printing & devices"
              meta="Thermal bill printers, office A4, and optional Windows Print Bridge pairing"
            >
              <PrintingDevicesPanel
                printers={data?.printers ?? []}
                canEdit={Boolean(data?.canEdit)}
                live={live}
                restaurantName={details.name}
              />
            </PageSection>

            {/* --------------------------------------------------- operating path */}
            <PageSection
              n="07"
              id="settings-operating-mode"
              title="Operating path &amp; POS handoff"
              meta="Mode A alongside an existing POS, or Mode B as primary OS"
            >
              <OperatingModePanel
                operatingMode={data?.operatingMode ?? outlet?.operatingMode ?? 'mode_b'}
                posIntegrationName={data?.posIntegrationName ?? outlet?.posIntegrationName ?? ''}
                posWebhookUrl={data?.posWebhookUrl ?? ''}
                posWebhookSecretConfigured={Boolean(data?.posWebhookSecretConfigured)}
                canEdit={Boolean(data?.canEdit)}
                live={live}
              />
            </PageSection>

            {/* ---------------------------------------------------------- operations */}
            <PageSection
              n="08"
              id="settings-operations"
              title="Operations"
              meta="Live incidents on this instance — acknowledge, resolve, escalate"
            >
              <OperationsPanel disabled={!live} />
            </PageSection>
          </div>

          {/* ------------------------------------------------------------- aside */}
          {/* The index and the QR follow the reader down five forms' worth of
              page. On a laptop they are sticky from just under the app bar; on
              a phone they stack below, where sticky would only eat the screen. */}
          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[72px]">
            {/* The page is five forms tall. This is the only thing on it that
                says where you are -- and it is four real anchors, not a menu
                that scrolls for you, so it still works with no JavaScript. */}
            <Panel title="On this page" meta={`${SECTIONS.length} sections`} bodyClassName="px-2 py-2">
              <nav aria-label="Sections on this page">
                <ul className="m-0 flex list-none flex-col p-0">
                  {SECTIONS.map((section, i) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="group flex items-center gap-2.5 rounded-[var(--p-r-control)] px-2.5 py-2 text-[12.5px] text-gink-64 transition-colors duration-150 ease-[var(--o-ease)] hover:bg-[var(--p-accent-wash)] hover:text-gink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]"
                      >
                        <span className="tnum text-[10.5px] font-semibold tracking-[0.1em] text-gink-28 transition-colors group-hover:text-[var(--p-accent)]">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{section.label}</span>
                        <span
                          aria-hidden="true"
                          className="text-[10.5px] text-gink-28 transition-colors group-hover:text-[var(--p-accent)]"
                        >
                          ↓
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </Panel>

            <Panel
              title={<span id="settings-qr">Public menu QR</span>}
              meta={data?.publicMenuSvg ? 'Opens for anyone' : 'Not available'}
              bodyClassName="px-4 py-4"
            >
              {data?.publicMenuSvg ? (
                <div className="flex justify-center rounded-[var(--p-r-control)] border border-hair bg-white p-3">
                  {/* Generated on the server by lib/qr.ts from a URL we build.
                      There is no path from anything a restaurant types to this
                      string, so it is injected rather than parsed. */}
                  <span
                    className="block [&>svg]:block [&>svg]:size-full"
                    style={{ width: 176, height: 176 }}
                    dangerouslySetInnerHTML={{ __html: data.publicMenuSvg }}
                  />
                </div>
              ) : (
                <p className="m-0 text-[12.5px] leading-[1.5] text-gink-46">
                  {live
                    ? 'The code could not be drawn for this address. The link below still works.'
                    : 'No code: there is no restaurant to encode until the database is connected.'}
                </p>
              )}

              {data?.publicMenuUrl ? (
                <div className="mt-3 flex items-center gap-1.5">
                  <a
                    id="settings-menu-url"
                    href={data.publicMenuUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate rounded-[var(--p-r-chip)] border border-hair bg-paper-deep px-2.5 py-1.5 text-[11.5px] text-gink underline decoration-hair-strong underline-offset-2 hover:decoration-gink"
                  >
                    {data.publicMenuUrl}
                  </a>
                  <CopyButton
                    value={data.publicMenuUrl}
                    selectId="settings-menu-url"
                    className={btn('ghost', 'sm')}
                  />
                </div>
              ) : null}

              <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                This is the menu, not a table. It opens for anyone, with no table attached, so it
                works for takeaway and for sharing. Table cards — the ones that pin an order to a
                table — are in{' '}
                <Link
                  href="/dashboard/tables"
                  className="font-medium text-gink underline decoration-hair-strong underline-offset-2"
                >
                  Tables &amp; QR
                </Link>
                .
              </p>

              {/* One banner, and it changes with what is actually wrong: no
                  menus at all, or menus that exist but are not published. */}
              {noPublishedMenu ? (
                <Notice tone="due" label="Nothing to show yet." className="mt-3 mb-0">
                  {(data?.totalMenus ?? 0) === 0 ? (
                    <>
                      You have no menus at all, so a guest scanning this lands on an empty page. Add
                      dishes first, then publish the menu.
                    </>
                  ) : (
                    <>
                      None of your {data?.totalMenus} menus is published, so a guest scanning this
                      lands on an empty page. Publish one menu and this code starts working.
                    </>
                  )}
                </Notice>
              ) : null}

              {live && data?.publicMenuSvg ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <PrintButton className={btn('ghost', 'sm')}>Print menu card</PrintButton>
                  <MenuQrActions
                    svg={data.publicMenuSvg}
                    url={data.publicMenuUrl ?? ''}
                    className={btn('ghost', 'sm')}
                  />
                </div>
              ) : null}
            </Panel>

            <Card className="bg-paper-deep px-4 py-4">
              <h2 className="text-[13.5px] font-semibold tracking-[-0.014em] text-gink">
                Where these appear
              </h2>
              <ul className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0">
                {[
                  'Name and tagline: the top of the guest menu, and the browser tab title.',
                  'Tax rate: the cart, the checkout total and every GST-off order placed from now on.',
                  'Web address: the QR above and every link to your menu.',
                  'Address, phone and GSTIN: printed on the bill. A bill with either the address or the GSTIN missing says so.',
                ].map((line) => (
                  <li key={line} className="flex gap-2 text-[11.5px] leading-[1.5] text-gink-64">
                    <span
                      aria-hidden="true"
                      className="mt-[7px] size-1 shrink-0 rounded-full bg-gink-28"
                    />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[11.5px] leading-[1.5] text-gink-46">
                Timezone: <strong className="text-gink">{data?.timezone ?? 'Asia/Kolkata'}</strong>.
                Fixed at signup, because it decides which day a sale belongs to in Reports; changing
                it mid-day would move yesterday&apos;s money into today.
              </p>
            </Card>
          </aside>
        </div>
      </div>

      {/* Printed by the Print menu card button: forms and aside are hidden, and
          this card is the page. */}
      <div className="hidden print:block" data-print-sheet>
        <div className="flex flex-col items-center gap-2 border border-hair px-6 py-8 text-center">
          {data?.publicMenuSvg ? (
            <span
              className="block [&>svg]:block [&>svg]:size-full"
              style={{ width: 160, height: 160 }}
              dangerouslySetInnerHTML={{ __html: data.publicMenuSvg }}
            />
          ) : null}
          <div className="text-[15px] font-medium text-gink">{details.name || 'Your restaurant'}</div>
          <div className="text-[11.5px] text-gink-46">Scan for the menu</div>
        </div>
      </div>
    </OwnerPage>
  );
}
