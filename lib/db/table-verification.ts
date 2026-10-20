import 'server-only';

import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { hashSessionToken, normalizePublicQrToken } from '@/lib/qr-verification-crypto';

export const TABLE_SESSION_COOKIE = 'autodine_table_session';

export type PublicTableQr = {
  id: string;
  publicToken: string;
  restaurantId: string;
  restaurantSlug: string;
  restaurantName: string;
  tableId: string;
  tableLabel: string;
};

export type VerifiedTableSession = {
  restaurantId: string;
  restaurantSlug: string;
  tableId: string;
  qrCodeId: string;
  expiresAt: string;
};

export async function getPublicTableQr(rawToken: string): Promise<PublicTableQr | null> {
  const token = normalizePublicQrToken(rawToken);
  const admin = getSupabaseAdmin();
  if (!token || !admin) return null;

  const { data: qr, error: qrError } = await admin
    .from('table_qr_codes')
    .select('id, public_token, restaurant_id, table_id, revoked_at')
    .eq('public_token', token)
    .maybeSingle();
  if (qrError || !qr || qr.revoked_at) return null;

  const [tableResult, restaurantResult] = await Promise.all([
    admin.from('dining_tables').select('id, label, restaurant_id, is_active').eq('id', qr.table_id).maybeSingle(),
    admin.from('restaurants').select('id, slug, name, is_active').eq('id', qr.restaurant_id).maybeSingle(),
  ]);
  const table = tableResult.data;
  const restaurant = restaurantResult.data;
  if (
    tableResult.error || restaurantResult.error || !table || !restaurant ||
    !table.is_active || !restaurant.is_active ||
    table.restaurant_id !== qr.restaurant_id || restaurant.id !== qr.restaurant_id
  ) return null;

  return {
    id: qr.id,
    publicToken: qr.public_token,
    restaurantId: qr.restaurant_id,
    restaurantSlug: restaurant.slug,
    restaurantName: restaurant.name,
    tableId: table.id,
    tableLabel: table.label,
  };
}

export async function resolveTableSession(rawToken: string | undefined): Promise<VerifiedTableSession | null> {
  if (!rawToken || !/^[A-Fa-f0-9]{64}$/.test(rawToken)) return null;
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data: session, error } = await admin
    .from('table_verification_sessions')
    .select('token_hash, restaurant_id, table_id, qr_code_id, expires_at, revoked_at')
    .eq('token_hash', hashSessionToken(rawToken))
    .maybeSingle();
  if (error || !session || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) return null;

  const [qrResult, tableResult, restaurantResult] = await Promise.all([
    admin.from('table_qr_codes').select('id, restaurant_id, table_id, revoked_at').eq('id', session.qr_code_id).maybeSingle(),
    admin.from('dining_tables').select('id, restaurant_id, is_active').eq('id', session.table_id).maybeSingle(),
    admin.from('restaurants').select('id, slug, is_active').eq('id', session.restaurant_id).maybeSingle(),
  ]);
  const qr = qrResult.data;
  const table = tableResult.data;
  const restaurant = restaurantResult.data;
  if (
    qrResult.error || tableResult.error || restaurantResult.error || !qr || !table || !restaurant ||
    qr.revoked_at || !table.is_active || !restaurant.is_active ||
    session.restaurant_id !== qr.restaurant_id || session.table_id !== qr.table_id ||
    table.restaurant_id !== session.restaurant_id || restaurant.id !== session.restaurant_id
  ) return null;

  return {
    restaurantId: session.restaurant_id,
    restaurantSlug: restaurant.slug,
    tableId: session.table_id,
    qrCodeId: session.qr_code_id,
    expiresAt: session.expires_at,
  };
}

export async function getCookieTableSession(): Promise<VerifiedTableSession | null> {
  const store = await cookies();
  return resolveTableSession(store.get(TABLE_SESSION_COOKIE)?.value);
}
