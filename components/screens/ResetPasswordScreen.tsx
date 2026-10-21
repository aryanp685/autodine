import Link from 'next/link';
import { updatePasswordAction } from '@/app/auth/actions';
import { MIN_PASSWORD } from '@/lib/password';

/**
 * Choose a new password, on the session the emailed link created.
 *
 * Two states, and which one is shown comes from the server, not from a guess:
 * a live session gets the form, no session gets an explanation and a way to
 * ask again. A form that renders and then fails on submit would look like the
 * password was wrong rather than the link.
 */
export function ResetPasswordScreen({ email, error }: { email: string | null; error?: string }) {
  return (
    <div className="pg">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">
          AutoDine
        </Link>
        <div className="pg__barRight">
          <span className="pg__barMuted">Changed your mind?</span>
          <Link href="/login" className="pg__barCta">
            Sign in
          </Link>
        </div>
      </div>

      <div className="pg__body pg__body--split">
        <section className="pg__formCard">
          {email ? (
            <>
              <div className="pg__kicker">Account recovery</div>
              <h1 className="pg__title pg__title--sm">Choose a new password</h1>
              <p className="pg__p">
                Setting the password for <strong>{email}</strong>. This also signs out every other device that was
                signed in to the account.
              </p>

              {error && (
                <div className="pg__note pg__note--warn" role="alert">
                  {error}
                </div>
              )}

              <form className="pg__form" action={updatePasswordAction}>
                <label className="ui-field">
                  <span className="ui-label">New password</span>
                  <input
                    className="ui-input"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder={`At least ${MIN_PASSWORD} characters`}
                    minLength={MIN_PASSWORD}
                    required
                  />
                  <span className="ui-hint">At least {MIN_PASSWORD} characters. Longer is safer than complicated.</span>
                </label>
                <label className="ui-field">
                  <span className="ui-label">Repeat the new password</span>
                  <input
                    className="ui-input"
                    name="confirmation"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Type it once more"
                    minLength={MIN_PASSWORD}
                    required
                  />
                </label>

                <button className="pg__submit" type="submit">
                  Save the new password
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="pg__kicker">Account recovery</div>
              <h1 className="pg__title pg__title--sm">This reset link has expired</h1>
              <p className="pg__p">
                The link works once and only for an hour, and it only opens in the browser that asked for it. Nothing
                has changed on your account.
              </p>

              {error && (
                <div className="pg__note pg__note--warn" role="alert">
                  {error}
                </div>
              )}

              <div className="pg__form">
                <Link className="pg__submit" href="/forgot-password">
                  Send a new reset link
                </Link>
                <p className="pg__fine">
                  If you are already signed in, sign out first and ask for the link from this browser.
                </p>
              </div>
            </>
          )}
        </section>

        <aside className="pg__aside">
          <div className="pg__asideCard">
            <div className="pg__asideHead">Why links expire</div>
            <p className="pg__p">
              An emailed link is a password in a mail box. A short life and a single use keep an old email from being
              a way back into the restaurant&apos;s account months later.
            </p>
          </div>

          <div className="pg__asideCard pg__asideCard--quiet">
            <div className="pg__asideHead">Other people signed in</div>
            <p className="pg__p">
              Saving the new password ends their sessions too. They will need the new password, so tell the counter
              staff before you change it during service.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
