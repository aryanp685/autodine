import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { updatePasswordAction } from '@/app/auth/actions';
import { MIN_PASSWORD } from '@/lib/password';
import { btn, Field, inputClass } from '@/components/owner/chrome';

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

        <Link className={`${btn('solid')} w-full`} href="/forgot-password">
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
      eyebrow="Account recovery"
      title="Choose a new password"
      lede={
        <>
          Setting the password for <strong className="font-medium text-gink">{email}</strong>. This
          also signs out every other device that was signed in to the account.
        </>
      }
      action={{ prompt: 'Changed your mind?', label: 'Sign in', href: '/login' }}
      notesTitle="Before you save"
      notes={[
        <>
          <strong>Other people are signed in.</strong> Saving the new password ends their sessions
          too, so tell the counter staff before you change it during service.
        </>,
        <>
          <strong>Longer beats complicated.</strong> A phrase you can type one-handed on a phone is
          safer than ten characters you have to write down.
        </>,
      ]}
    >
      {alert}

      <form className="flex flex-col gap-3.5" action={updatePasswordAction}>
        <Field
          label="New password"
          htmlFor="reset-password"
          hint={`At least ${MIN_PASSWORD} characters. Longer is safer than complicated.`}
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

        <button className={`${btn('solid')} mt-1 w-full`} type="submit">
          Save the new password
        </button>
      </form>
    </AuthShell>
  );
}
