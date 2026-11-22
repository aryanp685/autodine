'use client';

import { useFormStatus } from 'react-dom';
import { authButtonClass } from '@/components/AuthShell';
import { AuthPendingBar } from '@/components/auth/AuthPendingBar';
import { AuthSpinner } from '@/components/auth/AuthField';

export function AuthSubmit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  const text = pending ? pendingLabel : label;
  return (
    <>
      <AuthPendingBar />
      <button
        className={`${authButtonClass} relative mt-1 w-full overflow-hidden`}
        type="submit"
        disabled={pending}
        aria-busy={pending}
        aria-label={text}
      >
        <span aria-hidden="true" className="auth-sheen" />
        <span aria-live="polite">{text}</span>
        {pending ? <AuthSpinner /> : <span aria-hidden="true">↗</span>}
      </button>
    </>
  );
}
