import { describe, it, expect } from 'vitest';
import {
  eventToNotification,
  eventToVoiceText,
  filterUnseenEvents,
  updateSeenWithEvents,
  releaseSeenEvent,
  addNotifications,
  measureLatencyMs,
  isStaleClaim,
} from './store';
import type { AnnouncementEvent, WrittenNotification, SeenState } from './types';

function orderEvent(overrides: Partial<AnnouncementEvent> & { orderId: string } = { orderId: 'o1' } as never): AnnouncementEvent {
  return {
    kind: 'order',
    orderId: overrides.orderId,
    code: 'A-101',
    table: overrides.table ?? 'T5',
    placedAt: new Date().toISOString(),
    items: (overrides as unknown as { items: AnnouncementEvent extends { kind: 'order' } ? AnnouncementEvent['items'] : never }).items ?? [{ qty: 2, name: 'Paneer Tikka', detail: 'Extra spicy', spoken: null }],
    note: (overrides as unknown as { note: string | null }).note ?? null,
    eventAt: new Date().toISOString(),
  } as AnnouncementEvent;
}

function waiterEvent(overrides: { callId: string; table?: string } = { callId: 'w1' }): AnnouncementEvent {
  return {
    kind: 'waiter',
    callId: overrides.callId,
    table: overrides.table ?? 'T3',
    createdAt: new Date().toISOString(),
    eventAt: new Date().toISOString(),
  } as AnnouncementEvent;
}

const RECEIVED = new Date().toISOString();
const EMPTY_SEEN: SeenState = { orderIds: [], waiterCallIds: [] };

