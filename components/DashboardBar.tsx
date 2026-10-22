'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { OutletSwitcher } from '@/components/OutletSwitcher';
import { ShellSearch } from '@/components/ShellSearch';
import { DASHBOARD_LINKS, SHELL_GROUPS, type DashboardSection } from '@/components/shell-links';
import type { OutletBar } from '@/lib/outlets';
import { signOutAction } from '@/app/auth/actions';

export type { DashboardSection };
export { DASHBOARD_LINKS };

/**
 * The staff shell: a rail, a top bar, and a drawer on a phone.
 *
 * WHY IT CHANGED FROM A HORIZONTAL STRIP
 *
 * The old bar carried eight destinations in one row. Adding Branding and
 * Import menu made ten, which does not fit a 390px screen and does not fit a
 * 1024px tablet either -- the row scrolled sideways, so the two newest screens
 * were the two a person could not see. A vertical rail has room to grow and is
 * the shape every operations product this is competing with uses.
 *
 * THE THREE LAYOUTS, AND WHY EACH ONE
 *
 *   laptop and up   a fixed 232px rail, always visible. The content column is
 *                   padded by exactly its width, so nothing is ever hidden
 *                   behind it.
 *   tablet          the rail becomes a drawer with a scrim, opened from the
 *                   top bar. 1100px is where a 232px column stops being free
 *                   space and starts being a quarter of the working area.
 *   phone           the same contents as a sheet that rises from the bottom
 *                   edge, with the current screen in the top bar. A drawer
 *                   that slides in from the side puts its first item at the
 *                   top of the screen, out of a thumb's reach; the bottom
 *                   third is where the hand already is.
 *
 * Only the box changes between those three: one tree, one order, one set of
 * names, so a destination cannot exist on a laptop and not on a phone.
 *
 * The kitchen board does not use this shell at all: it is a full-screen wall
 * display with no navigation, by design.
 */
