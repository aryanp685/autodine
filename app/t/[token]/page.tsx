import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { createHash } from 'node:crypto';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import {
  TABLE_SESSION_COOKIE,
  TABLE_SESSION_COOKIE_OPTIONS,
  type TableSession,
} from '@/lib/table-session';
import { QrProblemScreen } from '@/components/screens/QrProblemScreen';

export const metadata: Metadata = {
  title: 'Finding your table · AutoDine',
  robots: { index: false, follow: false },
};

/**
 * What a printed QR code points at: /t/<public token>.
 *
 * Scanning exchanges that token for a short-lived table session, which is
 * then stored in a cookie. Everything after this -- the menu, the cart, the
 * order -- reads the session from that cookie, so an order can be stamped
 * with the table it was placed at.
 *
 * The token in the URL is the QR's public token, which is printed on the
 * table and is not a secret. The session token it is exchanged for is, and
 * that one never appears in a URL: it goes straight into an httpOnly cookie.
 * A URL gets copied into messages and ends up in browser history; a cookie
 * does not travel that way.
 *
 * Noindex: a scanned URL is not a page anyone should find.
 */

/**
 * A stable, non-reversible fingerprint of the caller's address.
 *
 * The database rate-limits verification attempts per code and per IP hash,
 * and requires the hash to be 64 hex characters. Salting with the QR token
 * means a hash from one table's code cannot be correlated with another's --
 * without it, the attempt log would be a record of which addresses scanned
 * which tables, which is more than rate limiting needs to know.
 *
 * The address is taken from the forwarded header because that is what carries
 * it behind Vercel. It is a header, so it can be forged; that is accepted
 * here. Rate limiting by IP is a brake on casual probing, not a control an
 * attacker cannot walk around, and pretending otherwise would be worse.
 */
function ipHash(address: string, salt: string): string {
  return createHash('sha256').update(`${address}|${salt}`).digest('hex');
}

async function clientAddress(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return h.get('x-real-ip')?.trim() || 'unknown';
}

export default async function TableQrPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isSupabaseConfigured) {
    return (
      <QrProblemScreen
        title="Ordering is not switched on yet"
        detail="This restaurant has not connected its ordering system. Please order with staff."
      />
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return (
      <QrProblemScreen
        title="Ordering is not switched on yet"
        detail="This restaurant has not connected its ordering system. Please order with staff."
      />
    );
  }

  const { data, error } = await supabase.rpc('verify_table_qr', {
    p_public_token: token,
    p_ip_hash: ipHash(await clientAddress(), token),
  });

  const row = Array.isArray(data) ? data[0] : undefined;

  if (error || !row) {
    // The function raises P0001 for everything a guest can cause, and its
    // messages are written for a guest to read. Anything else is ours, not
    // theirs, and must not be shown.
    const message =
      error?.code === 'P0001'
        ? error.message
        : 'We could not read this code. Please ask staff for the current one.';

    if (error && error.code !== 'P0001') {
      console.error('[verify_table_qr] unexpected failure', error);
    }

    return (
      <QrProblemScreen
        title="This code did not work"
        detail={message}
        staffHint="If this code is printed and still failing, the table may have been taken out of service or its code replaced."
      />
    );
  }

  const session: TableSession = {
    token: row.session_token,
    slug: row.restaurant_slug,
    tableLabel: row.table_label,
    expiresAt: row.expires_at,
  };

  (await cookies()).set(TABLE_SESSION_COOKIE, JSON.stringify(session), {
    ...TABLE_SESSION_COOKIE_OPTIONS,
    // The cookie must not outlive the session it carries. Both are an hour;
    // taking a minute off the cookie means the browser forgets first, so a
    // guest never holds a cookie for a session the database has dropped.
    maxAge: Math.min(TABLE_SESSION_COOKIE_OPTIONS.maxAge, 60 * 59),
  });

  redirect(`/menu?s=${encodeURIComponent(session.slug)}`);
}
