'use client';

import { useEffect, useState } from 'react';

/**
 * The right-edge index for the landing page.
 *
 * It duplicates nothing: every stop is an existing section id, and the labels
 * are short enough to sit outside the 1116px column instead of over it. The
 * rail is decorative navigation — the same destinations stay in the top bar —
 * so it is hidden below xl rather than compressed into the content.
 */

const SECTIONS = [
  { id: 'how', label: 'How' },
  { id: 'screens', label: 'Screens' },
  { id: 'product', label: 'Product' },
  { id: 'pricing', label: 'Pricing' },
] as const;

export function SectionRail() {
  const [active, setActive] = useState<string | null>(null);
  const [onDark, setOnDark] = useState(false);

  useEffect(() => {
    let frame = 0;
    const nodes = SECTIONS.map((section) => document.getElementById(section.id)).filter(
      (node): node is HTMLElement => node !== null,
    );
    if (nodes.length === 0) return;
    const darkBands = [...document.querySelectorAll<HTMLElement>('[data-rail-tone="dark"]')];

    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.4;
      let current: string | null = null;
      for (const node of nodes) {
        if (node.getBoundingClientRect().top <= line) current = node.id;
      }
      setActive(current);
      setOnDark(
        darkBands.some((band) => {
          const rect = band.getBoundingClientRect();
          return rect.top <= line && rect.bottom > line;
        }),
      );
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <nav
      aria-label="Page sections"
      data-section-rail
      className="fixed top-1/2 right-4 z-40 hidden -translate-y-1/2 xl:block 2xl:right-6"
    >
      <ol className="flex flex-col items-end">
        {SECTIONS.map((section) => {
          const current = active === section.id;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={current ? 'true' : undefined}
                className="group flex items-center justify-end gap-3 py-2 pl-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
              >
                <span
                  className={[
                    'text-[9.5px] font-medium tracking-[0.18em] uppercase transition-[color,opacity] duration-300 motion-reduce:transition-none',
                    current
                      ? onDark
                        ? 'text-brass-soft'
                        : 'text-forest'
                      : onDark
                        ? 'text-white/45 group-hover:text-white'
                        : 'text-mute-dim opacity-60 group-hover:text-gink group-hover:opacity-100',
                  ].join(' ')}
                >
                  {section.label}
                </span>
                <span
                  aria-hidden="true"
                  className={[
                    'block rounded-full transition-[width,height,background-color] duration-300 motion-reduce:transition-none',
                    current
                      ? onDark
                        ? 'h-4 w-[2px] bg-brass'
                        : 'h-4 w-[2px] bg-forest'
                      : onDark
                        ? 'h-px w-3 bg-white/25 group-hover:bg-white/60'
                        : 'h-px w-3 bg-mute-dim/50 group-hover:bg-gink/60',
                  ].join(' ')}
                />
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
