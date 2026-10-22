import Link from 'next/link';
import { signUpAction } from '@/app/auth/actions';

/**
 * Shared page structure; styled by the locked design system.
 *
 * This is now a REAL form: it posts to the signUpAction server action. The
 * markup and classes are unchanged from the locked design.
 */
export function SignupScreen({ error }: { error?: string }) {
  return (
    <div className="pg">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">
          AutoDine
        </Link>
        <div className="pg__barRight">
          <span className="pg__barMuted">Already have an account?</span>
          <Link href="/login" className="pg__barLink">
            Sign in
          </Link>
        </div>
      </div>

      <div className="pg__body pg__body--split">
        <section className="pg__formCard">
          <div className="pg__kicker">Early preview</div>
          <h1 className="pg__title pg__title--sm">Create your restaurant account</h1>
          <p className="pg__p">
            Creating an account needs the AutoDine backend to be configured. No paid plan and no trial
            is started by this form — the account is free while the product is in preview.
          </p>

          {error && (
            <div className="pg__note" role="alert">
              {error}
            </div>
          )}

          <form className="pg__form" action={signUpAction}>
            <div className="pg__fieldRow">
              <label className="ui-field">
                <span className="ui-label">Full name</span>
                <input className="ui-input" name="fullName" autoComplete="name" placeholder="Aryan Patel" required />
              </label>
              <label className="ui-field">
                <span className="ui-label">Restaurant name</span>
                <input
                  className="ui-input"
                  name="restaurantName"
                  autoComplete="organization"
                  placeholder="Saffron & Smoke"
                  required
                />
              </label>
            </div>
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
              <span className="ui-hint">Used to create and secure your preview account.</span>
            </label>
            <label className="ui-field">
              <span className="ui-label">Mobile number</span>
              <input className="ui-input" name="phone" autoComplete="tel" placeholder="+91 90000 00000" />
            </label>
            <label className="ui-field">
              <span className="ui-label">Password</span>
              <input
                className="ui-input"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 10 characters"
                minLength={10}
                required
              />
              <span className="ui-hint">Minimum 10 characters. Stored hashed — never in plain text.</span>
            </label>

            {/*
              NOT pre-ticked, deliberately. A pre-checked consent box is not
              valid consent under India's DPDP Act, which requires consent to be
              free, specific, informed, unconditional and unambiguous.
            */}
            <label className="ui-check pg__check">
              <input type="checkbox" name="agree" />
              <span>
                I understand this is a preview and agree that my details will be used to create this account in the configured Supabase project.
              </span>
            </label>

            <button className="pg__submit" type="submit">
              Create account
            </button>
            <p className="pg__fine">
              Signing up creates a restaurant workspace with one menu, one owner and nothing charged. No trial
              and no subscription is created by this form.
            </p>
          </form>
        </section>

        <aside className="pg__aside">
          <div className="pg__asideCard">
            <div className="pg__asideHead">What this preview includes</div>
            <ol className="pg__steps">
              <li><strong>Account access</strong> — Supabase signup and sign-in actions are available when a project is configured.</li>
              <li><strong>Workspace foundation</strong> — signup creates an initial restaurant, menu and owner membership.</li>
              <li><strong>Live screens</strong> — the menu, orders, kitchen board and counter all read and write the database once the backend is configured.</li>
            </ol>
          </div>

          <div className="pg__asideCard pg__asideCard--quiet">
            <div className="pg__asideHead">Not active yet</div>
            <p className="pg__p">
              No payment gateway is connected, no plan can be bought and no trial is being enforced. Guests pay
              at the counter and the payment is recorded there. Do not enter card details anywhere.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
