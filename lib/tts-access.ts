import { getStaffContextDetailed, KITCHEN_ROLES } from '@/lib/db/staff';

/** Authorize and reserve a shared budget before contacting the voice provider.
 * Public demo uses device speech; no credentials/DB means no provider relay. */
export async function authorizeTts(): Promise<Response | null> {
  const deny = (status: number, error: string, retry?: number) => Response.json({ error }, {
    status, headers: { 'Cache-Control': 'no-store', ...(retry ? { 'Retry-After': String(retry) } : {}) },
  });
  try {
    const staff = await getStaffContextDetailed();
    if (!staff.ok) return deny(staff.reason === 'unconfigured' ? 503 : staff.reason === 'signed-out' ? 401 : 403,
      'Hindi voice relay requires a signed-in restaurant staff account. Device speech remains available.');
    if (!KITCHEN_ROLES.includes(staff.context.role)) return deny(403, 'Kitchen staff permission is required for voice announcements.');
    const { data, error } = await staff.context.supabase.rpc('reserve_staff_tts_attempt', { p_restaurant_id: staff.context.restaurantId });
    if (error || !data?.[0] || typeof data[0].allowed !== 'boolean') return deny(503, 'Voice authorization is temporarily unavailable.', 30);
    if (!data[0].allowed) return deny(429, 'Too many announcements. Please wait and try again.', Math.max(1, data[0].retry_after_seconds || 600));
    return null;
  } catch { return deny(503, 'Voice authorization is temporarily unavailable.', 30); }
}
