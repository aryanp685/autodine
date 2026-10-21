import Link from 'next/link';
import { signInAction } from '@/app/auth/actions';

/**
 * Sign in.
 *
 * Built from the same locked page structure as the signup and pricing screens
 * (.pg bar, .pg__formCard, .ui-field, .ui-input, .pg__submit) so it is
 * consistent with the approved design rather than a new visual language.
 */
export function LoginScreen({ error, notice, next }: { error?: string; notice?: string; next?: string }) {
  return (
    <div className="pg">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">
          AutoDine
        </Link>
        <div className="pg__barRight">
          <span className="pg__barMuted">New to AutoDine?</span>
          <Link href="/signup" className="pg__barCta">
            Create account
          </Link>
        </div>
      </div>

      <div className="pg__body pg__body--split">
        <section className="pg__formCard">
          <div className="pg__kicker">Welcome back</div>
          <h1 className="pg__title pg__title--sm">Sign in to your restaurant</h1>
          <p className="pg__p">
            Use the email address you signed up with. Sessions are handled by Supabase Auth and expire
            automatically when you sign out.
          </p>

          {notice && <div className="pg__note">{notice}</div>}
          {error && (
            <div className="pg__note" role="alert">
              {error}
            </div>
          )}

          <form className="pg__form" action={signInAction}>
            {next && <input type="hidden" name="next" value={next} />}
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
            <label className="ui-field">
              <span className="ui-label">Password</span>
              <input
                className="ui-input"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Your password"
                required
              />
            </label>

            <button className="pg__submit" type="submit">
              Sign in
            </button>
            <p className="pg__fine">
              Forgotten it?{' '}
              <Link href="/forgot-password" className="pg__fineLink">
                Reset your password
              </Link>{' '}
              — we email a single-use link to the address you signed up with.
            </p>
          </form>
        </section>

        <aside className="pg__aside">
          <div className="pg__asideCard">
            <div className="pg__asideHead">Preview status</div>
            <ol className="pg__steps">
              <li><strong>Dashboard</strong> — sample metrics and fictional orders only.</li>
              <li><strong>Menu</strong> — database-backed public menu reads are available when configured.</li>
              <li><strong>Kitchen &amp; counter</strong> — interface previews only; no live orders or payments.</li>
              <li><strong>Account</strong> — Supabase authentication is available when the project is configured.</li>
            </ol>
          </div>

          <div className="pg__asideCard pg__asideCard--quiet">
            <div className="pg__asideHead">Important</div>
            <p className="pg__p">
              No trial enforcement, plan billing, live ordering or payment processing is enabled in this build.
              This environment is for product preview and development only.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
