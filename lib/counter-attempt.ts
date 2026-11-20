import { isCounterMethod, type CounterMethod } from './payment-methods';

export const COUNTER_ID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
export type CounterAttempt = { method: CounterMethod; amountPaise: number; idempotencyKey: string };
export const counterAttemptKey = (outlet: string, ticket: string) => `ad_counter:${outlet}:${ticket}`;

export function readCounterAttempt(storage: Pick<Storage, 'getItem'>, key: string): CounterAttempt | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const attempt = JSON.parse(raw);
  if (!isCounterMethod(attempt?.method) || !Number.isSafeInteger(attempt.amountPaise) || attempt.amountPaise <= 0 ||
      typeof attempt.idempotencyKey !== 'string' || !COUNTER_ID.test(attempt.idempotencyKey)) {
    throw new Error('Invalid saved payment recording');
  }
  return { method: attempt.method, amountPaise: attempt.amountPaise, idempotencyKey: attempt.idempotencyKey };
}
