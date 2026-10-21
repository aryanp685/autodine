import Link from 'next/link';
import { DashboardBar } from '@/components/DashboardBar';
import { SignInPrompt } from '@/components/SignInPrompt';
import { PrintButton } from '@/components/PrintButton';
import type { OutletBar } from '@/lib/outlets';
import type { SettingsScreenData } from '@/lib/db/settings-screen';
import { formatTaxPercent, taxExamplePaise } from '@/lib/settings-input';
import { saveDetailsAction, saveOnlinePaymentsAction, saveTaxAction } from '@/app/dashboard/settings/actions';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';

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
      <div className="pg pg--dash">
        <DashboardBar active="settings" outlet={outlet} />
        <div className="pg__body">
          <SignInPrompt reason={data.blocked} screen="settings screen" />
        </div>
      </div>
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
    <div className="pg pg--dash">
      <DashboardBar active="settings" outlet={outlet} />

      <div className="pg__body">
        {error && (
          <div className="pg__alert" role="alert">
            <strong>Nothing was saved.</strong>
            <p>{error}</p>
          </div>
        )}
        {notice && (
          <div className="pg__success" role="status">
            <strong>Saved.</strong>
            <p>{notice}</p>
          </div>
        )}

        <header className="pg__head">
          <div className="pg__kicker">Settings</div>
          <h1 className="pg__title">{details.name || 'Your restaurant'}</h1>
          <p className="pg__lede">
            What guests see, what the bill charges, and the code that opens your menu. Changes take effect
            immediately — the guest menu reads these the next time somebody scans.
          </p>
        </header>

        {!live && (
          <div className="pg__note pg__note--warn">
            <strong>The database is not connected.</strong> These fields are empty because there is no
            restaurant to read, and they cannot be saved. Nothing here is sample data — that is the point.
          </div>
        )}

        {live && !canEdit && (
          <div className="pg__note pg__note--info">
            <strong>Read-only for your role.</strong> You are signed in as{' '}
            <strong>{data?.role ?? 'staff'}</strong>. Your restaurant&apos;s name, address, tax rate and web
            address are changed by the owner or a manager. You can see them here so the tax on a bill is
            never a mystery.
          </div>
        )}

        <div className="pg__body--split">
          <div className="pg__settingsCol">
            <section className="pg__formCard">
              <h2 className="pg__h2">Restaurant details</h2>
              <p className="pg__p">
                The name and tagline are the first two things a guest reads on the menu.
              </p>

              <form action={saveDetailsAction} className="pg__form">
                <label className="ui-field">
                  <span className="ui-label">Restaurant name</span>
                  <input
                    className="ui-input"
                    name="name"
                    type="text"
                    defaultValue={details.name}
                    maxLength={80}
                    required
                    disabled={disabled}
                    autoComplete="organization"
                  />
                </label>

                <label className="ui-field">
                  <span className="ui-label">Tagline</span>
                  <input
                    className="ui-input"
                    name="tagline"
                    type="text"
                    defaultValue={details.tagline}
                    maxLength={120}
                    disabled={disabled}
                    placeholder="Bombay street food, made fresh"
                  />
                  <span className="ui-hint">Shown under your name on the guest menu. Optional.</span>
                </label>

                <label className="ui-field">
                  <span className="ui-label">Address</span>
                  <input
                    className="ui-input"
                    name="address"
                    type="text"
                    defaultValue={details.address}
                    maxLength={200}
                    disabled={disabled}
                    autoComplete="street-address"
                  />
                  <span className="ui-hint">
                    Stored for the bill and the printed QR sheet. Bill printing is not built yet, so nothing
                    prints this today.
                  </span>
                </label>

                <div className="pg__fieldRow">
                  <label className="ui-field">
                    <span className="ui-label">Phone</span>
                    <input
                      className="ui-input"
                      name="phone"
                      type="tel"
                      defaultValue={details.phone}
                      maxLength={24}
                      disabled={disabled}
                      autoComplete="tel"
                      placeholder="+91 98765 43210"
                    />
                  </label>

                  <label className="ui-field">
                    <span className="ui-label">GSTIN</span>
                    <input
                      className="ui-input"
                      name="gstin"
                      type="text"
                      defaultValue={details.gstin}
                      maxLength={15}
                      disabled={disabled}
                      autoCapitalize="characters"
                      placeholder="22AAAAA0000A1Z5"
                    />
                  </label>
                </div>
                <span className="ui-hint">
                  Leave the GSTIN blank if you are not registered. It is checked for the 15-character GST
                  format here rather than discovered on a filed invoice.
                </span>

                <label className="ui-field">
                  <span className="ui-label">Public web address</span>
                  <input
                    className="ui-input"
                    name="slug"
                    type="text"
                    defaultValue={details.slug}
                    maxLength={48}
                    disabled={disabled}
                    spellCheck={false}
                  />
                  <span className="ui-hint">
                    /menu?s={details.slug || 'your-address'} — the one link that names your restaurant.
                  </span>
                </label>

                {canEdit && (
                  <label className="ui-check">
                    <input type="checkbox" name="slugConfirm" />
                    <span>
                      I changed the web address and understand that existing links, bookmarks and printed
                      standees with the old one stop working.
                    </span>
                  </label>
                )}

                <button type="submit" className="pg__submit" disabled={disabled}>
                  Save details
                </button>
              </form>
            </section>

            <section className="pg__formCard">
              <h2 className="pg__h2">Tax</h2>
              <p className="pg__p">
                The rate the bill adds on top of the menu prices. Set what your accountant told you — this
                screen does not guess a rate.
              </p>

              {taxBps === 0 ? (
                <div className="pg__note pg__note--warn">
                  <strong>Tax is 0%.</strong> Every bill right now charges the menu price with no tax. If you
                  are registered for GST, set the rate here before service.
                </div>
              ) : (
                <p className="pg__note">
                  A dish priced {inr(100)} currently bills {inr(paiseToRupees(example.totalPaise))} —{' '}
                  {inr(100)} plus {inr(paiseToRupees(example.taxPaise))} tax.
                </p>
              )}

              <form action={saveTaxAction} className="pg__form">
                <label className="ui-field">
                  <span className="ui-label">Tax rate (%)</span>
                  <input
                    className="ui-input tnum"
                    name="taxRate"
                    type="text"
                    inputMode="decimal"
                    defaultValue={formatTaxPercent(taxBps)}
                    disabled={disabled}
                    required
                  />
                  <span className="ui-hint">
                    Up to two decimals, 0 to {formatTaxPercent(3000)}. Menu prices are treated as
                    tax-exclusive, so tax is added at checkout.
                  </span>
                </label>

                <button type="submit" className="pg__submit" disabled={disabled}>
                  Save tax rate
                </button>
              </form>

              <p className="pg__fine">
                Orders already placed keep the tax they were charged — a bill is a record of the rate at that
                moment, not a live calculation. New orders use the new rate immediately.
              </p>
            </section>

            <section className="pg__formCard">
              <h2 className="pg__h2">Online payment</h2>
              <p className="pg__p">
                Let guests pay by card or UPI from their own order page. Money goes to your payment-gateway
                account, and the order is marked paid as soon as the gateway confirms it.
              </p>

              {data?.onlinePaymentsEnabled && !gatewayConfigured && (
                <div className="pg__note pg__note--warn">
                  <strong>Switched on, but this deployment has no gateway keys.</strong> Guests will not see a
                  pay button — they will be told to pay at the counter. Nothing is broken; the key is simply not
                  configured on this server.
                </div>
              )}

              {!data?.onlinePaymentsEnabled && gatewayConfigured && (
                <div className="pg__note pg__note--info">
                  <strong>Off.</strong> This server has gateway keys, but guests still see &quot;pay at the
                  counter&quot;. Tick the box and save to change that.
                </div>
              )}

              <form action={saveOnlinePaymentsAction} className="pg__form">
                <label className="ui-check">
                  <input
                    type="checkbox"
                    name="onlinePayments"
                    defaultChecked={Boolean(data?.onlinePaymentsEnabled)}
                    disabled={disabled}
                  />
                  <span>
                    Take card and UPI payment online. Orders stay unpaid until the gateway confirms the money,
                    so nothing is ever marked paid on the guest&apos;s word.
                  </span>
                </label>

                <button type="submit" className="pg__submit" disabled={disabled}>
                  Save payment setting
                </button>
              </form>

              <p className="pg__fine">
                Turning this off does not touch orders already paid, and does not refund anything. Counter
                payments — cash, card and UPI at the till — keep working either way.
              </p>
            </section>

            <section className="pg__formCard">
              <h2 className="pg__h2">Outlets</h2>
              <p className="pg__p">
                Every outlet has its own menu, tables, QR codes, orders and bills. Whatever is open here is what
                the rest of the dashboard shows.
              </p>

              {live && (
                <ul className="pg__bullets">
                  {(data?.outlets ?? []).map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.name}</strong> — {entry.role}
                      {entry.id === data?.activeOutletId ? ' · open now' : ''}
                    </li>
                  ))}
                </ul>
              )}

              {live && data?.role === 'owner' && (
                <form className="pg__form" method="post" action="/dashboard/outlet/new">
                  <label className="ui-field">
                    <span className="ui-label">Add another outlet</span>
                    <input
                      className="ui-input"
                      name="name"
                      placeholder="Maddi — Baner"
                      minLength={2}
                      maxLength={80}
                      required
                    />
                    <span className="ui-hint">
                      Up to five per account. A new outlet starts empty, with its own web address and a 0% tax rate
                      to set.
                    </span>
                  </label>
                  <button className="pg__submit" type="submit">
                    Create outlet
                  </button>
                </form>
              )}

              {live && data?.role !== 'owner' && (
                <p className="pg__fine">
                  Only an owner can add an outlet. You are signed in as {data?.role ?? 'staff'}.
                </p>
              )}
            </section>
          </div>

          <aside className="pg__aside pg__settingsAside">
            <div className="pg__asideCard">
              <div className="pg__asideHead">Public menu QR</div>

              {data?.publicMenuSvg ? (
                <div className="pg__tableQr">
                  {/* Generated on the server by lib/qr.ts from a URL we build.
                      There is no path from anything a restaurant types to this
                      string, so it is injected rather than parsed. */}
                  <span
                    className="qr-svg"
                    style={{ width: 176, height: 176 }}
                    dangerouslySetInnerHTML={{ __html: data.publicMenuSvg }}
                  />
                </div>
              ) : (
                <p className="pg__p">
                  {live
                    ? 'The code could not be drawn for this address. The link below still works.'
                    : 'No code: there is no restaurant to encode until the database is connected.'}
                </p>
              )}

              {data?.publicMenuUrl && <p className="pg__settingsUrl">{data.publicMenuUrl}</p>}

              <p className="pg__fine">
                This is the menu, not a table. It opens for anyone, with no table attached, so it works for
                takeaway and for sharing. Table cards — the ones that pin an order to a table — are in{' '}
                <Link href="/dashboard/tables">Tables &amp; QR</Link>.
              </p>

              {noPublishedMenu && (
                <div className="pg__note pg__note--warn">
                  <strong>Nothing to show yet.</strong> None of your {data?.totalMenus ?? 0} menus is
                  published, so a guest scanning this lands on an empty page. Publish a menu first.
                </div>
              )}

              {live && data?.publicMenuSvg && (
                <div className="pg__rowEnd">
                  <PrintButton className="pg__btn">Print menu card</PrintButton>
                </div>
              )}
            </div>

            <div className="pg__asideCard pg__asideCard--quiet">
              <div className="pg__asideHead">Where these appear</div>
              <ul className="pg__bullets">
                <li>Name and tagline: the top of the guest menu, and the browser tab title.</li>
                <li>Tax rate: the cart, the checkout total and every order placed from now on.</li>
                <li>Web address: the QR above and every link to your menu.</li>
                <li>Address, phone and GSTIN: stored for invoices and receipts — bill printing is not built yet.</li>
              </ul>
              <p className="pg__fine">
                Timezone: <strong>{data?.timezone ?? 'Asia/Kolkata'}</strong>. Fixed at signup, because it
                decides which day a sale belongs to in Reports; changing it mid-day would move yesterday&apos;s
                money into today.
              </p>
            </div>
          </aside>
        </div>

        {/* Printed by the Print menu card button. The @media print block hides
            the forms and the aside, and leaves only this card. */}
        <div className="pg__printRow">
          <div className="pg__printSheet">
            <div className="pg__printHead">Menu card</div>
            <div className="pg__printGrid pg__printGrid--single">
              <div className="pg__printCard">
                {data?.publicMenuSvg ? (
                  <span
                    className="qr-svg"
                    style={{ width: 160, height: 160 }}
                    dangerouslySetInnerHTML={{ __html: data.publicMenuSvg }}
                  />
                ) : null}
                <div className="pg__printName">{details.name || 'Your restaurant'}</div>
                <div className="pg__printHint">Scan for the menu</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
