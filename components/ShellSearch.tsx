'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DASHBOARD_LINKS } from '@/components/shell-links';

/**
 * "Go to…" — jump to any screen without hunting the rail.
 *
 * WHY A REAL CONTROL AND NOT A DECORATIVE SEARCH BOX
 *
 * A search field that does nothing is worse than no field: it is the one
 * control on the chrome that promises and fails. This one filters the actual
 * destinations the caller can reach, and Enter opens the top match, so it is
 * honest and it is faster than the rail for someone who knows where they are
 * going.
 *
 * Keyboard: up/down move, Enter opens, Escape closes. Clicking outside
 * closes. Nothing here touches data — it navigates.
 *
 * EVERY RESULT IS A REAL LINK
 *
 * The obvious implementation calls `router.push`, but that takes away the
 * things a link gives for free: middle-click, "open in new tab", the URL in the
 * status bar on hover, and Next's own prefetch. So the rows are anchors, and
 * Enter on a highlighted row clicks the anchor it is already sitting on. Same
 * keystrokes, no downsides.
 */
export function ShellSearch({ onLaunch }: { onLaunch?: () => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  /**
   * Which modifier to print on the shortcut legend.
   *
   * Starts false so the server and the first client render agree (a mismatch
   * here would be a hydration warning on every staff screen), then corrected
   * once on mount -- a legend nobody reads for 200ms.
   */
  const [isApple, setIsApple] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return DASHBOARD_LINKS;
    return DASHBOARD_LINKS.filter(
      (link) =>
        link.label.toLowerCase().includes(needle) ||
        link.group.toLowerCase().includes(needle) ||
        link.href.toLowerCase().includes(needle)
    );
  }, [query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    setIsApple(/mac|iphone|ipad/i.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /*
   * CMD/CTRL+K, ALWAYS LISTENING.
   *
   * This handler used to live in the effect above, which only runs while the
   * palette is ALREADY open -- so the legend printed "⌘K", the shortcut did
   * nothing from a closed palette, and the one key everybody tries first
   * appeared to be broken. Found by reading the effect's dependencies, not by
   * looking at the screen: the palette looked perfect and did nothing.
   *
   * It is registered on the document for the life of the screen, not per open.
   */
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setOpen(true);
      inputRef.current?.focus();
      // The field is a real input: focusing it is enough, but a native
      // `select()` makes the shortcut useful when there is already a query.
      inputRef.current?.select();
    };
    document.addEventListener('keydown', onShortcut);
    return () => document.removeEventListener('keydown', onShortcut);
  }, []);

  function close() {
    setOpen(false);
    setQuery('');
    onLaunch?.();
  }

  return (
    <div className="relative" ref={wrapperRef}>
      {/* A FIELD, NOT A BOX. 38px, control radius, a hairline that only lights
          up on focus, and the magnifier at 14px so it reads as a mark rather
          than as the biggest thing in the header. The legend inside is the
          only chrome: on a bar this quiet, a filled pill behind "Go to…" would
          be the loudest object on the screen. */}
      {/* A quiet chip that becomes a field. A permanently outlined box in a top
          bar reads as an unfinished form control; the resting state is a soft
          tint, and focus turns it into the one white object in the bar with the
          accent ring. The `⌘K` legend sits inside it, because that is what it
          is: the shortcut for this control, not a separate affordance. */}
      <div className="flex h-9 items-center gap-2 rounded-[var(--p-r-control)] border border-transparent bg-[color-mix(in_oklab,var(--p-ink)_6%,transparent)] pr-2 pl-2.5 transition-[background-color,border-color,box-shadow] duration-150 ease-[var(--o-ease)] hover:border-hair-strong hover:bg-[color-mix(in_oklab,var(--p-ink)_3%,var(--p-card))] focus-within:border-[var(--p-accent)] focus-within:bg-card focus-within:shadow-[var(--p-shadow-1)]">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="shrink-0 text-gink-46"
        >
          <circle cx="11" cy="11" r="6.2" />
          <path d="M15.6 15.6 20 20" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          placeholder="Go to…"
          aria-label="Go to a screen"
          aria-expanded={open}
          aria-controls="shell-search-results"
          autoComplete="off"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setCursor((c) => Math.min(c + 1, results.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            }
            if (event.key === 'Enter' && results[cursor]) {
              event.preventDefault();
              optionRefs.current[cursor]?.click();
            }
          }}
          className="w-[92px] bg-transparent text-[12.5px] text-gink placeholder:text-gink-46 focus:w-[150px] focus:outline-none focus-visible:outline-none sm:w-[132px] sm:focus:w-[190px] transition-[width] duration-150"
        />
        {/* The key shown has to be the key that works. This printed ⌘K on every
            platform, including Windows, where the shortcut is Ctrl+K and the
            legend named a key the keyboard does not have. The modifier is read
            after mount so the server-rendered mark stays stable. */}
        <kbd className="hidden shrink-0 rounded-[6px] border border-hair bg-card px-1.5 py-px text-[10px] font-medium text-gink-46 shadow-[inset_0_-1px_0_rgba(255,255,255,0.05)] sm:block">
          {isApple ? '⌘K' : 'Ctrl K'}
        </kbd>
      </div>

      {open && (
        <div
          id="shell-search-results"
          role="listbox"
          aria-label="Screens"
          className="absolute top-[calc(100%+8px)] right-0 z-50 max-h-[min(60dvh,420px)] w-[300px] overflow-y-auto overscroll-contain rounded-[var(--p-r-block)] border border-hair bg-card py-1.5 shadow-[var(--p-shadow-3)]"
        >
          {results.length === 0 ? (
            <p className="px-3.5 py-3 text-[12.5px] text-gink-46">
              No screen matches “{query.trim()}”.
            </p>
          ) : (
            results.map((link, index) => (
              <Link
                key={link.key}
                href={link.href}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                role="option"
                aria-selected={index === cursor}
                onMouseEnter={() => setCursor(index)}
                onClick={close}
                className={[
                  'relative mx-1 flex items-center justify-between gap-3 rounded-[var(--p-r-control)] px-2.5 py-2 text-[13px]',
                  'transition-colors duration-100 ease-[var(--o-ease)]',
                  index === cursor ? 'bg-[color-mix(in_oklab,var(--p-accent)_10%,transparent)] text-gink' : 'text-gink-64',
                ].join(' ')}
              >
                {/* The cursor mark, in the same copper the rail uses for "you
                    are here". One idea, two places. */}
                <span
                  aria-hidden="true"
                  className={[
                    'absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--p-accent)] transition-opacity duration-100',
                    index === cursor ? 'opacity-100' : 'opacity-0',
                  ].join(' ')}
                />
                <span className="pl-2">{link.label}</span>
                <span className="pr-1 text-[10px] font-medium tracking-[0.1em] text-gink-46 uppercase">
                  {link.group}
                </span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
