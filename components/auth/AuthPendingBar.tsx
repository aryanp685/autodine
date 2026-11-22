'use client';

import { createPortal, useFormStatus } from 'react-dom';

/**
 * A hairline progress bar pinned to the top of the viewport while the form's
 * action is in flight. It lives inside the form so `useFormStatus` reads the
 * right action, but portals out to the body: the auth card sits inside
 * transformed, overflow-hidden ancestors, where a fixed child would be
 * clipped to the card instead of the viewport.
 */
export function AuthPendingBar() {
  const { pending } = useFormStatus();
  if (!pending || typeof document === 'undefined') return null;
  return createPortal(<div className="auth-pending-bar" aria-hidden="true" />, document.body);
}
