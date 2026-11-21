import type { ReactNode } from 'react';
import { RoleGate } from '@/components/owner/RoleGate';

/** Subscription and its immutable receipts are manager-facing; plan changes remain owner-only. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RoleGate allow={['owner', 'manager'] as const} area="subscription">
      {children}
    </RoleGate>
  );
}
