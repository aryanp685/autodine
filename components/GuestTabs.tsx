'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useCart } from '@/components/CartProvider';

/**
 * The guest's three destinations: Menu, Cart, Orders.
 *
 * WHY A TAB BAR AT ALL
 *
 * The menu is not a page, it is the whole app for the length of a meal: look,
 * add, check the bill, watch it cook. Without a tab bar every one of those is
 * a back button away from the last, and on a phone the back button is also
 * "leave the site" one press too far. Three tabs make the flow's shape
 * visible instead of something a guest has to remember.
 *
 * WHERE IT IS NOT
 *
 * Not on the dish sheet and not on checkout. Both are things you are doing --
 * one dish, one payment -- and a tab bar under them is an invitation to wander
 * mid-decision. It appears on the three screens that are places rather than
 * steps: /menu, /menu/cart, /menu/orders.
 *
 * WHY THE BADGE WAITS
 *
 * The cart lives in localStorage, so the first render on the server knows
 * nothing about it. A badge that renders "0" and then pops to "3" is a lie
 * told in the same place a lie is most visible; `cart.ready` exists to let
 * this component say nothing until it actually knows.
 */
export type GuestTab = 'menu' | 'cart' | 'orders';

export function GuestTabs({ slug, active }: { slug?: string | null; active: GuestTab }) {
  const cart = useCart();
  const withSlug = (path: string) => (slug ? `${path}?s=${encodeURIComponent(slug)}` : path);
  const count = cart.ready ? cart.count : 0;

  const tabs: ReadonlyArray<{ key: GuestTab; label: string; href: string; icon: ReactNode }> = [
    {
      key: 'menu',
      label: 'Menu',
      href: withSlug('/menu'),
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M5 4.5h9.5A3.5 3.5 0 0 1 18 8v11.5H8.5A3.5 3.5 0 0 1 5 16z" strokeLinejoin="round" />
          <path d="M8.5 9h6M8.5 12.5h4" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      key: 'cart',
      label: 'Cart',
      href: withSlug('/menu/cart'),
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M4.5 5h2l2.2 9.2h8.6L19.5 8H7" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="9.5" cy="18" r="1.3" />
          <circle cx="16.5" cy="18" r="1.3" />
        </svg>
      ),
    },
    {
      key: 'orders',
      label: 'Orders',
      href: withSlug('/menu/orders'),
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M6 3.5h12v17H6z" strokeLinejoin="round" />
          <path d="M9 8h6M9 12h6M9 16h4" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  return (
    <nav
      aria-label="Your order"
      data-gtab-bar=""
      data-flow-chrome="tabs"
      className="fixed inset-x-3 z-30 mx-auto max-w-[696px] rounded-[22px] px-1.5 py-1.5"
      style={{ bottom: 'calc(10px + env(safe-area-inset-bottom))' }}
    >
      <div className="grid w-full grid-cols-3">
        {tabs.map((tab) => {
          const current = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              data-gtab={tab.key}
              data-gtab-active={current ? 'true' : undefined}
              aria-current={current ? 'page' : undefined}
              className={[
                'group relative flex flex-col items-center gap-0.5 rounded-[16px] py-2 text-[10.5px] font-medium tracking-[0.01em] transition-colors',
                current
                  ? 'bg-white/70 text-[var(--p-accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]'
                  : 'text-gink-46 hover:text-gink-80',
              ].join(' ')}
            >
              <span className="relative">
                {tab.icon}
                {/* The number is not decoration: it is the answer to "did my
                    last tap work", and it is the only cart count on the screen
                    once the floating bar has been dismissed by adding nothing. */}
                {tab.key === 'cart' && count > 0 && (
                  <span
                    data-gtab-badge=""
                    aria-label={`${count} in the cart`}
                    className="tabular-nums absolute -top-1.5 -right-2 grid min-w-[17px] place-items-center rounded-full bg-[var(--p-accent)] px-1 text-[10px] leading-[17px] font-semibold text-onink"
                  >
                    {count}
                  </span>
                )}
              </span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
