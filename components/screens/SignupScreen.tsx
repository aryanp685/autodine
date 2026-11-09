import Link from 'next/link';
import { AuthSubmit } from '@/components/AuthSubmit';
import { AuthShell } from '@/components/AuthShell';
import { signUpAction } from '@/app/auth/actions';
import { Field, inputClass } from '@/components/owner/chrome';

/** Signup creates a workspace and starts its seven-day trial, not a paid plan. */
export function SignupScreen({ error }: { error?: string }) {
  return (
    <AuthShell
      visual={
        <aside className="hidden pt-6 lg:block" aria-label="Restaurant setup overview">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-forest">Make room for better service</p>
          <h2 className="mt-6 max-w-[13ch] text-[clamp(2.5rem,4.5vw,3.8rem)] font-medium leading-[1.06] tracking-[-0.05em]">Your restaurant.<br /><span className="text-forest">A fresh start.</span></h2>
          <p className="mt-6 max-w-[35ch] text-[15px] leading-relaxed text-gink-64">Create your workspace, then make it yours. Add dishes and prepare your table cards before trying the ordering flow.</p>
          <ol className="mt-10 space-y-3" aria-label="Your setup journey">
            {[
              { title: 'Create your workspace', body: 'Your restaurant, menu and owner account.' },
              { title: 'Build your menu', body: 'Add dishes, prices and the details guests need.' },
              { title: 'Prepare your table cards', body: 'Try the guest, kitchen and counter workflow.' },
            ].map((step, i) => <li key={step.title} style={{ animationDelay: `${i * 120}ms` }} className="login-service-node flex items-start gap-4 rounded-2xl border border-forest/10 bg-white/70 p-5"><span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-forest-soft text-[10.5px] font-medium text-forest">0{i + 1}</span><div><h3 className="text-[13.5px] font-medium">{step.title}</h3><p className="mt-1 text-[12.5px] leading-relaxed text-gink-64">{step.body}</p></div></li>)}
          </ol>
          <Link href="/pricing" className="mt-6 inline-flex min-h-11 items-center gap-3 text-[13px] font-medium text-forest">Read the trial and pricing details <span aria-hidden="true">↗</span></Link>
        </aside>
      }
      notesTitle="Your workspace, clearly explained"
      eyebrow="Create an account"
      title="Start with your restaurant"
      lede="Start your seven-day trial with one restaurant and one menu. No card required."
      action={{ prompt: 'Already have an account?', label: 'Sign in', href: '/login' }}
      notes={[
        <>
          <strong>Your workspace is created immediately</strong> — a restaurant, one menu and
          one owner membership, ready for dishes.
        </>,
        <>
          <strong>Product preview.</strong> Explore the guest, kitchen and counter workflow. Not certified for live restaurant operations.
        </>,
        <>
          <strong>Nothing is charged.</strong> No payment gateway is connected, no plan can be
          bought. A seven-day trial starts when your restaurant is created; after it ends, the workspace
          becomes read-only until access is extended.
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

      <form className="flex flex-col gap-4" action={signUpAction}>
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

        <Field label="Mobile number (optional)" htmlFor="signup-phone">
          <input
            id="signup-phone"
            type="tel"
            className={inputClass}
            name="phone"
            autoComplete="tel"
            placeholder="+91 90000 00000"
          />
        </Field>

        <Field
          label="Password"
          htmlFor="signup-password"
          hint="Minimum 10 characters. Use a unique password for this account."
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
            required
            className="mt-[2px] size-4 shrink-0 accent-[var(--p-accent)]"
          />
          <span className="text-[11.5px] leading-[1.5] text-gink-64">
            I understand this is a preview, and that my details are used to create this account in
            AutoDine’s configured account service.
          </span>
        </label>

        <AuthSubmit label="Create account" pendingLabel="Creating your workspace…" />

        <p className="text-[11.5px] leading-[1.5] text-gink-46">
          Signing up creates a restaurant workspace with one menu and one owner. A seven-day trial starts
          with the workspace. No paid subscription is created by this form.
        </p>
        <p className="text-[11.5px] leading-relaxed text-gink-46">Read our <Link href="/privacy" className="underline underline-offset-4">Privacy policy</Link> and <Link href="/terms" className="underline underline-offset-4">Terms</Link> before creating an account.</p>
      </form>
    </AuthShell>
  );
}
