import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isAdminSecretConfigured,
  isValidAdminSecret,
  MIN_SECRET_LENGTH,
} from './admin-auth';

/**
 * The admin gate itself.
 *
 * The rule these tests hold: a server without a usable ADMIN_SECRET
 * refuses everybody, and a server with one compares in a way that cannot
 * be timed from outside. Everything else in the admin workflow stands on
 * this module.
 */

const A_SECRET = 'a'.repeat(MIN_SECRET_LENGTH);

describe('admin secret', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_SECRET', A_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts exactly the configured secret', () => {
    expect(isValidAdminSecret(A_SECRET)).toBe(true);
  });

  it('rejects a wrong secret, an empty one, and a missing one', () => {
    expect(isValidAdminSecret('b'.repeat(MIN_SECRET_LENGTH))).toBe(false);
    expect(isValidAdminSecret('')).toBe(false);
    expect(isValidAdminSecret(null)).toBe(false);
    expect(isValidAdminSecret(undefined)).toBe(false);
  });

  it('fails closed when ADMIN_SECRET is not configured — even to the empty string', () => {
    vi.stubEnv('ADMIN_SECRET', '');
    expect(isAdminSecretConfigured()).toBe(false);
    expect(isValidAdminSecret('')).toBe(false);
    expect(isValidAdminSecret(A_SECRET)).toBe(false);
  });

  it('fails closed when ADMIN_SECRET is misconfigured (too short to be a secret)', () => {
    vi.stubEnv('ADMIN_SECRET', 'short');
    expect(isAdminSecretConfigured()).toBe(false);
    expect(isValidAdminSecret('short')).toBe(false);
  });

  it('reports the configured state honestly', () => {
    expect(isAdminSecretConfigured()).toBe(true);
  });
});
