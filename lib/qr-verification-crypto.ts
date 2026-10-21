import { createHash, createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export const QR_SESSION_TTL_SECONDS = 60 * 60;
export const QR_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const QR_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

const SECRET_HEX = /^(?:[A-Fa-f0-9]{2}){32,64}$/;
const QR_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function parseQrRateLimitSecret(value: string | undefined): Buffer | null {
  if (!value || !SECRET_HEX.test(value)) return null;
  try {
    return Buffer.from(value, 'hex');
  } catch {
    return null;
  }
}

export function normalizePublicQrToken(value: string): string | null {
  const token = value.trim();
  return QR_TOKEN.test(token) ? token : null;
}

/** HMAC fingerprint only; the source IP is never persisted or logged. */
export function rateLimitIpFingerprint(secret: Buffer, rawIp: string): string {
  const normalizedIp = canonicalIp(rawIp);
  return createHmac('sha256', secret)
    .update(`autodine:qr-rate-limit:v1:ip=${normalizedIp}`)
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
