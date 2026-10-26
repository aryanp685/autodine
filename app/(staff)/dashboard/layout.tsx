import type { ReactNode } from 'react';
import { RoleGate } from '@/components/owner/RoleGate';

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
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RoleGate allow={['owner', 'manager', 'cashier'] as const} area="dashboard">
      {children}
    </RoleGate>
  );
}
