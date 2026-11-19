'use client';

import { useFormStatus } from 'react-dom';
import { authButtonClass } from '@/components/AuthShell';
import { AuthSpinner } from '@/components/auth/AuthField';

export function AuthSubmit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  const text = pending ? pendingLabel : label;
  return (
    <button
      className={`${authButtonClass} mt-1 w-full`}
      type="submit"
      disabled={pending}
      aria-busy={pending}
      aria-label={text}
    >
      <span aria-live="polite">{text}</span>
      {pending ? <AuthSpinner /> : <span aria-hidden="true">↗</span>}
    </button>
  );
}
