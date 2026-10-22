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
 * SIXTH FAILURE MODE, and it is the one that actually shipped: the animation
 * animating from nothing to nothing. Every tween here used gsap.from(), and
 * gsap.from() takes its END value from the element's current computed style.
 * The stylesheet hides these elements with `opacity: 0` while .motion is
 * present, so the computed value was 0, the tween ran 0 -> 0, and the whole
 * page stayed blank while looking like it had animated. The rule below is
 * therefore: ALWAYS AN EXPLICIT END STATE. fromTo, never from.
 *
 * SEVENTH: the component never runs at all. Hydration fails, the chunk 404s,
 * an extension blocks the bundle -- and this defect is invisible to every
 * check above, because none of them execute. The CSS is then hiding content
 * that nothing will ever reveal. The inline script in app/layout.tsx stamps
 * `data-motion-ready` once this effect reaches GSAP, and drops `.motion` four
 * seconds later if that stamp is missing, which un-hides the page. Belt,
 * braces, and a third thing for the day the first two break.
 *
 * The motion itself is deliberately restrained -- small distances, no bounce,
 * a decelerating ease. Anything showier fights the editorial minimalism.
 */

import { useEffect } from 'react';

/** Everything the hero reveals, in the order it should arrive. */
const HERO_STEPS = ['kicker', 'title', 'lede', 'ctas', 'note'] as const;

/** If the animation has not begun by now, stop waiting and show the page. */
const WATCHDOG_MS = 2500;

/**
 * After this long, anything still invisible inside the viewport is shown.
 *
 * A belt to the animation's braces. The watchdog above only covers GSAP never
 * arriving; this covers GSAP arriving and then doing nothing useful -- a tween
 * that never fires, a ScrollTrigger that never refreshes, a browser that drops
 * the inline style. It only touches elements that are on screen: content below
 * the fold keeps its scroll reveal, which is the point of having one.
 */
const SAFETY_MS = 3000;

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

        // Tells the inline script in app/layout.tsx that the motion layer is
        // alive, so it does not strip .motion and un-hide the page under us.
        // See the seventh failure mode in the header comment.
        document.documentElement.setAttribute('data-motion-ready', '');

        context = gsap.context(() => {
          HERO_STEPS.forEach((step, i) => {
            const target = `[data-anim="hero-${step}"]`;
            if (!document.querySelector(target)) return;

            gsap.fromTo(
              target,
              { opacity: 0, y: step === 'title' ? 30 : step === 'note' ? 10 : 18 },
              {
                // Explicit end state. See the sixth failure mode above: the
                // stylesheet has already made this 0, so `to` must say 1.
                opacity: 1,
                y: 0,
                duration: step === 'title' ? 1.05 : 0.8,
                ease: 'power3.out',
                delay: 0.1 + i * 0.1,
                // The element is visible in the DOM from the start; only its
                // opacity is staged, so layout cannot shift under the photo.
                clearProps: 'transform',
              },
            );
          });

          // The opening frame: the photograph settles from a 6% overscan over
          // 1.6s while the copy arrives over it. Slow on purpose -- this runs
          // once per visit, and a fast zoom reads as a stutter rather than a
          // breath. It animates scale only, so it cannot fight the scrubbed
          // yPercent parallax set up further down.
          const openingHeroImg = document.querySelector<HTMLElement>('[data-hero-image]');
          if (openingHeroImg) {
            gsap.fromTo(
              openingHeroImg,
              { scale: 1.06 },
              { scale: 1, duration: 1.6, ease: 'power2.out' },
            );
          }

          // Section rules are drawn from the left as their section arrives.
          // scaleX on a 1px line is composited, so this costs nothing to run
          // alongside the block's own fade.
          gsap.utils.toArray<HTMLElement>('[data-rule]').forEach((rule) => {
            gsap.fromTo(
              rule,
              { scaleX: 0 },
              {
                scaleX: 1,
                duration: 1.1,
                ease: 'power2.out',
                scrollTrigger: { trigger: rule.parentElement ?? rule, start: 'top 88%', once: true },
              },
            );
          });

          gsap.utils.toArray<HTMLElement>('[data-anim="reveal"]').forEach((el) => {
            gsap.fromTo(
              el,
              { opacity: 0, y: 26 },
              {
                opacity: 1,
                y: 0,
                duration: 0.9,
                ease: 'power3.out',
                scrollTrigger: {
                  trigger: el,
                  // Fire when the top passes 85% of the viewport, so it lands
                  // while the reader is already looking at it.
                  start: 'top 85%',
                  once: true,
                },
              },
            );
          });

          // Hero parallax. The photograph drifts up more slowly than the page
          // scrolls, which is what gives a full-bleed image depth instead of
          // letting it feel pasted flat behind the type. Small on purpose:
          // 8% of the image's own height, scrubbed against scroll so it tracks
          // the wheel rather than running on a timer. The stylesheet sizes the
          // image at 120% with 10% of overhang, so 8% of 120% = 9.6% of the
          // hero stays inside it. Changing one number means changing the
          // other -- see the note on .home__heroImg.
          const heroImg = document.querySelector<HTMLElement>('[data-hero-image]');
          const hero = document.querySelector<HTMLElement>('[data-hero]');
          if (heroImg && hero) {
            gsap.to(heroImg, {
              yPercent: 8,
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

            gsap.fromTo(
              children,
              { opacity: 0, y: 18 },
              {
                opacity: 1,
                y: 0,
                duration: 0.8,
                ease: 'power3.out',
                // 75ms between siblings: close enough that a row reads as one
                // gesture, far enough that the order is legible.
                stagger: 0.075,
                scrollTrigger: { trigger: group, start: 'top 85%', once: true },
              },
            );
          });

          ScrollTrigger.refresh();
        });

        // Belt to the braces: see SAFETY_MS. Anything on screen that is still
        // invisible three seconds in is a bug, not a design, and a blank home
        // page is a worse outcome than a missing fade.
        window.setTimeout(() => {
          if (cancelled) return;
          document
            .querySelectorAll<HTMLElement>('[data-anim], [data-anim-group] > *')
            .forEach((el) => {
              if (window.getComputedStyle(el).opacity !== '0') return;
              const rect = el.getBoundingClientRect();
              const onScreen = rect.bottom > 0 && rect.top < window.innerHeight;
              if (!onScreen) return;
              el.style.opacity = '1';
              el.style.transform = 'none';
              el.style.willChange = 'auto';
            });
        }, SAFETY_MS);
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
