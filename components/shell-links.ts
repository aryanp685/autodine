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
  /**
   * Who may open it. Omitted means everybody with a membership.
   *
   * This is the rail's copy of a rule the database already enforces: a kitchen
   * login cannot write a price because the policy refuses it. Hiding the
   * destination is the difference between "you have no business here" and a
   * screen that opens, shows read-only fields, and answers Save with a
   * Postgres error. The layouts under app/(staff) gate the URLs themselves, so
   * a typed address behaves the same as a hidden link.
   */
  roles?: readonly string[];
};

/** Owner and manager: everything the business side owns. */
const MANAGE = ['owner', 'manager'] as const;
/** Money at the counter, and the bills it settles. */
const COUNTER = ['owner', 'manager', 'cashier'] as const;
/** The ticket rail. */
const KITCHEN = ['owner', 'manager', 'kitchen'] as const;

export const DASHBOARD_LINKS: ReadonlyArray<ShellLink> = [
  { key: 'overview', label: 'Overview', href: '/dashboard', group: 'Today', roles: MANAGE },

  { key: 'orders', label: 'Orders', href: '/dashboard/orders', group: 'Service', roles: COUNTER },
  { key: 'kitchen', label: 'Kitchen', href: '/kitchen', group: 'Service', roles: KITCHEN },
  { key: 'counter', label: 'Counter', href: '/cashier', group: 'Service', roles: COUNTER },

  { key: 'menus', label: 'Menus', href: '/dashboard/menus', group: 'Menu', roles: MANAGE },
  { key: 'branding', label: 'Branding', href: '/dashboard/branding', group: 'Menu', roles: MANAGE },
  { key: 'import', label: 'Import menu', href: '/dashboard/menus/import', group: 'Menu', roles: MANAGE },
  { key: 'tables', label: 'Tables & QR', href: '/dashboard/tables', group: 'Menu', roles: MANAGE },

  { key: 'reports', label: 'Reports', href: '/dashboard/reports', group: 'Business', roles: MANAGE },
  { key: 'settings', label: 'Settings', href: '/dashboard/settings', group: 'Business', roles: MANAGE },
];

/**
 * The rail for one person's role.
 *
 * An unknown role (no session, a demo screen, a role added later) gets
 * everything, which is what every screen did before this existed. A kitchen
 * login gets two destinations and no Business group at all, rather than a
 * heading with nothing under it.
 */
export function linksForRole(role: string | null | undefined): ReadonlyArray<ShellLink> {
  if (!role) return DASHBOARD_LINKS;
  return DASHBOARD_LINKS.filter((link) => !link.roles || link.roles.includes(role));
}

export function groupsForRole(
  role: string | null | undefined,
): ReadonlyArray<{ name: string; links: readonly ShellLink[] }> {
  return SHELL_GROUPS.map((group) => ({
    name: group.name,
    links: group.links.filter((link) => !role || !link.roles || link.roles.includes(role)),
  })).filter((group) => group.links.length > 0);
}

/** The rail's groups, in display order, each with its links. */
export const SHELL_GROUPS: ReadonlyArray<{ name: string; links: readonly ShellLink[] }> = [
  'Today',
  'Service',
  'Menu',
  'Business',
].map((name) => ({ name, links: DASHBOARD_LINKS.filter((link) => link.group === name) }));

/**
 * Which destination a URL is.
 *
 * WHY THIS EXISTS
 *
 * The shell used to be told its active section by a prop, passed by hand from
 * each page. That works until one page forgets, and then the rail is on screen
 * with nothing highlighted while the page loads -- which is exactly what
 * happened to seven skeletons in this codebase.
 *
 * Now that the rail is rendered once by a layout, it cannot be handed a prop
 * per page anyway: the layout does not re-run when the page changes. So the
 * answer is derived from the URL, which is the only place it was ever true.
 *
 * Longest match wins, so `/dashboard/menus/import` is Import rather than Menus,
 * and the comparison is segment-aware: `/kitchen` must not match
 * `/kitchenette`.
 */
export function sectionForPathname(pathname: string | null | undefined): DashboardSection | undefined {
  if (!pathname) return undefined;

  let best: { key: DashboardSection; length: number } | null = null;

  for (const link of DASHBOARD_LINKS) {
    const isMatch = pathname === link.href || pathname.startsWith(`${link.href}/`);
    if (!isMatch) continue;
    if (!best || link.href.length > best.length) {
      best = { key: link.key, length: link.href.length };
    }
  }

  return best?.key;
}

/**
 * The screens that want the wide column (a report table, a ticket grid).
 *
 * Derived from the same URL for the same reason: the width lives on the frame,
 * the frame lives in the layout, and the layout does not see the page's props.
 */
export function isWideSection(pathname: string | null | undefined): boolean {
  const key = sectionForPathname(pathname);
  return key === 'kitchen' || key === 'menus' || key === 'orders' || key === 'reports' || key === 'counter';
}
