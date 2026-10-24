'use client';

/**
 * A submit button that knows its form is in flight.
 *
 * THE PROBLEM IT SOLVES
 *
 * Every settings form posts to a server action and waits for the redirect. On a
 * slow connection that is a second or two in which the button looks exactly as
 * it did before the press: no text change, no disabled state, no spinner. The
 * reasonable thing for a person to do is press it again -- and on a form that
 * writes, that is a second write of the same values, a second audit line, and
 * on a bad day a second notification.
 *
 * `useFormStatus` is the only way to know, from inside the button, that the
 * form it belongs to is submitting. It has to be a client component, and it has
 * to be a DESCENDANT of the <form>, which is why this is a component and not a
 * class string like `btn()`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   - No spinner overlay. The label changes to "Saving…" and the button dims;
 *     a rotating glyph on a 32px pill is noise, and `disabled` already tells a
 *     screen reader the control is unavailable.
 *   - No optimistic success. The label says what is happening now, never what
 *     will have happened -- if the action fails, this button returns to its
 *     idle label and the server's error is what the person reads.
 *   - No JavaScript, no interception: with the client bundle blocked, `pending`
 *     is simply always false and the form submits natively, as it did before.
 */

import { useFormStatus } from 'react-dom';
import { btn, type BtnSize, type BtnTone } from '@/components/owner/chrome';

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  tone = 'solid',
  size = 'sm',
  disabled = false,
  className = '',
  ...rest
}: {
  children: React.ReactNode;
  /** Present tense, while it happens. "Saving details…", not "Saved". */
  pendingLabel?: string;
  tone?: BtnTone;
  size?: BtnSize;
  disabled?: boolean;
  className?: string;
} & Omit<React.ComponentProps<'button'>, 'type' | 'className' | 'children' | 'disabled'>) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`${btn(tone, size)} ${className}`.trim()}
      {...rest}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
