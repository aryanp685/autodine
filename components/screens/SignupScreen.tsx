import Link from 'next/link';
import { signUpAction } from '@/app/auth/actions';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { SubmitButton } from '@/components/auth/SubmitButton';

export function SignupScreen({ error }: { error?: string }) {
  return (
    <main className="pg auth">
      <header className="pg__bar auth__bar">
        <Link href="/" className="pg__brand" aria-label="AutoDine home">
          AutoDine<span className="auth__brandMark">.</span>
        </Link>
        <div className="pg__barRight">
          <span className="pg__barMuted">Already have an account?</span>
          <Link href="/login" className="pg__barCta">Sign in</Link>
        </div>
      </header>

      <div className="pg__body pg__body--split pg__authBody pg__authBody--signup">
        <section className="pg__formCard pg__formCard--auth" aria-labelledby="signup-title">
          <div className="auth__eyebrow"><span className="auth__eyebrowDot" /> Early preview access</div>
          <h1 id="signup-title" className="pg__title pg__title--sm auth__title">Set up your workspace</h1>
          <p className="pg__p auth__intro">
            Create an owner account for your restaurant. No paid subscription is created by signing up.
          </p>

          {error && <div className="auth__message auth__message--error" role="alert">{error}</div>}

          <form className="pg__form auth__form" action={signUpAction}>
            <div className="pg__fieldRow auth__fieldRow">
              <label className="ui-field" htmlFor="signup-name">
                <span className="ui-label">Your name</span>
                <input
                  className="ui-input"
                  id="signup-name"
                  name="fullName"
                  autoComplete="name"
                  maxLength={120}
                  placeholder="Aarav Patel"
                  required
                />
              </label>
              <label className="ui-field" htmlFor="signup-restaurant">
                <span className="ui-label">Restaurant name</span>
                <input
                  className="ui-input"
                  id="signup-restaurant"
                  name="restaurantName"
                  autoComplete="organization"
                  maxLength={120}
                  placeholder="Saffron & Smoke"
                  required
                />
              </label>
            </div>

            <label className="ui-field" htmlFor="signup-email">
              <span className="ui-label">Work email</span>
              <input
                className="ui-input"
                id="signup-email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="email"
                maxLength={254}
                placeholder="you@restaurant.in"
                required
              />
              <span className="ui-hint">We’ll use this to secure your account and send confirmation if required.</span>
            </label>

            <label className="ui-field" htmlFor="signup-phone">
              <span className="ui-label">Mobile number <span className="auth__optional">Optional</span></span>
              <input
                className="ui-input"
                id="signup-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                maxLength={30}
                placeholder="+91 90000 00000"
              />
            </label>

            <label className="ui-field" htmlFor="signup-password">
              <span className="ui-label">Create password</span>
              <PasswordInput
                id="signup-password"
                name="password"
                autoComplete="new-password"
                placeholder="At least 10 characters"
                minLength={10}
              />
              <span className="ui-hint">Use 10–128 characters. Your password is handled by Supabase Auth.</span>
            </label>

            <label className="ui-check pg__check auth__consent">
              <input type="checkbox" name="agree" required />
              <span>I understand this is a preview and agree that my details will be used to create an account in the configured Supabase project.</span>
            </label>

            <SubmitButton idleLabel="Create owner account" pendingLabel="Creating account…" />
            <p className="pg__fine auth__fine">
              Workspace creation starts the server-timed 10-day trial when the relevant database migration is installed. Billing is not enabled.
            </p>
          </form>
        </section>

        <aside className="pg__aside auth__aside" aria-label="About the preview">
          <div className="pg__asideCard auth__asideCard">
            <div className="auth__asideIcon" aria-hidden="true">01</div>
            <div className="pg__asideHead">What happens next</div>
            <ol className="auth__steps">
              <li><span>01</span><p>Create an owner account and restaurant workspace.</p></li>
              <li><span>02</span><p>Confirm your email if the project requires it.</p></li>
              <li><span>03</span><p>Sign in and select an authorized workspace.</p></li>
            </ol>
          </div>
          <div className="pg__asideCard pg__asideCard--quiet auth__asideCard auth__asideCard--quiet">
            <div className="pg__asideHead">Before you continue</div>
            <p className="pg__p auth__asideCopy">
              AutoDine is a development preview, not production-ready. Guest ordering, online payments and subscription billing are not active.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
