import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VerifyCodeForm } from './VerifyCodeForm';

/**
 * The six-digit form on a table's card page.
 *
 * Only the resting state can be asserted here -- effects do not run under
 * renderToStaticMarkup, and the auto-submit needs a live form. What is pinned
 * is everything a guest's phone depends on: one numeric field, a keypad rather
 * than a keyboard, a code that can be offered by the OS, and a button that is
 * honestly disabled until there is a full code to send.
 */

vi.mock('@/app/t/[token]/actions', () => ({
  verifyTableCodeAction: () => Promise.resolve(),
}));

const html = renderToStaticMarkup(<VerifyCodeForm token="abc123" windowMinutes={10} />);

describe('the code form', () => {
  it('posts the card token in the body, not in the action URL', () => {
    expect(html).toContain('name="token"');
    expect(html).toContain('value="abc123"');
    expect(html).not.toContain('/t/abc123');
  });

  it('opens a numeric keypad and lets the OS offer the code', () => {
    // React emits these as `inputMode` / `autoComplete`; HTML attribute names
    // are case-insensitive, so the assertion is too.
    expect(html).toMatch(/inputmode="numeric"/i);
    expect(html).toMatch(/autocomplete="one-time-code"/i);
    expect(html).toContain('maxLength="6"');
    // Six digits is the whole contract; a longer field invites a wrong paste.
    expect(html).toContain('pattern="[0-9]{6}"');
  });

  it('does not pretend a half-typed code can be sent', () => {
    // The button submits the form; on the resting state there is nothing in
    // the field, so it is disabled rather than failing a validation round trip.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Open the menu<\/button>/);
  });

  it('says how often the code changes, in the restaurant staff’s own terms', () => {
    expect(html).toContain('changes every 10 minutes');
    expect(html).toContain('ask a member of staff');
  });

  it('says "minute" rather than "1 minutes" when a restaurant rotates faster', () => {
    const fast = renderToStaticMarkup(<VerifyCodeForm token="abc123" windowMinutes={1} />);
    expect(fast).toContain('changes every minute');
  });
});