export function DashboardBar({
  active,
  outlet,
  signOut = true,
}: {
  /**
   * Which destination to mark. Optional so a loading skeleton can render this
   * before it knows which screen is coming. With no `active`, nothing claims
   * to be the current page -- which is honest while nothing has loaded yet,
   * and beats the navigation blinking out of existence for the length of the
   * fetch.
   */
  active?: DashboardSection;
  outlet?: OutletBar | null;
  /** Off on the demo screens, where there is nobody signed in to sign out. */
  signOut?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const activeLink = DASHBOARD_LINKS.find((link) => link.key === active);
  const activeOutlet =
    outlet?.outlets.find((entry) => entry.id === outlet.activeId) ?? outlet?.outlets[0] ?? null;

  // A drawer that stays open after navigating is a trap on a phone: the next
  // screen arrives underneath it and the tap that felt like "go" looks like
  // "nothing happened".
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes it, and the page behind must not scroll while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      {/* The scrim is a sibling, not a parent: tapping anywhere behind the
          drawer closes it without intercepting taps on the drawer itself. */}
      <button
        type="button"
        className={`shell__scrim ${open ? 'is-open' : ''}`}
        aria-label="Close navigation"
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
      />

      <aside id="app-rail" className={`shell__rail ${open ? 'is-open' : ''}`} aria-label="Restaurant">
        <div className="shell__brandRow">
          <Link href="/" className="shell__brand" aria-label="AutoDine">
            <span className="shell__mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <circle cx="12" cy="10" r="4.2" stroke="currentColor" strokeWidth="1.7" />
                <path d="M6 18.5h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            AutoDine
          </Link>

          <button
            type="button"
            className="shell__close"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>

        {/* Only when there is something to switch between. With one outlet the
            foot of the rail already names the venue, and printing the same name
            twice in a 232px column reads as a bug. */}
        {outlet && outlet.outlets.length > 1 && (
          <div className="shell__outlet">
            <span className="shell__outletLabel">Switch outlet</span>
            <OutletSwitcher outlets={outlet.outlets} activeId={outlet.activeId} next={activeLink?.href ?? '/dashboard'} />
          </div>
        )}

        <nav className="shell__nav" aria-label="Restaurant">
          {SHELL_GROUPS.map((group) => (
            <div key={group.name} className="shell__group">
              <div className="shell__groupName">{group.name}</div>
              {group.links.map((link) => (
                <Link
                  key={link.key}
                  href={link.href}
                  className={`shell__link ${link.key === active ? 'is-active' : ''}`}
                  aria-current={link.key === active ? 'page' : undefined}
                >
                  <span className="shell__icon" aria-hidden="true">
                    {ICONS[link.key]}
                  </span>
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="shell__foot">
          <div className="shell__who">
            <span className="shell__avatar" aria-hidden="true">
              {initialsOf(activeOutlet?.name ?? 'AutoDine')}
            </span>
            <span className="shell__whoText">
              <span className="shell__whoName">{activeOutlet?.name ?? 'AutoDine'}</span>
              <span className="shell__whoRole">{activeOutlet?.role ?? 'Staff'}</span>
            </span>
          </div>

          {signOut && (
            <form action={signOutAction}>
              <button type="submit" className="shell__signOut">
                Sign out
              </button>
            </form>
          )}
        </div>
      </aside>

      <header className="shell__top">
        <button
          type="button"
          className="shell__menuBtn"
          aria-expanded={open}
          aria-controls="app-rail"
          onClick={() => setOpen(true)}
        >
          <span className="shell__menuBars" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Menu
        </button>

        <div className="shell__crumbs">
          <span className="shell__crumbNow">{activeLink?.label ?? 'Dashboard'}</span>
          {activeOutlet && <span className="shell__crumbVenue">{activeOutlet.name}</span>}
        </div>

        <div className="shell__topRight">
          <ShellSearch onLaunch={() => setOpen(false)} />
        </div>
      </header>
    </>
  );
}

/** Two letters, for the venue avatar. */
function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || 'A'
  );
}

/**
 * One line icon per destination.
 *
 * Inline rather than an icon package: ten icons is not worth a dependency, and
 * a 1.6px stroke at 18px is what makes the rail read as a system rather than a
 * collection of borrowed glyphs.
 */
const ICONS: Record<DashboardSection, ReactNode> = {
  overview: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 11.2 12 4.5l8 6.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 10v8.5h11V10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  orders: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6 3.5h12v17H6z" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6M9 16h4" strokeLinecap="round" />
    </svg>
  ),
  kitchen: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 9h14" strokeLinecap="round" />
      <path d="M6.5 9a5.5 5.5 0 0 1 11 0" strokeLinecap="round" />
      <path d="M4.5 13h15M6 13v4.5M18 13v4.5" strokeLinecap="round" />
    </svg>
  ),
  counter: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 7h16v10H4z" strokeLinejoin="round" />
      <path d="M4 11h16" strokeLinecap="round" />
      <path d="M7 14.5h3" strokeLinecap="round" />
    </svg>
  ),
  menus: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 4.5h9.5A3.5 3.5 0 0 1 18 8v11.5H8.5A3.5 3.5 0 0 1 5 16z" strokeLinejoin="round" />
      <path d="M8.5 9h6M8.5 12.5h4" strokeLinecap="round" />
    </svg>
  ),
  branding: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  ),
  import: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 4.5v9" strokeLinecap="round" />
      <path d="M8.5 10 12 13.5 15.5 10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 16.5v2.5h14v-2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  tables: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 6.5h16v4H4z" strokeLinejoin="round" />
      <path d="M6.5 10.5v8M17.5 10.5v8" strokeLinecap="round" />
      <path d="M9.5 6.5v-2h5v2" strokeLinejoin="round" />
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 19.5v-6M10 19.5V7M15 19.5v-9M20 19.5V4.5" strokeLinecap="round" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M4.6 8l1.9 1.1M17.5 14.9l1.9 1.1M4.6 16l1.9-1.1M17.5 9.1l1.9-1.1"
        strokeLinecap="round"
      />
    </svg>
  ),
};
