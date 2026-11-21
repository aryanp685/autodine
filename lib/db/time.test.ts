import { describe, expect, it } from 'vitest';
import {
  clockTimeInZone,
  dateTimeInZone,
  hourLabel,
  hourRangeLabel,
  RESTAURANT_TIME_ZONE,
} from './time';

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

/**
 * The chart on the overview buckets revenue by hour index, so the labels are
 * built from a bare number. These are the two places a fixed table beats an
 * Intl formatter: noon and midnight, where the 12-hour clock has to start over
 * rather than count up.
 */
describe('hourRangeLabel', () => {
  it('names a morning hour as one range', () => {
    expect(hourRangeLabel(8)).toBe('8–9 am');
  });

  it('names an evening hour as one range', () => {
    expect(hourRangeLabel(20)).toBe('8–9 pm');
  });

  it('starts the 12-hour clock over at noon and midnight', () => {
    expect(hourRangeLabel(0)).toBe('12–1 am');
    expect(hourRangeLabel(12)).toBe('12–1 pm');
  });

  it('names both halves when the hour crosses midday or midnight', () => {
    expect(hourRangeLabel(11)).toBe('11 am–12 pm');
    expect(hourRangeLabel(23)).toBe('11 pm–12 am');
  });

  it('wraps rather than printing hour 24', () => {
    expect(hourRangeLabel(24)).toBe('12–1 am');
    expect(hourRangeLabel(-1)).toBe('11 pm–12 am');
  });
});

describe('hourLabel', () => {
  it('prints one hour for an axis tick', () => {
    expect(hourLabel(0)).toBe('12 am');
    expect(hourLabel(12)).toBe('12 pm');
    expect(hourLabel(20)).toBe('8 pm');
  });
});
