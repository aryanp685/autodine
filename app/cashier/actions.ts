'use server';

import { redirect } from 'next/navigation';
import { mayUseCashier } from '@/lib/db/workspace-selection';
import { requireWorkspaceForAction } from '@/lib/db/workspace-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_COUNTER_ORDER_LINES = 99;
const MAX_COUNTER_LINE_QUANTITY = 99;

type OrderLineInput = { item_id: string; qty: number; variant_id?: string; addons?: string[] };

function go(slug: string, error: string): never {
  const query = new URLSearchParams({ workspace: slug, error });
  redirect(`/cashier?${query.toString()}`);
}

function returnToCashier(slug: string): never {
  const query = new URLSearchParams({ workspace: slug });
  redirect(`/cashier?${query.toString()}`);
}

function safeErrorCode(message: string): string {
  if (/read-only/i.test(message)) return 'read-only';
  if (/no longer available|invalid variant|invalid quantity|quantity must|too many lines|more than 99 lines|order is empty/i.test(message)) return 'items';
  if (/outstanding balance|amount must exactly/i.test(message)) return 'amount';
  if (/cancelled/i.test(message)) return 'cancelled';
  if (/pending orders|no outstanding balance|already paid/i.test(message)) return 'already-paid';
  if (/permission|authorized|restaurant not found|order not found/i.test(message)) return 'permission';
  return 'request';
}

async function getAuthorizedCashier(slug: string) {
  let access: Awaited<ReturnType<typeof requireWorkspaceForAction>>;
  try {
    access = await requireWorkspaceForAction(slug);
  } catch {
    go(slug, 'access');
  }
  if (!mayUseCashier(access.workspace.role)) {
    go(slug, 'permission');
  }
  return access;
}

export async function createCounterOrderAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('workspace') ?? '').trim();
  if (!slug || slug.length > 180) redirect('/login?error=workspace');
  const { supabase } = await getAuthorizedCashier(slug);

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(formData.get('items') ?? ''));
  } catch {
    go(slug, 'items');
  }

  if (
    !Array.isArray(parsed)
    || parsed.length === 0
    || parsed.length > MAX_COUNTER_ORDER_LINES
  ) go(slug, 'items');
  const items: OrderLineInput[] = [];
  for (const candidate of parsed as unknown[]) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) go(slug, 'items');
    const line = candidate as Record<string, unknown>;
    const itemId = typeof line.item_id === 'string' ? line.item_id : '';
    const qty = Number(line.qty);
    if (line.variant_id !== undefined && line.variant_id !== null && typeof line.variant_id !== 'string') {
      go(slug, 'items');
    }
    const variantId = typeof line.variant_id === 'string' && line.variant_id ? line.variant_id : undefined;
    let addons: string[] | undefined;
    if (line.addons !== undefined) {
      if (!Array.isArray(line.addons) || !line.addons.every((addon) => typeof addon === 'string')) go(slug, 'items');
      addons = line.addons as string[];
    }

    if (
      !UUID.test(itemId)
      || !Number.isSafeInteger(qty)
      || qty <= 0
      || qty > MAX_COUNTER_LINE_QUANTITY
    ) go(slug, 'items');
    if (variantId && !UUID.test(variantId)) go(slug, 'items');
    items.push({ item_id: itemId, qty, ...(variantId ? { variant_id: variantId } : {}), ...(addons ? { addons } : {}) });
  }

  const note = String(formData.get('note') ?? '').trim().slice(0, 500);
  let rpcError: { message: string } | null = null;
  let createdOrderId: string | null = null;
  try {
    const result = await supabase.rpc('place_counter_order', {
      p_restaurant_slug: slug,
      p_items: items,
      p_note: note || null,
    });
    rpcError = result.error;
    createdOrderId = result.data;
  } catch {
    go(slug, 'request');
  }
  if (rpcError) go(slug, safeErrorCode(rpcError.message));
  if (!createdOrderId) go(slug, 'request');
  returnToCashier(slug);
}

export async function recordCashPaymentAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('workspace') ?? '').trim();
  const orderId = String(formData.get('order_id') ?? '').trim();
  const amountPaise = Number(formData.get('amount_paise'));
  const idempotencyKey = String(formData.get('idempotency_key') ?? '').trim();

  if (!slug || slug.length > 180) redirect('/login?error=workspace');
  if (!UUID.test(orderId) || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || !UUID.test(idempotencyKey)) {
    go(slug, 'payment-input');
  }

  const { supabase } = await getAuthorizedCashier(slug);
  let rpcError: { message: string } | null = null;
  let paymentId: string | null = null;
  try {
    const result = await supabase.rpc('record_cash_payment', {
      p_restaurant_slug: slug,
      p_order_id: orderId,
      p_amount_paise: amountPaise,
      p_idempotency_key: idempotencyKey,
    });
    rpcError = result.error;
    paymentId = result.data;
  } catch {
    go(slug, 'request');
  }
  if (rpcError) go(slug, safeErrorCode(rpcError.message));
  if (!paymentId) go(slug, 'request');
  returnToCashier(slug);
}
