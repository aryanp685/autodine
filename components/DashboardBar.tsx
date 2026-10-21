import Link from 'next/link';

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

export type DashboardSection = 'overview' | 'menus' | 'tables' | 'orders' | 'reports';

export const DASHBOARD_LINKS: ReadonlyArray<{ key: DashboardSection; label: string; href: string }> = [
  { key: 'overview', label: 'Overview', href: '/dashboard' },
  { key: 'menus', label: 'Menus', href: '/dashboard/menus' },
  { key: 'tables', label: 'Tables & QR', href: '/dashboard/tables' },
  { key: 'orders', label: 'Orders', href: '/dashboard/orders' },
  { key: 'reports', label: 'Reports', href: '/dashboard/reports' },
];

export function DashboardBar({ active }: { active: DashboardSection }) {
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
        <span className="pg__avatar">AP</span>
      </div>
    </div>
  );
}
