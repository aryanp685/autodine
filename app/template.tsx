import type { ReactNode } from 'react';

/**
 * One wrapper, re-created on every navigation, so the page arrives instead of
 * snapping into place.
 *
 * WHY A TEMPLATE AND NOT A LAYOUT
 *
 * A layout persists across a navigation; that is what makes it useful, and it
 * is exactly wrong here. A template is thrown away and rebuilt for each route,
 * which means the CSS animation on this element starts again on every click.
 * No JavaScript, no transition library, no state to get out of sync.
 *
 * WHY IT ONLY ANIMATES OPACITY
 *
 * The guest screens carry fixed action bars (".cart__bar", ".co__bar") and the
 * kitchen and dashboard rails do too. An ancestor with a transform -- including
 * one that is mid-animation, or holding a finished `translate` -- becomes the
 * containing block for every fixed descendant, and those bars would slide to
 * the wrong place for the length of the animation. Opacity creates a stacking
 * context but never a containing block, so this is the one property that can
 * be animated here without breaking the layout underneath it.
 *
 * 220ms is the product's "an element arriving" duration. Any longer and the
 * page feels like it is loading; any shorter and it is not perceived at all.
 * The global reduced-motion rule collapses it to nothing.
 */
export default function Template({ children }: { children: ReactNode }) {
  return (
    <div className="animate-[routein_220ms_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none">
      {children}
    </div>
  );
}
