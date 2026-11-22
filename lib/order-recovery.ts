/**
 * Client-side pending/failed order persistence for duplicate-free recovery.
 *
 * WHY THIS EXISTS
 *
 * A checkout attempt can fail in two different ways:
 *   1. The server refused it cleanly (validation, sold out, rate limit) and
 *      redirected back to the cart with `?error=...`.
 *   2. The network dropped mid-POST or the browser went offline *after* the
 *      server may or may not have committed the order.
 *
 * Without persisting the attempt UUID across reloads and retries, the next tap
 * would mint a brand-new `guest_token` and risk creating a duplicate kitchen
 * ticket. Persisting the attempt key alongside the cart signature lets:
 *   - Checkout & Cart reuse the SAME `attemptToken` for retries of the same cart;
 *   - Reconnect recovery ask `/api/orders/recover` whether the server already
 *     accepted that attempt, landing straight on confirmation with zero duplicates;
 *   - Failed or pending orders remain visibly surfaced instead of disappearing.
 *
 * Pure and StorageLike-scoped (safe under Safari private mode & SSR).
 */

import type { StoredLine } from '@/lib/cart-storage';
import type { StorageLike } from '@/lib/guest-orders';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTEMPT_TTL_MS = 2 * 60 * 60 * 1000;

export type PendingAttemptStatus = 'submitting' | 'pending_recovery' | 'failed';

export type PendingOrderAttempt = {
  attemptToken: string;
  slug: string;
  cartSignature: string;
  itemCount: number;
  note: string;
  status: PendingAttemptStatus;
  errorMessage: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
};

export type PendingCounterOrderStatus = 'submitting' | 'failed';

export type PendingCounterOrder = {
  idempotencyKey: string;
  channel: 'dine_in' | 'takeaway' | 'delivery';
  tableId: string | null;
  tableLabel: string | null;
  lines: Array<{ itemId: string; variantId?: string | null; qty: number }>;
  itemCount: number;
  note: string;
  customerName: string;
  customerPhone: string;
  status: PendingCounterOrderStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export function pendingOrderKey(slug: string): string {
  return `ad_pending_order:${slug.trim().toLowerCase()}`;
}

export function staffPendingOrdersKey(restaurantId: string): string {
  return `ad_staff_pending_orders:${restaurantId.trim().toLowerCase()}`;
}

export function generateAttemptUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback for environments without crypto.randomUUID.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildCartSignature(lines: StoredLine[]): string {
  if (!Array.isArray(lines) || lines.length === 0) return '';
  return lines
    .map((l) => {
      const addons = Array.isArray(l.addonIds) ? [...l.addonIds].sort().join(',') : '';
      return `${l.itemId}:${l.variantId ?? ''}:${addons}:${l.qty}`;
    })
    .sort()
    .join('|');
}

function parsePendingAttempt(raw: string | null, nowMs = Date.now()): PendingOrderAttempt | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const attemptToken = typeof parsed.attemptToken === 'string' ? parsed.attemptToken.trim() : '';
    const slug = typeof parsed.slug === 'string' ? parsed.slug.trim() : '';
    const cartSignature = typeof parsed.cartSignature === 'string' ? parsed.cartSignature : '';
    const status = parsed.status;
    const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '';
    const createdAt = typeof parsed.createdAt === 'string' ? parsed.createdAt : updatedAt;

    if (!UUID_RE.test(attemptToken) || !slug || !cartSignature) return null;
    if (status !== 'submitting' && status !== 'pending_recovery' && status !== 'failed') return null;

    const updatedMs = new Date(updatedAt).getTime();
    if (!Number.isNaN(updatedMs) && nowMs - updatedMs > ATTEMPT_TTL_MS) return null;

    return {
      attemptToken,
      slug,
      cartSignature,
      itemCount: typeof parsed.itemCount === 'number' && Number.isFinite(parsed.itemCount) ? parsed.itemCount : 0,
      note: typeof parsed.note === 'string' ? parsed.note : '',
      status,
      errorMessage: typeof parsed.errorMessage === 'string' ? parsed.errorMessage : null,
      errorCode: typeof parsed.errorCode === 'string' ? parsed.errorCode : null,
      createdAt,
      updatedAt,
      lastCheckedAt: typeof parsed.lastCheckedAt === 'string' ? parsed.lastCheckedAt : null,
    };
  } catch {
    return null;
  }
}

export function readPendingOrderAttempt(
  storage: StorageLike | null,
  slug: string,
  nowMs = Date.now(),
): PendingOrderAttempt | null {
  if (!storage || !slug.trim()) return null;
  try {
    return parsePendingAttempt(storage.getItem(pendingOrderKey(slug)), nowMs);
  } catch {
    return null;
  }
}

function writePendingAttempt(storage: StorageLike | null, attempt: PendingOrderAttempt): void {
  if (!storage) return;
  try {
    storage.setItem(pendingOrderKey(attempt.slug), JSON.stringify(attempt));
  } catch {
    // Storage quota or private browsing restriction — never crash checkout.
  }
}

/**
 * Reuse an active attempt UUID for the same cart so retries cannot create
 * duplicate orders, or mint a new UUID if the cart changed.
 */
