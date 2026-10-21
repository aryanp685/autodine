'use client';

import type { OutletOption } from '@/lib/outlets';

/**
 * The outlet picker in the dashboard bar.
 *
 * A plain form POST to /dashboard/outlet, not a server action: it works with
 * JavaScript disabled, it needs no client bundle beyond the auto-submit below,
 * and the handler re-validates the choice against the caller's memberships
 * instead of trusting what arrived.
 *
 * With one outlet there is nothing to switch between, so this renders the name
 * as text. A select with one option looks broken and invites a click that does
 * nothing.
 */
export function OutletSwitcher({
  outlets,
  activeId,
  next,
}: {
  outlets: OutletOption[];
  activeId: string;
  /** Where to come back to after switching. Always a path on this site. */
  next: string;
}) {
  if (outlets.length === 0) return null;

  const active = outlets.find((outlet) => outlet.id === activeId) ?? outlets[0];

  if (outlets.length === 1) {
    return (
      <span className="pg__outletName" title="This account has one outlet">
        {active.name}
      </span>
    );
  }

  return (
    <form className="pg__outletForm" method="post" action="/dashboard/outlet">
      <label className="ui-label--sr" htmlFor="outlet-switcher">
        Outlet
      </label>
      <select
        id="outlet-switcher"
        name="outlet"
        className="pg__outletSelect"
        defaultValue={active.id}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {outlets.map((outlet) => (
          <option key={outlet.id} value={outlet.id}>
            {outlet.name}
          </option>
        ))}
      </select>
      <input type="hidden" name="next" value={next} />
      {/* Without JavaScript the select cannot submit itself. */}
      <noscript>
        <button type="submit" className="pg__outletGo">
          Switch
        </button>
      </noscript>
    </form>
  );
}
