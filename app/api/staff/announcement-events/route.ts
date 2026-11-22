/**
 * GET /api/staff/announcement-events
 *
 * Global announcement event feed for the staff application.
 * Returns recent order and waiter-call events for the caller's restaurant.
 *
 * - Tenant-isolated: restaurantId comes from staff session, never from query params
 * - Role-gated: owner, manager, kitchen, cashier may all receive (they are the staff who serve guests)
 * - Minimal projection: only fields needed for voice + written notification
 * - No Realtime: simple polling, works everywhere, preserves existing architecture
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStaffContextDetailed } from '@/lib/db/staff';
import type { AnnouncementEvent } from '@/lib/announcements/types';

export const dynamic = 'force-dynamic';

/** How far back to look for recent orders that may still need announcing */
const RECENT_WINDOW_HOURS = 1;

export async function GET(_request: NextRequest) {
  const requestAt = new Date().toISOString();

  // Authentication & authorization
  const staff = await getStaffContextDetailed();
  if (!staff.ok) {
    const status = staff.reason === 'unconfigured' ? 503 : staff.reason === 'signed-out' ? 401 : 403;
    return NextResponse.json(
      { error: staff.reason === 'signed-out' ? 'Sign in to access announcements' : 'Access denied for announcement feed' },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // All staff roles may receive announcements (they serve guests on different screens)
  const allowedRoles = ['owner', 'manager', 'kitchen', 'cashier'];
  if (!allowedRoles.includes(staff.context.role)) {
    return NextResponse.json({ error: 'Your role cannot access announcements' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  const { supabase, restaurantId } = staff.context;
  const serverTime = new Date().toISOString();
  const cutoff = new Date(Date.now() - RECENT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  try {
    // Fetch recent open orders (prep_status != cancelled) within window
    // These are orders the kitchen may not have seen yet
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, code, table_id, customer_note, prep_status, placed_at, hold_required, confirmed_at')
      .eq('restaurant_id', restaurantId)
      .neq('prep_status', 'cancelled')
      .gte('placed_at', cutoff)
      .order('placed_at', { ascending: true });

    // Fallback: if above fails due to column ordering issue, retry without order
    let orderRows: unknown[] = [];
    if (ordersError) {
      // Try simpler query
      const fallback = await supabase
        .from('orders')
        .select('id, code, table_id, customer_note, prep_status, placed_at')
        .eq('restaurant_id', restaurantId)
        .neq('prep_status', 'cancelled')
        .gte('placed_at', cutoff)
        .order('placed_at', { ascending: true });
      if (!fallback.error && fallback.data) {
        orderRows = fallback.data;
      }
    } else if (orders) {
      orderRows = orders;
    }

    // Fetch table labels + order items in parallel
    const events: AnnouncementEvent[] = [];

    if (orderRows.length > 0) {
      // Gather table IDs
      const tableIds = [...new Set(orderRows.map((r) => (r as Record<string, unknown>).table_id).filter(Boolean) as string[])];
      const orderIds = orderRows.map((r) => (r as Record<string, unknown>).id as string);

      // Batch fetch table labels
      const tableLabelById = new Map<string, string>();
      if (tableIds.length > 0) {
        const { data: tables } = await supabase
          .from('dining_tables')
          .select('id, label')
          .in('id', tableIds);
        if (tables) {
          for (const t of tables as { id: string; label: string }[]) {
            tableLabelById.set(t.id, t.label);
          }
        }
      }

      // Batch fetch order items
      const itemsByOrderId = new Map<string, { qty: number; name: string; detail?: string; spoken?: string | null }[]>();
      if (orderIds.length > 0) {
        const { data: orderItems } = await supabase
          .from('order_items')
          .select('order_id, qty, name_snapshot, variant_snapshot, addons_snapshot, is_veg, item_id')
          .in('order_id', orderIds)
          .order('sort_order', { ascending: true });

        // Resolve spoken_name via items table (if available)
        const itemIds = Array.from(new Set((orderItems ?? []).map((r) => (r as { item_id: string | null }).item_id).filter(Boolean) as string[]));
        const spokenByItemId = new Map<string, string>();
        if (itemIds.length > 0) {
          const { data: spokenRows } = await supabase.from('items').select('id, spoken_name').in('id', itemIds);
          for (const row of (spokenRows as { id: string; spoken_name: string | null }[] | null) ?? []) {
            if (row.spoken_name) spokenByItemId.set(row.id, row.spoken_name);
          }
        }

        if (orderItems) {
          for (const item of orderItems as { order_id: string; qty: number; name_snapshot: string; variant_snapshot: string | null; addons_snapshot: unknown; item_id: string | null }[]) {
            const list = itemsByOrderId.get(item.order_id) ?? [];
            // Build detail from variant/addons similar to kitchen-screen
            const variant = item.variant_snapshot?.trim() || '';
            const addons = Array.isArray(item.addons_snapshot) ? (item.addons_snapshot as string[]) : [];
            const detailParts: string[] = [];
            if (variant) detailParts.push(variant);
            for (const addon of addons) {
              if (typeof addon === 'string') detailParts.push(addon);
              else if (addon && typeof addon === 'object' && 'name' in addon) detailParts.push(String((addon as { name: string }).name));
            }
            const detail = detailParts.length > 0 ? detailParts.join(' · ') : undefined;
            list.push({
              qty: item.qty,
              name: item.name_snapshot || 'Item',
              detail,
              spoken: item.item_id ? (spokenByItemId.get(item.item_id) ?? null) : null,
            });
            itemsByOrderId.set(item.order_id, list);
          }
        }
      }

      for (const row of orderRows as { id: string; code: string; table_id: string | null; customer_note: string | null; prep_status: string; placed_at: string; hold_required?: boolean; confirmed_at?: string | null }[]) {
        // Skip unconfirmed holds — not yet a real order
        if (row.hold_required && !row.confirmed_at) continue;
        // Only announce 'new' orders (primary use case). Strict scope: not cancellations, not status changes.
        // However, we include all recent non-cancelled orders so the client can filter by seen set.
        // The client tracks seen orderIds and only announces unseen ones.

        const table = row.table_id ? tableLabelById.get(row.table_id) ?? 'Takeaway' : 'Takeaway';
        const items = itemsByOrderId.get(row.id) ?? [{ qty: 1, name: 'Order', detail: undefined }];

        events.push({
          kind: 'order',
          orderId: row.id,
          code: row.code || row.id.slice(0, 8),
          table,
          placedAt: row.placed_at,
          items,
          note: row.customer_note ?? null,
          eventAt: row.placed_at,
        });
      }
    }

    // Fetch active waiter calls (only 'open' ones that need announcing)
    const { data: waiterCalls, error: waiterError } = await supabase
      .from('table_waiter_calls')
      .select('id, table_label_snapshot, created_at, announcement_status, announcement_claimed_at')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'open')
      .order('created_at', { ascending: true });

    if (!waiterError && waiterCalls) {
      const CLAIM_RECOVERY_MS = 2 * 60 * 1000;
      const nowMs = Date.now();
      for (const call of waiterCalls as { id: string; table_label_snapshot: string; created_at: string; announcement_status: string; announcement_claimed_at: string | null }[]) {
        // Skip resolved (already matched status='open')
        // Recovery: if 'claimed' but stale (>2min), treat as 'pending' for re-claim
        if (call.announcement_status === 'pending') {
          events.push({
            kind: 'waiter',
            callId: call.id,
            table: call.table_label_snapshot,
            createdAt: call.created_at,
            eventAt: call.created_at,
          });
        } else if (call.announcement_status === 'claimed') {
          // Recovery: allow re-announcement if claim is stale
          const claimedMs = call.announcement_claimed_at ? new Date(call.announcement_claimed_at).getTime() : NaN;
          if (!Number.isNaN(claimedMs) && nowMs - claimedMs > CLAIM_RECOVERY_MS) {
            events.push({
              kind: 'waiter',
              callId: call.id,
              table: call.table_label_snapshot,
              createdAt: call.created_at,
              eventAt: call.created_at,
            });
          }
        }
        // 'announced' and 'failed' are not re-queued — they have terminal state
      }
    }

    return NextResponse.json(
      {
        restaurantId,
        events,
        serverTime,
        requestAt,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Announcement-Count': String(events.length),
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load announcements';
    return NextResponse.json({ error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
