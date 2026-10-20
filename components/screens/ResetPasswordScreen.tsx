import Link from 'next/link';
import { updatePasswordAction } from '@/app/auth/actions';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { SubmitButton } from '@/components/auth/SubmitButton';

const errorMessages: Record<string, string> = {
  'weak-password': 'Choose a password between 10 and 128 characters.',
  mismatch: 'The passwords do not match. Please try again.',
  'update-failed': 'We could not update your password. Request a fresh link and try again.',
};

export function ResetPasswordScreen({ error }: { error?: string }) {
  const message = error ? errorMessages[error] : undefined;

  return (
    <main className="pg auth">
      <header className="pg__bar auth__bar">
        <Link href="/" className="pg__brand" aria-label="AutoDine home">
          AutoDine<span className="auth__brandMark">.</span>
        </Link>
        <div className="pg__barRight">
          <span className="pg__barMuted">Back to</span>
          <Link href="/login" className="pg__barCta">Sign in</Link>
        </div>
      </header>

      <div className="pg__body pg__body--split pg__authBody">
        <section className="pg__formCard pg__formCard--auth" aria-labelledby="reset-title">
          <div className="auth__eyebrow"><span className="auth__eyebrowDot" /> Account recovery</div>
          <h1 id="reset-title" className="pg__title pg__title--sm auth__title">Choose a new password</h1>
          <p className="pg__p auth__intro">Use a new password you haven’t used elsewhere.</p>

          {message && <div className="auth__message auth__message--error" role="alert">{message}</div>}

          <form className="pg__form auth__form" action={updatePasswordAction}>
            <label className="ui-field" htmlFor="reset-password">
              <span className="ui-label">New password</span>
              <PasswordInput
                id="reset-password"
                name="password"
                autoComplete="new-password"
                placeholder="At least 10 characters"
                minLength={10}
                maxLength={128}
              />
            </label>
            <label className="ui-field" htmlFor="reset-password-confirm">
              <span className="ui-label">Confirm new password</span>
              <PasswordInput
                id="reset-password-confirm"
                name="confirmPassword"
                autoComplete="new-password"
                placeholder="Enter it again"
                minLength={10}
                maxLength={128}
              />
            </label>

            <SubmitButton idleLabel="Update password" pendingLabel="Updating password…" />
            <p className="pg__fine auth__fine">You’ll be returned to sign in after the password is updated.</p>
          </form>
        </section>

        <aside className="pg__aside auth__aside" aria-label="Password reset guidance">
          <div className="pg__asideCard auth__asideCard">
            <div className="auth__asideIcon" aria-hidden="true">01</div>
            <div className="pg__asideHead">Reset link required</div>
            <p className="pg__p auth__asideCopy">
              This form only works after opening a valid reset link sent to your account email. If the link expired, request another one.
            </p>
            <Link href="/forgot-password" className="auth__recoveryLink">Request another link</Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
