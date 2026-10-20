import type { MemberRole } from '@/lib/db/database';

export function canViewVenueCode(role: MemberRole, cashierAccessEnabled: boolean): boolean {
  return role === 'owner' || role === 'manager' || (role === 'cashier' && cashierAccessEnabled);
}

export function canManageVenueCode(role: MemberRole): boolean {
  return role === 'owner' || role === 'manager';
}

export function canManageTableQrs(role: MemberRole): boolean {
  return canManageVenueCode(role);
}
