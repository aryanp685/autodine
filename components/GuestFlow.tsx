import type { ReactNode } from 'react';
import Link from 'next/link';

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
 * "Place order" on the pay screen. It is a separate element only so the CSS
 * can keep the page content clear of it.
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
  docked,
}: {
  step: GuestStep;
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
   * Forces the docked padding when the screen renders its own dock.
   *
   * The pay screen has to render its action INSIDE the order form -- that is
   * the only way `useFormStatus` can see the submit -- so it cannot use the
   * dock slot here. The class still has to be on the shell, because it is what
   * keeps the content clear of the pinned bar.
   */
  docked?: boolean;
}) {
  const currentIndex = GUEST_STEPS.findIndex((entry) => entry.key === step);
  const position = currentIndex + 1;

  return (
    <div className={`flow ${dock || docked ? 'flow--docked' : ''}`}>
      <header className="flow__bar">
        <div className="flow__lead">
          {back ? (
            <Link href={back.href} className="flow__back" aria-label={back.label}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M14.5 5.5L8 12l6.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          ) : (
            <Link href="/" className="flow__brand" aria-label="AutoDine">
              AutoDine
            </Link>
          )}
          <span className="flow__venue" title={venue ?? 'AutoDine'}>
            {venue || 'AutoDine'}
          </span>
          {table ? <span className="flow__table">{table}</span> : null}
        </div>

        {/* Four segments, not four labels: at arm's length on a phone the
            shape is what reads. The words are there for a screen reader, and
            the current one is also stated in text for anyone who wants it. */}
        <ol className="flow__steps" aria-label={`Step ${position} of ${GUEST_STEPS.length}`}>
          {GUEST_STEPS.map((entry, index) => {
            const state = index < currentIndex ? 'is-done' : index === currentIndex ? 'is-now' : 'is-todo';
            return (
              <li key={entry.key} className={`flow__step ${state}`} aria-current={index === currentIndex ? 'step' : undefined}>
                <span className="flow__sr">
                  {entry.label}
                  {index === currentIndex ? ' — you are here' : ''}
                </span>
              </li>
            );
          })}
        </ol>
      </header>

      <div className="flow__body">{children}</div>

      {dock ? <div className="flow__dock">{dock}</div> : null}
    </div>
  );
}
