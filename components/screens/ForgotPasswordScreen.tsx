import { AuthShell } from '@/components/AuthShell';
import { requestPasswordResetAction } from '@/app/auth/actions';
import { btn, Field, inputClass } from '@/components/owner/chrome';

/**
 * Ask for a reset link.
 *
 * Says the same thing for every address, because a form that answers "no such
 * account" is a free way to find out which restaurants use AutoDine. The one
 * honest exception is a rate limit -- see requestPasswordResetAction.
 */
export function ForgotPasswordScreen({ error, notice }: { error?: string; notice?: string }) {
  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset your password"
      lede="Enter the email address you signed up with. We send a link that lets you choose a new password."
      action={{ prompt: 'Remembered it?', label: 'Sign in', href: '/login' }}
      notesTitle="What happens next"
      notes={[
        <>
          <strong>Check the inbox</strong> for the address you signed up with, including spam.
        </>,
        <>
          <strong>Open the link</strong> in the same browser you asked from.
        </>,
        <>
          <strong>Choose a new password</strong> of at least 10 characters. That signs out every
          other device.
        </>,
        <>
          <strong>No email after a few minutes?</strong> This site sends its own mail and has a
          sending limit, so a burst of requests can be held back. If nothing arrives, the address
          may not have an account.
        </>,
      ]}
    >
      {notice ? (
        <div
          role="status"
          className="mb-4 rounded-[10px] border border-[var(--p-accent)]/25 bg-accent-soft px-3.5 py-2.5 text-[12px] leading-[1.5] text-gink-64"
        >
          {notice}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-2.5 text-[12px] leading-[1.5] text-[var(--alert)]"
        >
          {error}
        </div>
      ) : null}

      <form className="flex flex-col gap-3.5" action={requestPasswordResetAction}>
        <Field label="Work email" htmlFor="forgot-email">
          <input
            id="forgot-email"
            className={inputClass}
            name="email"
            type="email"
            autoComplete="email"
            placeholder="owner@restaurant.in"
            required
          />
        </Field>

        <button className={`${btn('solid')} mt-1 w-full`} type="submit">
          Send reset link
        </button>

        <p className="text-[11px] leading-[1.5] text-gink-46">
          The link is single-use and expires in an hour. Open it in this browser — a link asked for
          here will not work on a different device.
        </p>
      </form>
    </AuthShell>
  );
}
