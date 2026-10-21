import type { MemberRole } from '@/lib/db/database';

export function canManageTableQrs(role: MemberRole): boolean {
  return role === 'owner' || role === 'manager';
}
