'use client';

import { useEffect, useRef, useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Copies a string to the clipboard, and says so.
 *
 * The settings page shows the public menu URL as text. Copying it by hand is
 * the kind of thing people do once and get wrong, so this is a real button --
 * and because it is a real button it has to behave like one in every browser.
 *
 * `navigator.clipboard` only exists on secure origins, is missing in some
 * embedded webviews, and its promise rejects when the page is not focused.
 * So:
 *
 *   - success changes the label to "Copied" for a moment, announced by
 *     aria-live rather than by a colour change alone;
 *   - failure does NOT pretend. It selects the text in `selectId` so the next
 *     keystroke is ⌘C rather than a hunt for where the URL started, and the
 *     label says "Select and copy".
 *
 * A copy button that silently does nothing is worse than no copy button: the
 * person pastes the old link somewhere and blames the product.
 */
export function CopyButton({
  value,
  className,
  selectId,
  label = 'Copy link',
}: {
  value: string;
  className?: string;
  /** Element whose text becomes the selection if the clipboard is unavailable. */
  selectId?: string;
  label?: string;
}) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A confirmation that outlives the component is a state update on an
  // unmounted node, and React says so in the console.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    if (timer.current) clearTimeout(timer.current);

    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard api');
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      const target = selectId ? document.getElementById(selectId) : null;
      if (target) {
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setState('failed');
    }

    timer.current = setTimeout(() => setState('idle'), 2600);
  }

  return (
    <button
      type="button"
      className={className}
      onClick={copy}
      aria-live="polite"
      data-copy-state={state}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : label}
    </button>
  );
}
