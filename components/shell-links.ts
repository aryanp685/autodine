/**
 * The destinations in the staff shell, in the order a shift moves through
 * them.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The rail renders them, the "Go to…" search filters them, and the active
 * state is derived from them. Keeping the list in one place is what stops the
 * nav and the search disagreeing about what exists -- the failure mode where a
 * screen is in the rail but not reachable by name, or the search offers a
 * destination the nav does not have.
 *
 * The grouping is by what a person is doing, not by data model: service is the
 * live floor, menu is what is for sale, business is what it added up to.
 */

export type DashboardSection =
  | 'overview'
  | 'menus'
  | 'branding'
  | 'import'
  | 'tables'
  | 'orders'
  | 'kitchen'
  | 'counter'
  | 'reports'
  | 'settings';

export type ShellLink = {
  key: DashboardSection;
  label: string;
  href: string;
  /** Heading the link sits under in the rail. */
  group: string;
};

export const DASHBOARD_LINKS: ReadonlyArray<ShellLink> = [
  { key: 'overview', label: 'Overview', href: '/dashboard', group: 'Today' },

  { key: 'orders', label: 'Orders', href: '/dashboard/orders', group: 'Service' },
  { key: 'kitchen', label: 'Kitchen', href: '/kitchen', group: 'Service' },
  { key: 'counter', label: 'Counter', href: '/cashier', group: 'Service' },

  { key: 'menus', label: 'Menus', href: '/dashboard/menus', group: 'Menu' },
  { key: 'branding', label: 'Branding', href: '/dashboard/branding', group: 'Menu' },
  { key: 'import', label: 'Import menu', href: '/dashboard/menus/import', group: 'Menu' },
  { key: 'tables', label: 'Tables & QR', href: '/dashboard/tables', group: 'Menu' },

  { key: 'reports', label: 'Reports', href: '/dashboard/reports', group: 'Business' },
  { key: 'settings', label: 'Settings', href: '/dashboard/settings', group: 'Business' },
];

/** The rail's groups, in display order, each with its links. */
export const SHELL_GROUPS: ReadonlyArray<{ name: string; links: readonly ShellLink[] }> = [
  'Today',
  'Service',
  'Menu',
  'Business',
].map((name) => ({ name, links: DASHBOARD_LINKS.filter((link) => link.group === name) }));
