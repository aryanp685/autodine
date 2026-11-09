'use client';

import { useFormStatus } from 'react-dom';
import { authButtonClass } from '@/components/AuthShell';

export function AuthSubmit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  const text = pending ? pendingLabel : label;
  return <button className={`${authButtonClass} mt-1 w-full`} type="submit" disabled={pending} aria-busy={pending} aria-label={text}>
    <span aria-live="polite">{text}</span>
    <span aria-hidden="true">{pending ? '·' : '↗'}</span>
  </button>;
}
