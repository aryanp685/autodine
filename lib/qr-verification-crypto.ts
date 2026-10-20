import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const QR_CODE_ROTATION_MS = 5 * 60 * 1000;
export const QR_SESSION_TTL_SECONDS = 60 * 60;
export const QR_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const QR_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

const SECRET_HEX = /^(?:[A-Fa-f0-9]{2}){32,64}$/;
const QR_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const SIX_DIGITS = /^\d{6}$/;

export function parseQrVerificationSecret(value: string | undefined): Buffer | null {
  if (!value || !SECRET_HEX.test(value)) return null;
  try {
    return Buffer.from(value, 'hex');
  } catch {
    return null;
  }
}

function purposeKey(secret: Buffer, purpose: 'venue-code' | 'rate-limit-ip'): Buffer {
  return createHmac('sha256', secret).update(`autodine:qr:v1:${purpose}`).digest();
}

export function normalizePublicQrToken(value: string): string | null {
  const token = value.trim();
  return QR_TOKEN.test(token) ? token : null;
}

export function normalizeVerificationCode(value: string): string | null {
  const code = value.trim();
  return SIX_DIGITS.test(code) ? code : null;
}

export function venueCodeForSlot(
  secret: Buffer,
  restaurantId: string,
  codeVersion: number,
  slot: number,
): string {
  const input = `restaurant=${restaurantId.toLowerCase()}&version=${codeVersion}&slot=${slot}`;
  const digest = createHmac('sha256', purposeKey(secret, 'venue-code')).update(input).digest();
  const range = 2 ** 32;
  const acceptedBelow = Math.floor(range / 1_000_000) * 1_000_000;
  for (let offset = 0; offset <= digest.length - 4; offset += 4) {
    const candidate = digest.readUInt32BE(offset);
    if (candidate < acceptedBelow) return String(candidate % 1_000_000).padStart(6, '0');
  }
  // All eight independent-looking 32-bit HMAC chunks being rejected has probability below 2^-96.
  throw new Error('Could not derive a verification code.');
}

export function currentVenueCode(
  secret: Buffer,
  restaurantId: string,
  codeVersion: number,
  nowMs: number = Date.now(),
): { code: string; validUntil: string; slot: number } {
  const slot = Math.floor(nowMs / QR_CODE_ROTATION_MS);
  return {
    code: venueCodeForSlot(secret, restaurantId, codeVersion, slot),
    validUntil: new Date((slot + 1) * QR_CODE_ROTATION_MS).toISOString(),
    slot,
  };
}

export function isCurrentVenueCode(
  secret: Buffer,
  restaurantId: string,
  codeVersion: number,
  candidate: string,
  nowMs: number = Date.now(),
): boolean {
  const normalized = normalizeVerificationCode(candidate);
  if (!normalized) return false;
  const expected = Buffer.from(currentVenueCode(secret, restaurantId, codeVersion, nowMs).code, 'ascii');
  const provided = Buffer.from(normalized, 'ascii');
  return timingSafeEqual(expected, provided);
}

/** HMAC fingerprint only; the source IP is never persisted or logged. */
export function rateLimitIpFingerprint(secret: Buffer, rawIp: string): string {
  const normalizedIp = canonicalIp(rawIp);
  return createHmac('sha256', purposeKey(secret, 'rate-limit-ip'))
    .update(`ip=${normalizedIp}`)
    .digest('hex');
}

export function canonicalIp(value: string): string | null {
  let candidate = value.trim();
  if (candidate.startsWith('[') && candidate.includes(']')) {
    candidate = candidate.slice(1, candidate.indexOf(']'));
  }
  const zone = candidate.indexOf('%');
  if (zone >= 0) candidate = candidate.slice(0, zone);
  if (isIP(candidate) === 4) return candidate;
  if (isIP(candidate) === 6) {
    try {
      return new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}

/** Vercel supplies the left-most X-Forwarded-For address as the client. */
export function forwardedClientIp(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const candidate = headerValue.split(',')[0]?.trim();
  return candidate ? canonicalIp(candidate) : null;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
