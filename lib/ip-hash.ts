import { createHash } from 'node:crypto';
import { headers } from 'next/headers';

/**
 * A stable, non-reversible fingerprint of the caller's address.
 *
 * The database rate-limits guest actions per code and per address, and requires
 * 64 hex characters. Salting with the card's token means a hash from one
 * table's code cannot be correlated with another's -- without it, the log would
 * be a record of which addresses scanned which tables, which is more than rate
 * limiting needs to know.
 *
 * The address comes from the forwarded header because that is what carries it
 * behind Vercel. It is a header, so it can be forged. Rate limiting by IP is a
 * brake on casual probing, not a control an attacker cannot walk around, and
 * pretending otherwise would be worse than saying so.
 *
 * ONE IMPLEMENTATION, TWO CALLERS
 *
 * This lived inside the code-verification server action when that was the only
 * thing that needed it. Scanning a card in a scan-mode restaurant now mints a
 * session too, and two copies of a hash would be two chances for the two paths
 * to disagree about what an address is.
 */
/** The address a request came from, from the headers a proxy sets. */
export function addressFromHeaders(get: (name: string) => string | null): string {
  const forwarded = get('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0]!.trim() : '') || get('x-real-ip')?.trim() || 'unknown';
}

/** Hash an address we already have, without asking Next for the request again. */
export function hashAddress(address: string, salt: string): string {
  return createHash('sha256').update(`${address}|${salt}`).digest('hex');
}

/**
 * The address of the CURRENT request, for callers that only have a Server
 * Action context.
 *
 * A Route Handler already holds the request, and asking next/headers for it
 * again is both slower and impossible to call outside a request scope -- which
 * is why the scan route uses `addressFromHeaders` + `hashAddress` instead and
 * this helper stays in the action path that needs it.
 */
export async function ipHash(salt: string): Promise<string> {
  const store = await headers();
  return hashAddress(addressFromHeaders((name) => store.get(name)), salt);
}
