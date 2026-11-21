import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { useOptionalCart } = vi.hoisted(() => ({ useOptionalCart: vi.fn() }));
vi.mock('@/components/CartProvider', () => ({ useOptionalCart }));

import { OrderMoreLink } from './OrderMoreLink';

describe('OrderMoreLink', () => {
  it('holds navigation while a just-placed cart is still populated', () => {
    useOptionalCart.mockReturnValue({ ready: true, count: 1 });
    const html = renderToStaticMarkup(<OrderMoreLink href="/menu?s=demo" waitForEmptyCart />);
    expect(html).toContain('disabled');
    expect(html).toContain('data-order-more-ready="false"');
    expect(html).toContain('Preparing your next order');
    expect(html).not.toContain('<a ');
  });

  it('enables the next-round link as soon as the cart has been cleared', () => {
    useOptionalCart.mockReturnValue({ ready: true, count: 0 });
    const html = renderToStaticMarkup(<OrderMoreLink href="/menu?s=demo" waitForEmptyCart />);
    expect(html).toContain('href="/menu?s=demo"');
    expect(html).toContain('data-order-more-ready="true"');
    expect(html).toContain('Order something else');
  });

  it('does not block a menu link for an older order while a new cart is being built', () => {
    useOptionalCart.mockReturnValue({ ready: true, count: 1 });
    const html = renderToStaticMarkup(<OrderMoreLink href="/menu?s=demo" />);
    expect(html).toContain('href="/menu?s=demo"');
    expect(html).toContain('Order something else');
  });
});
