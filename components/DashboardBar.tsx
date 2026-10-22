import Link from 'next/link';
import { OutletSwitcher } from '@/components/OutletSwitcher';
import { outletInitials, type OutletBar } from '@/lib/outlets';
import { signOutAction } from '@/app/auth/actions';

/**
 * The one bar every staff screen wears.
 *
 * WHY IT IS ONE COMPONENT, AND WHY IT NOW INCLUDES THE COUNTER
 *
 * It used to be copied into every screen, and the copies drifted: the Menus
 * and Tables screens shipped "Orders" and "Reports" as plain <span>s that
 * looked like navigation and did nothing.
 *
 * The drift did not stop there. This bar listed six destinations and the
 * product has eight working screens, so two of them — the kitchen board and
 * the counter — were only reachable from a link inside another screen. A
 * cashier could not open the counter from the navigation at all; they had to
 * find an order and follow a note in it. A destination that exists and cannot
 * be reached from the nav is a dead end with extra steps.
 *
 * The bar therefore carries every screen a signed-in person can use, in the
 * order a shift moves through them: what happened (overview), what is for
 * sale (menus, tables), what is happening (orders, kitchen, counter), and what
 * it added up to (reports, settings).
 */

export type DashboardSection =
  | 'overview'
  | 'menus'
  | 'branding'
  | 'tables'
  | 'orders'
  | 'kitchen'
  | 'counter'
  | 'reports'
  | 'settings';

export const DASHBOARD_LINKS: ReadonlyArray<{ key: DashboardSection; label: string; href: string }> = [
  { key: 'overview', label: 'Overview', href: '/dashboard' },
  { key: 'menus', label: 'Menus', href: '/dashboard/menus' },
  { key: 'branding', label: 'Branding', href: '/dashboard/branding' },
  { key: 'tables', label: 'Tables & QR', href: '/dashboard/tables' },
  { key: 'orders', label: 'Orders', href: '/dashboard/orders' },
  { key: 'kitchen', label: 'Kitchen', href: '/kitchen' },
  { key: 'counter', label: 'Counter', href: '/cashier' },
  { key: 'reports', label: 'Reports', href: '/dashboard/reports' },
  { key: 'settings', label: 'Settings', href: '/dashboard/settings' },
];

/**
 * `outlet` is optional: in demo mode there is no session and therefore no
 * outlets, and the bar still has to render. It is also what tells the avatar
 * whose account this is.
 */
export function DashboardBar({
  active,
  outlet,
  signOut = true,
}: {
  /**
   * Optional so the loading skeleton can render this bar before it knows which
   * screen is coming. With no `active`, no link claims to be the current page
   * -- which is honest while nothing has loaded yet, and beats the navigation
   * blinking out of existence for the length of the fetch.
   */
  active?: DashboardSection;
  outlet?: OutletBar | null;
  /** Off on the demo screens, where there is nobody signed in to sign out. */
  signOut?: boolean;
}) {
  const activeHref = DASHBOARD_LINKS.find((link) => link.key === active)?.href ?? '/dashboard';
  const activeOutlet = outlet?.outlets.find((entry) => entry.id === outlet.activeId) ?? outlet?.outlets[0] ?? null;

  return (
    <header className="appBar">
      <div className="appBar__left">
        <Link href="/" className="appBar__brand">
          AutoDine
        </Link>
        <span className="appBar__venue" title={activeOutlet?.name ?? 'AutoDine'}>
          {outletInitials(activeOutlet?.name ?? 'AutoDine')}
        </span>
      </div>

      <nav className="appBar__nav" aria-label="Restaurant">
        {DASHBOARD_LINKS.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            className={link.key === active ? 'is-active' : undefined}
            aria-current={link.key === active ? 'page' : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="appBar__right">
        {outlet && outlet.outlets.length > 0 && (
          <OutletSwitcher outlets={outlet.outlets} activeId={outlet.activeId} next={activeHref} />
        )}
        {signOut && (
          <form action={signOutAction}>
            <button type="submit" className="appBar__signOut">
              Sign out
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
