/**
 * ADMIN AUTH — SERVER ONLY.
 *
 * WHY THIS FILE EXISTS
 *
 * The trial-renewal workflow writes with the service-role client, which
 * bypasses RLS. Before this module, nothing checked who was asking: any
 * request to /api/admin/renew-trial could restart any restaurant's trial
 * clock. This module is the single gate every privileged entry point must
 * pass — the API route AND the server action, independently.
 *
 * THE SECRET
 *
 * `ADMIN_SECRET` is an environment variable with no NEXT_PUBLIC_ prefix.
 * Next.js inlines only NEXT_PUBLIC_ variables into the browser bundle, so
 * this name can never appear in client JavaScript. It is never logged,
 * never echoed in a response, and never written to storage. The operator
 * types it into the admin page at call time; it travels in the request
 * body over TLS and lives only in server memory long enough to compare.
 *
 * FAIL CLOSED
 *
 * A missing secret, or one shorter than MIN_SECRET_LENGTH, is a server
 * misconfiguration. A misconfigured server must refuse every caller —
 * including one who guesses the empty string correctly.
 *
 * CONSTANT TIME
 *
 * Both sides are hashed with SHA-256 before timingSafeEqual, so the
 * comparison takes the same time whatever the caller sent, and strings of
 * different lengths cannot crash it.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * A short admin secret is a guessable admin secret. 32 characters is the
 * floor; generate with `openssl rand -hex 32`.
 */
export const MIN_SECRET_LENGTH = 32;

/** The environment variable name, kept in one place. */
export const ADMIN_SECRET_ENV = 'ADMIN_SECRET';

function configuredSecret(): string {
  // Read at call time, never at module load: tests stub the environment,
  // and a value captured at import would outlive its rotation.
  return process.env[ADMIN_SECRET_ENV] ?? '';
}

/** Whether this server has a usable admin secret at all. */
export function isAdminSecretConfigured(): boolean {
  return configuredSecret().length >= MIN_SECRET_LENGTH;
}

/**
 * Whether `provided` is the admin secret.
 *
 * False for every input when the server is not configured — the fail-closed
 * rule. Otherwise a constant-time comparison of SHA-256 digests.
 */
export function isValidAdminSecret(provided: string | null | undefined): boolean {
  const expected = configuredSecret();
  if (expected.length < MIN_SECRET_LENGTH) return false;
  if (typeof provided !== 'string' || provided.length === 0) return false;

  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

/** The one unauthorized answer: generic, identical for wrong and missing. */
export const UNAUTHORIZED_MESSAGE = 'Unauthorized';
