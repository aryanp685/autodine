'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { OutletSwitcher } from '@/components/OutletSwitcher';
import { ShellSearch } from '@/components/ShellSearch';
import { BrandLockup } from '@/components/BrandMark';
import { BRAND_GREEN } from '@/lib/brand';
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
        aria-label="Close navigation"
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
        className={[
          'fixed inset-0 z-40 bg-gink/35 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
      />

      <aside
        id="app-rail"
        aria-label="Restaurant"
        data-rail-open={open ? 'true' : 'false'}
        className={[
          /* Phone: a sheet from the bottom edge, because the thumb is there.
             Tablet: the same sheet. Laptop: a fixed rail that is part of the
             layout and never moves. One tree, three positions. */
          'fixed z-50 flex flex-col bg-card shadow-[var(--p-shadow-2)]',
          'inset-x-0 bottom-0 max-h-[80dvh] rounded-t-2xl border-t border-hair pb-[env(safe-area-inset-bottom)]',
          'transition-transform duration-250 ease-out',
          open ? 'translate-y-0' : 'translate-y-full',
          'lg:inset-y-0 lg:left-0 lg:w-[232px] lg:max-h-none lg:translate-y-0 lg:rounded-none lg:border-t-0 lg:border-r lg:pb-0',
        ].join(' ')}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2 lg:px-5 lg:pt-5">
          <Link href="/" aria-label="AutoDine" className="text-gink">
            <BrandLockup size={21} ink="currentColor" dot={BRAND_GREEN} />
          </Link>

          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="grid size-8 place-items-center rounded-full text-[18px] text-gink-46 hover:bg-gink-07 hover:text-gink lg:hidden"
          >
            ×
          </button>
        </div>

        {/* Only when there is something to switch between. With one outlet the
            foot of the rail already names the venue, and printing the same name
            twice in a 232px column reads as a bug. */}
        {outlet && outlet.outlets.length > 1 && (
          <div className="border-b border-hair px-4 py-3 lg:px-5">
            <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.13em] text-gink-46 uppercase">
              Switch outlet
            </span>
            <OutletSwitcher outlets={outlet.outlets} activeId={outlet.activeId} next={activeLink?.href ?? '/dashboard'} />
          </div>
        )}

        <nav aria-label="Restaurant" className="flex-1 overflow-y-auto px-2.5 py-3">
          {SHELL_GROUPS.map((group) => (
            <div key={group.name} className="mb-4 last:mb-0">
              <div className="px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.15em] text-gink-46 uppercase">
                {group.name}
              </div>
              {group.links.map((link) => {
                const current = link.key === active;
                return (
                  <Link
                    key={link.key}
                    href={link.href}
                    data-nav={link.key}
                    data-nav-active={current ? 'true' : undefined}
                    aria-current={current ? 'page' : undefined}
                    /* The current screen used to be the one black block in the
                       rail. Inside a glass panel that read as a hole punched in
                       the navigation, and it was the heaviest thing on a screen
                       whose job is to show numbers. It is now a tinted glass
                       chip with an accent edge -- still unmistakable at a
                       glance, no longer competing with the page's one real
                       action. */
                    className={[
                      'group relative mb-0.5 flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] transition-all duration-150',
                      current
                        ? 'bg-[color-mix(in_oklab,var(--p-accent)_11%,white)] font-medium text-gink shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-[color-mix(in_oklab,var(--p-accent)_22%,transparent)] ring-inset'
                        : 'text-gink-64 hover:bg-white/70 hover:text-gink',
                    ].join(' ')}
                  >
                    <span
                      aria-hidden="true"
                      className={[
                        'shrink-0 transition-colors',
                        current ? 'text-[var(--p-accent)]' : 'text-gink-46 group-hover:text-gink-64',
                      ].join(' ')}
                    >
                      {ICONS[link.key]}
                    </span>
                    {link.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-hair px-4 py-3 lg:px-5 lg:py-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--p-accent)_88%,black)] text-[11px] font-semibold text-onink"
            >
              {initialsOf(activeOutlet?.name ?? 'AutoDine')}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[12.5px] font-medium text-gink">
                {activeOutlet?.name ?? 'AutoDine'}
              </span>
              <span className="block truncate text-[11px] text-gink-46 capitalize">
                {activeOutlet?.role ?? 'Staff'}
              </span>
            </span>
          </div>

          {signOut && (
            <form action={signOutAction} className="mt-2.5">
              <button
                type="submit"
                className="w-full rounded-full border border-hair-strong bg-white/40 py-2 text-[11.5px] font-medium text-gink-64 transition-colors hover:border-gink-28 hover:bg-white/80 hover:text-gink"
              >
                Sign out
              </button>
            </form>
          )}
        </div>
      </aside>

      {/* The top bar. It is the only chrome on a phone, so it carries the way
          into the rail, the name of where you are, and the jump search. */}
      <header className="sticky top-0 z-30 border-b border-hair bg-white/60 backdrop-blur-xl lg:pl-[232px]">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="app-rail"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-full border border-hair-strong py-1.5 pr-3 pl-2 text-[12px] font-medium text-gink lg:hidden"
          >
            <span aria-hidden="true" className="flex flex-col gap-[3px]">
              <i className="block h-px w-3.5 bg-current" />
              <i className="block h-px w-3.5 bg-current" />
              <i className="block h-px w-2.5 bg-current" />
            </span>
            Menu
          </button>

          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-gink">
              {activeLink?.label ?? 'Dashboard'}
            </span>
            {activeOutlet && (
              <span className="hidden truncate text-[12px] text-gink-46 sm:block">· {activeOutlet.name}</span>
            )}
          </div>

          <div className="ml-auto">
            <ShellSearch onLaunch={() => setOpen(false)} />
          </div>
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
