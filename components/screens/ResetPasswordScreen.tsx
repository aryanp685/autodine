import Link from 'next/link';
import { AuthSubmit } from '@/components/AuthSubmit';
import { AuthShell, authButtonClass } from '@/components/AuthShell';
import { updatePasswordAction } from '@/app/auth/actions';
import { MIN_PASSWORD } from '@/lib/password';
import { Field, inputClass } from '@/components/owner/chrome';

function RecoveryVisual({ expired }: { expired: boolean }) {
  return (
    <aside className="hidden pt-6 lg:block" aria-label="Password recovery overview">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-forest">Keep your workspace yours</p>
      <h2 className="mt-6 max-w-[13ch] text-[clamp(2.5rem,4.5vw,3.8rem)] font-medium leading-[1.06] tracking-[-0.05em]">{expired ? 'A new link.' : 'A new password.'}<br /><span className="text-forest">A clear way back.</span></h2>
      <p className="mt-6 max-w-[35ch] text-[15px] leading-relaxed text-gink-64">{expired ? 'Recovery links are temporary. Request another from this browser when you’re ready to continue.' : 'Choose a unique password for this account. Once saved, other signed-in devices will need to sign in again.'}</p>
      <div aria-hidden="true" className="login-service-node relative mt-10 grid h-52 place-items-center overflow-hidden rounded-[28px] border border-forest/10 bg-forest-soft/50">
        <div className="absolute size-40 rounded-full border border-[#B98A4B]/25" />
        <div className="relative grid size-24 place-items-center rounded-3xl border border-forest/15 bg-white shadow-[0_8px_24px_rgba(31,77,58,0.06)]">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="text-forest"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15" r="1" /><path d="M12 16v2" stroke="#B98A4B" /></svg>
        </div>
      </div>
      <Link href="/login" className="mt-6 inline-flex min-h-11 items-center gap-3 text-[13px] font-medium text-forest"><span aria-hidden="true">←</span> Back to sign in</Link>
    </aside>
  );
}

/**
 * Choose a new password, on the session the emailed link created.
 *
 * Two states, and which one is shown comes from the server, not from a guess:
 * a live session gets the form, no session gets an explanation and a way to
 * ask again. A form that renders and then fails on submit would look like the
 * password was wrong rather than the link.
 */
export function ResetPasswordScreen({ email, error }: { email: string | null; error?: string }) {
  const alert = error ? (
    <div
      role="alert"
      className="mb-4 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-[var(--alert)]"
    >
      {error}
    </div>
  ) : null;

  if (!email) {
    return (
      <AuthShell
        visual={<RecoveryVisual expired />}
        eyebrow="Account recovery"
        title="This reset link has expired"
        lede="The link works once and only for an hour, and it only opens in the browser that asked for it. Nothing has changed on your account."
        action={{ prompt: 'Changed your mind?', label: 'Sign in', href: '/login' }}
        notesTitle="Why links expire"
        notes={[
          <>
            <strong>A link is a password in a mailbox.</strong> A short life and a single use keep
            an old email from being a way back into the account months later.
          </>,
          <>
            <strong>A link asked for on another device will not open here.</strong> Ask for a new
            one from this browser.
          </>,
        ]}
      >
        {alert}

        <Link className={`${authButtonClass} w-full`} href="/forgot-password">
          Send a new reset link
        </Link>

        <p className="mt-3 text-center text-[11.5px] leading-[1.5] text-gink-46">
          If you are already signed in, sign out first and ask for the link from this browser.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      visual={<RecoveryVisual expired={false} />}
      eyebrow="Account recovery"
      title="Choose a new password"
      lede={
        <>
          Setting the password for <strong className="break-all font-medium text-gink">{email}</strong>. This
          also signs out every other device that was signed in to the account.
        </>
      }
      action={{ prompt: 'Changed your mind?', label: 'Sign in', href: '/login' }}
      notesTitle="Before you save"
      notes={[
        <>
          <strong>Other sessions will end.</strong> If this account is used on a counter or kitchen device, let your team know before saving.
        </>,
        <>
          <strong>Use a unique password.</strong> Choose a long passphrase or a password-manager-generated password that you do not use for another account.
        </>,
      ]}
    >
      {alert}

      <form className="flex flex-col gap-4" action={updatePasswordAction}>
        <Field
          label="New password"
          htmlFor="reset-password"
          hint={`At least ${MIN_PASSWORD} characters. Use a unique password.`}
        >
          <input
            id="reset-password"
            className={inputClass}
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder={`At least ${MIN_PASSWORD} characters`}
            minLength={MIN_PASSWORD}
            required
          />
        </Field>

        <Field label="Repeat the new password" htmlFor="reset-confirmation">
          <input
            id="reset-confirmation"
            className={inputClass}
            name="confirmation"
            type="password"
            autoComplete="new-password"
            placeholder="Type it once more"
            minLength={MIN_PASSWORD}
            required
          />
        </Field>

        <AuthSubmit label="Save the new password" pendingLabel="Saving your password…" />
        <p className="rounded-xl border border-forest/10 bg-forest-soft/50 p-3.5 text-[12.5px] leading-relaxed text-gink-64">Saving updates your account password and ends other active sessions. You may need to sign in again on your other devices.</p>
      </form>
    </AuthShell>
  );
}
