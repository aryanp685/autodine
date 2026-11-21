'use client';

/**
 * A submit button that asks once before it fires.
 *
 * WHY NOT `window.confirm`
 *
 * Because a native dialog cannot be styled, cannot say which table it is
 * talking about in the product's voice, blocks the whole tab, and on a phone
 * looks like the browser is in trouble. This product has none, and adding the
 * first one in the place where somebody is holding a printed QR card would be
 * the worst possible place to start.
 *
 * WHY IT IS INLINE AND NOT A MODAL
 *
 * The action it guards is small and reversible in one click ("No"), and the
 * thing being confirmed -- a table code -- is already on screen behind it. A
 * modal would put the subject of the question behind a scrim.
 *
 * THE FOUR THINGS IT HAS TO GET RIGHT
 *
 *   1. Two steps, one submit. The first press only arms; the second submits
 *      the form exactly once. Nothing is written on the arming press.
 *   2. Focus moves to the confirming button, so a keyboard user is not left
 *      with focus on a button that no longer exists.
 *   3. Escape cancels. It is the key everybody tries.
 *   4. The question is announced, not just drawn: `role="alertdialog"` with a
 *      labelled question would be heavier than this needs, so the question is
 *      a live region that receives focus. If the click did nothing visible, a
 *      screen reader would say so here.
 *
 * It is a *submit* button with a `formAction`, so the write stays a server
 * action on a server-rendered form: this component decides when the form is
 * submitted, never what the server does with it.
 */

import { useEffect, useRef, useState } from 'react';
import { btn, type BtnSize, type BtnTone } from '@/components/owner/chrome';

export function ConfirmSubmit({
  children,
  question,
  confirmLabel = 'Yes, do it',
  cancelLabel = 'No',
  tone = 'danger',
  size = 'sm',
  className = '',
  ...rest
}: {
  /** The idle label: what the button does. */
  children: React.ReactNode;
  /** The question the second press answers. Say the table, not "this item". */
  question: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: BtnTone;
  size?: BtnSize;
  className?: string;
} & Omit<React.ComponentProps<'button'>, 'type' | 'onClick' | 'className' | 'children'>) {
  const [armed, setArmed] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (armed) confirmRef.current?.focus();
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className={`${btn(tone, size)} ${className}`.trim()}
      >
        {children}
      </button>
    );
  }

  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1.5 ${className}`.trim()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setArmed(false);
        }
      }}
    >
      <span role="status" className="text-[11.5px] font-medium text-gink">
        {question}
      </span>
      <button ref={confirmRef} type="submit" className={btn(tone, size)} {...rest}>
        {confirmLabel}
      </button>
      <button type="button" className={btn('quiet', size)} onClick={() => setArmed(false)}>
        {cancelLabel}
      </button>
    </span>
  );
}
