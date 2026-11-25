'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BrandLockup } from '@/components/BrandMark';

/** Full-viewport, branded progress veil while an account form action is pending. */
export function AuthSubmissionOverlay({ open, message }: { open: boolean; message: string }) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-surface="owner"
      data-auth-shell
      data-auth-submit-overlay
      className="auth-submit-overlay"
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      <div className="auth-submit-overlay__card">
        <BrandLockup size={40} ink="var(--auth-heading)" dot="var(--auth-accent)" />
        <p className="auth-submit-overlay__eyebrow">Secure account hand-off</p>
        <p className="auth-submit-overlay__message">{message}</p>
        <div className="auth-submit-overlay__track" aria-hidden="true">
          <span />
        </div>
        <p className="auth-submit-overlay__caption">Please keep this page open for a moment.</p>
      </div>
    </div>,
    document.body,
  );
}
