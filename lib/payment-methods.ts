/**
 * Counter payment methods.
 *
 * This file is deliberately free of any database import.
 *
 * The cashier screen is a client component and needs the list to render its
 * buttons. The obvious place to put it was lib/db/cashier-screen.ts, but that
 * module pulls in lib/db/staff.ts, which pulls in lib/supabase/server.ts --
 * a server-only module. Importing a VALUE (rather than a type) from it drags
 * the whole chain into the browser bundle, which both breaks the build and
 * points server-only code at the client.
 *
 * Types are erased at compile time, so importing `CounterOrder` from there is
 * harmless. Constants are not erased. Anything the client needs at runtime
 * belongs here.
 *
 * These three are what public.record_counter_payment accepts. 'online' is
 * intentionally absent: an online payment starts with the guest and a payment
 * provider, and arrives by webhook -- a cashier cannot record one.
 */

export const COUNTER_METHODS = ['cash', 'card', 'upi'] as const;

export type CounterMethod = (typeof COUNTER_METHODS)[number];

/** Display label. Kept here so the UI cannot drift from the accepted values. */
export const COUNTER_METHOD_LABEL: Record<CounterMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
};

export function isCounterMethod(value: unknown): value is CounterMethod {
  return COUNTER_METHODS.some((m) => m === value);
}
