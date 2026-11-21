import type { ReactNode } from 'react';
import { RoleGate } from '@/components/owner/RoleGate';

/**
 * Who may open this area.
 *
 * The rail hides what a role cannot use, the database refuses the writes, and
 * this refuses the URL -- so a typed address and a hidden link behave the same.
 * See components/owner/RoleGate.tsx for why this is a layout.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RoleGate allow={['owner', 'manager'] as const} area="menus">
      {children}
    </RoleGate>
  );
}
