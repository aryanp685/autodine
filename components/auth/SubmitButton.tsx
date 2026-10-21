'use client';

import { useFormStatus } from 'react-dom';

type SubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
};

export function SubmitButton({ idleLabel, pendingLabel }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button className="pg__submit auth__submit" type="submit" disabled={pending} aria-live="polite">
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
