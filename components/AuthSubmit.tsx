'use client';

import { useFormStatus } from 'react-dom';
import { authButtonClass } from '@/components/AuthShell';
import { AuthPendingBar } from '@/components/auth/AuthPendingBar';
import { BrandMark } from '@/components/BrandMark';

/**
 * The account forms' one button, and the moment it is working.
 *
 * A submit reads as AutoDine rather than as a generic spinner: the mark sits in
 * the button, breathing beside three brass dots, and the label says what is
 * happening. The state is driven by `useFormStatus`, so it stays up for the
 * whole server round trip — including the redirect — and never claims work the
 * server has already finished.
 */
export function AuthSubmit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <>
      <AuthPendingBar />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        aria-label={pending ? pendingLabel : label}
        data-auth-submit
        className={`${authButtonClass} mt-1 w-full`}
      >
        {pending ? (
          <span aria-hidden="true" data-auth-submit-mark className="auth-loading-logo">
            <BrandMark size={17} />
          </span>
        ) : null}
        <span>{pending ? pendingLabel : label}</span>
        <span aria-hidden="true" className="inline-flex w-4 shrink-0 justify-center">
          {pending ? (
            <span className="auth-loading-dots">
              <i />
              <i />
              <i />
            </span>
          ) : (
            '→'
          )}
        </span>
      </button>
    </>
  );
}
