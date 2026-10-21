'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { resolveTableSession, TABLE_SESSION_COOKIE } from '@/lib/db/table-verification';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ORDER_LINES = 99;
const MAX_LINE_QUANTITY = 99;
const MAX_ITEMS_JSON_LENGTH = 24_000;

type GuestOrderLine = {
  item_id: string;
  qty: number;
  variant_id?: string;
  addons?: string[];
};

function returnToCheckout(slug: string, status: string): never {
  const query = new URLSearchParams({ s: slug, status });
  redirect(`/menu/checkout?${query.toString()}`);
}

function safeOrderError(message: string): string {
  if (/verification has expired|verification is no longer valid/i.test(message)) return 'session';
  if (/read-only/i.test(message)) return 'read-only';
  if (/no longer available|invalid variant|invalid quantity|order is empty|menu is not currently available/i.test(message)) return 'items';
  if (/unpriced add-ons/i.test(message)) return 'options';
  return 'unavailable';
}

export async function placeGuestOrderAction(formData: FormData): Promise<void> {
  if (!isSupabaseConfigured) redirect('/menu/checkout?status=preview');

  const store = await cookies();
  const sessionToken = store.get(TABLE_SESSION_COOKIE)?.value;
  const session = await resolveTableSession(sessionToken);
  if (!session || !sessionToken) redirect('/menu/checkout?status=session');
  const slug = session.restaurantSlug;

  const requestId = String(formData.get('request_id') ?? '').trim();
  if (!UUID.test(requestId)) returnToCheckout(slug, 'invalid');

  const serializedItems = String(formData.get('items') ?? '');
  if (!serializedItems || serializedItems.length > MAX_ITEMS_JSON_LENGTH) {
    returnToCheckout(slug, 'items');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedItems);
  } catch {
    returnToCheckout(slug, 'items');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_ORDER_LINES) {
    returnToCheckout(slug, 'items');
  }

  const items: GuestOrderLine[] = [];
  for (const candidate of parsed as unknown[]) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      returnToCheckout(slug, 'items');
    }
    const line = candidate as Record<string, unknown>;
    const itemId = typeof line.item_id === 'string' ? line.item_id : '';
    const qty = Number(line.qty);
    if (!UUID.test(itemId) || !Number.isSafeInteger(qty) || qty <= 0 || qty > MAX_LINE_QUANTITY) {
      returnToCheckout(slug, 'items');
    }

    let variantId: string | undefined;
    if (line.variant_id !== undefined && line.variant_id !== null) {
      if (typeof line.variant_id !== 'string' || !UUID.test(line.variant_id)) {
        returnToCheckout(slug, 'items');
      }
      variantId = line.variant_id;
    }

    let addons: string[] | undefined;
    if (line.addons !== undefined) {
      if (!Array.isArray(line.addons) || !line.addons.every((addon) => typeof addon === 'string')) {
        returnToCheckout(slug, 'items');
      }
      if (line.addons.length > 0) returnToCheckout(slug, 'options');
      addons = [];
    }

    items.push({ item_id: itemId, qty, ...(variantId ? { variant_id: variantId } : {}), ...(addons ? { addons } : {}) });
  }

  const admin = getSupabaseAdmin();
  if (!admin) returnToCheckout(session.restaurantSlug, 'unavailable');

  const { data: canWrite, error: entitlementError } = await admin.rpc('restaurant_can_write', {
    p_restaurant_id: session.restaurantId,
  });
  if (entitlementError || !canWrite) returnToCheckout(session.restaurantSlug, 'read-only');

  let orderId: string | null = null;
  let errorMessage: string | null = null;
  try {
    const result = await admin.rpc('place_order_idempotent', {
      p_session_token: sessionToken,
      p_items: items,
      p_note: null,
      p_request_id: requestId,
    });
    errorMessage = result.error?.message ?? null;
    orderId = result.data;
  } catch {
    returnToCheckout(session.restaurantSlug, 'unavailable');
  }

  if (errorMessage) returnToCheckout(session.restaurantSlug, safeOrderError(errorMessage));
  if (!orderId) returnToCheckout(session.restaurantSlug, 'unavailable');

  returnToCheckout(session.restaurantSlug, 'placed');
}
