import { AuthShell } from '@/components/AuthShell';
import { signUpAction } from '@/app/auth/actions';

/**
 * Create an account.
 *
 * A real form that posts to signUpAction: it creates the auth user, the
 * restaurant, its first menu and the owner membership.
 *
 * The copy is careful about what it does NOT do, because the two things people
 * assume a signup does are the two things this one deliberately does not: take
 * a card, and start a trial clock.
 */
export function SignupScreen({ error }: { error?: string }) {
  return (
    <AuthShell
      eyebrow="Create an account"
      title="Start with your restaurant"
      lede="One account, one restaurant workspace, one menu to fill in. No card, nothing to install."
      action={{ prompt: 'Already have an account?', label: 'Sign in', href: '/login' }}
      notes={[
        <>
          <strong>Your workspace is created immediately</strong> — a restaurant, one menu and
          one owner membership, ready for dishes.
        </>,
        <>
          <strong>The screens are live.</strong> Menu, orders, kitchen board and counter all read
          and write the same database.
        </>,
        <>
          <strong>Nothing is charged.</strong> No payment gateway is connected, no plan can be
          bought and no trial is being enforced. Do not enter card details anywhere.
        </>,
      ]}
    >
      {error ? (
        <div className="authCard__alert" role="alert">
          {error}
        </div>
      ) : null}

      <form className="authForm" action={signUpAction}>
        <div className="authRow">
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
          <span className="ui-hint">Used to create and secure your account.</span>
        </label>

        <label className="ui-field">
          <span className="ui-label">Mobile number</span>
          <input
            className="ui-input"
            name="phone"
            autoComplete="tel"
            placeholder="+91 90000 00000"
          />
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
          NOT pre-ticked, deliberately. A pre-checked consent box is not valid
          consent under India's DPDP Act, which requires consent to be free,
          specific, informed, unconditional and unambiguous.
        */}
        <label className="ui-check authConsent">
          <input type="checkbox" name="agree" />
          <span>
            I understand this is a preview, and that my details are used to create this account in
            the configured Supabase project.
          </span>
        </label>

        <button className="authSubmit" type="submit">
          Create account
        </button>

        <p className="authFine">
          Signing up creates a restaurant workspace with one menu and one owner. No trial and no
          subscription is created by this form.
        </p>
      </form>
    </AuthShell>
  );
}
