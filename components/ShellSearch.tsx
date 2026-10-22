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
    <div className="shellSearch" ref={wrapperRef}>
      <input
        ref={inputRef}
        type="search"
        className="shellSearch__input"
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
      />

      {open && (
        <div className="shellSearch__panel" id="shell-search-results" role="listbox" aria-label="Screens">
          {results.length === 0 ? (
            <p className="shellSearch__empty">No screen matches “{query.trim()}”.</p>
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
                className={`shellSearch__item ${index === cursor ? 'is-on' : ''}`}
                onMouseEnter={() => setCursor(index)}
                onClick={close}
              >
                <span>{link.label}</span>
                <span className="shellSearch__group">{link.group}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
