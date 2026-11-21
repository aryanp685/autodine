import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableGateScreen } from './TableGateScreen';

/**
 * What a guest sees instead of a menu when they have not proved they are at a
 * table.
 *
 * This screen replaced the menu for anyone with a forwarded link, so the copy
 * has to be true and actionable rather than an apology. Notably it must not
 * claim a session expired when there never was one, and it must not offer a
 * "verify again" link when we no longer know which card was scanned -- that
 * would lead straight back to a form they cannot reach.
 */

describe('TableGateScreen', () => {
  it('sends a guest who never scanned to the QR code on their table', () => {
    const html = renderToStaticMarkup(<TableGateScreen reason="none" />);

    expect(html).toContain('Open this menu from your table');
    expect(html).toContain('QR code');
    // No claim about a session ending: there was never one.
    expect(html).not.toContain('session has ended');
  });

  it('explains an ended session without pretending it is a lockout', () => {
    const html = renderToStaticMarkup(<TableGateScreen reason="stale" />);

    expect(html).toContain('Your table session has ended');
    expect(html).toContain('about an hour');
  });

  it('offers one tap back to the code form when the card is known', () => {
    const html = renderToStaticMarkup(
      <TableGateScreen reason="stale" verifyHref="/t/qr_abcdefghijklmnop" />
    );

    expect(html).toContain('href="/t/qr_abcdefghijklmnop"');
    expect(html).toContain('Enter the code again');
  });

  it('omits that link when the card is not known', () => {
    const html = renderToStaticMarkup(<TableGateScreen reason="stale" verifyHref={null} />);

    expect(html).not.toContain('Enter the code again');
    expect(html).not.toContain('/t/');
  });

  it('blames itself, not the guest, when the database cannot be reached', () => {
    const html = renderToStaticMarkup(<TableGateScreen reason="unavailable" />);

    expect(html).toContain('could not check your table');
    expect(html).toContain('try again');
  });

  it('keeps staff on a route to their own menu', () => {
    const html = renderToStaticMarkup(<TableGateScreen reason="none" />);
    expect(html).toContain('href="/dashboard/menus"');
  });

  it('does not put a staff dashboard where the guest’s next step should be', () => {
    // This screen is read by a guest whose card did not open a menu. The
    // primary button used to be "Go to my menu", pointed at /dashboard/menus:
    // the least useful destination in the product for the person holding the
    // phone, and the most prominent thing on the page.
    const html = renderToStaticMarkup(<TableGateScreen reason="none" />);

    expect(html).not.toContain('data-gnote-cta');
    expect(html).toContain('data-gnote-ghost');
    // The staff route is still there, as a footnote rather than a button.
    expect(html).toContain('Behind the counter?');
  });

  it('never shows menu content, which would defeat the gate', () => {
    for (const reason of ['none', 'stale', 'unavailable'] as const) {
      const html = renderToStaticMarkup(<TableGateScreen reason={reason} />);
      expect(html).not.toContain('Butter Chicken');
      expect(html).toContain('AutoDine');
    }
  });

  it('says which of the three steps this screen is', () => {
    // A guest arriving from a forwarded link has no idea whether they are at
    // the start of the flow or two steps into it.
    const never = renderToStaticMarkup(<TableGateScreen reason="none" />);
    expect(never).toContain('data-gnote-steps');
    expect(never).toMatch(/data-gnote-step="now"[^>]*>.*?Scan/s);

    const stale = renderToStaticMarkup(<TableGateScreen reason="stale" />);
    expect(stale).toMatch(/data-gnote-step="now"[^>]*>.*?Code/s);
    expect(stale).toMatch(/data-gnote-step="done"[^>]*>.*?Scan/s);
  });
});
