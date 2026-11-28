'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useRailStagger } from './owner/useRailStagger';
import type { ReactNode } from 'react';
import { OutletSwitcher } from '@/components/OutletSwitcher';
import { ShellSearch } from '@/components/ShellSearch';
import { BrandLockup } from '@/components/BrandMark';
import {
  DASHBOARD_LINKS,
  groupsForRole,
  sectionForPathname,
  type DashboardSection,
} from '@/components/shell-links';
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
 * EVERY STAFF SCREEN USES THIS SHELL, INCLUDING THE KITCHEN BOARD
 *
 * The kitchen board used to be exempt: it rendered its own full-screen frame,
 * with its own header and one "Dashboard" link as the only way out. That read
 * as a separate application. A manager watching service moves between the
 * rail and the board dozens of times a shift, and each move threw the venue,
 * the outlet and the way back away.
 *
 * The board now renders this bar like the other nine screens. What it keeps is
 * its density -- a wider content column and its audio controls as page
 * actions -- because that is a layout decision, not a reason to leave the
 * product's navigation behind.
 *
 * A screen is never asked to import this and render it directly: pages render
 * <DashboardBar> on the server and hand it to a client screen as a node (see
 * app/cashier/page.tsx and app/kitchen/page.tsx). Importing it into a client
 * component would pull the sign-out action and its server-only admin imports
 * into the browser bundle.
 */
