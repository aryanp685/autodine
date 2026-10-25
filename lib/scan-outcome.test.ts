import { describe, expect, it } from 'vitest';
import { formatRetry, scanOutcome, throttleNotice, type ScanStatus } from './scan-outcome';

/**
 * The scan contract, as a table.
 *
 * These are the tests that can run with no database and no browser, which is
 * exactly why this decision was pulled out of the route: the throttle bug was
 * not a missing query, it was a status word being swallowed.
 */

const ALL: ScanStatus[] = [
  'opened',
  'reused',
  'held',
  'limited',
  'code',
  'revoked',
  'notserving',
  'nomenu',
  'unreadable',
];

describe('what a scan answer means', () => {
  it('gives every known status an answer', () => {
    for (const status of ALL) {
      expect(scanOutcome(status), status).toBeTruthy();
    }
  });

  it('keeps a session only for the three answers that carry one', () => {
    for (const status of ALL) {
      const expected = status === 'opened' || status === 'reused' || status === 'held';
      expect(scanOutcome(status).keepSession, status).toBe(expected);
    }
  });

  it('names a throttle as a throttle, not as a dead card', () => {
    // The old handler could not tell these apart, which is how a throttled
    // guest ended up on a code page that could not help them.
    expect(scanOutcome('limited').reason).toBe('throttled');
    expect(scanOutcome('revoked').reason).toBe('card');
    expect(scanOutcome('code').reason).toBe('code-mode');
  });

  it('does not promise an order for a card that cannot take one', () => {
    for (const status of ['revoked', 'notserving', 'nomenu', 'unreadable', 'limited'] as const) {
      expect(scanOutcome(status).expectOrder, status).toBe(false);
    }
    // A code-mode restaurant is expected to end in an order -- at checkout,
    // after the digits. It is not a failure.
    expect(scanOutcome('code').expectOrder).toBe(true);
  });

  it('grants nothing for a status this build has never heard of', () => {
    // A newer database must not be read as "you may order".
    for (const unknown of ['', null, undefined, 'opened_v2', 'OK']) {
      const outcome = scanOutcome(unknown as string);
      expect(outcome.keepSession).toBe(false);
      expect(outcome.reason).toBeNull();
      expect(outcome.expectOrder).toBe(false);
    }
  });
});

describe('legitimate burst', () => {
  it('lets a six-seat table scan, reload and re-scan without losing ordering', () => {
    // Six people, one phone reloaded twice, one guest joining late: ten scans.
    // Under L1 the reloads answer `reused` (nothing minted, nothing counted),
    // so the eleventh is still a normal mint rather than a throttle.
    const burst: ScanStatus[] = [
      'opened',
      'opened',
      'opened',
      'opened',
      'opened',
      'opened',
      'reused',
      'reused',
      'reused',
      'opened',
    ];

    for (const status of burst) {
      const outcome = scanOutcome(status);
      expect(outcome.keepSession, `${status} must let them order`).toBe(true);
      expect(outcome.reason, `${status} must not explain a failure`).toBeNull();
    }
  });

  it('still lets a code-mode restaurant be scanned all day', () => {
    // The common case in production today: no session, no error, digits asked
    // for at checkout.
    expect(scanOutcome('code')).toMatchObject({ keepSession: false, reason: 'code-mode' });
  });
});

describe('abusive repetition', () => {
  it('never hands a session to a throttled scan', () => {
    expect(scanOutcome('limited').keepSession).toBe(false);
  });

  it('does not pretend a throttled table is a revoked card', () => {
    // Sending this guest to "this card is no longer valid" would be a lie.
    expect(scanOutcome('limited').reason).not.toBe('card');
  });

  it('survives a hundred hostile answers without inventing permission', () => {
    const hostile: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      hostile.push(i % 2 === 0 ? 'limited' : 'revoked');
    }
    for (const status of hostile) {
      expect(scanOutcome(status).keepSession).toBe(false);
    }
  });
});

describe('retry advice', () => {
  it('rounds up, so the estimate is never early', () => {
    expect(formatRetry(1)).toBe('about a minute');
    expect(formatRetry(30)).toBe('about a minute');
    expect(formatRetry(61)).toBe('about 2 minutes');
    expect(formatRetry(600)).toBe('about 10 minutes');
    // A window is an hour, so the largest honest answer is the window itself.
    // (59 minutes stays 59 minutes: rounding it up to "an hour" would
    // overstate how long the guest is waiting.)
    expect(formatRetry(3540)).toBe('about 59 minutes');
    expect(formatRetry(3600)).toBe('about an hour');
  });

  it('says nothing rather than something false when it does not know', () => {
    for (const value of [undefined, null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatRetry(value as number)).toBeNull();
    }
  });

  it('keeps the cart and names another way to order', () => {
    const withTime = throttleNotice(600);
    const withoutTime = throttleNotice();

    for (const sentence of [withTime, withoutTime]) {
      expect(sentence).toContain('cart is safe');
      expect(sentence).toContain('order with staff');
      // The one thing never said to a guest in a scan-mode restaurant.
      expect(sentence.toLowerCase()).not.toContain('ask for the code');
      expect(sentence.toLowerCase()).not.toContain('enter the code');
    }
    expect(withTime).toContain('about 10 minutes');
    expect(withoutTime).toContain('a short while');
  });
});
