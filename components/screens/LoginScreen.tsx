import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { signInAction } from '@/app/auth/actions';

/**
 * Sign in.
 *
 * The first screen of the product a returning owner sees, so it says one
 * thing: which two fields open the door. The aside that used to sit beside it
 * — four bordered cards of preview status — has become three sentences under
 * the form, where somebody who wants to know what this build does can read
 * them and somebody who wants to sign in can ignore them.
 */
export function LoginScreen({ error, notice, next }: { error?: string; notice?: string; next?: string }) {
  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to your restaurant"
      lede="Use the email address you signed up with."
      action={{ prompt: 'New to AutoDine?', label: 'Create an account', href: '/signup' }}
      notes={[
        <>
          <strong>Ordering, the kitchen board and the counter are live.</strong> An order from a
          verified table reaches the board in the same second.
        </>,
        <>
          <strong>Plans are not on sale.</strong> No card is asked for, and no trial is counting
          down.
        </>,
        <>
          <strong>Payments are recorded at the counter.</strong> Card and UPI online are not
          switched on in this build.
        </>,
      ]}
    >
      {notice ? <div className="authCard__notice">{notice}</div> : null}
      {error ? (
        <div className="authCard__alert" role="alert">
          {error}
        </div>
      ) : null}

      <form className="authForm" action={signInAction}>
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

        <button className="authSubmit" type="submit">
          Sign in
        </button>

        <p className="authFine">
          Forgotten it?{' '}
          <Link href="/forgot-password" className="authFine__link">
            Reset your password
          </Link>{' '}
          — we email a single-use link to the address you signed up with.
        </p>
      </form>
    </AuthShell>
  );
}
