import { describe, expect, it } from 'vitest';
import { canManageTableQrs, canManageVenueCode, canViewVenueCode } from './qr-authorization';

describe('QR authorization roles', () => {
  it('lets owners and managers view/manage venue codes and table QRs', () => {
    for (const role of ['owner', 'manager'] as const) {
      expect(canViewVenueCode(role, false)).toBe(true);
      expect(canManageVenueCode(role)).toBe(true);
      expect(canManageTableQrs(role)).toBe(true);
    }
  });

  it('lets cashiers view only when an owner/manager explicitly enables access', () => {
    expect(canViewVenueCode('cashier', false)).toBe(false);
    expect(canViewVenueCode('cashier', true)).toBe(true);
    expect(canManageVenueCode('cashier')).toBe(false);
    expect(canManageTableQrs('cashier')).toBe(false);
  });

  it('never lets kitchen view or manage verification codes or table QRs', () => {
    expect(canViewVenueCode('kitchen', false)).toBe(false);
    expect(canViewVenueCode('kitchen', true)).toBe(false);
    expect(canManageVenueCode('kitchen')).toBe(false);
    expect(canManageTableQrs('kitchen')).toBe(false);
  });
});
