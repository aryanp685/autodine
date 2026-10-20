'use client';

/**
 * Entrance and scroll animation for the home page.
 *
 * A client component so HomeScreen can stay a Server Component: it finds the
 * elements it needs by [data-anim] attribute and animates them in place. It
 * renders nothing itself.
 *
 * GSAP is imported DYNAMICALLY, after paint, not bundled into the initial
 * load. Statically imported it costs about 44 KB gzipped on the critical path
 * of a page whose whole point is to load fast on a phone -- a quarter of the
 * page's JavaScript for an effect nobody asked to wait for. The hero is
 * already hidden by CSS at this point, so deferring the import costs nothing
 * visually: the elements simply stay hidden a few frames longer.
 *
 * FIVE FAILURE MODES, and they are the whole reason this file is not just a
 * gsap.from() call:
 *
 *   1. Reduced motion. A staggering animation is exactly the thing that makes
 *      some people ill. When the OS asks for reduced motion, GSAP is never
 *      even imported and everything is shown immediately.
 *
 *   2. JavaScript disabled or broken. The CSS only hides [data-anim] when
 *      <html> carries .motion, which an inline script adds at paint time. No
 *      JS means no class, so nothing is ever hidden and the page reads whole.
 *
 *   3. GSAP fails to load. A dynamic import can reject -- offline, blocked
 *      CDN, chunk 404. The CSS has already hidden the elements, so a failed
 *      import would leave the page blank. The catch reveals everything.
 *
 *   4. GSAP loads too slowly. Same blank-page risk, different cause. A
 *      watchdog reveals everything if the animation has not started in time,
 *      and a flag makes sure the reveal cannot then be undone by a late import.
 *
 *   5. Navigation away mid-animation. gsap.context() reverts every tween it
 *      created and kills its ScrollTriggers on cleanup, so leaving cannot
 *      leave a half-faded element or an orphaned scroll listener.
 *
 * The motion itself is deliberately restrained -- small distances, no bounce,
 * a decelerating ease. Anything showier fights the editorial minimalism.
 */

import { useEffect } from 'react';

/** Everything the hero reveals, in the order it should arrive. */
const HERO_STEPS = ['kicker', 'title', 'lede', 'ctas', 'note'] as const;

/** If the animation has not begun by now, stop waiting and show the page. */
const WATCHDOG_MS = 2500;

export function HomeMotion() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      revealAll();
      return;
    }

    let cancelled = false;
    let context: { revert: () => void } | null = null;

    // Set before the await: if cleanup runs while GSAP is still loading,
    // the late import must not then animate or re-hide anything.
    const watchdog = window.setTimeout(() => {
      if (!context) revealAll();
    }, WATCHDOG_MS);

    void (async () => {
      try {
        const [{ gsap }, { ScrollTrigger }] = await Promise.all([
          import('gsap'),
          import('gsap/ScrollTrigger'),
        ]);

        if (cancelled) return;
        gsap.registerPlugin(ScrollTrigger);

        context = gsap.context(() => {
          HERO_STEPS.forEach((step, i) => {
            const target = `[data-anim="hero-${step}"]`;
            if (!document.querySelector(target)) return;

            gsap.from(target, {
              opacity: 0,
              y: step === 'title' ? 26 : 16,
              duration: step === 'title' ? 1.1 : 0.85,
              ease: 'power3.out',
              delay: 0.08 + i * 0.11,
            });
          });

          gsap.utils.toArray<HTMLElement>('[data-anim="reveal"]').forEach((el) => {
            gsap.from(el, {
              opacity: 0,
              y: 24,
              duration: 0.9,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: el,
                // Fire when the top passes 85% of the viewport, so it lands
                // while the reader is already looking at it.
                start: 'top 85%',
                once: true,
              },
            });
          });

          // Hero parallax. The photograph drifts up more slowly than the page
          // scrolls, which is what gives a full-bleed image depth instead of
          // letting it feel pasted flat behind the type. Small on purpose:
          // 12% of the hero height, scrubbed against scroll so it tracks the
          // wheel rather than running on a timer.
          const heroImg = document.querySelector<HTMLElement>('[data-hero-image]');
          const hero = document.querySelector<HTMLElement>('[data-hero]');
          if (heroImg && hero) {
            gsap.to(heroImg, {
              yPercent: 12,
              ease: 'none',
              scrollTrigger: {
                trigger: hero,
                start: 'top top',
                end: 'bottom top',
                scrub: true,
              },
            });
          }

          // The hero copy fades as it leaves. Without this the headline stays
          // fully opaque behind the section scrolling over it, which reads as
          // a layering mistake rather than a transition.
          const heroBody = document.querySelector<HTMLElement>('[data-hero-body]');
          if (heroBody && hero) {
            gsap.to(heroBody, {
              opacity: 0,
              y: -30,
              ease: 'none',
              scrollTrigger: {
                trigger: hero,
                start: 'top top',
                end: '55% top',
                scrub: true,
              },
            });
          }

          gsap.utils.toArray<HTMLElement>('[data-anim-group]').forEach((group) => {
            const children = Array.from(group.children) as HTMLElement[];
            if (!children.length) return;

            gsap.from(children, {
              opacity: 0,
              y: 20,
              duration: 0.8,
              ease: 'power3.out',
              stagger: 0.09,
              scrollTrigger: { trigger: group, start: 'top 85%', once: true },
            });
          });

          ScrollTrigger.refresh();
        });
      } catch {
        // GSAP could not be fetched. The page must not stay blank.
        if (!cancelled) revealAll();
      } finally {
        window.clearTimeout(watchdog);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
      context?.revert();
    };
  }, []);

  return null;
}

/**
 * Show every staged element at once, with no animation.
 *
 * Uses a plain style write rather than a library call so it works whether or
 * not GSAP ever loaded. The will-change hint is dropped too -- leaving it on
 * every animated element permanently would keep them on their own compositor
 * layer for the life of the page.
 */
function revealAll() {
  const nodes = document.querySelectorAll<HTMLElement>(
    '[data-anim], [data-anim-group] > *'
  );
  nodes.forEach((el) => {
    el.style.opacity = '1';
    el.style.transform = 'none';
    el.style.willChange = 'auto';
  });
}
