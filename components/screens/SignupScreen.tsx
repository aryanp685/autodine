import Link from 'next/link';
import { AuthSubmit } from '@/components/AuthSubmit';
import { AuthShell } from '@/components/AuthShell';
import { AuthField } from '@/components/auth/AuthField';
import { signUpAction } from '@/app/auth/actions';
import { TRIAL_DAYS } from '@/lib/trial';

/** Signup creates a workspace and starts its 21-day trial, not a paid plan. */
export function SignupScreen({ error }: { error?: string }) {
  return (
    <AuthShell
      visual={
        <aside className="hidden pt-2 lg:block" aria-label="Restaurant setup overview">
          <p className="flex items-center gap-2.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-forest">
            <span aria-hidden="true" className="h-px w-6 bg-brass" />
            Make room for better service
          </p>
          <h2 className="mt-6 max-w-[13ch] text-[clamp(2.5rem,4.5vw,3.8rem)] font-medium leading-[1.05] tracking-[-0.05em]">
            Your restaurant.<br />
            <span className="text-forest">A <em className="font-display font-normal italic">fresh</em> start.</span>
          </h2>
          <p className="mt-6 max-w-[35ch] text-[15px] leading-[1.7] text-gink-64">
            Create your workspace, then make it yours. Add dishes and prepare your table cards
            before trying the ordering flow.
          </p>

          <div className="relative mt-10 overflow-hidden rounded-[30px] border border-white/70 bg-white/65 p-5 shadow-[0_24px_60px_-42px_rgba(31,77,58,0.5)] backdrop-blur-xl">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(75%_55%_at_10%_0%,rgba(185,138,75,0.1),transparent_62%)]"
            />
            <p className="relative flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gink-46">
              <span aria-hidden="true" className="size-1 rounded-full bg-brass/70" />
              Your first hour
            </p>
            <ol className="relative mt-3 space-y-2.5" aria-label="Your setup journey">
              {[
                { title: 'Create your workspace', body: 'Your restaurant, menu and owner account.', time: '1 min' },
                { title: 'Build your menu', body: 'Add dishes, prices and the details guests need.', time: '10 min' },
                { title: 'Prepare your table cards', body: 'Print or share a QR card for each table.', time: '5 min' },
              ].map((step, index) => (
                <li key={step.title} className="flex items-start gap-3.5 rounded-2xl border border-hair/80 bg-white/80 p-3.5 transition-colors duration-300 hover:border-forest/20 hover:bg-white">
                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-forest-soft font-display text-[12px] italic text-forest">
                    0{index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="block text-[12.5px] font-medium text-gink">{step.title}</span>
                      <span className="shrink-0 text-[10px] text-gink-28">{step.time}</span>
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-gink-46">{step.body}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="relative mt-4 border-t border-hair/80 pt-3.5 text-[11px] leading-relaxed text-gink-46">
              Nothing is charged at signup. The preview starts with one restaurant and one menu.
            </p>
          </div>

          <Link href="/pricing" className="mt-6 inline-flex min-h-11 items-center gap-2.5 text-[13px] font-medium text-forest transition-colors hover:text-forest-strong">
            Read the trial and pricing details <span aria-hidden="true">↗</span>
          </Link>
        </aside>
      }
      notesTitle="Your workspace, clearly explained"
      eyebrow="Create an account"
      title={<>Start with your <em className="font-display font-normal italic text-forest">restaurant</em></>}
      lede={`Start your ${TRIAL_DAYS}-day trial with one restaurant and one menu. No card required.`}
      action={{ prompt: 'Already have an account?', label: 'Sign in', href: '/login' }}
      notes={[
        <span key="created">
          <strong>Your workspace is created immediately</strong> — a restaurant, one menu and
          one owner membership, ready for dishes.
        </span>,
        <span key="preview">
          <strong>Product preview.</strong> Explore the guest, kitchen and counter workflow. Not certified for live restaurant operations.
        </span>,
        <span key="charged">
          <strong>Nothing is charged.</strong> No payment gateway is connected, no plan can be
          bought. A {TRIAL_DAYS}-day trial starts when your restaurant is created; after it ends, the workspace
          becomes read-only until access is extended.
        </span>,
      ]}
    >
      {error ? (
        <div
          role="alert"
          className="mb-4 flex gap-2.5 rounded-xl border border-[var(--alert)]/25 bg-[var(--alert)]/8 px-3.5 py-3 text-[12.5px] leading-[1.55] text-[var(--alert)]"
        >
          <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-[var(--alert)] text-[9px] text-white">!</span>
          <span>{error}</span>
        </div>
      ) : null}

      <form className="flex flex-col gap-4" action={signUpAction}>
        <div className="grid gap-3 sm:grid-cols-2">
          <AuthField
            id="signup-name"
            name="fullName"
            label="Full name"
            autoComplete="name"
            placeholder="Aryan Patel"
            required
            requiredMessage="Enter your name."
          />

          <AuthField
            id="signup-restaurant"
            name="restaurantName"
            label="Restaurant name"
            autoComplete="organization"
            placeholder="Saffron & Smoke"
            required
            requiredMessage="Enter your restaurant's name."
          />
        </div>

        <AuthField
          id="signup-email"
          name="email"
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="owner@restaurant.in"
          hint="Used to create and secure your account."
          required
          requiredMessage="Enter the email you want to sign in with."
          invalidMessage="That does not look like an email address."
        />

        <AuthField
          id="signup-phone"
          name="phone"
          label="Mobile number (optional)"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+91 90000 00000"
          hint="Only used to reach you about this workspace."
        />

        <AuthField
          id="signup-password"
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 10 characters"
          hint="Minimum 10 characters. Use a unique password for this account."
          minLength={10}
          required
          requiredMessage="Choose a password."
          showRequirements
        />

        {/*
          NOT pre-ticked, deliberately. A pre-checked consent box is not valid
          consent under India's DPDP Act, which requires consent to be free,
          specific, informed, unconditional and unambiguous.
        */}
        <label className="flex items-start gap-2.5 rounded-xl border border-hair bg-paper-deep/70 px-3.5 py-3 transition-colors has-[:checked]:border-forest/25 has-[:checked]:bg-forest-soft/40">
          <input
            type="checkbox"
            name="agree"
            required
            className="mt-[2px] size-4 shrink-0 accent-[var(--p-accent)]"
          />
          <span className="text-[11.5px] leading-[1.55] text-gink-64">
            I understand this is a preview, and that my details are used to create this account in
            AutoDine’s configured account service.
          </span>
        </label>

        <AuthSubmit label="Create account" pendingLabel="Creating your workspace…" />

        <p className="text-center text-[11.5px] leading-[1.6] text-gink-46">
          Signing up creates a restaurant workspace with one menu and one owner. A {TRIAL_DAYS}-day trial starts
          with the workspace. No paid subscription is created by this form.
        </p>
        <p className="text-center text-[11.5px] leading-relaxed text-gink-46">
          Read our{' '}
          <Link href="/privacy" className="underline underline-offset-4 transition-colors hover:text-forest">Privacy policy</Link> and{' '}
          <Link href="/terms" className="underline underline-offset-4 transition-colors hover:text-forest">Terms</Link>{' '}
          before creating an account.
        </p>
      </form>
    </AuthShell>
  );
}
