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
  SectionHead,
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
 *     warning, tax example, missing gateway keys, "off", the UPI caveat, the
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
 *   - One save button per form, all the solid ink button at the same size, so
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
  { id: 'settings-qr', label: 'Menu QR' },
] as const;

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
            restaurant&apos;s name, address, tax rate and web address are changed by the owner or a
            manager. You can see them here so the tax on a bill is never a mystery.
          </Notice>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_318px] lg:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            {/* -------------------------------------------------- what guests see */}
            <div>
              <SectionHead
                title={<span id="settings-details">What guests see</span>}
                meta="Name, address and the link that opens your menu"
              />

              <Panel
                title="Restaurant details"
                meta="Name, address and what the bill carries"
                bodyClassName="px-5 py-5"
              >
                <p className="m-0 mb-4 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                  The name and tagline are the first two things a guest reads on the menu.
                </p>

                <form action={saveDetailsAction} className="flex flex-col gap-3.5">
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

                  <div>
                    <SubmitButton pendingLabel="Saving details…" disabled={disabled} tone="solid">
                      Save details
                    </SubmitButton>
                  </div>
                </form>
              </Panel>
            </div>

            {/* -------------------------------------------- what the bill charges */}
            <div>
              <SectionHead
                title={<span id="settings-money">What the bill charges</span>}
                meta="Tax, online payment and your own UPI code"
              />

              <div className="flex flex-col gap-4">
                <Panel
                  title="Tax"
                  meta={taxBps === 0 ? '0% — nothing added' : `${formatTaxPercent(taxBps)}%`}
                  bodyClassName="px-5 py-5"
                >
                  <p className="m-0 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                    The rate the bill adds on top of the menu prices. Set what your accountant told
                    you — this screen does not guess a rate.
                  </p>

                  {taxBps === 0 ? (
                    <Notice tone="due" label="Tax is 0%." className="mt-3 mb-0">
                      Every bill right now charges the menu price with no tax. If you are registered
                      for GST, set the rate here before service.
                    </Notice>
                  ) : (
                    <Notice tone="plain" label="Example" className="mt-3 mb-0">
                      A dish priced {inr(100)} currently bills {inr(paiseToRupees(example.totalPaise))}{' '}
                      — {inr(100)} plus {inr(paiseToRupees(example.taxPaise))} tax.
                    </Notice>
                  )}

                  <form action={saveTaxAction} className="mt-3.5 flex flex-col gap-3">
                    <Field
                      label="Tax rate (%)"
                      htmlFor="settings-tax"
                      hint={`Up to two decimals, 0 to ${formatTaxPercent(3000)}. Menu prices are treated as tax-exclusive, so tax is added at checkout.`}
                    >
                      {/* `w-[180px]!` and not `w-[180px]`: the kit input is
                          `w-full`, and Tailwind sorts `.w-[180px]` BEFORE
                          `.w-full` in the stylesheet, so appending it silently
                          does nothing. The `!` suffix is the explicit
                          override. See the kit note in owner/chrome.tsx. */}
                      <input
                        id="settings-tax"
                        className={`${inputClass} w-[180px]! tabular-nums`}
                        name="taxRate"
                        type="text"
                        inputMode="decimal"
                        defaultValue={formatTaxPercent(taxBps)}
                        disabled={disabled}
                        required
                      />
                    </Field>

                    <div>
                      <SubmitButton pendingLabel="Saving rate…" disabled={disabled} tone="solid">
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

                {/* --------------------------------------------- online payment */}
                <Panel
                  title="Online payment"
                  meta={gatewayConfigured ? 'Gateway keys present' : 'No gateway keys'}
                  bodyClassName="px-5 py-5"
                >
                  <p className="m-0 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                    Let guests pay by card or UPI from their own order page. Money goes to your
                    payment-gateway account, and the order is marked paid as soon as the gateway
                    confirms it.
                  </p>

                  {/* Shown whenever the keys are missing, not only when the box is
                      already ticked. The switch is a database flag; the keys are
                      an environment fact. */}
                  {!gatewayConfigured ? (
                    <Notice
                      tone="due"
                      label="No gateway keys on this deployment."
                      className="mt-3 mb-0"
                    >
                      This switch is disabled because there is nothing behind it: the server has no
                      payment-gateway key pair, so no pay button can appear for a guest. Ask
                      whoever deploys AutoDine to add the keys, then come back.
                    </Notice>
                  ) : null}

                  {!data?.onlinePaymentsEnabled && gatewayConfigured ? (
                    <Notice tone="plain" label="Off." className="mt-3 mb-0">
                      This server has gateway keys, but guests still see &quot;pay at the
                      counter&quot;. Tick the box and save to change that.
                    </Notice>
                  ) : null}

                  <form action={saveOnlinePaymentsAction} className="mt-3.5 flex flex-col gap-3">
                    <label className="flex items-start gap-2.5 rounded-[var(--p-r-control)] border border-hair bg-paper-deep px-3 py-2.5">
                      <input
                        type="checkbox"
                        disabled={disabled || !gatewayConfigured}
                        name="onlinePayments"
                        defaultChecked={Boolean(data?.onlinePaymentsEnabled)}
                        className="mt-[2px] size-4 shrink-0 accent-[var(--p-accent)]"
                      />
                      <span className="text-[11.5px] leading-[1.5] text-gink-64">
                        Take card and UPI payment online. Orders stay unpaid until the gateway
                        confirms the money, so nothing is ever marked paid on the guest&apos;s word.
                      </span>
                    </label>

                    <div>
                      <SubmitButton
                        tone="solid"
                        pendingLabel="Saving setting…"
                        disabled={disabled || !gatewayConfigured}
                      >
                        Save payment setting
                      </SubmitButton>
                    </div>
                  </form>

                  <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                    Turning this off does not touch orders already paid, and does not refund
                    anything. Counter payments — cash, card and UPI at the till — keep working
                    either way.
                  </p>
                </Panel>

                {/* ------------------------------------------------- your own UPI */}
                <Panel
                  title="Your UPI QR"
                  meta={data?.upiId ? 'Shown to guests' : 'Not set'}
                  bodyClassName="px-5 py-5"
                >
                  <p className="m-0 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                    Your own UPI handle, on the guest&apos;s phone, with the amount already filled
                    in. The money goes to your account — AutoDine never holds it and takes no cut.
                  </p>

                  <Notice
                    tone="accent"
                    label="This is not a payment gateway."
                    className="mt-3 mb-0"
                  >
                    When a guest scans it, nothing is marked paid here. They say they have paid, and
                    you or your cashier confirm the transfer in your own UPI app before recording it
                    at the counter. That keeps the record honest — and it is why this works today,
                    with no gateway and no KYC.
                  </Notice>

                  <form action={saveUpiAction} className="mt-3.5 grid gap-3">
                    <div className="grid gap-3.5 sm:grid-cols-2">
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
                    </div>

                    <div>
                      <SubmitButton tone="solid" pendingLabel="Saving UPI…" disabled={disabled}>
                        Save UPI details
                      </SubmitButton>
                    </div>
                  </form>

                  <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                    Test it before a service: open your guest menu on a phone, place an order, and
                    scan the code with your own UPI app. If the payee name is wrong, guests will not
                    trust it.
                  </p>
                </Panel>
              </div>
            </div>

            {/* ------------------------------------------------------------ account */}
            <div>
              <SectionHead
                title={<span id="settings-outlets">Account</span>}
                meta="Every outlet carries its own menu, tables and money"
              />

              <Panel
                title="Outlets"
                meta={live ? `${data?.outlets?.length ?? 0} on this account` : 'none'}
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

                {live && data?.role === 'owner' ? (
                  <form
                    className="mt-3 flex flex-col gap-2.5"
                    method="post"
                    action="/dashboard/outlet/new"
                  >
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
            </div>
          </div>

          {/* ------------------------------------------------------------- aside */}
          <aside className="flex min-w-0 flex-col gap-4">
            {/* The page is five forms tall. This is the only thing on it that
                says where you are -- and it is four real anchors, not a menu
                that scrolls for you, so it still works with no JavaScript. */}
            <Panel title="On this page" meta={`${SECTIONS.length} sections`} bodyClassName="px-2 py-2">
              <nav aria-label="Sections on this page">
                <ul className="m-0 flex list-none flex-col p-0">
                  {SECTIONS.map((section) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="flex items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 text-[12.5px] text-gink-64 transition-colors hover:bg-gink-07 hover:text-gink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]"
                      >
                        {section.label}
                        <span aria-hidden="true" className="text-gink-28">
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
                <div className="mt-3">
                  <PrintButton className={btn('ghost', 'sm')}>Print menu card</PrintButton>
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
