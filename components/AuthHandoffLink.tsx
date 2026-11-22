'use client';

import Link from 'next/link';
import type { ComponentProps, MouseEvent, Ref } from 'react';

/**
 * A marketing link into the account screens that lets the lockup travel.
 *
 * The browser's View Transition API cannot drive this route change: Next
 * commits a server-rendered page in more than one step, and a transition
 * started around router.push() is aborted before it can capture the new page.
 * So the click only records where the lockup was; the account shell reads that
 * once, on mount, and animates the same lockup from there to its header slot.
 * Nothing is blocked, and a missing record or reduced motion means a plain
 * navigation with no animation at all.
 */

export const BRAND_HANDOFF_KEY = 'autodine:brand-handoff';

type Props = ComponentProps<typeof Link> & { ref?: Ref<HTMLAnchorElement> };

export function AuthHandoffLink({ href, children, onClick, ...props }: Props) {
  const remember = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const brand = document.querySelector<HTMLElement>('[data-brand-handoff]');
    if (!brand) return;
    const rect = brand.getBoundingClientRect();
    try {
      sessionStorage.setItem(
        BRAND_HANDOFF_KEY,
        JSON.stringify({ x: rect.x, y: rect.y, w: rect.width, h: rect.height, t: Date.now() }),
      );
    } catch {
      /* storage can be unavailable in private modes; the link still works */
    }
  };

  return (
    <Link href={href} onClick={remember} {...props}>
      {children}
    </Link>
  );
}
