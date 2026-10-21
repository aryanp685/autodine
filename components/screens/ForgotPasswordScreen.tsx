import Link from 'next/link';
import { requestPasswordResetAction } from '@/app/auth/actions';

/**
 * Ask for a reset link.
 *
 * Says the same thing for every address, because a form that answers "no such
 * account" is a free way to find out which restaurants use AutoDine. The one
 * honest exception is a rate limit -- see requestPasswordResetAction.
 */
export function ForgotPasswordScreen({ error, notice }: { error?: string; notice?: string }) {
  return (
    <div className="pg">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">
          AutoDine
        </Link>
        <div className="pg__barRight">
          <span className="pg__barMuted">Remembered it?</span>
          <Link href="/login" className="pg__barCta">
            Sign in
          </Link>
        </div>
      </div>

      <div className="pg__body pg__body--split">
        <section className="pg__formCard">
          <div className="pg__kicker">Account recovery</div>
          <h1 className="pg__title pg__title--sm">Reset your password</h1>
          <p className="pg__p">
            Enter the email address you signed up with. We will send a link that lets you choose a new password.
          </p>

          {notice && <div className="pg__note pg__note--info">{notice}</div>}
          {error && (
            <div className="pg__note pg__note--warn" role="alert">
              {error}
            </div>
          )}

          <form className="pg__form" action={requestPasswordResetAction}>
            <label className="ui-field">
              <span className="ui-label">Work email</span>
              <input
                className="ui-input"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="owner@restaurant.in"
                required
              />
            </label>

            <button className="pg__submit" type="submit">
              Send reset link
            </button>
            <p className="pg__fine">
              The link is single-use and expires in an hour. Open it in this browser — a link asked for here will not
              work on a different device.
            </p>
          </form>
        </section>

        <aside className="pg__aside">
          <div className="pg__asideCard">
            <div className="pg__asideHead">What happens next</div>
            <ol className="pg__steps">
              <li><strong>Check the inbox</strong> for the address you signed up with, including spam.</li>
              <li><strong>Open the link</strong> in the same browser you asked from.</li>
              <li><strong>Choose a new password</strong> of at least 10 characters.</li>
              <li><strong>Sign in again</strong> everywhere — the reset ends all other sessions.</li>
            </ol>
          </div>

          <div className="pg__asideCard pg__asideCard--quiet">
            <div className="pg__asideHead">No email?</div>
            <p className="pg__p">
              This site sends its own mail and has a sending limit, so a burst of reset requests can be held back for a
              few minutes. If nothing arrives after that, the address may not have an account.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
