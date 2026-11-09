import Link from 'next/link';
import { AuthSubmit } from '@/components/AuthSubmit';
import { AuthShell } from '@/components/AuthShell';
import { requestPasswordResetAction } from '@/app/auth/actions';
import { Field, inputClass } from '@/components/owner/chrome';

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
      visual={
        <aside className="hidden pt-6 lg:block" aria-label="Account recovery guide">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-forest">A way back in</p>
          <h2 className="mt-6 max-w-[13ch] text-[clamp(2.5rem,4.5vw,3.8rem)] font-medium leading-[1.06] tracking-[-0.05em]">A fresh password.<br /><span className="text-forest">The same workspace.</span></h2>
          <p className="mt-6 max-w-[35ch] text-[15px] leading-relaxed text-gink-64">Start with your account email. Keep this browser handy to open the recovery link and choose your new password.</p>
          <div aria-hidden="true" className="login-service-node relative mt-10 grid h-52 place-items-center overflow-hidden rounded-[28px] border border-forest/10 bg-forest-soft/50">
            <div className="absolute size-40 rounded-full border border-[#B98A4B]/25" />
            <div className="relative grid size-24 place-items-center rounded-3xl border border-forest/15 bg-white shadow-[0_8px_24px_rgba(31,77,58,0.06)]">
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="text-forest"><rect x="3" y="6" width="18" height="13" rx="3" /><path d="m4 8 8 6 8-6" /><path d="M8 3h8" stroke="#B98A4B" /></svg>
            </div>
          </div>
          <Link href="/login" className="mt-6 inline-flex min-h-11 items-center gap-3 text-[13px] font-medium text-forest"><span aria-hidden="true">←</span> Back to sign in</Link>
        </aside>
      }
      eyebrow="Account recovery"
      title="Reset your password"
      lede="Enter your account email. If it has an AutoDine account, we’ll send a link to choose a new password."
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
          <strong>No email after a few minutes?</strong> Check spam and confirm the address is correct. Requests can be rate-limited; wait a few minutes before trying again. For privacy, this page does not confirm whether an account exists.
        </>,
      ]}
    >
      {notice ? (
        <div
          role="status"
          className="mb-4 rounded-[10px] border border-[var(--p-accent)]/25 bg-accent-soft px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-gink-64"
        >
          {notice}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-[var(--alert)]"
        >
          {error}
        </div>
      ) : null}

      <form className="flex flex-col gap-4" action={requestPasswordResetAction}>
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

        <AuthSubmit label="Send reset link" pendingLabel="Sending reset link…" />

        <p className="rounded-xl border border-forest/10 bg-forest-soft/50 p-3.5 text-[12px] leading-relaxed text-gink-64">
          The link is single-use and expires in an hour. Open it in this browser — a link asked for
          here will not work on a different device.
        </p>
      </form>
    </AuthShell>
  );
}
