import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CartProvider } from './CartProvider';
import { GuestTabs } from './GuestTabs';
import { CustomerMenu, ItemSheet } from './screens/CustomerMenu';

/**
 * The tab bar is the guest's navigation for the length of a meal, so three
 * things have to stay true: it exists on the screens that are places, it does
 * not exist on the screens that are decisions, and it never claims a cart
 * count it has not read yet.
 */

// The menu screens use the router for their post-add redirect.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/menu',
}));

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<CartProvider slug="copper-pot">{node}</CartProvider>);
}

describe('GuestTabs', () => {
  it('renders exactly the three destinations, with the slug carried through', () => {
    const html = render(<GuestTabs slug="copper-pot" active="menu" />);

    expect(html.split('class="gtabs__tab').length - 1).toBe(3);
    expect(html).toContain('href="/menu?s=copper-pot"');
    expect(html).toContain('href="/menu/cart?s=copper-pot"');
    expect(html).toContain('href="/menu/orders?s=copper-pot"');
    expect(html).toContain('aria-label="Your order"');
  });

  it('marks the current tab for assistive technology, once', () => {
    const html = render(<GuestTabs slug="copper-pot" active="cart" />);

    expect(html.split('aria-current="page"').length - 1).toBe(1);
    const at = html.indexOf('aria-current="page"');
    expect(html.slice(at, at + 120)).toContain('href="/menu/cart');
  });

  /**
   * The cart is read from storage after mount, so the first render knows
   * nothing. A "0" that becomes "3" is a lie told in the most visible place on
   * the screen, and the badge is simply absent until the count is real.
   */
  it('shows no badge before the cart has been read', () => {
    const html = render(<GuestTabs slug="copper-pot" active="menu" />);
    expect(html).not.toContain('gtabs__badge');
  });

  it('does not put a cart count on the menu or orders tab', () => {
    const html = render(<GuestTabs slug="copper-pot" active="menu" />);
    // Every badge that appears must sit next to the Cart label.
    expect(html).not.toMatch(/gtabs__badge[\s\S]*gtabs__label">(Menu|Orders)/);
  });

  it('works without a slug, so a broken link still has navigation', () => {
    const html = render(<GuestTabs active="orders" />);
    expect(html).toContain('href="/menu"');
    expect(html).toContain('href="/menu/orders"');
  });
});

describe('menu search', () => {
  it('is a real labelled field, not a picture of one', () => {
    const html = render(<CustomerMenu />);
    expect(html).toContain('aria-label="Search dishes"');
    expect(html).toContain('type="search"');
    expect(html).toContain('placeholder="Search dishes"');
  });

  /** With nothing typed there is nothing to clear, and Clear would be a lie. */
  it('offers no clear button before anything is typed', () => {
    const html = render(<CustomerMenu />);
    expect(html).not.toContain('menu__searchClear');
  });

  it('keeps the course rail while no search is running', () => {
    const html = render(<CustomerMenu />);
    expect(html).toContain('aria-label="Courses"');
  });
});

describe('where the tabs are allowed to be', () => {
  it('is on the menu', () => {
    const html = renderToStaticMarkup(
      <CartProvider slug="copper-pot">
        <CustomerMenu />
      </CartProvider>,
    );
    expect(html).toContain('gtabs__inner');
  });

  /**
   * The dish sheet is a decision about one dish. A tab bar under it invites a
   * guest to leave mid-choice and lose the options they had picked.
   */
  it('is not on the dish sheet', () => {
    const html = renderToStaticMarkup(
      <CartProvider slug="copper-pot">
        <ItemSheet />
      </CartProvider>,
    );
    expect(html).not.toContain('gtabs');
  });
});
