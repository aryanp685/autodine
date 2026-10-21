import { DashboardBar } from '@/components/DashboardBar';
import type { OutletBar } from '@/lib/outlets';
import { tables as demoTables, restaurant as demoRestaurant } from '@/lib/demo-data';
import { TableQr } from '@/components/TableQr';
import { PrintButton } from '@/components/PrintButton';
import type { TablesScreenData, TableRow } from '@/lib/db/tables-screen';
import {
  addTableAction,
  revokeQrAction,
  rotateQrAction,
  rotateVerificationCodeAction,
  setTableActiveAction,
} from '@/app/dashboard/tables/actions';
import { SignInPrompt } from '@/components/SignInPrompt';
import { VerificationCodeRefresh } from '@/components/VerificationCodeRefresh';

const STATUS_TONE: Record<string, string> = {
  active: 'is-active',
  printed: 'is-printed',
  revoked: 'is-revoked',
  disabled: 'is-disabled',
};

/**
 * Shared page structure; styled by the locked design system.
 *
 * `data` is the live floor plan when the database is configured. When it is
 * absent the screen falls back to its demo rows, exactly as before, so the
 * locked markup and its sample content stay byte-for-byte identical.
 */
export function TablesScreen({
  data,
  outlet,
  error,
  notice,
}: {
  data?: TablesScreenData | null;
  /** Which outlet is open, for the switcher in the bar. */
  outlet?: OutletBar | null;
  error?: string;
  notice?: string;
}) {
  const restaurantName = data?.restaurantName ?? demoRestaurant.name;
  // Blocked callers get an empty list, not the demo floor plan: twelve
  // fictional tables read as a real restaurant that happens to be quiet.
  const tables: TableRow[] = data?.tables ?? (data?.blocked ? [] : demoTables);
  const live = Boolean(data);

  // How often the on-site code rolls, in words, read from the row rather than
  // written into the copy: if a restaurant widens its window the sentence has
  // to change with it, or staff will tell guests the wrong thing.
  const codeMinutes = data?.verification
    ? Math.max(1, Math.round(data.verification.windowSeconds / 60))
    : 10;
  const minutes = `${codeMinutes} ${codeMinutes === 1 ? 'minute' : 'minutes'}`;

  return (
    <div className="pg pg--dash">
      <DashboardBar active="tables" outlet={outlet} />

      <div className="pg__body">
        {data?.blocked && (
          <SignInPrompt reason={data.blocked} screen="tables and QR screen" />
        )}
        {error && (
          <div className="pg__alert" role="alert">
            <strong>Could not update tables.</strong>
            <p>{error}</p>
          </div>
        )}
        {notice && (
          <div className="pg__success" role="status">
            <strong>Done.</strong>
            <p>{notice}</p>
          </div>
        )}

        <header className="pg__head pg__head--row">
          <div>
            <div className="pg__kicker">Tables &amp; QR</div>
            <h1 className="pg__title">
              {tables.length} tables · {restaurantName}
            </h1>
          </div>
          <div className="pg__headActions">
            <PrintButton className="pg__btn">Print QR sheet</PrintButton>
            <form action={addTableAction} className="pg__headActions">
              <label className="ui-field ui-field--inline">
                <span className="ui-label ui-label--sr">Seats</span>
                <select className="ui-select" name="seats" defaultValue="4" disabled={!live}>
                  {[2, 4, 6, 8, 10].map((n) => (
                    <option key={n} value={n}>
                      {n} seats
                    </option>
                  ))}
                </select>
              </label>
              {/* Without a database this submit can only fail, so it does not
                  render as live. The warning above explains why. */}
              <button type="submit" className="pg__btn pg__btn--solid" disabled={!live}>
                Add table
              </button>
            </form>
          </div>
        </header>

        {data?.verification ? (
          <section className="pg__verifyPanel">
            <div className="pg__verifyCopy">
              <div className="pg__kicker">On-site code</div>
              <p>
                Guests type these six digits after scanning a table&apos;s QR. Put this screen — or a printout of
                it — where guests can see it, and it changes every {minutes} on its own. Nothing to remember,
                nothing to reset.
              </p>
            </div>
            <div className="pg__verifyCode" aria-live="polite">
              {data.verification.code}
            </div>
            <form className="pg__verifyActions">
              <button type="submit" formAction={rotateVerificationCodeAction} className="pg__btn">
                New code now
              </button>
            </form>
            {/* Re-renders this panel when the window the code belongs to ends,
                so a tab left open does not keep showing a dead code. */}
            <VerificationCodeRefresh expiresAt={data.verification.expiresAt} />
          </section>
        ) : null}

        {data?.verificationError ? (
          <div className="pg__alert" role="alert">
            <strong>The on-site code is not available.</strong>
            <p>{data.verificationError}</p>
          </div>
        ) : null}

        <div className="pg__note pg__note--info">
          <strong>How a scan works:</strong> the card on the table carries an unguessable token, not a link to
          the restaurant. Scanning it opens a short form that asks for the six-digit code above, and only then
          is a session created — bound to that one table, and expiring in under an hour, so an order placed from
          it is stamped with the table it was placed at. Each restaurant gets its own cards and its own code: one
          restaurant&apos;s card will not scan into another.
        </div>

        <div className="pg__note pg__note--warn">
          <strong>Honest limitation:</strong> somebody in the room can read the code out to somebody outside on
          the phone. A shared code is a deterrent, not proof of presence — no design that a seated guest has to
          be able to use can be proof. What it does buy is that the leak has to be live and human, that it dies
          within {minutes}, and that the session it produced can be ended by revoking the table&apos;s card
          here. Twenty wrong codes inside one window also replace the code automatically, so guessing is not a
          way through.
        </div>

        {!live && (
          <div className="pg__note pg__note--warn">
            <strong>Sample floor plan.</strong> The database is not connected, so these twelve tables are
            fictional and the buttons below do nothing. Connect Supabase to manage the real floor.
          </div>
        )}

        <section className="pg__tables">
          {tables.map((t) => (
            <article key={t.code} className={`pg__tableCard ${STATUS_TONE[t.qr]}`}>
              <div className="pg__tableTop">
                <div className="pg__tableCode">{t.code}</div>
                <span className={`pg__qrState is-${t.qr}`}>{t.qr}</span>
              </div>
              <div className="pg__tableMeta">
                {t.label} · {t.seats} seats
              </div>
              <div className="pg__tableQr">
                <TableQr svg={t.qrSvg} fallbackValue={`${restaurantName}-${t.code}`} size={72} />
              </div>
              <div className="pg__tableStats">
                <div>
                  <span>Last scan</span>
                  <strong>{t.lastScan}</strong>
                </div>
                <div>
                  <span>Orders today</span>
                  <strong className="tnum">{t.orders}</strong>
                </div>
              </div>

              {live && t.id ? (
                /* One form per card. Every button shares the hidden table id
                   and overrides only the action, so all four are real
                   submissions rather than inert spans. */
                <form className="pg__tableBtns">
                  <input type="hidden" name="tableId" value={t.id} />
                  {/* Preview opens the card's own URL, which is what a guest
                      actually sees: the verification form, not a menu. A link
                      straight to /menu would now land on the gate screen and
                      teach nobody anything. */}
                  <a
                    href={t.scanUrl ?? '/menu'}
                    target="_blank"
                    rel="noreferrer"
                    className="pg__miniBtn"
                  >
                    Preview
                  </a>
                  <button type="submit" formAction={rotateQrAction} className="pg__miniBtn">
                    Regenerate
                  </button>
                  <button
                    type="submit"
                    formAction={setTableActiveAction}
                    name="active"
                    value={t.qr === 'disabled' ? 'true' : 'false'}
                    className="pg__miniBtn"
                  >
                    {t.qr === 'disabled' ? 'Enable' : 'Disable'}
                  </button>
                  <button
                    type="submit"
                    formAction={revokeQrAction}
                    className="pg__miniBtn pg__miniBtn--danger"
                  >
                    Revoke
                  </button>
                </form>
              ) : (
                <div className="pg__tableBtns">
                  <span className="pg__miniBtn">Preview</span>
                  <span className="pg__miniBtn">Regenerate</span>
                  <span className="pg__miniBtn">{t.qr === 'disabled' ? 'Enable' : 'Disable'}</span>
                  <span className="pg__miniBtn pg__miniBtn--danger">Revoke</span>
                </div>
              )}
            </article>
          ))}
        </section>

        <section className="pg__printRow">
          <div className="pg__printSheet">
            <div className="pg__printHead">Print sheet — 6 per A4 page</div>
            <div className="pg__printGrid">
              {tables.slice(0, 6).map((t) => (
                <div key={t.code} className="pg__printCard">
                  <TableQr svg={t.qrSvg} fallbackValue={`print-${t.code}`} size={64} />
                  <div className="pg__printCode">{t.code}</div>
                  <div className="pg__printName">{restaurantName}</div>
                  <div className="pg__printHint">Scan, then enter the code on screen</div>
                </div>
              ))}
            </div>
          </div>

          <aside className="pg__printAside">
            <h3 className="pg__h3">What a card carries</h3>
            <p className="pg__p">
              These are real QR codes. Each encodes a URL containing 256 bits of randomness, bound to one table.
              There is no restaurant name in it to guess at and no expiry on the card itself.
            </p>
            <ul className="pg__bullets">
              <li>Every table is given a code when it is created — a table cannot exist without one.</li>
              <li>
                A card alone is not enough: the guest also types the six-digit code showing inside the
                restaurant, which changes every {minutes}.
              </li>
              <li>A verified scan creates a session that expires in under an hour; the card keeps working.</li>
              <li>An expired or revoked code shows a clear message with a recovery path, never a silent bypass.</li>
              <li>
                Regenerating a table code invalidates the previous one immediately, and ends any session created
                from it.
              </li>
              <li>Ordering can be disabled per table without touching the menu.</li>
              <li>No signing keys or admin tokens appear in the QR URL.</li>
              <li>
                The card does not carry the on-site code: that changes every {minutes}, so printing it would put
                a dead code on every table. Show the code panel above on a screen, or print that panel
                separately.
              </li>
            </ul>
            <div className="pg__note pg__note--warn">
              Print a fresh sheet after regenerating. The old cards look identical and will simply stop working,
              which is the intended behaviour but is not obvious to a guest holding one.
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