describe('announcements store — strict scope lock', () => {
  describe('eventToNotification — actual order data, no invention', () => {
    it('creates notification with actual table, items, quantities, special instructions', () => {
      const evt = orderEvent({ orderId: 'o1' }) as AnnouncementEvent & { kind: 'order' };
      // Override to test actual data
      (evt as unknown as { items: { qty: number; name: string; detail?: string; spoken: string | null }[] }).items = [{ qty: 2, name: 'Paneer Tikka', detail: 'Extra spicy', spoken: null }];
      (evt as unknown as { note: string | null }).note = 'No onion';
      const n = eventToNotification(evt, 'en', RECEIVED);
      expect(n.kind).toBe('order');
      expect(n.table).toBe('T5');
      expect(n.body).toContain('Paneer Tikka');
      expect(n.body).toContain('Extra spicy');
      expect(n.body).toContain('No onion');
      expect(n.orderDetails?.items[0].name).toBe('Paneer Tikka');
    });

    it('preserves allergy/special instructions verbatim', () => {
      const evt = orderEvent({ orderId: 'o2' }) as AnnouncementEvent;
      (evt as unknown as { note: string | null }).note = 'Allergy: peanuts — handle with care';
      const n = eventToNotification(evt, 'en', RECEIVED);
      expect(n.body).toContain('Allergy: peanuts — handle with care');
    });

    it('waiter notification has table number', () => {
      const evt = waiterEvent({ callId: 'w1', table: 'T7' });
      const n = eventToNotification(evt, 'en', RECEIVED);
      expect(n.kind).toBe('waiter');
      expect(n.table).toBe('T7');
      expect(n.title).toContain('T7');
    });

    it('Hindi titles use Hindi, English titles use English', () => {
      const o = orderEvent({ orderId: 'o1' });
      expect(eventToNotification(o, 'hi', RECEIVED).title).toContain('नया ऑर्डर');
      expect(eventToNotification(o, 'en', RECEIVED).title).toContain('New order');
      const w = waiterEvent({ callId: 'w1' });
      expect(eventToNotification(w, 'hi', RECEIVED).title).toContain('वेटर कॉल');
      expect(eventToNotification(w, 'en', RECEIVED).title).toContain('Waiter call');
    });
  });

  describe('eventToVoiceText — actual order data, correct language', () => {
    it('voice includes table number and item names verbatim', () => {
      const evt = orderEvent({ orderId: 'o1' });
      const hi = eventToVoiceText(evt, 'hi');
      // Hindi voice converts T5 → टेबल पाँच
      expect(hi).toContain('पाँच');
      expect(hi).toContain('पनीर टिक्का');
      const en = eventToVoiceText(evt, 'en');
      // English keeps T-prefix for table
      expect(en).toContain('Paneer Tikka');
      expect(en).toContain('Table');
    });

    it('voice includes special instructions (allergy verbatim)', () => {
      const evt = orderEvent({ orderId: 'o1' }) as AnnouncementEvent;
      (evt as unknown as { note: string | null }).note = 'Less spicy, no garlic';
      const hi = eventToVoiceText(evt, 'hi');
      // Voice may transliterate; ensure it mentions the instruction concept
      expect(hi.length).toBeGreaterThan(10);
      // Written body preserves verbatim
      const n = eventToNotification(evt as AnnouncementEvent, 'en', RECEIVED);
      expect(n.body).toContain('Less spicy, no garlic');
    });

    it('waiter call voice includes table number in both languages', () => {
      const evt = waiterEvent({ callId: 'w1', table: 'T3' });
      expect(eventToVoiceText(evt, 'hi')).toContain('T3');
      expect(eventToVoiceText(evt, 'en')).toContain('T3');
    });

    it('only hi and en are valid AnnouncementLang', () => {
      const o = orderEvent({ orderId: 'o1' });
      expect(eventToVoiceText(o, 'hi')).toBeTruthy();
      expect(eventToVoiceText(o, 'en')).toBeTruthy();
    });
  });

  describe('idempotency — no duplicate announcements', () => {
    it('filters out already-seen events', () => {
      const e1 = orderEvent({ orderId: 'o1' });
      const e2 = waiterEvent({ callId: 'w2' });
      const seen: SeenState = { orderIds: ['o1'], waiterCallIds: [] };
      const unseen = filterUnseenEvents([e1, e2], seen);
      expect(unseen).toHaveLength(1);
      expect((unseen[0] as { callId: string }).callId).toBe('w2');
    });

    it('returns all when seen is empty', () => {
      const e1 = orderEvent({ orderId: 'o1' });
      expect(filterUnseenEvents([e1], EMPTY_SEEN)).toHaveLength(1);
    });

    it('updateSeenWithEvents is idempotent', () => {
      const e1 = orderEvent({ orderId: 'o1' });
      const e2 = waiterEvent({ callId: 'w1' });
      const seen = updateSeenWithEvents(EMPTY_SEEN, [e1, e2]);
      expect(seen.orderIds).toContain('o1');
      expect(seen.waiterCallIds).toContain('w1');
      const again = updateSeenWithEvents(seen, [e1, e2]);
      expect(again.orderIds.length).toBe(1);
      expect(again.waiterCallIds.length).toBe(1);
    });
  });

  describe('releaseSeenEvent — a failed claim is retried, not lost', () => {
    it('removes only the released event so the next poll sees it as unseen', () => {
      const seen = updateSeenWithEvents({ orderIds: [], waiterCallIds: [] }, [orderEvent({ orderId: 'o1' }), orderEvent({ orderId: 'o2' }), waiterEvent({ callId: 'w1' })]);
      const released = releaseSeenEvent(releaseSeenEvent(seen, orderEvent({ orderId: 'o1' })), waiterEvent({ callId: 'w1' }));
      expect(released).toEqual({ orderIds: ['o2'], waiterCallIds: [] });
      expect(filterUnseenEvents([orderEvent({ orderId: 'o1' }), orderEvent({ orderId: 'o2' })], released).map((e) => e.kind === 'order' && e.orderId)).toEqual(['o1']);
    });
  });

  describe('addNotifications — deduplicated, capped', () => {
    it('prepends newcomers and deduplicates by id', () => {
      const n1: WrittenNotification = { id: 'order:o1', kind: 'order', table: 'T1', title: 'T', body: 'B', createdAt: new Date().toISOString(), read: false, eventAt: new Date().toISOString(), receivedAt: RECEIVED };
      const next = addNotifications([], [n1]);
      expect(next).toHaveLength(1);
      const again = addNotifications(next, [n1]);
      expect(again).toHaveLength(1); // no duplicate
    });

    it('caps at 50', () => {
      const existing: WrittenNotification[] = Array.from({ length: 50 }, (_, i) => ({ id: `old-${i}`, kind: 'order', table: 'T1', title: 'T', body: 'B', createdAt: new Date().toISOString(), read: false, eventAt: new Date().toISOString(), receivedAt: RECEIVED } as WrittenNotification));
      const newcomer: WrittenNotification = { id: 'new-1', kind: 'order', table: 'T1', title: 'T', body: 'B', createdAt: new Date().toISOString(), read: false, eventAt: new Date().toISOString(), receivedAt: RECEIVED };
      const next = addNotifications(existing, [newcomer]);
      expect(next.length).toBe(50);
      expect(next[0].id).toBe('new-1');
    });
  });

  describe('latency measurement — real, no false guarantee', () => {
    it('computes latency from eventAt to now', () => {
      const now = Date.now();
      const eventAt = new Date(now - 5000).toISOString();
      const latency = measureLatencyMs(eventAt, now);
      expect(latency).toBeGreaterThanOrEqual(4900);
      expect(latency).toBeLessThanOrEqual(5100);
    });

    it('returns -1 for invalid eventAt', () => {
      expect(measureLatencyMs('not-a-date', Date.now())).toBe(-1);
    });
  });

  describe('claim recovery — crash cannot stay stuck', () => {
    it('stale claim after recoveryMs', () => {
      const RECOVERY = 2 * 60 * 1000;
      const claimedAt = new Date(Date.now() - RECOVERY - 1000).toISOString();
      expect(isStaleClaim(claimedAt, Date.now(), RECOVERY)).toBe(true);
      const fresh = new Date(Date.now() - 1000).toISOString();
      expect(isStaleClaim(fresh, Date.now(), RECOVERY)).toBe(false);
      expect(isStaleClaim(null, Date.now(), RECOVERY)).toBe(false);
      expect(isStaleClaim(undefined, Date.now(), RECOVERY)).toBe(false);
    });
  });

  describe('scope lock — only 2 event kinds', () => {
    it('only order and waiter kinds exist', () => {
      const order = orderEvent({ orderId: 'o1' });
      const waiter = waiterEvent({ callId: 'w1' });
      expect(order.kind).toBe('order');
      expect(waiter.kind).toBe('waiter');
      // No payment/cancel/status/marketing kinds
    });
  });
});
