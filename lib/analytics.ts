export type AnalyticsEvent = {
  name: AnalyticsEventName;
  properties?: Record<string, unknown>;
  timestamp?: number;
};

export type AnalyticsEventName =
  | 'page_viewed'
  | 'menu_viewed'
  | 'item_added_to_cart'
  | 'order_placed'
  | 'order_paid'
  | 'kitchen_ticket_served'
  | 'waiter_call'
  | 'table_scanned'
  | 'repeat_visit'
  | 'peak_hour'
  | 'item_margin';

export const ANALYTICS_EVENT_NAMES: readonly AnalyticsEventName[] = [
  'page_viewed',
  'menu_viewed',
  'item_added_to_cart',
  'order_placed',
  'order_paid',
  'kitchen_ticket_served',
  'waiter_call',
  'table_scanned',
  'repeat_visit',
  'peak_hour',
  'item_margin',
];

const PII_KEYS: readonly string[] = [
  'guesttoken',
  'guestid',
  'ordercode',
  'orderid',
  'ordernumber',
  'name',
  'phone',
  'gstin',
  'email',
  'address',
  'customer',
];

function normalizeKey(key: string): string {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isPiiKey(key: string): boolean {
  return PII_KEYS.includes(normalizeKey(key));
}

function stripProperties(properties?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!properties) return out;
  for (const [key, value] of Object.entries(properties)) {
    if (isPiiKey(key)) continue;
    out[key] = value;
  }
  return out;
}

function isDemoMode(): boolean {
  const env: Record<string, string | undefined> =
    typeof process !== 'undefined' && process.env ? process.env : {};
  return env.NEXT_PUBLIC_AUTODINE_DEMO_MODE === 'true' || env.AUTODINE_DEMO_MODE === 'true';
}

export function track(event: AnalyticsEvent): void {
  if (!isDemoMode()) return;
  if (!ANALYTICS_EVENT_NAMES.includes(event.name)) return;
  const normalized: AnalyticsEvent = {
    name: event.name,
    properties: stripProperties(event.properties),
    timestamp: event.timestamp ?? Date.now(),
  };
  console.log('[autodine:analytics]', JSON.stringify(normalized));
}

export function trackOrderPlaced(_orderId: string, itemCount: number, methodCategory: string): void {
  track({
    name: 'order_placed',
    properties: { item_count: itemCount, method_category: methodCategory },
  });
}

export function trackRepeatVisit(): void {
  track({ name: 'repeat_visit' });
}

export function trackPeakHour(hourBucket: string): void {
  track({
    name: 'peak_hour',
    properties: { hour_bucket: hourBucket },
  });
}

export function trackItemMargin(itemId: string, marginPaise: number): void {
  track({
    name: 'item_margin',
    properties: { item_id: itemId, margin_paise: marginPaise },
  });
}
