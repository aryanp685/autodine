import Link from 'next/link';
import { tables, restaurant } from '@/lib/demo-data';
import { QrChip } from '@/components/ui';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { PreviewAction } from '@/components/ui/PreviewAction';
import { LiveTableQrManager } from '@/components/screens/LiveTableQrManager';
import type { AuthorizedWorkspace } from '@/lib/db/workspace-selection';

type LiveTable = {
  id: string;
  label: string;
  seats: number;
  is_active: boolean;
  qrCodes: Array<{ id: string; public_token: string; revoked_at: string | null }>;
};

const STATUS_TONE: Record<string, string> = {
  active: 'is-active',
  printed: 'is-printed',
  revoked: 'is-revoked',
  disabled: 'is-disabled',
};

/** Shared page structure; demo routes and live workspace data are explicit. */
export function TablesScreen({
  workspace,
  workspaces,
  liveTables,
  canManageTables = false,
}: {
  workspace?: AuthorizedWorkspace;
  workspaces?: AuthorizedWorkspace[];
  liveTables?: LiveTable[];
  canManageTables?: boolean;
} = {}) {
  const workspaceQuery = workspace ? `?workspace=${encodeURIComponent(workspace.slug)}` : '';
  const isLive = liveTables !== undefined;

  return (
    <div className="pg pg--dash">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">AutoDine</Link>
        <div className="pg__barLinks">
          <Link href={`/dashboard${workspaceQuery}`}>Overview</Link>
          <Link href={`/dashboard/menus${workspaceQuery}`}>Menus</Link>
          <Link href={`/dashboard/tables${workspaceQuery}`} className="is-active">Tables &amp; QR</Link>
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
        {isLive ? (
          <><strong>Live workspace data.</strong> Table records and issued QR codes are loaded from Supabase; the checkout and payment flow remains preview-only.</>
        ) : (
          <><strong>Demo — not saved.</strong> {workspace
            ? `Workspace access verified for ${workspace.name}; table cards below are fictional.`
            : 'Table cards and QR images below are illustrative; controls do not change database records.'}</>
        )}
      </div>

      <div className="pg__body">
        <header className="pg__head pg__head--row">
          <div>
            <div className="pg__kicker">Tables &amp; QR</div>
            <h1 className="pg__title">{isLive ? `${liveTables.length} tables · ${workspace?.name ?? ''}` : workspace ? `Demo table preview · ${workspace.name}` : `12 demo tables · ${restaurant.name}`}</h1>
          </div>
          {!isLive && (
            <div className="pg__headActions">
              <PreviewAction className="pg__btn" message="Print the sample QR sheet from the browser dialog." print>Print QR sheet</PreviewAction>
              <PreviewAction className="pg__btn pg__btn--solid" message="Tables are demo-only; no table was created.">Add table</PreviewAction>
            </div>
          )}
        </header>

        {isLive ? (
          <LiveTableQrManager
            key={`${workspace?.slug}:${liveTables.length}`}
            slug={workspace?.slug ?? ''}
            initialTables={liveTables}
            canManage={canManageTables}
          />
        ) : (
          <>
            <div className="pg__note pg__note--info">
              <strong>Preview only:</strong> table cards and QR images below are fictional; no table records or QR tokens are changed.
            </div>

            <section className="pg__tables">
              {tables.map((t) => (
                <article key={t.code} className={`pg__tableCard ${STATUS_TONE[t.qr]}`}>
                  <div className="pg__tableTop">
                    <div className="pg__tableCode">{t.code}</div>
                    <span className={`pg__qrState is-${t.qr}`}>{t.qr}</span>
                  </div>
                  <div className="pg__tableMeta">{t.label} · {t.seats} seats</div>
                  <div className="pg__tableQr"><QrChip value={`${restaurant.name}-${t.code}`} size={72} /></div>
                  <div className="pg__tableStats">
                    <div><span>Last scan</span><strong>{t.lastScan}</strong></div>
                    <div><span>Orders today</span><strong className="tnum">{t.orders}</strong></div>
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
                <h3 className="pg__h3">Scan to order</h3>
                <p className="pg__p">Guests scan the table QR, open the menu and send an order directly to the kitchen.</p>
                <ul className="pg__bullets">
                  <li>Each QR identifies one table and can be revoked or replaced.</li>
                  <li>Guest sessions expire after one hour.</li>
                  <li>Only available menu items and server-calculated prices can be ordered.</li>
                  <li>QR links can be shared, so anyone with an active link can place an order.</li>
                </ul>
              </aside>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
