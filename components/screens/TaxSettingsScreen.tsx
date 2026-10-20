import Link from 'next/link';
import { saveRestaurantTaxSettingsAction } from '@/app/dashboard/settings/actions';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { formatTaxRatePercent } from '@/lib/tax-settings';
import type { AuthorizedWorkspace } from '@/lib/db/workspace-selection';

const STATUS: Record<string, string> = {
  saved: 'Tax settings saved. New orders will use this rate.',
  'invalid-rate': 'Enter a rate greater than 0% and no higher than 30%, with at most two decimal places.',
  'save-failed': 'We could not save this setting. Refresh and try again; existing orders are unchanged.',
};

export function TaxSettingsScreen({
  workspace,
  workspaces,
  taxRateBps,
  status,
  canEdit,
}: {
  workspace: AuthorizedWorkspace;
  workspaces: AuthorizedWorkspace[];
  taxRateBps: number;
  status?: string;
  canEdit: boolean;
}) {
  const workspaceQuery = `?workspace=${encodeURIComponent(workspace.slug)}`;
  const enabled = taxRateBps > 0;
  const statusText = status ? STATUS[status] : undefined;

  return (
    <div className="pg pg--dash">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">AutoDine</Link>
        <div className="pg__barLinks">
          <Link href={`/dashboard${workspaceQuery}`}>Overview</Link>
          <Link href={`/dashboard/menus${workspaceQuery}`}>Menus</Link>
          <Link href={`/dashboard/tables${workspaceQuery}`}>Tables &amp; QR</Link>
          <Link href={`/dashboard/settings${workspaceQuery}`} className="is-active">Settings</Link>
        </div>
        <div className="pg__barRight">
          <WorkspaceSwitcher workspaces={workspaces} selectedSlug={workspace.slug} pathname="/dashboard/settings" />
        </div>
      </div>

      <div className="pg__demoBanner">
        <strong>Restaurant settings.</strong> Workspace: {workspace.name}. GST treatment is the owner's responsibility to verify; this tool does not provide tax advice.
      </div>

      <main className="tax-settings">
        <header className="tax-settings__header">
          <div className="pg__kicker">Settings · Tax</div>
          <h1 id="tax-settings-title">Optional GST</h1>
          <p>GST is off for new restaurants. Turn it on only after confirming the applicable rate for your restaurant.</p>
        </header>

        <section className="tax-settings__card" aria-labelledby="tax-settings-title">
          <div className="tax-settings__current">
            <span>Current order setting</span>
            <strong>{enabled ? `${formatTaxRatePercent(taxRateBps)}% GST` : 'No GST added'}</strong>
          </div>

          {!canEdit && (
            <p className="tax-settings__notice" role="note">Only the restaurant owner can change this setting. You can view the current rate.</p>
          )}
          {statusText && <p className="tax-settings__status" role={status === 'saved' ? 'status' : 'alert'}>{statusText}</p>}

          {canEdit && (
            <form action={saveRestaurantTaxSettingsAction} className="tax-settings__form">
              <input type="hidden" name="workspace" value={workspace.slug} />
              <label className="tax-settings__toggle">
                <input type="checkbox" name="taxEnabled" defaultChecked={enabled} />
                <span><strong>Add GST to new guest orders</strong><small>Leave this off to charge no GST and hide the tax line at checkout.</small></span>
              </label>
              <label className="tax-settings__field" htmlFor="tax-rate-percent">
                <span>GST rate (%)</span>
                <input
                  id="tax-rate-percent"
                  name="taxRatePercent"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max="30"
                  step="0.01"
                  defaultValue={enabled ? formatTaxRatePercent(taxRateBps) : ''}
                  placeholder="For example, 5"
                  aria-describedby="tax-rate-help"
                />
                <small id="tax-rate-help">Used only when GST is enabled. Range: 0.01%–30%, up to two decimal places. Set the checkbox off to save 0%.</small>
              </label>
              <button className="tax-settings__save" type="submit">Save tax settings</button>
            </form>
          )}

          <div className="tax-settings__footnote">
            This affects future orders only. Existing orders keep their stored subtotal, tax and total. The database recalculates new order totals using this saved rate.
          </div>
        </section>
      </main>
    </div>
  );
}
