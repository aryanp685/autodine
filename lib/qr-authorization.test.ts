import { describe, expect, it } from 'vitest';
import { canManageTableQrs } from './qr-authorization';

describe('table QR authorization', () => {
  it('lets only owners and managers create or revoke table QRs', () => {
    expect(canManageTableQrs('owner')).toBe(true);
    expect(canManageTableQrs('manager')).toBe(true);
    expect(canManageTableQrs('cashier')).toBe(false);
    expect(canManageTableQrs('kitchen')).toBe(false);
  });
});
