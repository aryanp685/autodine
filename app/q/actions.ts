'use server';

import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPublicTableQr, TABLE_SESSION_COOKIE } from '@/lib/db/table-verification';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  forwardedClientIp,
  hashSessionToken,
  normalizePublicQrToken,
  parseQrRateLimitSecret,
  rateLimitIpFingerprint,
  QR_SESSION_TTL_SECONDS,
} from '@/lib/qr-verification-crypto';

function startRedirect(token: string, state: 'unavailable' | 'cooldown'): never {
  redirect(`/q/${encodeURIComponent(token)}?status=${state}`);
}

/** Start a guest table session from the unguessable, revocable QR handle. */
export async function startTableOrderingAction(formData: FormData): Promise<void> {
  const qrToken = normalizePublicQrToken(String(formData.get('qrToken') ?? ''));
  if (!qrToken) redirect('/menu?table=invalid');

  const admin = getSupabaseAdmin();
  const secret = parseQrRateLimitSecret(process.env.QR_VERIFICATION_SECRET);
  if (!admin || !secret) startRedirect(qrToken, 'unavailable');

  const qr = await getPublicTableQr(qrToken);
  if (!qr) startRedirect(qrToken, 'unavailable');

  const cookieStore = await cookies();
  const currentToken = cookieStore.get(TABLE_SESSION_COOKIE)?.value;
  if (currentToken) {
    const { data: existing } = await admin
      .from('table_verification_sessions')
      .select('token_hash, restaurant_id, table_id, qr_code_id, expires_at, revoked_at')
      .eq('token_hash', hashSessionToken(currentToken))
      .maybeSingle();
    if (
      existing && !existing.revoked_at && Date.parse(existing.expires_at) > Date.now() &&
      existing.restaurant_id === qr.restaurantId && existing.table_id === qr.tableId &&
      existing.qr_code_id === qr.id
    ) {
      redirect(`/menu?s=${encodeURIComponent(qr.restaurantSlug)}`);
    }
  }

  const requestHeaders = await headers();
  const clientIp = forwardedClientIp(requestHeaders.get('x-forwarded-for'));
  if (!clientIp) startRedirect(qrToken, 'unavailable');
  const ipHash = rateLimitIpFingerprint(secret, clientIp);

  const { data: reservation, error: reservationError } = await admin.rpc('reserve_qr_verification_attempt', {
    p_qr_code_id: qr.id,
    p_ip_hash: ipHash,
  });
  if (reservationError || !reservation?.[0]) startRedirect(qrToken, 'unavailable');
  if (!reservation[0].allowed) startRedirect(qrToken, 'cooldown');

  const rawSessionToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + QR_SESSION_TTL_SECONDS * 1000).toISOString();
  const { error: sessionError } = await admin.from('table_verification_sessions').insert({
    token_hash: hashSessionToken(rawSessionToken),
    restaurant_id: qr.restaurantId,
    table_id: qr.tableId,
    qr_code_id: qr.id,
    expires_at: expiresAt,
  });
  if (sessionError) startRedirect(qrToken, 'unavailable');

  cookieStore.set(TABLE_SESSION_COOKIE, rawSessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresAt),
  });
  redirect(`/menu?s=${encodeURIComponent(qr.restaurantSlug)}`);
}
