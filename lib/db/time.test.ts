import { describe, expect, it } from 'vitest';
import { clockTimeInZone, dateTimeInZone, RESTAURANT_TIME_ZONE } from './time';

/**
 * These two exist because the same formatting was copied into the kitchen
 * board, the cashier queue and the dashboard, and every copy formatted in the
 * server's zone. Vercel lambdas run in UTC, so a 12:31 pm bill in Noida was
 * printed as 7:01 am on a ticket a cook was working from. The first test here
 * is that regression, written down.
 */

const HALF_PAST_NOON_IST = '2026-10-21T07:01:00Z'; // 12:31 pm in Asia/Kolkata

describe('clockTimeInZone', () => {
  it('renders the restaurant clock, not the server clock', () => {
    const shown = clockTimeInZone(RESTAURANT_TIME_ZONE, HALF_PAST_NOON_IST);
    expect(shown).toMatch(/^12:31/);
    expect(shown.toLowerCase()).toContain('pm');
    // The old, broken behaviour: formatted in the runtime's zone.
    expect(shown).not.toMatch(/^7:01/);
  });

  it('accepts a Date as well as an ISO string', () => {
    const shown = clockTimeInZone(RESTAURANT_TIME_ZONE, new Date(HALF_PAST_NOON_IST));
    expect(shown).toBe(clockTimeInZone(RESTAURANT_TIME_ZONE, HALF_PAST_NOON_IST));
  });

  it('falls back to the restaurant default when the zone is missing', () => {
    expect(clockTimeInZone(null, HALF_PAST_NOON_IST)).toBe(
      clockTimeInZone(RESTAURANT_TIME_ZONE, HALF_PAST_NOON_IST),
    );
    expect(clockTimeInZone(undefined, HALF_PAST_NOON_IST)).toBe(
      clockTimeInZone(RESTAURANT_TIME_ZONE, HALF_PAST_NOON_IST),
    );
  });

  it('shows an em dash rather than NaN for an unparseable timestamp', () => {
    expect(clockTimeInZone(RESTAURANT_TIME_ZONE, 'not-a-date')).toBe('—');
  });
});

describe('dateTimeInZone', () => {
  it('puts the day and the time in the restaurant zone on a ledger row', () => {
    // 21:00 UTC is 02:30 the next morning in India -- the case where a UTC
    // render would file a late bill under the wrong day.
    const shown = dateTimeInZone(RESTAURANT_TIME_ZONE, '2026-10-21T21:00:00Z');
    expect(shown).toContain('22');
    expect(shown).toContain('Oct');
    expect(shown).toMatch(/2:30/);
  });

  it('shows an em dash rather than NaN for an unparseable timestamp', () => {
    expect(dateTimeInZone(RESTAURANT_TIME_ZONE, 'not-a-date')).toBe('—');
  });
});
