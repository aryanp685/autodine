import Link from 'next/link';
import { SignInPrompt } from '@/components/SignInPrompt';
import { CopyButton } from '@/components/CopyButton';
import { PrintButton } from '@/components/PrintButton';
import { SubmitButton } from '@/components/owner/SubmitButton';
import type { OutletBar } from '@/lib/outlets';
import type { SettingsScreenData } from '@/lib/db/settings-screen';
import { formatTaxPercent, taxExamplePaise } from '@/lib/settings-input';
import {
  saveDetailsAction,
  saveOnlinePaymentsAction,
  saveTaxAction,
  saveUpiAction,
} from '@/app/dashboard/settings/actions';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';
import {
  OwnerPage,
  PageHead,
  Card,
  Panel,
  btn,
  Field,
  inputClass,
  Tag,
} from '@/components/owner/chrome';

/**
 * Restaurant settings: the details guests and bills read, the tax rate, and
 * the QR that opens the public menu.
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
export function SettingsScreen({
  data,
  outlet,
  error,
  notice,
  gatewayConfigured = false,
}: {
  data?: SettingsScreenData | null;
  /** Which outlet is open, for the switcher in the bar. */
  outlet?: OutletBar | null;
  error?: string;
  notice?: string;
  /**
   * Does this DEPLOYMENT have a payment gateway key pair?
   *
   * Passed in rather than read here, because it is an environment fact and
   * this component is also rendered in tests. The switch and the key are two
   * different things and the card below says which one is missing -- an owner
   * who "turned it on" and saw no button needs to know why.
   */
  gatewayConfigured?: boolean;
}) {
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
  const details = data?.details ?? { name: '', tagline: '', address: '', phone: '', gstin: '', slug: '' };
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
            that opens on a red band reads as broken before it reads as fixed. */}
        {error && (
          <div
            role="alert"
            className="mb-3 rounded-[12px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-4 py-3"
          >
            <strong className="text-[12.5px] text-[var(--alert)]">Nothing was saved.</strong>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-64">{error}</p>
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="mb-3 rounded-[12px] border border-[var(--p-accent)]/25 bg-accent-soft px-4 py-2.5"
          >
            <strong className="text-[12.5px] text-gink">Saved.</strong>{' '}
            <span className="text-[12.5px] text-gink-64">{notice}</span>
          </div>
        )}

        {!live && (
          <div className="mb-3 rounded-[12px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-4 py-3 text-[11.5px] leading-[1.55] text-gink-64">
            <strong className="font-semibold text-gink">The database is not connected.</strong> These
            fields are empty because there is no restaurant to read, and they cannot be saved. Nothing
            here is sample data — that is the point.
          </div>
        )}

        {live && !canEdit && (
          <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-[12px] border border-hair bg-paper-deep px-4 py-3 text-[11.5px] leading-[1.55] text-gink-64">
            <Tag tone="neutral">{data?.role ?? 'staff'}</Tag>
            <span>
              <strong className="font-semibold text-gink">Read-only for your role.</strong> Your
              restaurant&apos;s name, address, tax rate and web address are changed by the owner or a
              manager. You can see them here so the tax on a bill is never a mystery.
            </span>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_318px] xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            {/* ------------------------------------------------------- details */}
            <Panel
              title="Restaurant details"
              meta="Name, address and what the bill carries"
              bodyClassName="px-4 py-4 sm:px-5"
            >
              <p className="m-0 mb-4 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                The name and tagline are the first two things a guest reads on the menu.
              </p>

              <form action={saveDetailsAction} className="flex flex-col gap-3">
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

                <div className="grid gap-3 sm:grid-cols-2">
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
                    hint="Leave it blank if you are not registered. The 15-character format is checked here rather than discovered on a filed invoice."
                  >
                    <input
                      id="settings-gstin"
                      className={inputClass}
                      name="gstin"
                      type="text"
                      defaultValue={details.gstin}
                      maxLength={15}
                      disabled={disabled}
                      autoCapitalize="characters"
                      placeholder="22AAAAA0000A1Z5"
                    />
                  </Field>
                </div>

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

                {canEdit && (
                  <label className="flex items-start gap-2.5 rounded-[10px] border border-hair bg-paper-deep px-3 py-2.5">
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
                )}

                <div>
                  <SubmitButton pendingLabel="Saving details…" disabled={disabled}>
                    Save details
                  </SubmitButton>
                </div>
              </form>
            </Panel>

            {/* ------------------------------------------------------------ tax */}
            <Panel
              title="Tax"
              meta={taxBps === 0 ? '0% — nothing added' : `${formatTaxPercent(taxBps)}%`}
              bodyClassName="px-4 py-4 sm:px-5"
            >
              <p className="m-0 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                The rate the bill adds on top of the menu prices. Set what your accountant told you —
                this screen does not guess a rate.
              </p>

              {taxBps === 0 ? (
                <p className="mt-3 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-2.5 text-[11.5px] leading-[1.5] text-gink-64">
                  <strong className="font-semibold text-gink">Tax is 0%.</strong> Every bill right now
                  charges the menu price with no tax. If you are registered for GST, set the rate here
                  before service.
                </p>
              ) : (
                <p className="mt-3 rounded-[10px] border border-hair bg-paper-deep px-3.5 py-2.5 text-[11.5px] leading-[1.5] text-gink-64">
                  A dish priced {inr(100)} currently bills {inr(paiseToRupees(example.totalPaise))} —{' '}
                  {inr(100)} plus {inr(paiseToRupees(example.taxPaise))} tax.
                </p>
              )}

              <form action={saveTaxAction} className="mt-3 flex flex-col gap-3">
                <Field
                  label="Tax rate (%)"
                  htmlFor="settings-tax"
                  hint={`Up to two decimals, 0 to ${formatTaxPercent(3000)}. Menu prices are treated as tax-exclusive, so tax is added at checkout.`}
                >
                  <input
                    id="settings-tax"
                    className={`${inputClass} w-[140px] tabular-nums`}
                    name="taxRate"
                    type="text"
                    inputMode="decimal"
                    defaultValue={formatTaxPercent(taxBps)}
                    disabled={disabled}
                    required
                  />
                </Field>

                <div>
                  <SubmitButton tone="ghost" pendingLabel="Saving rate…" disabled={disabled}>
                    Save tax rate
                  </SubmitButton>
                </div>
              </form>

              <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                Orders already placed keep the tax they were charged — a bill is a record of the rate at
                that moment, not a live calculation. New orders use the new rate immediately.
              </p>
            </Panel>

            {/* -------------------------------------------------- online payment */}
            <Panel
              title="Online payment"
              meta={gatewayConfigured ? 'Gateway keys present' : 'No gateway keys'}
              bodyClassName="px-4 py-4 sm:px-5"
            >
              <p className="m-0 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                Let guests pay by card or UPI from their own order page. Money goes to your
                payment-gateway account, and the order is marked paid as soon as the gateway confirms
                it.
              </p>

              {/* Shown whenever the keys are missing, not only when the box is
                  already ticked. The switch is a database flag; the keys are an
                  environment fact. */}
              {!gatewayConfigured && (
                <p className="mt-3 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-2.5 text-[11.5px] leading-[1.5] text-gink-64">
                  <strong className="font-semibold text-gink">No gateway keys on this deployment.</strong>{' '}
                  This switch is disabled because there is nothing behind it: the server has no
                  payment-gateway key pair, so no pay button can appear for a guest. Ask whoever
                  deploys AutoDine to add the keys, then come back.
                </p>
              )}

              {!data?.onlinePaymentsEnabled && gatewayConfigured && (
                <p className="mt-3 rounded-[10px] border border-hair bg-paper-deep px-3.5 py-2.5 text-[11.5px] leading-[1.5] text-gink-64">
                  <strong className="font-semibold text-gink">Off.</strong> This server has gateway
                  keys, but guests still see &quot;pay at the counter&quot;. Tick the box and save to
                  change that.
                </p>
              )}

              <form action={saveOnlinePaymentsAction} className="mt-3 flex flex-col gap-3">
                <label className="flex items-start gap-2.5 rounded-[10px] border border-hair bg-paper-deep px-3 py-2.5">
                  <input
                    type="checkbox"
                    disabled={disabled || !gatewayConfigured}
                    name="onlinePayments"
                    defaultChecked={Boolean(data?.onlinePaymentsEnabled)}
                    className="mt-[2px] size-4 shrink-0 accent-[var(--p-accent)]"
                  />
                  <span className="text-[11.5px] leading-[1.5] text-gink-64">
                    Take card and UPI payment online. Orders stay unpaid until the gateway confirms the
                    money, so nothing is ever marked paid on the guest&apos;s word.
                  </span>
                </label>

                <div>
                  <SubmitButton
                    pendingLabel="Saving setting…"
                    disabled={disabled || !gatewayConfigured}
                  >
                    Save payment setting
                  </SubmitButton>
                </div>
              </form>

              <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                Turning this off does not touch orders already paid, and does not refund anything.
                Counter payments — cash, card and UPI at the till — keep working either way.
              </p>
            </Panel>

            {/* ------------------------------------------------------ your own UPI */}
            <Panel
              title="Your UPI QR"
              meta={data?.upiId ? 'Shown to guests' : 'Not set'}
              bodyClassName="px-4 py-4 sm:px-5"
            >
              <p className="m-0 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                Your own UPI handle, on the guest&apos;s phone, with the amount already filled in.
                The money goes to your account — AutoDine never holds it and takes no cut.
              </p>

              <p className="mt-3 rounded-[10px] border border-hair bg-paper-deep px-3.5 py-2.5 text-[11.5px] leading-[1.5] text-gink-64">
                <strong className="font-semibold text-gink">This is not a payment gateway.</strong>{' '}
                When a guest scans it, nothing is marked paid here. They say they have paid, and you
                or your cashier confirm the transfer in your own UPI app before recording it at the
                counter. That keeps the record honest — and it is why this works today, with no
                gateway and no KYC.
              </p>

              <form action={saveUpiAction} className="mt-3 grid gap-3">
                <Field
                  label="UPI ID"
                  htmlFor="upiId"
                  hint="The handle printed on your counter standee. Leave it empty to show no QR."
                >
                  <input
                    id="upiId"
                    name="upiId"
                    type="text"
                    inputMode="email"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="thegulmohar@okhdfcbank"
                    defaultValue={data?.upiId ?? ''}
                    disabled={disabled}
                    className={inputClass}
                  />
                </Field>

                <Field
                  label="Name shown in the guest's UPI app"
                  htmlFor="upiPayeeName"
                  hint="Optional. Defaults to your restaurant name above."
                >
                  <input
                    id="upiPayeeName"
                    name="upiPayeeName"
                    type="text"
                    defaultValue={data?.upiPayeeName ?? ''}
                    disabled={disabled}
                    className={inputClass}
                  />
                </Field>

                <div>
                  <SubmitButton pendingLabel="Saving UPI…" disabled={disabled}>
                    Save UPI details
                  </SubmitButton>
                </div>
              </form>

              <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                Test it before a service: open your guest menu on a phone, place an order, and scan
                the code with your own UPI app. If the payee name is wrong, guests will not trust it.
              </p>
            </Panel>

            {/* --------------------------------------------------------- outlets */}
            <Panel
              title="Outlets"
              meta={live ? `${data?.outlets?.length ?? 0} on this account` : 'none'}
              bodyClassName="px-4 py-4 sm:px-5"
            >
              <p className="m-0 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                Every outlet has its own menu, tables, QR codes, orders and bills. Whatever is open here
                is what the rest of the dashboard shows.
              </p>

              {!live && (
                <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                  The database is not connected, so there are no outlets to list and none can be added.
                  The sample restaurant elsewhere in this preview is a single outlet.
                </p>
              )}

              {live && (
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
              )}

              {live && data?.role === 'owner' && (
                <form className="mt-3 flex flex-col gap-2.5" method="post" action="/dashboard/outlet/new">
                  <Field
                    label="Add another outlet"
                    htmlFor="new-outlet-name"
                    hint="Up to five per account. A new outlet starts empty, with its own web address and a 0% tax rate to set."
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
                    <SubmitButton tone="ghost" pendingLabel="Creating…">
                      Create outlet
                    </SubmitButton>
                  </div>
                </form>
              )}

              {live && data?.role !== 'owner' && (
                <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                  Only an owner can add an outlet. You are signed in as {data?.role ?? 'staff'}.
                </p>
              )}
            </Panel>
          </div>

          {/* ------------------------------------------------------------- aside */}
          <aside className="flex min-w-0 flex-col gap-4">
            <Card className="px-4 py-4">
              <div className="text-[10.5px] font-semibold tracking-[0.1em] text-gink-46 uppercase">
                Public menu QR
              </div>

              {data?.publicMenuSvg ? (
                <div className="mt-3 flex justify-center rounded-[10px] border border-hair bg-white p-3">
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
                <p className="mt-3 text-[12.5px] leading-[1.5] text-gink-46">
                  {live
                    ? 'The code could not be drawn for this address. The link below still works.'
                    : 'No code: there is no restaurant to encode until the database is connected.'}
                </p>
              )}

              {data?.publicMenuUrl && (
                <div className="mt-3 flex items-center gap-1.5">
                  <a
                    id="settings-menu-url"
                    href={data.publicMenuUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate rounded-[8px] border border-hair bg-paper-deep px-2.5 py-1.5 text-[11.5px] text-gink underline decoration-hair-strong underline-offset-2 hover:decoration-gink"
                  >
                    {data.publicMenuUrl}
                  </a>
                  <CopyButton
                    value={data.publicMenuUrl}
                    selectId="settings-menu-url"
                    className={btn('ghost', 'sm')}
                  />
                </div>
              )}

              <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                This is the menu, not a table. It opens for anyone, with no table attached, so it works
                for takeaway and for sharing. Table cards — the ones that pin an order to a table — are
                in{' '}
                <Link
                  href="/dashboard/tables"
                  className="font-medium text-gink underline decoration-hair-strong underline-offset-2"
                >
                  Tables &amp; QR
                </Link>
                .
              </p>

              {noPublishedMenu && (
                <p className="mt-3 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3 py-2.5 text-[11.5px] leading-[1.5] text-gink-64">
                  {(data?.totalMenus ?? 0) === 0 ? (
                    <>
                      <strong className="font-semibold text-gink">Nothing to show yet.</strong> You
                      have no menus at all, so a guest scanning this lands on an empty page. Add dishes
                      first, then publish the menu.
                    </>
                  ) : (
                    <>
                      <strong className="font-semibold text-gink">Nothing to show yet.</strong> None
                      of your {data?.totalMenus} menus is published, so a guest scanning this lands on
                      an empty page. Publish one menu and this code starts working.
                    </>
                  )}
                </p>
              )}

              {live && data?.publicMenuSvg && (
                <div className="mt-3">
                  <PrintButton className={btn('ghost', 'sm')}>Print menu card</PrintButton>
                </div>
              )}
            </Card>

            <Card className="bg-paper-deep px-4 py-4">
              <div className="text-[10.5px] font-semibold tracking-[0.1em] text-gink-46 uppercase">
                Where these appear
              </div>
              <ul className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0">
                {[
                  'Name and tagline: the top of the guest menu, and the browser tab title.',
                  'Tax rate: the cart, the checkout total and every order placed from now on.',
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
                Fixed at signup, because it decides which day a sale belongs to in Reports; changing it
                mid-day would move yesterday&apos;s money into today.
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
