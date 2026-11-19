/**
 * Pure helpers for the global announcement notification store.
 *
 * Kept separate from React so every behavior is unit-testable without
 * a browser or a database. The provider is a thin wrapper around these.
 */

import type {
  AnnouncementEvent,
  WrittenNotification,
  SeenState,
} from './types';
import { MAX_NOTIFICATIONS } from './types';
import { newOrderText, newOrderTextEn, waiterCallAnnouncement } from '@/lib/announce';
import type { AnnouncementLang } from './types';

/** Build a written notification from an announcement event. */
export function eventToNotification(
  event: AnnouncementEvent,
  lang: AnnouncementLang,
  receivedAt: string,
): WrittenNotification {
  if (event.kind === 'order') {
    const itemsText = event.items
      .map((it) => `${it.qty}x ${it.name}${it.detail ? ` (${it.detail})` : ''}`)
      .join(', ');
    const notePart = event.note?.trim() ? ` Note: ${event.note.trim()}` : '';
    return {
      id: `order:${event.orderId}`,
      kind: 'order',
      table: event.table,
      title: lang === 'hi' ? `नया ऑर्डर — टेबल ${event.table}` : `New order — Table ${event.table}`,
      body: `${event.code} · ${itemsText}${notePart}`,
      orderDetails: {
        code: event.code,
        items: event.items.map((it) => ({ qty: it.qty, name: it.name, detail: it.detail })),
        note: event.note,
      },
      createdAt: event.placedAt,
      read: false,
      eventAt: event.eventAt,
      receivedAt,
    };
  }
  // waiter
  return {
    id: `waiter:${event.callId}`,
    kind: 'waiter',
    table: event.table,
    title: lang === 'hi' ? `वेटर कॉल — टेबल ${event.table}` : `Waiter call — Table ${event.table}`,
    body: lang === 'hi'
      ? `टेबल ${event.table} को सहायता चाहिए`
      : `Table ${event.table} needs assistance`,
    createdAt: event.createdAt,
    read: false,
    eventAt: event.eventAt,
    receivedAt,
  };
}

/** Build voice text for an event, using actual order data — never invented. */
export function eventToVoiceText(
  event: AnnouncementEvent,
  lang: AnnouncementLang,
): string {
  if (event.kind === 'order') {
    // Use actual ordered data: table, item names, quantities, special instructions
    const items = event.items.map((it) => ({
      qty: it.qty,
      name: it.name,
      detail: it.detail,
      spoken: it.spoken ?? null,
    }));
    if (lang === 'hi') {
      return newOrderText(event.table, items, event.note);
    }
    return newOrderTextEn(event.table, items, event.note);
  }
  // Waiter call: table number only, professional delivery
  if (lang === 'hi') {
    return waiterCallAnnouncement(event.table);
  }
  // English waiter call
  const safeTable = event.table.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40) || 'Table';
  return `Waiter call. Table ${safeTable} needs assistance.`;
}

/** Deduplicate events against seen state — exactly one announcement per event. */
export function filterUnseenEvents(
  events: AnnouncementEvent[],
  seen: SeenState,
): AnnouncementEvent[] {
  const seenOrderIds = new Set(seen.orderIds);
  const seenWaiterIds = new Set(seen.waiterCallIds);
  return events.filter((e) => {
    if (e.kind === 'order') return !seenOrderIds.has(e.orderId);
    return !seenWaiterIds.has(e.callId);
  });
}

/** Update seen state with new events. */
export function updateSeenWithEvents(
  seen: SeenState,
  events: AnnouncementEvent[],
): SeenState {
  const orderIds = [...seen.orderIds];
  const waiterCallIds = [...seen.waiterCallIds];
  const orderSet = new Set(orderIds);
  const waiterSet = new Set(waiterCallIds);
  for (const e of events) {
    if (e.kind === 'order' && !orderSet.has(e.orderId)) {
      orderIds.push(e.orderId);
      orderSet.add(e.orderId);
    } else if (e.kind === 'waiter' && !waiterSet.has(e.callId)) {
      waiterCallIds.push(e.callId);
      waiterSet.add(e.callId);
    }
  }
  // Cap at 500 entries to avoid unbounded growth
  return {
    orderIds: orderIds.slice(-500),
    waiterCallIds: waiterCallIds.slice(-500),
  };
}

/** Add notifications, deduplicated by id, capped at MAX_NOTIFICATIONS. */
export function addNotifications(
  existing: WrittenNotification[],
  newcomers: WrittenNotification[],
): WrittenNotification[] {
  const existingIds = new Set(existing.map((n) => n.id));
  const toAdd = newcomers.filter((n) => !existingIds.has(n.id));
  // Newest first
  return [...toAdd, ...existing].slice(0, MAX_NOTIFICATIONS);
}

/** Mark a notification as read. */
export function markRead(
  notifications: WrittenNotification[],
  id: string,
): WrittenNotification[] {
  return notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
}

/** Mark all as read. */
export function markAllRead(notifications: WrittenNotification[]): WrittenNotification[] {
  return notifications.map((n) => ({ ...n, read: true }));
}

/** Count unread. */
export function unreadCount(notifications: WrittenNotification[]): number {
  return notifications.filter((n) => !n.read).length;
}

/** Latency measurement: end-to-end from event creation to voice playback start. */
export function measureLatencyMs(eventAt: string, nowMs: number): number {
  const eventMs = new Date(eventAt).getTime();
  if (Number.isNaN(eventMs)) return -1;
  return nowMs - eventMs;
}

/**
 * Check if an announcement is stale and eligible for recovery.
 * A claimed waiter call that hasn't been marked announced/failed within
 * CLAIM_RECOVERY_MS may be re-claimed by another device.
 */
export function isStaleClaim(claimedAt: string | null | undefined, nowMs: number, recoveryMs: number): boolean {
  if (!claimedAt) return false;
  const claimedMs = new Date(claimedAt).getTime();
  if (Number.isNaN(claimedMs)) return false;
  return nowMs - claimedMs > recoveryMs;
}