export function DashboardBar({
  active,
  outlet,
  signOut = true,
  children,
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
  children?: ReactNode;
}) {
  const pathname = usePathname();

  /*
   * WHERE WE ARE COMES FROM THE URL.
   *
   * The prop is still accepted -- a skeleton that renders before its page is
   * known can name the section itself, and standalone renders in tests pass one
   * -- but when it is absent the rail works it out from the path. That is what
   * lets the bar be rendered ONCE by the staff layout and still mark the right
   * row on every navigation: a layout does not re-run when the page changes, so
   * a prop threaded from the page would go stale.
   */
  const activeSection = active ?? sectionForPathname(pathname);

  const [open, setOpen] = useState(false);
  /* GSAP, lazily, for the drawer's rows only -- see components/owner/useRailStagger.ts
     for why this is the surface that needs a timeline and the rest does not. */
  const railRef = useRailStagger<HTMLElement>(open);

  /*
   * THE BAR EARNS ITS EDGE.
   *
   * A sticky bar with a permanent hairline and a permanent shadow is drawn as if
   * there is always something scrolling under it -- at the top of a page there
   * is not, and the line then separates two surfaces that are the same surface.
   * So the edge appears when the page has actually moved.
   *
   * The listener is passive, throttled to one rAF, and only calls setState when
   * the boolean FLIPS: a scroll handler that re-renders on every frame is how a
   * "premium" header turns a phone scroll into a slideshow.
   */
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setScrolled(window.scrollY > 4);
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  /* The rail shows what this person can actually open. The role travels with
     the outlet because the same account can own one restaurant and cashier at
     another -- see lib/outlets.ts. With no outlet (demo, signed out) every
     link is drawn, which is the behaviour every screen had before this. */
  const role = outlet?.outlets.find((entry) => entry.id === outlet.activeId)?.role ?? null;
  const operatingMode = outlet?.operatingMode ?? 'mode_b';
  const groups = groupsForRole(role, operatingMode);

  const activeLink = DASHBOARD_LINKS.find((link) => link.key === activeSection);
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
          'fixed inset-0 z-40 bg-gink/40 transition-opacity duration-200 ease-[var(--o-ease)] lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
      />

      <aside
        id="app-rail"
        ref={railRef}
        aria-label="Restaurant"
        data-rail-open={open ? 'true' : 'false'}
        className={[
          /* Phone: a sheet from the bottom edge, because the thumb is there.
             Tablet: the same sheet. Laptop: a fixed rail that is part of the
             layout and never moves. One tree, three positions. */
          'fixed z-50 flex flex-col bg-rail text-rail-ink',
          /* Two shadows, both doing a job: an outer one to lift the sheet off
             the page, and an inner lit edge on the rail's right side so the
             sand column has a boundary against the paper instead of ending in
             a hard seam. On a phone the same edge reads as the top lip of the
             sheet, which is where a bottom sheet catches light. */
          'shadow-[var(--p-shadow-3)] lg:shadow-none',
          'inset-x-0 bottom-0 max-h-[80dvh] rounded-t-[20px] border-t border-rail-line pb-[env(safe-area-inset-bottom)]',
          'transition-transform duration-[280ms] ease-[var(--o-ease)] will-change-transform',
          open ? 'translate-y-0' : 'translate-y-full',
          'lg:inset-y-0 lg:left-0 lg:w-[244px] lg:max-h-none lg:translate-y-0 lg:rounded-none lg:border-t-0 lg:border-r lg:pb-0',
        ].join(' ')}
      >
        {/* The brand block is a band with a hairline under it, so the rail has a
            top edge instead of a wordmark floating in dark space. The venue is
            named once, at the foot, where the account lives -- printing it here
            as well would put the same words twice in a 244px column. */}
        <div className="flex items-center justify-between border-b border-rail-line px-4 py-3.5 lg:px-5 lg:py-4">
          <Link
            href="/"
            aria-label="AutoDine"
            className="group inline-flex items-center rounded-[13px] border border-rail-line bg-[var(--p-rail-raised)] px-3 py-[7px] shadow-[0_1px_2px_rgba(43,32,21,0.06),inset_0_1px_0_rgba(255,255,255,0.7)] transition-[box-shadow,transform] duration-150 ease-[var(--o-ease)] hover:-translate-y-px hover:shadow-[0_3px_10px_rgba(43,32,21,0.10),inset_0_1px_0_rgba(255,255,255,0.7)]"
          >
            {/* The lockup sits on a raised porcelain chip rather than straight
                on the sand: it is a warm brown drawing, and on the sand column
                it was reading as part of the background. */}
            <BrandLockup height={27} />
          </Link>

          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="grid size-8 place-items-center rounded-[var(--p-r-chip)] text-[18px] leading-none text-rail-ink-64 transition-colors duration-150 hover:bg-gink-07 hover:text-rail-ink focus-visible:outline-[var(--p-rail-ink)] lg:hidden"
          >
            ×
          </button>
        </div>

        {/* Only when there is something to switch between. With one outlet the
            foot of the rail already names the venue, and printing the same name
            twice in a 232px column reads as a bug. */}
        {outlet && outlet.outlets.length > 1 && (
          <div className="border-b border-rail-line px-4 py-3 lg:px-5">
            <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.16em] text-rail-ink-40 uppercase">
              Switch outlet
            </span>
            <OutletSwitcher outlets={outlet.outlets} activeId={outlet.activeId} next={activeLink?.href ?? '/dashboard'} />
          </div>
        )}

        <nav aria-label="Restaurant" className="flex-1 overflow-y-auto px-3 py-3.5">
          {groups.map((group) => (
            <div key={group.name} className="mb-4 last:mb-0">
              <div className="flex items-center gap-2 px-3 pt-2 pb-2">
                <span className="text-[10px] font-semibold tracking-[0.2em] text-rail-ink-40 uppercase">
                  {group.name}
                </span>
                {/* A rule to the edge of the column closes each group, so the
                    rail reads as labelled sections rather than one long list
                    with words in it. */}
                <span aria-hidden="true" className="h-px flex-1 bg-rail-line" />
              </div>
              {group.links.map((link) => {
                const current = link.key === activeSection;
                return (
                  <Link
                    key={link.key}
                    href={link.href}
                    data-nav={link.key}
                    data-nav-active={current ? 'true' : undefined}
                    aria-current={current ? 'page' : undefined}
                    /* On the sand rail the current screen is a filled orange
                       pill with white type -- the one saturated object in the
                       column, the way the reference dashboard marks "you are
                       here". Other rows lift on an orange wash.
                       `data-rail-row` is the GSAP handle: the row is animated
                       only while the drawer is opening, and never on a laptop
                       where the rail is always on screen. Tapping any row --
                       including the current one -- closes the sheet, because a
                       tap that appears to do nothing reads as a broken menu. */
                    onClick={() => setOpen(false)}
                    data-rail-row="true"
                    className={[
                      'group relative mb-[3px] flex items-center gap-3 rounded-[var(--p-r-control)] px-3 py-2.5 text-[13px]',
                      'transition-[background-color,color,box-shadow,transform] duration-150 ease-[var(--o-ease)] hover:translate-x-[1px] motion-reduce:hover:translate-x-0',
                      current
                        ? 'bg-[var(--p-rail-active)] font-semibold text-[var(--p-rail-active-ink)] shadow-[0_1px_2px_rgba(43,32,21,0.16)]'
                        : 'text-rail-ink-64 hover:bg-[var(--p-rail-hover)] hover:text-rail-ink',
                    ].join(' ')}
                  >
                    <span
                      aria-hidden="true"
                      className={[
                        /* One optical box for every glyph: the icon set is
                           drawn on different grids, and a fixed 18px cell is
                           what makes the column of labels line up to the
                           pixel. */
                        'grid size-[18px] shrink-0 place-items-center transition-colors [&_svg]:size-[17px]',
                        current
                          ? 'text-[var(--p-rail-active-ink)]'
                          : 'text-rail-ink-40 group-hover:text-rail-ink-64',
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

        {/* The account is a RAISED CARD at the foot of the rail, not a row of
            loose text. It is the one object on this sand column that is about a
            person rather than a destination, so it gets its own surface -- a
            white card on the sand, with a hairline. */}
        <div className="border-t border-rail-line p-2.5">
          <div className="rounded-[var(--p-r-block)] border border-rail-line bg-[var(--p-rail-raised)] p-2">
            <div className="flex items-center gap-2.5 rounded-[10px] p-1">
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[color-mix(in_oklab,var(--p-rail-active)_10%,transparent)] text-[11.5px] font-semibold text-[var(--p-rail-active)]"
              >
                {initialsOf(activeOutlet?.name ?? 'AutoDine')}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[12.5px] font-medium text-rail-ink">
                  {activeOutlet?.name ?? 'AutoDine'}
                </span>
                <span className="block truncate text-[11.5px] text-rail-ink-40 capitalize">
                  {activeOutlet?.role ?? 'Staff'}
                  {operatingMode === 'mode_a' ? ' · Mode A' : ''}
                </span>
              </span>
              {/* A who-am-I block, nothing more: the rail already carries the
                  settings door, and the product asks for each destination to
                  appear exactly once, so this card does not open its own. */}
            </div>

            {/* Sign out sits with the account, not at the bottom of the page.
                It used to be a full-width outlined pill the same weight as a
                destination, which is the wrong thing to put under a thumb.
                It is a plain 28px row under the name now, with a real
                `background` of its own -- a <button> with no background class
                was inheriting the browser's light grey box, and on this rail it
                rendered as a blank white rectangle. The reset in globals.css
                removes that default at the source now; this row is only left
                with its own fill, in the pill the rest of the product uses. */}
            {signOut && (
              <form action={signOutAction} className="mt-2 border-t border-rail-line pt-2">
                <button
                  type="submit"
                  className="w-auto rounded-full px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--p-rail-active)] transition-colors duration-150 hover:bg-[var(--p-rail-hover)] hover:text-[var(--p-accent-strong)] focus-visible:outline-[var(--p-rail-ink)]"
                >
                  Sign out
                </button>
              </form>
            )}
          </div>
        </div>
      </aside>

      {/* The top bar. It is the only chrome on a phone, so it carries the way
          into the rail, the name of where you are, and the jump search. */}
      {/* Solid, not frosted. A translucent header over a scrolling table is
          glassmorphism, and it also lets a table row read through the
          venue name. The hairline is what separates the two. */}
      <header
        data-bar-scrolled={scrolled ? 'true' : 'false'}
        className={[
          /* The sheet colour, not the field: the bar is chrome, and on a pale
             field a white bar with a hairline reads as a bar, while a grey one
             reads as a band of the page that forgot to scroll. */
          'sticky top-0 z-30 border-b border-hair bg-card lg:pl-[244px]',
          'transition-shadow duration-200 ease-[var(--o-ease)]',
          /* One elevation token, not a hand-tuned shadow: the bar lifts to the
             same contact shadow as a card, so the shell and the content agree
             about where the light is coming from. */
          scrolled ? 'shadow-[var(--p-shadow-1)]' : 'shadow-none',
        ].join(' ')}
      >
        <div className="flex h-14 items-center gap-3 px-4 sm:h-[60px] sm:px-6">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="app-rail"
            /* Named as the pair of the sheet's own "Close navigation". The name
               carries the visible word ("Menu") so voice control and the label
               agree, and it says what the tap does. */
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-full bg-[color-mix(in_oklab,var(--p-ink)_7%,transparent)] py-2 pr-4 pl-3 text-[12.5px] font-medium text-gink transition-colors duration-150 ease-[var(--o-ease)] hover:bg-[color-mix(in_oklab,var(--p-ink)_11%,transparent)] lg:hidden"
          >
            <span aria-hidden="true" className="flex flex-col gap-[3px]">
              <i className="block h-px w-3.5 bg-current" />
              <i className="block h-px w-3.5 bg-current" />
              <i className="block h-px w-2.5 bg-current" />
            </span>
            Menu
          </button>

          {/* Where you are, then who you are. The screen name is ink and the
              venue is meta: on a long shift the question is "which page", and
              the venue is already answered by the rail's foot. The name is
              prefixed with the same glyph the rail uses for that destination,
              so the bar and the rail never disagree about what this page is. */}
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="hidden size-7 shrink-0 place-items-center rounded-[9px] border border-hair bg-paper text-gink-46 sm:grid [&_svg]:size-[15px]"
            >
              {activeSection ? ICONS[activeSection] : null}
            </span>
            <span className="truncate text-[13.5px] font-semibold tracking-[-0.022em] text-gink">
              {activeLink?.label ?? 'Dashboard'}
            </span>
            {activeOutlet && (
              <>
                <span aria-hidden="true" className="hidden h-4 w-px shrink-0 bg-hair-strong sm:block" />
                <span className="hidden truncate text-[12.5px] tracking-[-0.005em] text-gink-46 sm:block">
                  {activeOutlet.name}
                </span>
              </>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {operatingMode === 'mode_a' && (
              <Link
                href="/dashboard/settings#settings-operating-mode"
                className="hidden rounded-full border border-hair bg-paper px-2.5 py-1 text-[11.5px] font-medium text-gink-62 transition-colors hover:text-gink md:inline-flex"
              >
                {outlet?.posIntegrationName
                  ? `Alongside ${outlet.posIntegrationName}`
                  : 'Mode A · Alongside POS'}
              </Link>
            )}
            {children}
            {/* The jump search keeps its 92px field from `sm` up. At 320px it
                was the 26px that pushed the bar sideways, and a phone already
                carries every destination in the drawer, so the field is the
                one thing that can wait for a wider screen. */}
            <div className="hidden sm:block">
              <ShellSearch
                onLaunch={() => setOpen(false)}
                role={role}
                operatingMode={operatingMode}
              />
            </div>
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
  invoices: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5.5 3.5h9l4 4v13h-13z" strokeLinejoin="round" />
      <path d="M14.5 3.5v4h4M8.5 12h7M8.5 15.5h7" strokeLinecap="round" />
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
  subscription: (
    // A card with a tick: the subscription is a standing arrangement, not an
    // action, which is why it is not a bolt or a lightning mark.
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3.5 7.5h17v11h-17z" strokeLinejoin="round" />
      <path d="M3.5 11h17" strokeLinecap="round" />
      <path d="m7 14.8 1.8 1.8 3.4-3.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 14.2h3M15 16.4h3" strokeLinecap="round" />
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
