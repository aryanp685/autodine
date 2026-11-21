'use client';

import { useActionState, useState } from 'react';
import { resendSignupConfirmationAction } from '@/app/auth/actions';
import { AuthSubmit } from '@/components/AuthSubmit';
import { Field, inputClass } from '@/components/owner/chrome';
import type { SignupResendState } from '@/lib/signup-confirmation';

const INITIAL_STATE: SignupResendState = { status: 'idle' };

const FEEDBACK: Record<Exclude<SignupResendState['status'], 'idle'>, string> = {
  invalid: 'Enter a valid email address.',
  requested:
    'If a signup for this address is waiting for confirmation, a request may be processed. Delivery is not confirmed. Check the inbox and spam or junk folder; Auth may apply a sending cooldown, so wait a few minutes before trying again.',
};

export function SignupConfirmationResendFeedback({
  status,
}: {
  status: SignupResendState['status'];
}) {
  if (status === 'idle') return null;
  const isError = status === 'invalid';

  return (
    <p
      role={isError ? 'alert' : 'status'}
      className={
        isError
          ? 'rounded-xl border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-3 text-[12.5px] leading-[1.55] text-[var(--alert)]'
          : 'rounded-xl border border-forest/10 bg-forest-soft/50 px-3.5 py-3 text-[12.5px] leading-[1.55] text-gink-64'
      }
    >
      {FEEDBACK[status]}
    </p>
  );
}

export function ResendSignupConfirmationForm({ email }: { email: string | null }) {
  const [state, formAction] = useActionState(resendSignupConfirmationAction, INITIAL_STATE);
  const [address, setAddress] = useState(email ?? '');

  return (
    <div className="flex flex-col gap-4">
      <SignupConfirmationResendFeedback status={state.status} />

      <form action={formAction} className="flex flex-col gap-4">
        <Field
          label="Signup email"
          htmlFor="confirmation-email"
          hint="Use the same address you entered when creating your account."
        >
          <input
            id="confirmation-email"
            className={inputClass}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={320}
            value={address}
            onChange={(event) => setAddress(event.currentTarget.value)}
            required
          />
        </Field>

        <AuthSubmit label="Request another confirmation" pendingLabel="Requesting confirmation…" />
      </form>
    </div>
  );
}
