/**
 * Global Announcement System — Type Definitions
 *
 * Strict scope: ONLY two announcement purposes
 *   1. Customer order details → Kitchen staff
 *   2. Customer waiter-call → Staff
 *
 * Every type here is shared between the polling API, the global provider,
 * and the written-notification UI so they cannot drift apart.
 */

export type AnnouncementLang = 'hi' | 'en';

export type OrderAnnouncementEvent = {
  kind: 'order';
  orderId: string;
  code: string;
  table: string;
  placedAt: string; // ISO
  items: {
    qty: number;
    name: string;
    detail?: string;
    spoken?: string | null;
  }[];
  note?: string | null;
  /** Server timestamp of the event for latency measurement. */
  eventAt: string;
};

export type WaiterAnnouncementEvent = {
  kind: 'waiter';
  callId: string;
  table: string;
  createdAt: string; // ISO
  eventAt: string;
};

export type AnnouncementEvent = OrderAnnouncementEvent | WaiterAnnouncementEvent;

/** Payload from GET /api/staff/announcement-events */
export type AnnouncementEventsResponse = {
  restaurantId: string;
  events: AnnouncementEvent[];
  serverTime: string;
  /** For latency measurement: when the server started handling the request */
  requestAt: string;
};

/** A written notification shown on every staff page. */
export type WrittenNotification = {
  id: string; // orderId or callId prefixed
  kind: 'order' | 'waiter';
  table: string;
  title: string;
  body: string;
  /** Full order details for the inbox detail view */
  orderDetails?: {
    code: string;
    items: { qty: number; name: string; detail?: string }[];
    note?: string | null;
  };
  createdAt: string; // ISO
  read: boolean;
  /** For latency tracking */
  eventAt: string;
  receivedAt: string; // when client received
};

/** Persisted seen IDs for idempotency */
export type SeenState = {
  orderIds: string[];
  waiterCallIds: string[];
};

/** Settings stored in localStorage, per-restaurant */
export type AnnouncementSettings = {
  soundOn: boolean;
  lang: AnnouncementLang;
  voiceName: string | null;
};

export const DEFAULT_SETTINGS: AnnouncementSettings = {
  soundOn: true,
  lang: 'hi',
  voiceName: null,
};

export const SETTINGS_KEY = (restaurantId: string) => `autodine:announcements:${restaurantId}`;
export const SEEN_KEY = (restaurantId: string) => `autodine:announcements:seen:${restaurantId}`;
export const NOTIFICATIONS_KEY = (restaurantId: string) => `autodine:announcements:notifications:${restaurantId}`;

/** Poll interval: 5 seconds globally */
export const POLL_INTERVAL_MS = 5_000;

/** How long a claimed announcement may be stuck before recovery (2 minutes) */
export const CLAIM_RECOVERY_MS = 2 * 60 * 1000;

/** Max written notifications retained */
export const MAX_NOTIFICATIONS = 50;

/** Max time an order is considered "recent" for announcement (30 min) */
export const RECENT_ORDER_WINDOW_MS = 30 * 60 * 1000;
