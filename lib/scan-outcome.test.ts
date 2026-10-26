import { describe, expect, it } from 'vitest';
import {
  formatRetry,
  isThrottled,
  notPlacedNotice,
  readRetryAfter,
  readThrottleFlag,
  scanOutcome,
  throttleFlag,
  throttleNotice,
  type ScanStatus,
} from './scan-outcome';

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

describe('the checkout sentence', () => {
  it('says nothing was sent before it says anything else', () => {
    const message = notPlacedNotice(600);
    expect(message.startsWith('Your order was not sent.')).toBe(true);
    expect(message).toContain('try again in about 10 minutes');
    expect(message).toContain('cart is safe');
    expect(message).toContain('nothing has been charged');
  });

  it('does not invent a wait when the database gave no retry time', () => {
    const message = notPlacedNotice();
    expect(message).toContain('try again in a few minutes');
    expect(message).not.toMatch(/\d+ minutes/);
  });

  it('never claims anything was saved or accepted', () => {
    for (const message of [notPlacedNotice(), notPlacedNotice(120)]) {
      const lower = message.toLowerCase();
      for (const lie of ['saved', 'confirmed', 'accepted', 'placed']) {
        expect(lower).not.toContain(lie);
      }
    }
  });
});

describe('the throttle flag', () => {
  it('is only ever the one exact value', () => {
    // The flag arrives from a URL and a cookie, so it is guest-controlled input.
    expect(isThrottled('throttled')).toBe(true);
    for (const other of ['', 'Throttled', 'throttled ', '1', 'true', null, undefined]) {
      expect(isThrottled(other as string), String(other)).toBe(false);
    }
  });
});

describe('the wait the database reported', () => {
  it('is read from either spelling an L1 return table might use', () => {
    expect(readRetryAfter({ retry_after_seconds: 600 })).toBe(600);
    expect(readRetryAfter({ retry_after: 90 })).toBe(90);
    expect(readRetryAfter({ retry_after_seconds: '45' })).toBe(45);
  });

  it('is rounded up, so the guest is never sent back too early', () => {
    expect(readRetryAfter({ retry_after_seconds: 30.2 })).toBe(31);
  });

  it('refuses what a sentence could not honestly say', () => {
    for (const row of [
      {},
      null,
      undefined,
      { retry_after_seconds: 0 },
      { retry_after_seconds: -60 },
      { retry_after_seconds: 86_401 },
      { retry_after_seconds: 'soon' },
      { retry_after_seconds: Number.NaN },
      { retry_after_seconds: Number.POSITIVE_INFINITY },
    ]) {
      expect(readRetryAfter(row as Record<string, unknown> | null), JSON.stringify(row)).toBe(null);
    }
  });
});

describe('the flag that carries it', () => {
  it('is the bare word when there is no wait', () => {
    expect(throttleFlag()).toBe('throttled');
    expect(throttleFlag(null)).toBe('throttled');
    expect(throttleFlag(0)).toBe('throttled');
    expect(throttleFlag(-1)).toBe('throttled');
  });

  it('carries the wait in the same value, so the two cannot disagree', () => {
    expect(throttleFlag(600)).toBe('throttled.600');
  });

  it('round-trips what it wrote', () => {
    const flag = throttleFlag(600);
    expect(readThrottleFlag(flag)).toEqual({ throttled: true, retryAfterSeconds: 600 });
  });

  it('keeps the note and drops an unusable number', () => {
    // A guest can edit a cookie. The number must not become a sentence, and
    // the explanation must not disappear because the number was rubbish.
    expect(readThrottleFlag('throttled.-5')).toEqual({ throttled: true, retryAfterSeconds: null });
    expect(readThrottleFlag('throttled.soon')).toEqual({ throttled: true, retryAfterSeconds: null });
    expect(readThrottleFlag('throttled.999999')).toEqual({ throttled: true, retryAfterSeconds: null });
  });

  it('is false for anything that is not the flag', () => {
    for (const value of ['', 'throttle', 'THROTTLED', 'throttled ', 'v', '1', null, undefined]) {
      expect(readThrottleFlag(value as string).throttled, String(value)).toBe(false);
    }
  });
});
