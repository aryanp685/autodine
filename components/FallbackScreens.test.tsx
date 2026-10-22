import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import AppError from '@/app/error';
import NotFound from '@/app/not-found';

/**
 * The two screens nobody designs on purpose, and everybody eventually sees.
 *
 * Both used to be Next's built-in page: black on white, system font, no
 * wordmark and no way back into the product. A mistyped address or a failed
 * request is already a bad moment; looking like a different application in it
 * is worse. These tests hold the two things that make them part of AutoDine:
 * the guest shell, and a real way out.
 */

describe('the 404', () => {
  const html = renderToStaticMarkup(<NotFound />);

  it('wears the product’s own shell, not the browser default', () => {
    expect(html).toContain('gnote');
    expect(html).toContain('AutoDine');
    // The exact sentence from Next's default page, which is not ours.
    expect(html).not.toContain('This page could not be found');
  });

  it('says what to do next instead of only naming the status', () => {
    expect(html).toContain('404');
    expect(html).toContain('This page does not exist');
    expect(html).toContain('href="/"');
    // And it understands the most likely reason somebody is here: a typed
    // address instead of the card on the table.
    expect(html).toContain('Ask staff for the current code');
  });
});

describe('the error screen', () => {
  const html = renderToStaticMarkup(<AppError error={new Error('boom')} reset={() => {}} />);

  it('offers a retry that remounts the segment', () => {
    expect(html).toContain('Try again');
    expect(html).toMatch(/<button[^>]*class="gnote__cta"/);
  });

  it('tells the reader that nothing recorded was lost', () => {
    // Somebody whose screen just broke must not re-enter an order that was
    // already written: duplicate orders are worse than a slow one.
    expect(html).toContain('written on the server');
    expect(html).toContain('Back to the dashboard');
    // The message is not the stack trace.
    expect(html).not.toContain('boom');
  });
});
