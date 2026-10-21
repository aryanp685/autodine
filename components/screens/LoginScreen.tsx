import Link from 'next/link';
import { signInAction } from '@/app/auth/actions';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { SubmitButton } from '@/components/auth/SubmitButton';

export function LoginScreen({ error, notice, next }: { error?: string; notice?: string; next?: string }) {
  return (
    <main className="pg auth">
      <header className="pg__bar auth__bar">
        <Link href="/" className="pg__brand" aria-label="AutoDine home">
          AutoDine<span className="auth__brandMark">.</span>
        </Link>
        <div className="pg__barRight">
          <span className="pg__barMuted">New to AutoDine?</span>
          <Link href="/signup" className="pg__barCta">
            Create account
          </Link>
        </div>
      </header>

      <div className="pg__body pg__body--split pg__authBody">
        <section className="pg__formCard pg__formCard--auth" aria-labelledby="login-title">
          <div className="auth__eyebrow"><span className="auth__eyebrowDot" /> Restaurant workspace</div>
          <h1 id="login-title" className="pg__title pg__title--sm auth__title">Welcome back</h1>
          <p className="pg__p auth__intro">Sign in to continue to your AutoDine workspace.</p>

          {notice && <div className="auth__message auth__message--info" role="status">{notice}</div>}
          {error && <div className="auth__message auth__message--error" role="alert">{error}</div>}

          <form className="pg__form auth__form" action={signInAction}>
            {next && <input type="hidden" name="next" value={next} />}
            <label className="ui-field" htmlFor="login-email">
              <span className="ui-label">Work email</span>
              <input
                className="ui-input"
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="email"
                maxLength={254}
                placeholder="you@example.com"
                required
              />
            </label>
            <label className="ui-field" htmlFor="login-password">
              <span className="ui-label">Password</span>
              <PasswordInput
                id="login-password"
                name="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                maxLength={1024}
              />
            </label>
            <Link href="/forgot-password" className="auth__recoveryLink">Forgot password?</Link>

            <SubmitButton idleLabel="Sign in" pendingLabel="Signing in…" />
            <p className="pg__fine auth__fine">
              If this is a new account, confirm the email address before signing in.
            </p>
          </form>
        </section>

        <aside className="pg__aside auth__aside" aria-label="Account information">
          <div className="pg__asideCard auth__asideCard">
            <div className="auth__asideIcon" aria-hidden="true">↗</div>
            <div className="pg__asideHead">One secure sign-in</div>
            <p className="pg__p auth__asideCopy">
              Your account only opens workspaces you are authorized to access. If you belong to more than one, you can choose after signing in.
            </p>
          </div>
          <div className="pg__asideCard pg__asideCard--quiet auth__asideCard auth__asideCard--quiet">
            <div className="pg__asideHead">Preview environment</div>
            <p className="pg__p auth__asideCopy">
              This product is still in development and is not production-ready. Some screens use sample data; order and payment workflows have not been verified against a live Supabase project.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
