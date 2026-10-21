'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase/client';

export function ForgotPasswordScreen({ error }: { error?: string }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [requestError, setRequestError] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setSent(false);
    setRequestError(false);

    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setRequestError(true);
      setSending(false);
      return;
    }

    const callback = new URL('/auth/callback', window.location.origin);
    callback.searchParams.set('next', '/reset-password');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: callback.toString() },
    );

    setSending(false);
    if (resetError) {
      setRequestError(true);
      return;
    }
    setSent(true);
  }

  return (
    <main className="pg auth">
      <header className="pg__bar auth__bar">
        <Link href="/" className="pg__brand" aria-label="AutoDine home">
          AutoDine<span className="auth__brandMark">.</span>
        </Link>
        <div className="pg__barRight">
          <span className="pg__barMuted">Remember your password?</span>
          <Link href="/login" className="pg__barCta">Sign in</Link>
        </div>
      </header>

      <div className="pg__body pg__body--split pg__authBody">
        <section className="pg__formCard pg__formCard--auth" aria-labelledby="forgot-title">
          <div className="auth__eyebrow"><span className="auth__eyebrowDot" /> Account recovery</div>
          <h1 id="forgot-title" className="pg__title pg__title--sm auth__title">Reset your password</h1>
          <p className="pg__p auth__intro">Enter the email on your account. We’ll send a secure, one-time reset link if it matches an account.</p>

          {error === 'expired' && (
            <div className="auth__message auth__message--error" role="alert">
              That reset link is expired or invalid. Request a fresh one below.
            </div>
          )}
          {sent && (
            <div className="auth__message auth__message--info" role="status">
              If an account exists for that email, a reset link has been sent. Check your inbox and spam folder.
            </div>
          )}
          {requestError && (
            <div className="auth__message auth__message--error" role="alert">
              We couldn’t send the reset link right now. Check the address and try again in a little while.
            </div>
          )}

          <form className="pg__form auth__form" onSubmit={submit}>
            <label className="ui-field" htmlFor="recovery-email">
              <span className="ui-label">Account email</span>
              <input
                className="ui-input"
                id="recovery-email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="email"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>

            <button className="pg__submit auth__submit" type="submit" disabled={sending} aria-live="polite">
              {sending ? 'Sending link…' : 'Send reset link'}
            </button>
            <p className="pg__fine auth__fine">
              For your security, this page does not reveal whether an email address is registered.
            </p>
          </form>
        </section>

        <aside className="pg__aside auth__aside" aria-label="Recovery information">
          <div className="pg__asideCard auth__asideCard">
            <div className="auth__asideIcon" aria-hidden="true">↗</div>
            <div className="pg__asideHead">Secure recovery</div>
            <p className="pg__p auth__asideCopy">
              The reset link is time-limited and returns only to this AutoDine preview. You’ll choose a new password before signing in again.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
