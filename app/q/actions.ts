'use server';

import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getPublicTableQr, TABLE_SESSION_COOKIE } from '@/lib/db/table-verification';
import { currentVenueCode, hashSessionToken, isCurrentVenueCode, normalizePublicQrToken, normalizeVerificationCode, parseQrVerificationSecret, forwardedClientIp, rateLimitIpFingerprint, QR_SESSION_TTL_SECONDS } from '@/lib/qr-verification-crypto';
import { requireWorkspaceForAction } from '@/lib/db/workspace-access';
import { canManageVenueCode, canViewVenueCode } from '@/lib/qr-authorization';

function verificationRedirect(token: string, state: 'invalid' | 'unavailable' | 'cooldown' | 'incorrect'): never {
  redirect(`/q/${encodeURIComponent(token)}?status=${state}`);
}

/** Guest submits the six-digit code in the POST body; neither the code nor the session token enters a URL. */
export async function verifyTableCodeAction(formData: FormData): Promise<void> {
  const rawToken = String(formData.get('qrToken') ?? '');
  const qrToken = normalizePublicQrToken(rawToken);
  const code = normalizeVerificationCode(String(formData.get('code') ?? ''));
  if (!qrToken) redirect('/menu?verification=invalid');
  if (!code) verificationRedirect(qrToken, 'invalid');

  const admin = getSupabaseAdmin();
  const secret = parseQrVerificationSecret(process.env.QR_VERIFICATION_SECRET);
  if (!admin || !secret) verificationRedirect(qrToken, 'unavailable');

  const qr = await getPublicTableQr(qrToken);
  if (!qr) verificationRedirect(qrToken, 'unavailable');

  // Vercel terminates the public connection and supplies this trusted header.
  // Invalid/missing values fail closed; raw addresses are never persisted.
  const requestHeaders = await headers();
  const clientIp = forwardedClientIp(requestHeaders.get('x-forwarded-for'));
  if (!clientIp) verificationRedirect(qrToken, 'unavailable');
  const ipHash = rateLimitIpFingerprint(secret, clientIp);

  const { data: reservation, error: reservationError } = await admin.rpc('reserve_qr_verification_attempt', {
    p_qr_code_id: qr.id,
    p_ip_hash: ipHash,
  });
  if (reservationError || !reservation?.[0]) verificationRedirect(qrToken, 'unavailable');
  if (!reservation[0].allowed) verificationRedirect(qrToken, 'cooldown');

  const { data: settings, error: settingsError } = await admin
    .from('restaurant_verification_settings')
    .select('code_version')
    .eq('restaurant_id', qr.restaurantId)
    .maybeSingle();
  if (settingsError) verificationRedirect(qrToken, 'unavailable');
  const codeVersion = settings?.code_version ?? 1;

  if (!isCurrentVenueCode(secret, qr.restaurantId, codeVersion, code)) {
    const { data: blocked, error: failureError } = await admin.rpc('record_qr_verification_failure', {
      p_qr_code_id: qr.id,
      p_ip_hash: ipHash,
    });
    if (failureError) verificationRedirect(qrToken, 'unavailable');
    verificationRedirect(qrToken, blocked ? 'cooldown' : 'incorrect');
  }

  const rawSessionToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + QR_SESSION_TTL_SECONDS * 1000).toISOString();
  const { error: sessionError } = await admin.from('table_verification_sessions').insert({
    token_hash: hashSessionToken(rawSessionToken),
    restaurant_id: qr.restaurantId,
    table_id: qr.tableId,
    qr_code_id: qr.id,
    expires_at: expiresAt,
  });
  if (sessionError) verificationRedirect(qrToken, 'unavailable');

  const cookieStore = await cookies();
  cookieStore.set(TABLE_SESSION_COOKIE, rawSessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresAt),
  });
  await admin.rpc('clear_qr_verification_attempts', { p_qr_code_id: qr.id, p_ip_hash: ipHash });
  redirect(`/menu?s=${encodeURIComponent(qr.restaurantSlug)}`);
}

export type VenueCodeView = {
  ok: boolean;
  code?: string;
  validUntil?: string;
  cashierAccessEnabled?: boolean;
  error?: string;
};

export async function getVenueVerificationCodeAction(slug: string): Promise<VenueCodeView> {
  try {
    const { workspace } = await requireWorkspaceForAction(slug);
    const admin = getSupabaseAdmin();
    const secret = parseQrVerificationSecret(process.env.QR_VERIFICATION_SECRET);
    if (!admin || !secret) return { ok: false, error: 'Code service is not configured.' };

    const { data: settings, error } = await admin
      .from('restaurant_verification_settings')
      .select('code_version, cashier_access_enabled')
      .eq('restaurant_id', workspace.id)
      .maybeSingle();
    if (error) return { ok: false, error: 'Code service is temporarily unavailable.' };
    const cashierAccessEnabled = settings?.cashier_access_enabled ?? false;
    const mayView = canViewVenueCode(workspace.role, cashierAccessEnabled);
    if (!mayView) return { ok: false, error: 'Only an authorized owner or manager can view this code.' };

    const current = currentVenueCode(secret, workspace.id, settings?.code_version ?? 1);
    return { ok: true, code: current.code, validUntil: current.validUntil, cashierAccessEnabled };
  } catch {
    return { ok: false, error: 'Workspace authorization failed.' };
  }
}

export async function rotateVenueVerificationCodeAction(slug: string): Promise<VenueCodeView> {
  try {
    const { workspace, userId } = await requireWorkspaceForAction(slug);
    if (!canManageVenueCode(workspace.role)) {
      return { ok: false, error: 'Only an owner or manager can rotate this code.' };
    }
    const admin = getSupabaseAdmin();
    const secret = parseQrVerificationSecret(process.env.QR_VERIFICATION_SECRET);
    if (!admin || !secret) return { ok: false, error: 'Code service is not configured.' };

    const { error: rotateError } = await admin.rpc('rotate_restaurant_verification_code', {
      p_restaurant_id: workspace.id,
      p_actor_id: userId,
    });
    if (rotateError) return { ok: false, error: 'Could not rotate the code. Please try again.' };
    const { data: settings, error } = await admin
      .from('restaurant_verification_settings')
      .select('code_version, cashier_access_enabled')
      .eq('restaurant_id', workspace.id)
      .single();
    if (error || !settings) return { ok: false, error: 'Code service is temporarily unavailable.' };
    const current = currentVenueCode(secret, workspace.id, settings.code_version);
    return { ok: true, code: current.code, validUntil: current.validUntil, cashierAccessEnabled: settings.cashier_access_enabled };
  } catch {
    return { ok: false, error: 'Workspace authorization failed.' };
  }
}

export async function setCashierCodeAccessAction(slug: string, enabled: boolean): Promise<VenueCodeView> {
  try {
    const { workspace, userId } = await requireWorkspaceForAction(slug);
    if (!canManageVenueCode(workspace.role)) {
      return { ok: false, error: 'Only an owner or manager can change cashier access.' };
    }
    const admin = getSupabaseAdmin();
    const secret = parseQrVerificationSecret(process.env.QR_VERIFICATION_SECRET);
    if (!admin || !secret) return { ok: false, error: 'Code service is not configured.' };

    const { error } = await admin.from('restaurant_verification_settings').upsert({
      restaurant_id: workspace.id,
      cashier_access_enabled: enabled,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'restaurant_id' });
    if (error) return { ok: false, error: 'Could not update cashier access.' };
    return getVenueVerificationCodeAction(slug);
  } catch {
    return { ok: false, error: 'Workspace authorization failed.' };
  }
}
