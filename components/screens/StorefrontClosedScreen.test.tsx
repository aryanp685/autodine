import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StorefrontClosedScreen } from './StorefrontClosedScreen';

/**
 * THE CLOSED STOREFRONT.
 *
 * `is_active` off has always meant "not taking orders", but a guest on the
 * storefront was shown a 404 or a scan gate. This says the shop is closed in
 * the same words the scan problem screen uses, and promises what is true:
 * staff can still take the order, and an order already placed is still being
 * looked after.
 */
describe('StorefrontClosedScreen', () => {
  it('says the shop is closed, in the words the scan screen already uses', () => {
    const html = renderToStaticMarkup(<StorefrontClosedScreen name="Maddi" />);
    expect(html).toContain('Not taking orders right now');
    expect(html).toContain('Maddi');
    expect(html).toContain('order with staff');
  });

  it('promises the placed order is safe, and claims no order exists', () => {
    const html = renderToStaticMarkup(<StorefrontClosedScreen name="Maddi" />);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    expect(text).toContain('already placed is still being looked after');
    for (const lie of ['order placed', 'order confirmed', 'sent to the kitchen']) {
      expect(text).not.toContain(lie);
    }
  });

  it('shows the announcement when there is one — often the reason', () => {
    const html = renderToStaticMarkup(
      <StorefrontClosedScreen name="Maddi" announcement="Closed for Diwali — back on Friday." />,
    );
    expect(html).toContain('Closed for Diwali — back on Friday.');
  });

  it('points staff at the reopen switch', () => {
    const html = renderToStaticMarkup(<StorefrontClosedScreen name="Maddi" />);
    expect(html).toContain('href="/dashboard/branding"');
    expect(html).toContain('Reopen the storefront');
  });
});
