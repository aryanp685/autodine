/**
 * Restaurant-local time.
 *
 * WHY THIS IS A FILE AND NOT THREE FUNCTIONS INSIDE THE DASHBOARD
 *
 * "Today", "this week" and the bucket a bill falls into are all questions
 * about the RESTAURANT's clock, not the server's. Every Vercel lambda runs in
 * UTC, so a naive start-of-day would move an Indian restaurant's business-day
 * boundary to 5:30 in the evening and reset the dashboard in the middle of
 * dinner service.
 *
 * India has no daylight saving, so a fixed +05:30 offset would work there --
 * but this product is meant to expand internationally, and much of the world
 * does shift. The offsets here are therefore derived from the IANA zone
 * through Intl at the instant being asked about, so a zone that changes twice
 * a year still resolves correctly.
 *
 * The dashboard and the reports screen must agree on where a day starts. They
 * both import from here rather than keeping a copy each, which is exactly the
 * kind of duplication that lets two money screens disagree by a day.
 */

/**
 * Fallback only. The zone actually used comes from restaurants.timezone, read
 * through getStaffContextDetailed. This constant covers the window before a
 * row has loaded -- and any row whose zone the runtime cannot parse.
 */
export const RESTAURANT_TIME_ZONE = 'Asia/Kolkata';

/**
 * Offset in milliseconds between the given zone and UTC at a given instant.
 *
 * Derived from Intl rather than a table so that zones which shift for daylight
 * saving resolve correctly at the instant asked about.
 */
export function timeZoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  let year = 0;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const part of parts) {
    const value = Number(part.value);
    switch (part.type) {
      case 'year':
        year = value;
        break;
      case 'month':
        month = value;
        break;
      case 'day':
        day = value;
        break;
      case 'hour':
        // Intl can render midnight as '24' with hour12: false.
        hour = value % 24;
        break;
      case 'minute':
        minute = value;
        break;
      case 'second':
        second = value;
        break;
      default:
        break;
    }
  }

  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asIfUtc - at.getTime();
}

/** The calendar date this instant falls on, in the given zone. */
export function localDateParts(
  timeZone: string,
  at: Date,
): { year: number; month: number; day: number } {
  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

  const [year, month, day] = isoDate.split('-').map(Number);
  return { year, month, day };
}

/** 'YYYY-MM-DD' for this instant in the given zone. */
export function localDateKey(timeZone: string, at: Date): string {
  const { year, month, day } = localDateParts(timeZone, at);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The UTC instant at which a given local calendar date begins in a zone.
 *
 * Two passes over the offset on purpose. The first pass guesses the offset
 * using the wall-clock instant read as if it were UTC; in a zone that observes
 * daylight saving the guess can land on the wrong side of a transition, so the
 * offset at the guessed instant is used for a second, corrected pass. In a
 * zone with no DST the second pass is a no-op.
 *
 * `day` may be out of range (0, -1, 32): Date.UTC rolls it over, which is what
 * makes "six days before today" work across a month boundary.
 */
export function startOfLocalDayUtc(
  timeZone: string,
  date: { year: number; month: number; day: number },
): Date {
  const wallClock = Date.UTC(date.year, date.month - 1, date.day);
  const firstOffset = timeZoneOffsetMs(timeZone, new Date(wallClock));
  let instant = wallClock - firstOffset;

  const secondOffset = timeZoneOffsetMs(timeZone, new Date(instant));
  if (secondOffset !== firstOffset) instant = wallClock - secondOffset;

  return new Date(instant);
}

/** The UTC instant at which the current day began, in the given zone. */
export function startOfDayUtc(timeZone: string, at: Date): Date {
  return startOfLocalDayUtc(timeZone, localDateParts(timeZone, at));
}

/**
 * Start of the local day `daysAgo` days before the day `at` falls on.
 * daysAgo = 0 is today.
 */
export function startOfDayOffsetUtc(timeZone: string, at: Date, daysAgo: number): Date {
  const { year, month, day } = localDateParts(timeZone, at);
  return startOfLocalDayUtc(timeZone, { year, month, day: day - daysAgo });
}

/** Hour of day (0-23) in the given zone. */
export function hourInZone(timeZone: string, at: Date): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
  }).format(at);
  return Number(hour) % 24;
}

/**
 * An hour of the day as a range label: `8–9 pm`.
 *
 * The dashboard chart buckets revenue by hour index (0-23) rather than by a
 * timestamp, because that is what `hourInZone` returns for each order. Reading
 * a squiggle is not an answer to "when was the busy hour"; naming the hour is.
 * A fixed table rather than Intl formatting: the input is already local to the
 * restaurant, so there is no zone left to apply, and a formatter given a bare
 * number would need an arbitrary date to put it on.
 */
export function hourRangeLabel(hour: number): string {
  const from = wrapHour(hour);
  const to = wrapHour(hour + 1);
  const sameMeridiem = meridiem(from) === meridiem(to);
  return sameMeridiem
    ? `${clockHour(from)}–${clockHour(to)} ${meridiem(from)}`
    : `${clockHour(from)} ${meridiem(from)}–${clockHour(to)} ${meridiem(to)}`;
}

function wrapHour(hour: number): number {
  return ((Math.trunc(hour) % 24) + 24) % 24;
}

function meridiem(hour: number): 'am' | 'pm' {
  return hour >= 12 ? 'pm' : 'am';
}

function clockHour(hour: number): number {
  return hour % 12 === 0 ? 12 : hour % 12;
}

/** One hour as a short axis tick: `8 pm`, `12 am`. */
export function hourLabel(hour: number): string {
  const h = wrapHour(hour);
  return `${clockHour(h)} ${meridiem(h)}`;
}

export function clockTimeInZone(
  timeZone: string | null | undefined,
  at: string | Date,
): string {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-IN', {
    timeZone: timeZone || RESTAURANT_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Date and time together, for a ledger row where the day matters: '12 Oct,
 * 12:31 pm'. Same reasoning as clockTimeInZone -- the zone is the
 * restaurant's, never the server's.
 */
export function dateTimeInZone(
  timeZone: string | null | undefined,
  at: string | Date,
): string {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    timeZone: timeZone || RESTAURANT_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
