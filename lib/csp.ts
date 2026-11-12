/**
 * The Content Security Policy, built per request.
 *
 * WHY A NONCE
 *
 * The page carries exactly one hand-written inline script (the motion flag in
 * app/layout.tsx) and Next.js writes its own inline runtime. A hash would have
 * to be recomputed for every flight-data payload; a nonce is minted per
 * request, handed to the renderer (see proxy.ts), and is the pattern Next.js
 * documents. Scripts without the nonce are refused — there is no
 * 'unsafe-inline' for script-src here, and adding one would make the policy
 * decorative.
 *
 * WHAT IS LOOSENED, AND WHY ONLY THAT
 *
 * `style-src 'unsafe-inline'`: React renders `style="…"` attributes (the QR
 * wrappers, the venue card theming) and no nonce can ride along on an
 * attribute. Styles are not a script execution surface; scripts stay strict.
 *
 * WHAT IS ALLOWED BY NAME
 *
 *   the Supabase origin    auth, data and realtime (wss) for every screen
 *
 * No payment-provider origin or frame is allowed: guest checkout is
 * pay-at-counter only and no reviewed provider-iframe flow is shipped.
 *
 * Everything else is 'self'. object-src 'none' and base-uri 'self' close the
 * plugin and <base> tricks; frame-ancestors 'self' matches the existing
 * X-Frame-Options.
 */

export type CspInput = {
  /** Fresh, per request. */
  nonce: string;
  /** NEXT_PUBLIC_SUPABASE_URL; empty in demo mode. */
  supabaseUrl?: string | null;
};

/** Only an https origin survives; anything else is simply left out. */
function httpsOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function buildCsp({ nonce, supabaseUrl }: CspInput): string {
  const supabase = httpsOrigin(supabaseUrl);

  const scriptSrc = ["'self'", `'nonce-${nonce}'`];
  const connectSrc = ["'self'"];
  const imgSrc = ["'self'", 'data:', 'blob:'];

  if (supabase) {
    imgSrc.push(supabase);
    connectSrc.push(supabase, supabase.replace('https://', 'wss://'));
  }

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    // React style attributes have no nonce mechanism; scripts stay strict.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc.join(' ')}`,
    "font-src 'self'",
    `connect-src ${connectSrc.join(' ')}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
  ].join('; ');
}
