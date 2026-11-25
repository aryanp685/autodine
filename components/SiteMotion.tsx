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
          // Guarded: this layer runs on every public route, and pages without
          // a hero would otherwise make GSAP log "target not found".
          const lines = gsap.utils.toArray<HTMLElement>('[data-line]');
          if (lines.length) {
            gsap.fromTo(
              lines,
              { yPercent: 108, filter: 'blur(8px)' },
              {
                yPercent: 0,
                filter: 'blur(0px)',
                opacity: 1,
                duration: 1.2,
                ease: 'power3.out',
                stagger: 0.09,
                delay: 0.12,
                clearProps: 'filter',
              },
            );
          }

          const heroSteps = gsap.utils.toArray<HTMLElement>('[data-hero-step]');
          if (heroSteps.length) {
            gsap.fromTo(
              heroSteps,
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
          }

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

          // The composition itself drifts up a touch slower than the page, so
          // the frame reads as a layer behind the copy rather than part of it.
          const heroVisual = document.querySelector<HTMLElement>('[data-hero-visual]');
          if (heroVisual && hero) {
            gsap.to(heroVisual, {
              yPercent: -7,
              ease: 'none',
              scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 },
            });
          }

          /* -------------------------------------------------- the sections */

          gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => {
            // Group children have their own shorter, sequenced reveal below;
            // don't create two competing tweens on the same element.
            if (el.parentElement?.hasAttribute('data-stagger')) return;
            gsap.fromTo(
              el,
              { opacity: 0, y: 22, scale: 0.988, filter: 'blur(5px)' },
              {
                opacity: 1,
                y: 0,
                scale: 1,
                filter: 'blur(0px)',
                duration: 0.72,
                ease: 'power2.out',
                clearProps: 'transform,filter',
                scrollTrigger: { trigger: el, start: 'top 88%', once: true },
              },
            );
          });

          gsap.utils.toArray<HTMLElement>('[data-stagger]').forEach((group) => {
            const children = Array.from(group.children) as HTMLElement[];
            if (!children.length) return;

            gsap.fromTo(
              children,
              { opacity: 0, y: 20, scale: 0.99, filter: 'blur(4px)' },
              {
                opacity: 1,
                y: 0,
                scale: 1,
                filter: 'blur(0px)',
                duration: 0.68,
                ease: 'power2.out',
                stagger: 0.085,
                clearProps: 'transform,filter',
                scrollTrigger: { trigger: group, start: 'top 88%', once: true },
              },
            );
          });

          /* Service flow: reversible scroll progress, one-shot card entrances.
             No pinning, scroll interception, or animation on essential copy. */
          const flow = document.querySelector<HTMLElement>('[data-service-flow]');
          const progress = document.querySelector<HTMLElement>('[data-service-progress]');
          if (flow && progress) {
            gsap.fromTo(progress, { scaleX: 0 }, {
              scaleX: 1, ease: 'none',
              scrollTrigger: { trigger: flow, start: 'top 85%', end: 'bottom 40%', scrub: 0.5 },
            });
            Array.from(flow.children).forEach((card, index) => {
              gsap.fromTo(card, { opacity: 0, y: 44, rotation: index === 1 ? 0 : (index === 0 ? -1.5 : 1.5) }, {
                opacity: 1, y: 0, rotation: 0, duration: 0.9,
                ease: 'power3.out', delay: index * 0.08, clearProps: 'transform,opacity',
                scrollTrigger: { trigger: card, start: 'top 90%', once: true },
              });
              const icon = card.querySelector('[data-service-icon]');
              if (icon) gsap.fromTo(icon, { scale: 0.8, rotation: -12 }, {
                scale: 1, rotation: 0, duration: 0.85, delay: 0.18,
                ease: 'back.out(1.4)', clearProps: 'transform',
                scrollTrigger: { trigger: card, start: 'top 85%', once: true },
              });
            });
          }

          /* The service loop: at desktop widths the stage pins and one
             ticket travels from the table to the pass to the counter.
             `is-live` is the switch the stylesheet keys on; the cleanup
             returns the ticket and the stations to their reading order. */
          const loopMotion = gsap.matchMedia();
          loopMotion.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
            const loop = document.querySelector<HTMLElement>('[data-loop]');
            const ticket = loop?.querySelector<HTMLElement>('[data-loop-ticket]');
            const stations = loop
              ? Array.from(loop.querySelectorAll<HTMLElement>('[data-loop-station]'))
              : [];
            if (!loop || !ticket || stations.length !== 3) return;

            loop.classList.add('is-live');

            const centerFor = (index: number) => {
              const track = ticket.parentElement;
              if (!track) return 0;
              const trackBox = track.getBoundingClientRect();
              const stationBox = stations[index].getBoundingClientRect();
              return stationBox.left - trackBox.left + stationBox.width / 2 - ticket.offsetWidth / 2;
            };

            const setActive = (index: number) => {
              stations.forEach((station, i) => station.classList.toggle('is-on', i === index));
            };

            gsap.set(ticket, { x: () => centerFor(0), y: 0, rotate: -1.2 });
            setActive(0);

            gsap
              .timeline({
                scrollTrigger: {
                  trigger: loop,
                  start: 'top top',
                  end: 'bottom bottom',
                  scrub: 0.6,
                  invalidateOnRefresh: true,
                  onUpdate: (self) =>
                    setActive(self.progress < 0.36 ? 0 : self.progress < 0.7 ? 1 : 2),
                },
              })
              .to(ticket, {
                x: () => centerFor(1),
                y: -14,
                rotate: 0.8,
                duration: 1,
                ease: 'power1.inOut',
              })
              .to(ticket, {
                x: () => centerFor(2),
                y: 0,
                rotate: -0.6,
                duration: 1,
                ease: 'power1.inOut',
              });

            return () => {
              loop.classList.remove('is-live');
              stations.forEach((station) => station.classList.remove('is-on'));
              gsap.set(ticket, { clearProps: 'all' });
            };
          });

          /* Screen gallery: independent entrance and inner-frame depth so
             the two animations never compete for the same transform. */
          const galleryMotion = gsap.matchMedia();
          galleryMotion.add({
            desktop: '(min-width: 768px)',
            mobile: '(max-width: 767px)',
            reduced: '(prefers-reduced-motion: reduce)',
          }, (media) => {
            if (media.conditions?.reduced) return;
            const desktop = media.conditions?.desktop;
            document.querySelectorAll<HTMLElement>('[data-screen-card]').forEach((card, index) => {
              gsap.fromTo(card, {
                opacity: 0, y: desktop ? 56 : 24,
              }, {
                opacity: 1, y: 0, duration: 0.95,
                delay: desktop ? index * 0.12 : 0,
                ease: 'power3.out', clearProps: 'transform,opacity',
                scrollTrigger: { trigger: card, start: 'top 92%', once: true },
              });
              const frame = card.querySelector('[data-screen-frame]');
              if (!frame) return;
              gsap.fromTo(frame, {
                y: desktop ? 18 : 8,
                rotationX: desktop ? 7 : 0,
                rotationY: desktop ? (1 - index) * 5 : 0,
                transformPerspective: 1000,
              }, {
                y: desktop ? -8 : -3, rotationX: 0, rotationY: 0,
                ease: 'none',
                scrollTrigger: { trigger: card, start: 'top bottom', end: 'bottom top', scrub: 0.7 },
              });
            });
          });

          /* Prices stay literal and stable. Animate the containers, never
             count up money or imply that an indicative plan is selectable. */
          gsap.utils.toArray<HTMLElement>('[data-pricing-grid]').forEach((grid) => {
            grid.querySelectorAll<HTMLElement>('[data-pricing-card]').forEach((card, index) => {
              gsap.fromTo(card, { opacity: 0, y: 36, scale: 0.97 }, {
                opacity: 1, y: 0, scale: 1, duration: 0.85,
                delay: window.innerWidth >= 768 ? index * 0.1 : 0,
                ease: 'power3.out', clearProps: 'transform,opacity',
                scrollTrigger: { trigger: card, start: 'top 92%', once: true },
              });
            });
          });

          /* --------------------------------------------- the product tour */

          /* Three screens, one frame. Above 900px the panels stack in a
             sticky box and cross-fade as each step scrolls past; below it,
             and with reduced motion, every panel simply sits under its own
             step. The layout switch is a class this layer adds, so a page
             with no JavaScript never has a panel hidden by a script that did
             not run.

             gsap.matchMedia owns both the media query and the teardown: it
             reverts the class and the inline styles when the viewport
             crosses back under the breakpoint, and again when this layer
             unmounts. */
          const matchTour = gsap.matchMedia();

          matchTour.add('(min-width: 901px)', () => {
            const stage = document.querySelector<HTMLElement>('[data-tour]');
            if (!stage) return;

            const panels = Array.from(stage.querySelectorAll<HTMLElement>('[data-tour-panel]'));
            const steps = Array.from(stage.querySelectorAll<HTMLElement>('[data-tour-step]'));
            if (panels.length < 2 || panels.length !== steps.length) return;

            stage.classList.add('is-live');

            const show = (index: number) => {
              panels.forEach((panel, i) => {
                gsap.to(panel, {
                  opacity: i === index ? 1 : 0,
                  y: i === index ? 0 : 18,
                  duration: 0.5,
                  ease: 'power2.out',
                  overwrite: 'auto',
                });
              });
              steps.forEach((step, i) => step.classList.toggle('is-on', i === index));
            };

            gsap.set(panels, { opacity: 0, y: 18 });

            const triggers = steps.map((step, index) =>
              ScrollTrigger.create({
                trigger: step,
                start: 'top 52%',
                end: 'bottom 48%',
                onToggle: (self) => {
                  if (self.isActive) show(index);
                },
              }),
            );

            // Landing mid-section must not leave the frame showing panel one
            // while the reader is looking at step three.
            const already = triggers.findIndex((trigger) => trigger.isActive);
            show(already >= 0 ? already : 0);

            ScrollTrigger.refresh();

            return () => {
              stage.classList.remove('is-live');
              steps.forEach((step) => step.classList.remove('is-on'));
              gsap.set(panels, { clearProps: 'all' });
            };
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

          /* The headline's own hairline. Guarded like the hero selectors: the
             landing is the only page that carries one. */
          gsap.utils.toArray<HTMLElement>('[data-rule]').forEach((rule) => {
            gsap.fromTo(
              rule,
              { scaleX: 0 },
              {
                scaleX: 1,
                duration: 1.15,
                ease: 'power3.out',
                scrollTrigger: { trigger: rule, start: 'top 92%', once: true },
              },
            );
          });

          /* How much of the page has been read -- a 2px hairline, decoration
             only. ScrollTrigger on the document itself is the cheapest way to
             ask that question; it is absent on pages shorter than a viewport. */
          const pageProgress = document.querySelector<HTMLElement>('[data-page-progress]');
          if (pageProgress) {
            gsap.to(pageProgress, {
              scaleX: 1,
              ease: 'none',
              scrollTrigger: {
                trigger: document.documentElement,
                start: 'top top',
                end: 'bottom bottom',
                scrub: 0.3,
              },
            });
          }

          // The closing photograph moves inside its frame. The 8% overscan
          // means neither edge can ever slide into view.
          const close = document.querySelector<HTMLElement>('[data-close]');
          const closeImg = close?.querySelector<HTMLElement>('img');
          if (close && closeImg) {
            gsap.fromTo(
              closeImg,
              { scale: 1.08, yPercent: -3 },
              {
                yPercent: 3,
                ease: 'none',
                scrollTrigger: { trigger: close, start: 'top bottom', end: 'bottom top', scrub: 0.7 },
              },
            );
          }

          ScrollTrigger.refresh();

          // Runs when the context is reverted (unmount): the media query
          // groups own the classes and inline styles they added.
          return () => {
            loopMotion.revert();
            matchTour.revert();
          };
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
    .querySelectorAll<HTMLElement>('[data-reveal], [data-stagger] > *, [data-hero-step], [data-line], [data-rule]')
    .forEach((el) => {
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.willChange = 'auto';
    });
}
