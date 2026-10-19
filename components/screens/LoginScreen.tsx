import Link from 'next/link';
import { signInAction } from '@/app/auth/actions';

/**
 * Sign in.
 *
 * Built from the same locked page structure as the signup and pricing screens
 * (.pg bar, .pg__formCard, .ui-field, .ui-input, .pg__submit) so it is
 * consistent with the approved design rather than a new visual language.
 */
export function LoginScreen({ error, notice }: { error?: string; notice?: string }) {
  return (
    <div className="pg">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">
          AutoDine
        </Link>
        <div className="pg__barRight">
          <span className="pg__barMuted">New to AutoDine?</span>
          <Link href="/signup" className="pg__barCta">
            Start 10-day trial
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
              Forgotten your password? Password reset is not wired up yet — ask us and we will send a reset link.
            </p>
          </form>
        </section>

        <aside className="pg__aside">
          <div className="pg__asideCard">
            <div className="pg__asideHead">What you get</div>
            <ol className="pg__steps">
              <li>
                <strong>Dashboard</strong> — live orders, revenue and the trial countdown.
              </li>
              <li>
                <strong>Menus</strong> — build once with categories, variants and add-ons.
              </li>
              <li>
                <strong>Tables &amp; QR</strong> — print codes, revoke them, rotate them.
              </li>
              <li>
                <strong>Kitchen &amp; counter</strong> — orders land on the board and are announced out loud.
              </li>
            </ol>
          </div>

          <div className="pg__asideCard pg__asideCard--quiet">
            <div className="pg__asideHead">On the trial</div>
            <p className="pg__p">
              If your trial has ended, everything you created is still here. The account becomes read-only
              and new customer orders are blocked until you choose a plan — nothing is deleted.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
