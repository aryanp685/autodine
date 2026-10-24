import { AuthShell } from '@/components/AuthShell';
import { signUpAction } from '@/app/auth/actions';
import { btn, Field, inputClass } from '@/components/owner/chrome';

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
      lede="One account, one restaurant to start with, one menu to fill in. More outlets can be added later. No card, nothing to install."
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
        <div
          role="alert"
          className="mb-4 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-[var(--alert)]"
        >
          {error}
        </div>
      ) : null}

      <form className="flex flex-col gap-3.5" action={signUpAction}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" htmlFor="signup-name">
            <input
              id="signup-name"
              className={inputClass}
              name="fullName"
              autoComplete="name"
              placeholder="Aryan Patel"
              required
            />
          </Field>

          <Field label="Restaurant name" htmlFor="signup-restaurant">
            <input
              id="signup-restaurant"
              className={inputClass}
              name="restaurantName"
              autoComplete="organization"
              placeholder="Saffron & Smoke"
              required
            />
          </Field>
        </div>

        <Field label="Work email" htmlFor="signup-email" hint="Used to create and secure your account.">
          <input
            id="signup-email"
            className={inputClass}
            name="email"
            type="email"
            autoComplete="email"
            placeholder="owner@restaurant.in"
            required
          />
        </Field>

        <Field label="Mobile number" htmlFor="signup-phone">
          <input
            id="signup-phone"
            className={inputClass}
            name="phone"
            autoComplete="tel"
            placeholder="+91 90000 00000"
          />
        </Field>

        <Field
          label="Password"
          htmlFor="signup-password"
          hint="Minimum 10 characters. Stored hashed — never in plain text."
        >
          <input
            id="signup-password"
            className={inputClass}
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 10 characters"
            minLength={10}
            required
          />
        </Field>

        {/*
          NOT pre-ticked, deliberately. A pre-checked consent box is not valid
          consent under India's DPDP Act, which requires consent to be free,
          specific, informed, unconditional and unambiguous.
        */}
        <label className="flex items-start gap-2.5 rounded-[10px] border border-hair bg-paper-deep px-3 py-2.5">
          <input
            type="checkbox"
            name="agree"
            className="mt-[2px] size-4 shrink-0 accent-[var(--p-accent)]"
          />
          <span className="text-[11.5px] leading-[1.5] text-gink-64">
            I understand this is a preview, and that my details are used to create this account in
            the configured Supabase project.
          </span>
        </label>

        <button className={`${btn('solid')} mt-1 w-full`} type="submit">
          Create account
        </button>

        <p className="text-[11.5px] leading-[1.5] text-gink-46">
          Signing up creates a restaurant workspace with one menu and one owner. No trial and no
          subscription is created by this form.
        </p>
      </form>
    </AuthShell>
  );
}
