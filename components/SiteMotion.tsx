'use client';

/**
 * The motion layer for the site's public pages.
 *
 * WHAT IT DOES
 *
 *   [data-line]        each line of a masked headline slides up from behind
 *                      its overflow-hidden parent. The mask does the work, so
 *                      nothing fades -- type reads as revealed, not switched on.
 *   [data-hero-step]   the supporting hero copy: short fade and lift, staggered
 *                      after the headline.
 *   [data-hero-image]  a slow settle from 4% overscan, plus a scrubbed parallax
 *                      tied to scroll position.
 *   [data-reveal]      a section that arrives when its top crosses 82% of the
 *                      viewport. Small distance, long ease.
 *   [data-stagger]     children arriving in sequence, 70ms apart.
 *   [data-draw]        hairline rules drawn left to right.
 *
 * SEVEN WAYS THIS CAN BREAK A PAGE, and what each costs if ignored. The first
 * six are the reason this file is not four gsap.from() calls; the seventh is
 * why it is not four gsap.fromTo() calls either.
 *
 *   1. Reduced motion. When the OS asks for it, GSAP is never imported and
 *      everything is shown immediately.
 *   2. JavaScript disabled or broken. The CSS hides staged elements only while
 *      <html> has .motion, which the inline script in app/layout.tsx adds at
 *      paint time. No JS, no class, nothing hidden.
 *   3. GSAP fails to fetch. The catch reveals everything; the page was never
 *      allowed to depend on it.
 *   4. GSAP arrives too slowly. A watchdog reveals everything if the animation
 *      has not started in time, and a flag stops a late import undoing it.
 *   5. Navigating away mid-animation. gsap.context() reverts its own tweens and
 *      kills its ScrollTriggers on cleanup.
 *   6. ANIMATING FROM NOTHING TO NOTHING. gsap.from() reads its END value from
 *      the element's computed style. The stylesheet has already made those
 *      computed values opacity: 0, so a from() tween runs 0 -> 0 and leaves the
 *      page blank while looking, in DevTools, exactly like a working animation.
 *      This shipped once. The rule is therefore: ALWAYS AN EXPLICIT END STATE,
 *      fromTo, never from.
 *   7. The component never runs at all. Hydration fails, the chunk 404s, an
 *      extension blocks the bundle. Then the CSS is hiding content nothing will
 *      ever reveal. This file stamps `data-motion-ready` once it reaches GSAP;
 *      the inline script drops .motion four seconds later if that stamp is
 *      missing, which un-hides the page. Belt, braces, and a third thing for
 *      the day the first two break.
 *
 * The motion itself is restrained by design: 300-600ms, small distances, no
 * bounce, nothing that repeats except the parallax that follows the pointer.
 */

import { useEffect } from 'react';

/** If the animation has not begun by now, stop waiting and show the page. */
const WATCHDOG_MS = 2500;

/** After this long, anything still invisible on screen is a bug. Show it. */
const SAFETY_MS = 3200;

export function SiteMotion() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      revealAll();
      return;
    }

    let cancelled = false;
    let context: { revert: () => void } | null = null;

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

        // Tells the inline script in app/layout.tsx that this layer is alive,
        // so it does not strip .motion and un-hide the page underneath us.
        document.documentElement.setAttribute('data-motion-ready', '');

        context = gsap.context(() => {
          /* ---------------------------------------------------- the hero */

          // The headline, one masked line at a time. yPercent rather than a
          // pixel value so it works whatever the type scale comes out at.
          gsap.fromTo(
            '[data-line]',
            { yPercent: 108 },
            {
              yPercent: 0,
              opacity: 1,
              duration: 1.15,
              ease: 'power3.out',
              stagger: 0.085,
              delay: 0.12,
            },
          );

          gsap.fromTo(
            '[data-hero-step]',
            { opacity: 0, y: 20 },
            {
              opacity: 1,
              y: 0,
              duration: 0.85,
              ease: 'power3.out',
              stagger: 0.09,
              delay: 0.5,
              clearProps: 'transform',
            },
          );

          const heroImg = document.querySelector<HTMLElement>('[data-hero-image]');
          if (heroImg) {
            gsap.fromTo(
              heroImg,
              { scale: 1.1 },
              { scale: 1.04, duration: 1.9, ease: 'power2.out' },
            );
          }

          // Parallax. 4% of a 112%-tall image is 4.48% of the hero's height,
          // comfortably inside the 6% overhang at the top of .hero__media.
          // Anything at or above the overhang slides the image's top edge into
          // view and puts a hairline of paper across the top of the photograph.
          // Changing one number means changing the other.
          const hero = document.querySelector<HTMLElement>('[data-hero]');
          if (heroImg && hero) {
            gsap.to(heroImg, {
              yPercent: 4,
              ease: 'none',
              scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
            });
          }

          // The copy leaves a little faster than the photograph, which gives
          // the frame depth instead of letting it slide as one flat sheet.
          const heroBody = document.querySelector<HTMLElement>('[data-hero-body]');
          if (heroBody && hero) {
            gsap.to(heroBody, {
              opacity: 0,
              y: -24,
              ease: 'none',
              scrollTrigger: { trigger: hero, start: 'top top', end: '60% top', scrub: true },
            });
          }

          /* -------------------------------------------------- the sections */

          gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => {
            gsap.fromTo(
              el,
              { opacity: 0, y: 30 },
              {
                opacity: 1,
                y: 0,
                duration: 0.95,
                ease: 'power3.out',
                scrollTrigger: { trigger: el, start: 'top 82%', once: true },
              },
            );
          });

          gsap.utils.toArray<HTMLElement>('[data-stagger]').forEach((group) => {
            const children = Array.from(group.children) as HTMLElement[];
            if (!children.length) return;

            gsap.fromTo(
              children,
              { opacity: 0, y: 26 },
              {
                opacity: 1,
                y: 0,
                duration: 0.85,
                ease: 'power3.out',
                stagger: 0.07,
                scrollTrigger: { trigger: group, start: 'top 84%', once: true },
              },
            );
          });

          gsap.utils.toArray<HTMLElement>('[data-draw]').forEach((rule) => {
            gsap.fromTo(
              rule,
              { scaleX: 0 },
              {
                scaleX: 1,
                duration: 1,
                ease: 'power2.out',
                scrollTrigger: { trigger: rule, start: 'top 90%', once: true },
              },
            );
          });

          ScrollTrigger.refresh();
        });

        // Belt to the braces: see SAFETY_MS. Only on-screen elements, so the
        // scroll reveals below the fold keep working as intended.
        window.setTimeout(() => {
          if (cancelled) return;
          document
            .querySelectorAll<HTMLElement>('[data-reveal], [data-stagger] > *, [data-hero-step], [data-line]')
            .forEach((el) => {
              if (window.getComputedStyle(el).opacity !== '0') return;
              const rect = el.getBoundingClientRect();
              if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
              el.style.opacity = '1';
              el.style.transform = 'none';
              el.style.willChange = 'auto';
            });
        }, SAFETY_MS);
      } catch {
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
 * A plain style write rather than a library call, so it works whether or not
 * GSAP ever loaded. will-change is dropped too: leaving it on every animated
 * element for the life of the page keeps them all on their own compositor
 * layer.
 */
function revealAll() {
  document
    .querySelectorAll<HTMLElement>('[data-reveal], [data-stagger] > *, [data-hero-step], [data-line]')
    .forEach((el) => {
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.willChange = 'auto';
    });
}
