import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { signInAction } from '@/app/auth/actions';
import { btn, Field, inputClass } from '@/components/owner/chrome';

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
      {notice ? (
        <div
          role="status"
          className="mb-4 rounded-[10px] border border-[var(--p-accent)]/25 bg-accent-soft px-3.5 py-2.5 text-[12px] leading-[1.5] text-gink-64"
        >
          {notice}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-2.5 text-[12px] leading-[1.5] text-[var(--alert)]"
        >
          {error}
        </div>
      ) : null}

      <form className="flex flex-col gap-3.5" action={signInAction}>
        {next && <input type="hidden" name="next" value={next} />}

        <Field label="Work email" htmlFor="login-email">
          <input
            id="login-email"
            className={inputClass}
            name="email"
            type="email"
            autoComplete="email"
            placeholder="owner@restaurant.in"
            required
          />
        </Field>

        <Field label="Password" htmlFor="login-password">
          <input
            id="login-password"
            className={inputClass}
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            required
          />
        </Field>

        <button className={`${btn('solid')} mt-1 w-full`} type="submit">
          Sign in
        </button>

        <p className="text-center text-[11.5px] leading-[1.5] text-gink-46">
          Forgotten it?{' '}
          <Link
            href="/forgot-password"
            className="font-medium text-gink underline decoration-hair-strong underline-offset-2 hover:decoration-gink"
          >
            Reset your password
          </Link>{' '}
          — we email a single-use link to the address you signed up with.
        </p>
      </form>
    </AuthShell>
  );
}
