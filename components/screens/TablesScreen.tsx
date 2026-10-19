import Link from 'next/link';
import { tables, restaurant } from '@/lib/demo-data';
import { QrChip } from '@/components/ui';

const STATUS_TONE: Record<string, string> = {
  active: 'is-active',
  printed: 'is-printed',
  revoked: 'is-revoked',
  disabled: 'is-disabled',
};

/** Shared page structure; styled by the locked design system. */
export function TablesScreen() {
  return (
    <div className="pg pg--dash">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">AutoDine</Link>
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
        <header className="pg__head pg__head--row">
          <div>
            <div className="pg__kicker">Tables &amp; QR</div>
            <h1 className="pg__title">12 tables · {restaurant.name}</h1>
          </div>
          <div className="pg__headActions">
            <span className="pg__btn">Print QR sheet</span>
            <span className="pg__btn pg__btn--solid">Add table</span>
          </div>
        </header>

        <div className="pg__note pg__note--info">
          <strong>How on-site verification works:</strong> each table&apos;s QR resolves to that restaurant and
          table, then the server checks a short-lived on-site code, expiry, revocation and ordering rules before
          a menu is shown. A static QR alone cannot prove a guest is in the room, and GPS is unreliable indoors
          — this reduces remote ordering abuse substantially, but no method prevents it absolutely. The exact
          code lifetime and recovery flow will be designed and shown to you before implementation.
        </div>

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
                <QrChip value={`${restaurant.name}-${t.code}`} size={72} />
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
              <div className="pg__tableBtns">
                <span className="pg__miniBtn">Preview</span>
                <span className="pg__miniBtn">Regenerate</span>
                <span className="pg__miniBtn">{t.qr === 'disabled' ? 'Enable' : 'Disable'}</span>
                <span className="pg__miniBtn pg__miniBtn--danger">Revoke</span>
              </div>
            </article>
          ))}
        </section>

        <section className="pg__printRow">
          <div className="pg__printSheet">
            <div className="pg__printHead">Print sheet — 6 per A4 page</div>
            <div className="pg__printGrid">
              {tables.slice(0, 6).map((t) => (
                <div key={t.code} className="pg__printCard">
                  <QrChip value={`print-${t.code}`} size={64} />
                  <div className="pg__printCode">{t.code}</div>
                  <div className="pg__printName">{restaurant.name}</div>
                  <div className="pg__printHint">Scan to view menu &amp; order</div>
                </div>
              ))}
            </div>
          </div>

          <aside className="pg__printAside">
            <h3 className="pg__h3">Rotating codes</h3>
            <p className="pg__p">
              On top of the printed table code, the ordering session carries a short-lived on-site code that the
              server validates. Proposed behaviour, pending your approval:
            </p>
            <ul className="pg__bullets">
              <li>Code lifetime measured in minutes, refreshed while the guest is on the page.</li>
              <li>Expired or revoked codes show a clear message with a recovery path — never a silent bypass.</li>
              <li>Regenerating a table code invalidates the previous one immediately.</li>
              <li>Ordering can be disabled per table without touching the menu.</li>
              <li>No signing keys or admin tokens appear in the QR URL.</li>
            </ul>
            <div className="pg__note pg__note--warn">
              Honest limitation: a guest in the restaurant could still photograph a live code and share it. This
              design narrows that window; it does not eliminate it.
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
