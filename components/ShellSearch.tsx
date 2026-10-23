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
      // Cmd/Ctrl+K opens it from anywhere: the one shortcut people try.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setQuery('');
    onLaunch?.();
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="flex items-center gap-2 rounded-full border border-transparent bg-paper-deep px-3 py-1.5 transition-colors focus-within:border-hair-strong focus-within:bg-card">
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
          className="w-[92px] bg-transparent text-[12.5px] text-gink placeholder:text-gink-46 focus:w-[150px] focus:outline-none sm:w-[132px] sm:focus:w-[190px] transition-[width] duration-150"
        />
        {/* The key shown has to be the key that works. This printed ⌘K on every
            platform, including Windows, where the shortcut is Ctrl+K and the
            legend named a key the keyboard does not have. The modifier is read
            after mount so the server-rendered mark stays stable. */}
        <kbd className="hidden shrink-0 rounded border border-hair-strong px-1 py-px text-[9.5px] font-medium text-gink-46 sm:block">
          {isApple ? '⌘K' : 'Ctrl K'}
        </kbd>
      </div>

      {open && (
        <div
          id="shell-search-results"
          role="listbox"
          aria-label="Screens"
          className="absolute top-[calc(100%+6px)] right-0 z-50 w-[280px] overflow-hidden rounded-xl border border-hair bg-card py-1 shadow-g2"
        >
          {results.length === 0 ? (
            <p className="px-3.5 py-3 text-[12.5px] text-gink-46">No screen matches “{query.trim()}”.</p>
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
                  'flex items-center justify-between gap-3 px-3.5 py-2 text-[13px] transition-colors',
                  index === cursor ? 'bg-gink-07 text-gink' : 'text-gink-64',
                ].join(' ')}
              >
                <span>{link.label}</span>
                <span className="text-[10px] font-medium tracking-[0.08em] text-gink-46 uppercase">
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
