import { inr, trial } from '@/lib/demo-data';

/** Shared page structure; styled by the locked design system. */
export function SignupScreen() {
  return (
    <div className="pg">
      <div className="pg__bar">
        <div className="pg__brand">AutoDine</div>
        <div className="pg__barRight">
          <span className="pg__barMuted">Already have an account?</span>
          <span className="pg__barLink">Sign in</span>
        </div>
      </div>

      <div className="pg__body pg__body--split">
        <section className="pg__formCard">
          <div className="pg__kicker">Create your account</div>
          <h1 className="pg__title pg__title--sm">Start your {trial.days}-day trial</h1>
          <p className="pg__p">
            All features are unlocked during the trial. We ask for payment details only when you choose a plan.
          </p>

          <form className="pg__form" action="#" method="dialog">
            <div className="pg__fieldRow">
              <label className="ui-field">
                <span className="ui-label">Full name</span>
                <input className="ui-input" placeholder="Aryan Patel" />
              </label>
              <label className="ui-field">
                <span className="ui-label">Restaurant name</span>
                <input className="ui-input" placeholder="Saffron & Smoke" />
              </label>
            </div>
            <label className="ui-field">
              <span className="ui-label">Work email</span>
              <input className="ui-input" type="email" placeholder="owner@restaurant.in" />
              <span className="ui-hint">Used for receipts, trial reminders and account recovery.</span>
            </label>
            <label className="ui-field">
              <span className="ui-label">Mobile number</span>
              <input className="ui-input" placeholder="+91 90000 00000" />
            </label>
            <label className="ui-field">
              <span className="ui-label">Password</span>
              <input className="ui-input" type="password" placeholder="At least 10 characters" />
              <span className="ui-hint">Minimum 10 characters. Stored hashed — never in plain text.</span>
            </label>

            <label className="ui-check pg__check">
              <input type="checkbox" defaultChecked />
              <span>
                I agree to the Terms of Service and Privacy Policy, and to receive trial reminder emails.
              </span>
            </label>

            <button className="pg__submit" type="submit">
              Create account &amp; start trial
            </button>
            <p className="pg__fine">
              Prototype form — nothing is submitted and no account is created.
            </p>
          </form>
        </section>

        <aside className="pg__aside">
          <div className="pg__asideCard">
            <div className="pg__asideHead">What happens next</div>
            <ol className="pg__steps">
              <li>
                <strong>Day 0</strong> — your restaurant workspace is created and the {trial.days}-day trial
                starts. The start and expiry timestamps are recorded on the server.
              </li>
              <li>
                <strong>Day 0–{trial.days}</strong> — every feature is available, including AI menu import,
                QR codes, online payments and the kitchen board.
              </li>
              <li>
                <strong>Day {trial.days - 3} and {trial.days - 1}</strong> — reminders appear in the dashboard
                and by email.
              </li>
              <li>
                <strong>Day {trial.days}</strong> — choose a plan from {inr(899)}/month. If you don&apos;t, the
                account becomes read-only: your menus, orders, receipts and reports stay, but new customer
                orders are blocked.
              </li>
            </ol>
          </div>

          <div className="pg__asideCard pg__asideCard--quiet">
            <div className="pg__asideHead">Trial abuse prevention</div>
            <p className="pg__p">
              Trial eligibility is decided on the server using account, restaurant and payment identifiers —
              not by the browser. Repeatedly recreating accounts to restart a trial will not extend access.
              Genuine new restaurants are not affected.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
