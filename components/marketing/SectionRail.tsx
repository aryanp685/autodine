'use client';

import { useEffect, useState } from 'react';

const SECTIONS = [
  { id: 'how', label: 'How' },
  { id: 'screens', label: 'Screens' },
  { id: 'product', label: 'Product' },
  { id: 'trust', label: 'Trust' },
  { id: 'status', label: 'Status' },
  { id: 'pricing', label: 'Pricing' },
] as const;

/** Compact glass index for the landing page. Every stop maps to a real section. */
export function SectionRail() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;
    const nodes = SECTIONS.map((section) => document.getElementById(section.id)).filter(
      (node): node is HTMLElement => node !== null,
    );
    if (nodes.length === 0) return;

    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.4;
      let current: string | null = null;
      for (const node of nodes) {
        if (node.getBoundingClientRect().top <= line) current = node.id;
      }
      setActive(current);
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
      className="fixed top-1/2 right-4 z-40 hidden -translate-y-1/2 rounded-2xl border border-white/90 bg-white/85 p-2 shadow-[0_18px_46px_-32px_rgba(20,50,35,0.4)] backdrop-blur-xl xl:block 2xl:right-6"
    >
      <ol className="flex flex-col gap-0.5">
        {SECTIONS.map((section) => {
          const current = active === section.id;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={current ? 'true' : undefined}
                className="group flex min-h-8 items-center gap-2 rounded-xl px-2.5 transition-colors hover:bg-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
              >
                <span
                  aria-hidden="true"
                  className={[
                    'size-1.5 shrink-0 rounded-full transition-colors duration-200',
                    current ? 'bg-forest' : 'bg-ink-line group-hover:bg-forest/40',
                  ].join(' ')}
                />
                <span className={[
                  'text-[9px] font-semibold tracking-[0.08em] uppercase transition-colors',
                  current ? 'text-forest' : 'text-mute group-hover:text-cream',
                ].join(' ')}>
                  {section.label}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
