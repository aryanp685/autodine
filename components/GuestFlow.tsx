import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import { BRAND_GREEN } from '@/lib/brand';

/**
 * The shell every screen in the ordering flow wears.
 *
 * A guest who scanned a card is in an app, not browsing a website: they have a
 * table, a cart and one thing to do next. So the flow is four full screens --
 * menu, cart, pay, placed -- and each of them is the whole viewport with one
 * primary action docked at the bottom, the way a phone app does it.
 *
 * What the bar carries, and why:
 *
 *   back      only where there is somewhere to go back to. The menu is the
 *             root of the flow, so it has no back arrow rather than a disabled
 *             one.
 *   venue     which restaurant, because a guest may scan two in a week and the
 *             cart is per restaurant.
 *   table     only when a live session says which table. Never invented: a
 *             menu that does not know the table says nothing at all.
 *   steps     four segments. Not a progress bar for its own sake -- the guest
 *             can be on any of these screens from a link, a refresh or the
 *             back button, and this is what says where they are and how much
 *             is left.
 *
 * The dock is rendered by the screen, not here, because the action belongs to
 * the work: "Review order" on the menu, "Continue to payment" on the cart,
 * "Place order" on the pay screen.
 *
 * STRUCTURE, NOT DECORATION
 *
 * The shell is written in Tailwind utilities and carries no visual class names
 * of its own, so the states a screen reader and a test care about are exposed
 * as `data-` attributes: data-flow-step on each segment, data-flow-back on the
 * back control, data-flow-table on the table chip, data-flow-dock on the
 * action bar. A test that used to assert `.flow__step.is-now` now asserts
 * `[data-flow-step='now']`, which is the same fact without the CSS class
 * standing in for it.
 */

export type GuestStep = 'menu' | 'cart' | 'pay' | 'placed';

export const GUEST_STEPS: ReadonlyArray<{ key: GuestStep; label: string }> = [
  { key: 'menu', label: 'Menu' },
  { key: 'cart', label: 'Cart' },
  { key: 'pay', label: 'Pay' },
  { key: 'placed', label: 'Placed' },
];

export function GuestFlow({
  step,
  venue,
  table,
  back,
  children,
  dock,
  tabs,
  docked,
  style,
}: {
  /**
   * Which step of the ordering flow this is.
   *
   * Optional, and omitted by the Orders tab: that screen is a place a guest
   * can stand, not a step they are moving through. Marking it as a step would
   * put the four-segment indicator in a state that is simply not true.
   */
  step?: GuestStep;
  /** The restaurant's name, as the guest knows it. */
  venue?: string | null;
  /** The table, only when a live session confirmed it. */
  table?: string | null;
  /** Where the back control goes. Omitted on the first step of a flow. */
  back?: { href: string; label: string } | null;
  children: ReactNode;
  /** The one primary action for this screen, pinned to the bottom. */
  dock?: ReactNode;
  /**
   * The guest tab bar, on the screens that are places rather than steps.
   *
   * Passed in rather than imported here so this stays a server-safe component
   * and so each screen decides for itself whether it is a destination worth
   * having tabs under.
   */
  tabs?: ReactNode;
  /**
   * Per-restaurant accent, as `--p-accent` / `--p-accent-soft`.
   *
   * Applied to the flow root rather than each screen, because the accent is a
   * property of the restaurant and not of a step: a guest who moves from menu
   * to cart must not see the colour change. Consumers build this with
   * `accentStyle()` from lib/branding/palette.ts, and every utility that needs
   * it reads `var(--p-accent)`, so a restaurant that picks terracotta gets a
   * terracotta flow rather than a green one with a terracotta dot.
   */
  style?: CSSProperties;
  /**
   * Forces the docked padding when the screen renders its own dock.
   *
   * The pay screen has to render its action INSIDE the order form -- that is
   * the only way `useFormStatus` can see the submit -- so it cannot use the
   * dock slot here. The padding still has to be on the shell, because it is
   * what keeps the content clear of the pinned bar.
   */
  docked?: boolean;
}) {
  const currentIndex = step ? GUEST_STEPS.findIndex((entry) => entry.key === step) : -1;
  const position = currentIndex + 1;
  const hasDock = Boolean(dock || docked);

  return (
    <div
      data-flow-root=""
      data-flow-docked={hasDock ? 'true' : undefined}
      className="min-h-dvh bg-paper text-gink antialiased"
      /* Room for the pinned action and, on the screens that have one, the tab
         bar. Both are fixed, so the page has to reserve the space itself --
         otherwise the last dish sits under the cart bar and can never be
         tapped. */
      style={{
        ...style,
        paddingBottom: hasDock
          ? 'calc(76px + env(safe-area-inset-bottom))'
          : tabs
            ? 'calc(64px + env(safe-area-inset-bottom))'
            : undefined,
      }}
    >
      <header className="sticky top-0 z-30 border-b border-hair bg-paper/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-[720px] items-center gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            {back ? (
              <Link
                href={back.href}
                data-flow-back=""
                aria-label={back.label}
                className="-ml-1.5 grid size-9 shrink-0 place-items-center rounded-full text-gink-80 transition hover:bg-gink-07 hover:text-gink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="17"
                  height="17"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M14.5 5.5L8 12l6.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ) : (
              <Link
                href="/"
                aria-label="AutoDine"
                className="-ml-1.5 grid size-9 shrink-0 place-items-center rounded-full text-gink transition hover:bg-gink-07"
              >
                <BrandMark size={22} ink="currentColor" dot={BRAND_GREEN} tone="flow" />
              </Link>
            )}

            <span className="truncate text-[14px] font-medium tracking-[-0.01em] text-gink" title={venue ?? 'AutoDine'}>
              {venue || 'AutoDine'}
            </span>

            {table ? (
              <span
                data-flow-table=""
                className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold tracking-[0.06em] text-[var(--p-accent)] uppercase"
              >
                {table}
              </span>
            ) : null}
          </div>

          {/* Four segments, not four labels: at arm's length on a phone the
              shape is what reads. The words are there for a screen reader, and
              the current one is also stated in text for anyone who wants it.
              Omitted entirely when the screen is not a step in the flow. */}
          {step && (
            <ol
              data-flow-steps=""
              aria-label={`Step ${position} of ${GUEST_STEPS.length}`}
              className="ml-auto flex items-center gap-1.5"
            >
              {GUEST_STEPS.map((entry, index) => {
                const state = index < currentIndex ? 'done' : index === currentIndex ? 'now' : 'todo';
                return (
                  <li
                    key={entry.key}
                    data-flow-step={state}
                    aria-current={index === currentIndex ? 'step' : undefined}
                    /* Done and current are solid ink, the rest are hairline:
                       at a glance the shape says "two thirds of the way". */
                    className={[
                      'h-1 w-6 rounded-full transition-colors',
                      state === 'todo' ? 'bg-gink-12' : 'bg-[var(--p-accent)]',
                      state === 'done' ? 'opacity-45' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className="sr-only">
                      {entry.label}
                      {index === currentIndex ? ' — you are here' : ''}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px]">{children}</main>

      {dock ? (
        <div
          data-flow-dock=""
          className="fixed inset-x-0 bottom-0 z-40 border-t border-hair bg-paper/92 backdrop-blur-xl"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="mx-auto w-full max-w-[720px] px-4 py-3">{dock}</div>
        </div>
      ) : null}

      {tabs}
    </div>
  );
}