export function ensurePendingAttemptToken(
  storage: StorageLike | null,
  slug: string,
  lines: StoredLine[],
  nowMs = Date.now(),
): { token: string; reused: boolean } {
  const sig = buildCartSignature(lines);
  const existing = readPendingOrderAttempt(storage, slug, nowMs);
  if (existing && existing.cartSignature === sig) {
    return { token: existing.attemptToken, reused: true };
  }
  return { token: generateAttemptUuid(), reused: false };
}

export function markPendingOrderSubmitting(
  storage: StorageLike | null,
  input: {
    attemptToken: string;
    slug: string;
    lines: StoredLine[];
    note?: string;
    nowIso?: string;
  },
): PendingOrderAttempt | null {
  if (!UUID_RE.test(input.attemptToken) || !input.slug.trim()) return null;
  const nowIso = input.nowIso ?? new Date().toISOString();
  const existing = readPendingOrderAttempt(storage, input.slug);
  const sig = buildCartSignature(input.lines);
  const itemCount = input.lines.reduce((sum, l) => sum + l.qty, 0);
  const next: PendingOrderAttempt = {
    attemptToken: input.attemptToken,
    slug: input.slug.trim(),
    cartSignature: sig,
    itemCount,
    note: (input.note ?? '').slice(0, 300),
    status: 'submitting',
    errorMessage: null,
    errorCode: null,
    createdAt: existing?.attemptToken === input.attemptToken ? existing.createdAt : nowIso,
    updatedAt: nowIso,
    lastCheckedAt: existing?.lastCheckedAt ?? null,
  };
  writePendingAttempt(storage, next);
  return next;
}

export function markPendingOrderOutcome(
  storage: StorageLike | null,
  slug: string,
  status: PendingAttemptStatus,
  details?: { errorMessage?: string | null; errorCode?: string | null; lastCheckedAt?: string | null },
  nowIso = new Date().toISOString(),
): PendingOrderAttempt | null {
  const existing = readPendingOrderAttempt(storage, slug);
  if (!existing) return null;
  const next: PendingOrderAttempt = {
    ...existing,
    status,
    errorMessage: details?.errorMessage !== undefined ? details.errorMessage : existing.errorMessage,
    errorCode: details?.errorCode !== undefined ? details.errorCode : existing.errorCode,
    lastCheckedAt: details?.lastCheckedAt !== undefined ? details.lastCheckedAt : existing.lastCheckedAt,
    updatedAt: nowIso,
  };
  writePendingAttempt(storage, next);
  return next;
}

export function clearPendingOrderAttempt(storage: StorageLike | null, slug: string): void {
  if (!storage || !slug.trim()) return;
  try {
    storage.removeItem(pendingOrderKey(slug));
  } catch {
    // Ignore storage removal errors.
  }
}

// ---------------------------------------------------------------------------
// Staff counter pending/failed order queue
// ---------------------------------------------------------------------------

export function readPendingCounterOrders(
  storage: StorageLike | null,
  restaurantId: string,
  nowMs = Date.now(),
): PendingCounterOrder[] {
  if (!storage || !restaurantId.trim()) return [];
  try {
    const raw = storage.getItem(staffPendingOrdersKey(restaurantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is PendingCounterOrder => {
        if (!entry || typeof entry !== 'object') return false;
        const row = entry as Record<string, unknown>;
        if (typeof row.idempotencyKey !== 'string' || !UUID_RE.test(row.idempotencyKey)) return false;
        if (row.channel !== 'dine_in' && row.channel !== 'takeaway' && row.channel !== 'delivery') return false;
        if (row.status !== 'submitting' && row.status !== 'failed') return false;
        const updatedAt = typeof row.updatedAt === 'string' ? new Date(row.updatedAt).getTime() : NaN;
        if (!Number.isNaN(updatedAt) && nowMs - updatedAt > 24 * 60 * 60 * 1000) return false;
        return Array.isArray(row.lines) && row.lines.length > 0;
      })
      .slice(0, 20);
  } catch {
    return [];
  }
}

function writePendingCounterOrders(
  storage: StorageLike | null,
  restaurantId: string,
  items: PendingCounterOrder[],
): void {
  if (!storage || !restaurantId.trim()) return;
  try {
    if (items.length === 0) storage.removeItem(staffPendingOrdersKey(restaurantId));
    else storage.setItem(staffPendingOrdersKey(restaurantId), JSON.stringify(items.slice(0, 20)));
  } catch {
    // Ignore storage errors.
  }
}

export function upsertPendingCounterOrder(
  storage: StorageLike | null,
  restaurantId: string,
  entry: PendingCounterOrder,
): PendingCounterOrder[] {
  const existing = readPendingCounterOrders(storage, restaurantId);
  const next = [entry, ...existing.filter((item) => item.idempotencyKey !== entry.idempotencyKey)];
  writePendingCounterOrders(storage, restaurantId, next);
  return next;
}

export function removePendingCounterOrder(
  storage: StorageLike | null,
  restaurantId: string,
  idempotencyKey: string,
): PendingCounterOrder[] {
  const existing = readPendingCounterOrders(storage, restaurantId);
  const next = existing.filter((item) => item.idempotencyKey !== idempotencyKey);
  writePendingCounterOrders(storage, restaurantId, next);
  return next;
}
