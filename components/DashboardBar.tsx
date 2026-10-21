import Link from 'next/link';
import { OutletSwitcher } from '@/components/OutletSwitcher';
import { outletInitials, type OutletBar } from '@/lib/outlets';

/**
 * The dashboard's top bar.
 *
 * WHY THIS EXISTS AS A COMPONENT
 *
 * It used to be copied into every screen, and the copies drifted. The Menus
 * and Tables screens each shipped "Orders" and "Reports" as plain <span>s --
 * they looked like navigation, sat in the navigation, and did nothing at all
 * when clicked. A dead link that looks live is worse than a missing one: the
 * owner concludes the product is broken rather than the feature unbuilt.
 *
 * One list, one place. Adding a destination here adds it everywhere.
 */

export type DashboardSection = 'overview' | 'menus' | 'tables' | 'orders' | 'reports' | 'settings';

export const DASHBOARD_LINKS: ReadonlyArray<{ key: DashboardSection; label: string; href: string }> = [
  { key: 'overview', label: 'Overview', href: '/dashboard' },
  { key: 'menus', label: 'Menus', href: '/dashboard/menus' },
  { key: 'tables', label: 'Tables & QR', href: '/dashboard/tables' },
  { key: 'orders', label: 'Orders', href: '/dashboard/orders' },
  { key: 'reports', label: 'Reports', href: '/dashboard/reports' },
  { key: 'settings', label: 'Settings', href: '/dashboard/settings' },
];

/**
 * `outlet` is optional: in demo mode there is no session and therefore no
 * outlets, and the bar still has to render. It is also what tells the avatar
 * whose account this is.
 */
export function DashboardBar({ active, outlet }: { active: DashboardSection; outlet?: OutletBar | null }) {
  const activeHref = DASHBOARD_LINKS.find((link) => link.key === active)?.href ?? '/dashboard';
  const activeOutlet = outlet?.outlets.find((entry) => entry.id === outlet.activeId) ?? outlet?.outlets[0] ?? null;

  return (
    <div className="pg__bar">
      <Link href="/" className="pg__brand">
        AutoDine
      </Link>
      <nav className="pg__barLinks" aria-label="Dashboard">
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
      <div className="pg__barRight">
        {outlet && outlet.outlets.length > 0 && (
          <OutletSwitcher outlets={outlet.outlets} activeId={outlet.activeId} next={activeHref} />
        )}
        {/* The avatar was the letters AP on every restaurant, which told an
            owner nothing and looked like somebody else's account. */}
        <span className="pg__avatar" aria-hidden="true">
          {outletInitials(activeOutlet?.name ?? 'AutoDine')}
        </span>
      </div>
    </div>
  );
}
