import Link from 'next/link';
import { LoginSubmit } from '@/components/LoginSubmit';
import { AuthShell } from '@/components/AuthShell';
import { AuthField } from '@/components/auth/AuthField';
import { signInAction } from '@/app/auth/actions';
import { TRIAL_DAYS } from '@/lib/trial';

/**
 * Sign in.
 *
 * The first screen of the product a returning owner sees, so it says one
 * thing: which two fields open the door. The left column shows the same three
 * places the product connects — table, pass, counter — as a single quiet
 * board, not as a second form competing with the first.
 */
export function LoginScreen({ error, notice, next }: { error?: string; notice?: string; next?: string }) {
  return (
    <AuthShell
      visual={
        <aside className="pt-2" aria-label="Restaurant workspace overview">
          <p className="flex items-center gap-2.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/80">
            <span aria-hidden="true" className="h-px w-6 bg-[var(--auth-accent-bright)]" />
            Back to your service
          </p>
          <h2 className="mt-6 max-w-[13ch] text-[clamp(2.25rem,3.6vw,3.1rem)] font-medium leading-[1.05] tracking-[-0.05em] text-white">
            The room moves.<br />
            Stay <em className="font-display font-normal italic text-[var(--auth-accent-bright)]">connected.</em>
          </h2>
          <p className="mt-5 max-w-[35ch] text-[14.5px] leading-[1.7] text-white/80">
            Your menu, kitchen tickets and counter, with a place for every part of service.
          </p>

          <div className="relative mt-9 overflow-hidden rounded-[26px] border border-white/15 bg-white/10 p-5 backdrop-blur-xl">
            <div className="relative flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/75">Live service</p>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white">
                <span aria-hidden="true" className="auth-live-dot size-1.5 rounded-full bg-[var(--auth-accent-bright)]" />
                One order
              </span>
            </div>

            <ol className="relative mt-4 space-y-2.5">
              {[
                { n: '01', place: 'Table 05', state: 'Order sent', detail: '2 dishes · one guest note', accent: 'bg-[var(--auth-accent-bright)]' },
                { n: '02', place: 'Kitchen', state: 'Preparing', detail: 'Table 05 · no app to install', accent: 'bg-[var(--auth-accent)]' },
                { n: '03', place: 'Counter', state: 'Awaiting payment', detail: 'Check, then record at the counter', accent: 'bg-white/40' },
              ].map((row) => (
                <li key={row.place} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-3.5 py-3 transition-colors duration-300 hover:border-white/25 hover:bg-white/15">
                  <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${row.accent}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-white">{row.place}</span>
                    <span className="block text-[11px] text-white/80">{row.detail}</span>
                  </span>
                  <span className="shrink-0 text-[10.5px] font-medium text-[var(--auth-accent-bright)]">{row.state}</span>
                  <span aria-hidden="true" className="text-[9px] tabular-nums tracking-[0.12em] text-white/35">{row.n}</span>
                </li>
              ))}
            </ol>

            <p className="relative mt-4 border-t border-white/10 pt-3.5 text-[11px] leading-relaxed text-white/80">
              Sending an order does not mark its bill as paid. Staff still check and record payment.
            </p>
          </div>

          <Link href="/#screens" className="mt-6 inline-flex min-h-11 items-center gap-2.5 text-[13px] font-medium text-white transition-colors hover:text-[var(--auth-accent-bright)]">
            Take a look around <span aria-hidden="true">↗</span>
          </Link>
        </aside>
      }
      notesTitle="Before you sign in"
      eyebrow="Welcome back"
      title={<>Sign in to your <span className="font-bold text-[var(--auth-accent-ink)]">restaurant</span></>}
      lede="Use the email address you signed up with."
      action={{ prompt: 'New to AutoDine?', label: 'Create an account', href: '/signup' }}
      notes={[
        <span key="live">
          <strong>Ordering, the kitchen board and the counter are live.</strong> Every outlet, order and menu row stays exactly where you left it.
        </span>,
        <span key="plans">
          <strong>New accounts start with {TRIAL_DAYS} trial days.</strong> Pick a plan whenever you are ready — checkout is secure, through Cashfree.
        </span>,
        <span key="payments">
          <strong>Guest bills are settled your way.</strong> AutoDine records counter payments; subscription billing runs through Cashfree.
        </span>,
      ]}
    >
      {notice ? (
        <div
          role="status"
          className="mb-4 flex gap-2.5 rounded-xl border border-[var(--p-accent)]/20 bg-accent-soft px-3.5 py-3 text-[12.5px] leading-[1.55] text-gink-64"
        >
          <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-forest text-[9px] text-white">i</span>
          <span>{notice}</span>
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mb-4 flex gap-2.5 rounded-xl border border-[var(--alert)]/25 bg-[var(--alert)]/8 px-3.5 py-3 text-[12.5px] leading-[1.55] text-[var(--alert)]"
        >
          <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-[var(--alert)] text-[9px] text-white">!</span>
          <span>{error}</span>
        </div>
      ) : null}

      <form className="flex flex-col gap-4" action={signInAction}>
        {next && <input type="hidden" name="next" value={next} />}

        <AuthField
          id="login-email"
          name="email"
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="owner@restaurant.in"
          required
          requiredMessage="Enter the email address you signed up with."
          invalidMessage="That does not look like an email address."
        />

        <AuthField
          id="login-password"
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="Your password"
          required
          requiredMessage="Enter your password."
        />

        <LoginSubmit />

        <p className="text-center text-[11.5px] leading-[1.6] text-gink-46">
          Forgotten it?{' '}
          <Link
            href="/forgot-password"
            className="font-medium text-gink underline decoration-hair-strong underline-offset-2 transition-colors hover:text-forest hover:decoration-forest"
          >
            Reset your password
          </Link>{' '}
          — we email a single-use link to the address you signed up with.
        </p>
      </form>
    </AuthShell>
  );
}
