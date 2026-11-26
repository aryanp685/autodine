import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { RoleGate } from '@/components/owner/RoleGate';
import { subscriptionStatusOf } from '@/lib/billing/status';
import { getStaffContextDetailed } from '@/lib/db/staff';

/**
 * Who may open the dashboard at all.
 *
 * A kitchen login belongs on the board, not in the office: the rail hides the
 * dashboard's destinations from that role (components/shell-links.ts) and this
 * refuses the URL, so a typed /dashboard behaves like a hidden link.
 *
 * A cashier IS allowed in, because the day's bills and the counter's payments
 * are their work and Orders lives under this segment. The screens that are
 * genuinely the owner's -- menus, branding, tables, reports, settings -- each
 * carry their own gate below this one, and the database refuses the writes even
 * if one is ever forgotten.
 */
export default async function Layout({ children }: { children: ReactNode }) {
  // The post-trial wall. A paid plan, an unfinished trial or any failed or
  // absent billing read passes; only a database-decided block (the trial ran
  // out and no plan is active) sends the owner to choose a plan. Cashiers and
  // kitchen never receive billing state, so their shift is never walled.
  const staff = await getStaffContextDetailed();
  if (staff.ok && ['owner', 'manager'].includes(staff.context.role)) {
    const status = subscriptionStatusOf(staff.context.access);
    if (status === 'blocked') redirect('/choose-plan');
  }

  return (
    <RoleGate allow={['owner', 'manager', 'cashier'] as const} area="dashboard">
      {children}
    </RoleGate>
  );
}
