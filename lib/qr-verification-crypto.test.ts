import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  QR_SESSION_TTL_SECONDS,
  canonicalIp,
  forwardedClientIp,
  hashSessionToken,
  normalizePublicQrToken,
  parseQrRateLimitSecret,
  rateLimitIpFingerprint,
} from './qr-verification-crypto';

const secret = randomBytes(32);

describe('QR session crypto', () => {
  it('uses one-hour server-validated sessions', () => {
    expect(QR_SESSION_TTL_SECONDS).toBe(60 * 60);
  });

  it('requires a high-entropy server secret and never accepts short values', () => {
    expect(parseQrRateLimitSecret(undefined)).toBeNull();
    expect(parseQrRateLimitSecret('short')).toBeNull();
    expect(parseQrRateLimitSecret('g'.repeat(64))).toBeNull();
    expect(parseQrRateLimitSecret('ab'.repeat(32))).toHaveLength(32);
  });

  it('accepts only URL-safe QR handles of the supported length', () => {
    expect(normalizePublicQrToken(' abcdEFGHijklMNOPqrstUVWX ')).toBe('abcdEFGHijklMNOPqrstUVWX');
    expect(normalizePublicQrToken('short')).toBeNull();
    expect(normalizePublicQrToken('a'.repeat(129))).toBeNull();
    expect(normalizePublicQrToken('../secret-token')).toBeNull();
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
