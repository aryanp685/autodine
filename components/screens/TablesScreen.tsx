import Link from 'next/link';
import { tables, restaurant } from '@/lib/demo-data';
import { QrChip } from '@/components/ui';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { PreviewAction } from '@/components/ui/PreviewAction';
import type { AuthorizedWorkspace } from '@/lib/db/workspace-selection';

const STATUS_TONE: Record<string, string> = {
  active: 'is-active',
  printed: 'is-printed',
  revoked: 'is-revoked',
  disabled: 'is-disabled',
};

/** Shared page structure; styled by the locked design system. */
export function TablesScreen({
  workspace,
  workspaces,
}: {
  workspace?: AuthorizedWorkspace;
  workspaces?: AuthorizedWorkspace[];
} = {}) {
  const workspaceQuery = workspace ? `?workspace=${encodeURIComponent(workspace.slug)}` : '';

  return (
    <div className="pg pg--dash">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">AutoDine</Link>
        <div className="pg__barLinks">
          <Link href={`/dashboard${workspaceQuery}`}>Overview</Link>
          <Link href={`/dashboard/menus${workspaceQuery}`}>Menus</Link>
          <Link href={`/dashboard/tables${workspaceQuery}`} className="is-active">
            Tables &amp; QR
          </Link>
          <span>Orders</span>
          <span>Reports</span>
        </div>
        <div className="pg__barRight">
          {workspace && workspaces ? (
            <WorkspaceSwitcher workspaces={workspaces} selectedSlug={workspace.slug} pathname="/dashboard/tables" />
          ) : (
            <span className="pg__avatar">AP</span>
          )}
        </div>
      </div>

      <div className="pg__demoBanner">
        <strong>Demo — not saved.</strong>{' '}
        {workspace
          ? `Workspace access verified for ${workspace.name}; the tables and QR cards below remain fictional.`
          : 'Table cards and QR images below are illustrative; controls do not change database records.'}
      </div>

      <div className="pg__body">
        <header className="pg__head pg__head--row">
          <div>
            <div className="pg__kicker">Tables &amp; QR</div>
            <h1 className="pg__title">{workspace ? `Demo table preview · ${workspace.name}` : `12 demo tables · ${restaurant.name}`}</h1>
          </div>
          <div className="pg__headActions">
            <PreviewAction className="pg__btn" message="Print the sample QR sheet from the browser dialog." print>Print QR sheet</PreviewAction>
            <PreviewAction className="pg__btn pg__btn--solid" message="Tables are demo-only; no table was created.">Add table</PreviewAction>
          </div>
        </header>

        <div className="pg__note pg__note--info">
          <strong>Current status:</strong> this screen and its QR controls are visual demos; the QR images are not live table credentials.
          The guest-order RPC validates a submitted table token, expiry, table/restaurant activity and trial entitlement, but this UI
          does not create, rotate or revoke real tokens. The live database path still needs Supabase verification before restaurant use.
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
                <PreviewAction className="pg__miniBtn" message={`${t.code} is a fictional demo QR; no live code was opened.`}>Preview</PreviewAction>
                <PreviewAction className="pg__miniBtn" message="QR regeneration is not connected; no token changed.">Regenerate</PreviewAction>
                <PreviewAction className="pg__miniBtn" message="Table availability is preview-only and was not changed.">{t.qr === 'disabled' ? 'Enable' : 'Disable'}</PreviewAction>
                <PreviewAction className="pg__miniBtn pg__miniBtn--danger" message="This demo action did not revoke any live table token.">Revoke</PreviewAction>
              </div>
            </article>
          ))}
        </section>

        <section className="pg__printRow">
          <div className="pg__printSheet">
            <div className="pg__printHead">QR print preview · demo only · not scannable</div>
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
              Possible future approach: pair a printed table code with a short-lived on-site session code that the
              server validates. This is a design proposal, not a feature wired to the controls above:
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
              approach could narrow that window; it would not eliminate it.
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
