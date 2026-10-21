import { describe, expect, it } from 'vitest';
import {
  isVerifyErrorReason,
  qrProblemReasonForStatus,
  verifyErrorText,
} from './qr-problem';

/**
 * The mapping from a verification status to something a guest reads.
 *
 * This is a boundary, not a formatter: verify_table_qr_with_code returns a
 * status word rather than raising (a raise would roll back the rate-limit
 * attempt it had just recorded), and nothing from the database is ever
 * rendered. The tests are therefore mostly about what does NOT happen -- an
 * unfamiliar status must not become a page that repeats it.
 */

describe('qrProblemReasonForStatus', () => {
  it('maps every status the migration can return', () => {
    expect(qrProblemReasonForStatus('unreadable')).toBe('unreadable');
    expect(qrProblemReasonForStatus('revoked')).toBe('revoked');
    expect(qrProblemReasonForStatus('notserving')).toBe('notserving');
    expect(qrProblemReasonForStatus('nomenu')).toBe('nomenu');
    expect(qrProblemReasonForStatus('nosetup')).toBe('nosetup');
    expect(qrProblemReasonForStatus('limited')).toBe('limited');
  });

  it('does not render a status it has never heard of', () => {
    // A future migration adding a status must degrade to a fixed sentence,
    // not to that word on a guest's screen.
    expect(qrProblemReasonForStatus('some_new_thing')).toBe('failed');
    expect(qrProblemReasonForStatus('')).toBe('failed');
    // 'ok' and 'wrong' are handled by the caller before this point; if one
    // ever reaches here it is a bug, and the bug shows a fixed sentence.
    expect(qrProblemReasonForStatus('ok')).toBe('failed');
  });
});

describe('verifyErrorText', () => {
  it('has a sentence for every retryable reason', () => {
    for (const reason of ['wrong', 'rotated', 'limited', 'failed'] as const) {
      const text = verifyErrorText(reason);
      expect(text.length).toBeGreaterThan(20);
      // No database wording, no class names, no codes: this is what the
      // guest reads.
      expect(text).not.toContain('P0001');
      expect(text).not.toContain('status');
    }
  });

  it('only accepts the codes it knows', () => {
    expect(isVerifyErrorReason('wrong')).toBe(true);
    expect(isVerifyErrorReason('rotated')).toBe(true);
    expect(isVerifyErrorReason('limited')).toBe(true);
    expect(isVerifyErrorReason('failed')).toBe(true);
    expect(isVerifyErrorReason('revoked')).toBe(false);
    expect(isVerifyErrorReason('ok')).toBe(false);
    expect(isVerifyErrorReason(undefined)).toBe(false);
  });
});
