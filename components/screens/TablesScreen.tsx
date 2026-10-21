import Link from 'next/link';
import { tables as demoTables, restaurant as demoRestaurant } from '@/lib/demo-data';
import { TableQr } from '@/components/TableQr';
import { PrintButton } from '@/components/PrintButton';
import type { TablesScreenData, TableRow } from '@/lib/db/tables-screen';
import { addTableAction, revokeQrAction, rotateQrAction, setTableActiveAction } from '@/app/dashboard/tables/actions';
import { SignInPrompt } from '@/components/SignInPrompt';

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
  error,
  notice,
}: {
  data?: TablesScreenData | null;
  error?: string;
  notice?: string;
}) {
  const restaurantName = data?.restaurantName ?? demoRestaurant.name;
  // Blocked callers get an empty list, not the demo floor plan: twelve
  // fictional tables read as a real restaurant that happens to be quiet.
  const tables: TableRow[] = data?.tables ?? (data?.blocked ? [] : demoTables);
  const live = Boolean(data);

  return (
    <div className="pg pg--dash">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">
          AutoDine
        </Link>
        <div className="pg__barLinks">
          <Link href="/dashboard">Overview</Link>
          <Link href="/dashboard/menus">Menus</Link>
          <Link href="/dashboard/tables" className="is-active">
            Tables &amp; QR
          </Link>
          <span>Orders</span>
          <span>Reports</span>
        </div>
        <div className="pg__barRight">
          <span className="pg__avatar">AP</span>
        </div>
      </div>

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

        <div className="pg__note pg__note--info">
          <strong>How a scan works:</strong> the card on the table carries an unguessable token, not a link to
          the restaurant. Scanning exchanges it for a session that is bound to that one table and expires in
          under an hour, so an order placed from it is stamped with the table it was placed at. Each restaurant
          gets its own codes — one restaurant&apos;s card will not scan into another.
        </div>

        <div className="pg__note pg__note--warn">
          <strong>Honest limitation:</strong> a guest in the room can photograph a live card and send the
          picture to someone outside, who can then order to that table. No printed code can prevent this —
          the code has to be readable by whoever is sitting there. What is prevented is the worse case: a
          shareable link anyone could edit or reuse from anywhere, forever. Revoking a code here takes it out
          of service immediately and ends any session created from it.
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
                  <Link href="/menu" className="pg__miniBtn">
                    Preview
                  </Link>
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
                  <div className="pg__printHint">Scan to view menu &amp; order</div>
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
              <li>A scan creates a session that expires in under an hour; the card keeps working.</li>
              <li>An expired or revoked code shows a clear message with a recovery path, never a silent bypass.</li>
              <li>
                Regenerating a table code invalidates the previous one immediately, and ends any session created
                from it.
              </li>
              <li>Ordering can be disabled per table without touching the menu.</li>
              <li>No signing keys or admin tokens appear in the QR URL.</li>
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
