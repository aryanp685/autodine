import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  QR_CODE_ROTATION_MS,
  QR_SESSION_TTL_SECONDS,
  canonicalIp,
  currentVenueCode,
  forwardedClientIp,
  hashSessionToken,
  isCurrentVenueCode,
  normalizePublicQrToken,
  normalizeVerificationCode,
  parseQrVerificationSecret,
  rateLimitIpFingerprint,
  venueCodeForSlot,
} from './qr-verification-crypto';

const secret = randomBytes(32);
const restaurantId = '20000000-0000-4000-8000-000000000001';

describe('QR verification crypto', () => {
  it('keeps the approved five-minute code and 60-minute session defaults', () => {
    expect(QR_CODE_ROTATION_MS).toBe(5 * 60 * 1000);
    expect(QR_SESSION_TTL_SECONDS).toBe(60 * 60);
  });

  it('requires a high-entropy server secret and never accepts short values', () => {
    expect(parseQrVerificationSecret(undefined)).toBeNull();
    expect(parseQrVerificationSecret('short')).toBeNull();
    expect(parseQrVerificationSecret('g'.repeat(64))).toBeNull();
    expect(parseQrVerificationSecret('ab'.repeat(32))).toHaveLength(32);
  });

  it('produces six-digit codes that rotate on the exact five-minute boundary', () => {
    const now = 1_800_000_000_000;
    const beforeBoundary = currentVenueCode(secret, restaurantId, 1, now);
    const afterBoundary = currentVenueCode(secret, restaurantId, 1, now + QR_CODE_ROTATION_MS);
    expect(beforeBoundary.code).toMatch(/^\d{6}$/);
    expect(beforeBoundary.validUntil).toBe(new Date((Math.floor(now / QR_CODE_ROTATION_MS) + 1) * QR_CODE_ROTATION_MS).toISOString());
    expect(afterBoundary.slot).toBe(beforeBoundary.slot + 1);
    expect(afterBoundary.code).not.toBe(venueCodeForSlot(secret, restaurantId, 1, beforeBoundary.slot));
  });

  it('binds codes to the restaurant and manual version, and accepts only the current slot', () => {
    const now = 1_800_000_000_000;
    const code = currentVenueCode(secret, restaurantId, 7, now).code;
    expect(isCurrentVenueCode(secret, restaurantId, 7, code, now)).toBe(true);
    expect(isCurrentVenueCode(secret, restaurantId, 8, code, now)).toBe(false);
    expect(isCurrentVenueCode(secret, '20000000-0000-4000-8000-000000000002', 7, code, now)).toBe(false);
    expect(isCurrentVenueCode(secret, restaurantId, 7, code, now + QR_CODE_ROTATION_MS)).toBe(false);
    expect(isCurrentVenueCode(secret, restaurantId, 7, '00000x', now)).toBe(false);
  });

  it('normalizes input without permitting QR tokens or codes in a malformed form', () => {
    expect(normalizePublicQrToken(' abcdEFGHijklMNOPqrstUVWX ')).toBe('abcdEFGHijklMNOPqrstUVWX');
    expect(normalizePublicQrToken('short')).toBeNull();
    expect(normalizePublicQrToken('a'.repeat(129))).toBeNull();
    expect(normalizePublicQrToken('../secret-token')).toBeNull();
    expect(normalizeVerificationCode(' 004281 ')).toBe('004281');
    expect(normalizeVerificationCode('4281')).toBeNull();
    expect(normalizeVerificationCode('12345x')).toBeNull();
  });

  it('canonicalizes forwarded IPs and stores a keyed fingerprint, not the source value', () => {
    expect(canonicalIp('192.0.2.11')).toBe('192.0.2.11');
    expect(canonicalIp('[2001:DB8::1]:443')).toBe('2001:db8::1');
    expect(canonicalIp('[2001:DB8::1]')).toBe('2001:db8::1');
    expect(canonicalIp('2001:0db8:0:0:0:0:0:1')).toBe('2001:db8::1');
    expect(forwardedClientIp('192.0.2.11, 10.0.0.1')).toBe('192.0.2.11');
    expect(forwardedClientIp('not-an-ip')).toBeNull();
    const fingerprint = rateLimitIpFingerprint(secret, '192.0.2.11');
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain('192.0.2.11');
    expect(rateLimitIpFingerprint(randomBytes(32), '192.0.2.11')).not.toBe(fingerprint);
  });

  it('stores only a one-way hash of high-entropy table session tokens', () => {
    const token = randomBytes(32).toString('hex');
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(hashSessionToken(token)).toBe(hash);
  });
});
