/**
 * The origin this build is being served from.
 *
 * Derived from the incoming request rather than a constant, because the same
 * build is served from a Vercel preview URL, a production alias, and a custom
 * domain. A link built with the wrong host is a dead link, and there is no way
 * to tell from the link that it is dead -- the two places that build one are a
 * printed QR code (lib/qr.ts) and a password-reset email
 * (app/auth/actions.ts), and neither can be corrected after the fact.
 *
 * Falls back to an explicit SITE_URL when there is no request to read --
 * scripts, tests, and any other non-request context.
 *
 * This lives in its own module, away from the QR encoder, so the reset action
 * does not pull the whole encoder into the auth bundle to learn a hostname.
 */

export async function siteOrigin(): Promise<string> {
  const configured = process.env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;

  // Read lazily: headers() is request-scoped, and calling it at module scope
  // would make every import of this file require a request.
  const { headers } = await import('next/headers');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return '';

  // x-forwarded-proto is what Vercel sets; host alone cannot tell us.
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

/**
 * The origin of THIS request, even on a preview deployment.
 *
 * siteOrigin() prefers the project's production domain, which is right for a
 * printed QR card: a card that survives the deployment it was printed from is
 * the whole point. It is wrong for an emailed auth link, and quietly so. The
 * PKCE verifier for a password reset is a cookie on the host that asked for
 * the link. Send the mail back to production from a preview, and the exchange
 * lands on the wrong host, finds no verifier, and reports the link as expired.
 *
 * So auth links ask this instead: whoever is serving the request gets the
 * redirect, and the cookie is where the link comes back to.
 */
export async function requestOrigin(): Promise<string> {
  const { headers } = await import('next/headers');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');

  if (host) {
    // x-forwarded-proto is what Vercel sets; host alone cannot tell us.
    const proto = h.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${host}`;
  }

  return siteOrigin();
}
