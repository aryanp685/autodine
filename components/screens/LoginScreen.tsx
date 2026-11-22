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
        <aside className="hidden pt-2 lg:block" aria-label="Restaurant workspace overview">
          <p className="flex items-center gap-2.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-forest">
            <span aria-hidden="true" className="h-px w-6 bg-brass" />
            Back to your service
          </p>
          <h2 className="mt-6 max-w-[13ch] text-[clamp(2.5rem,4.5vw,3.8rem)] font-medium leading-[1.05] tracking-[-0.05em]">
            The room moves.<br />
            <span className="text-forest">Stay <em className="font-display font-normal italic">connected.</em></span>
          </h2>
          <p className="mt-6 max-w-[35ch] text-[15px] leading-[1.7] text-gink-64">
            Your menu, kitchen tickets and counter, with a place for every part of service.
          </p>

          <div className="relative mt-10 overflow-hidden rounded-[30px] border border-white/70 bg-white/65 p-5 shadow-[0_24px_60px_-42px_rgba(31,77,58,0.5)] backdrop-blur-xl">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_85%_0%,rgba(31,77,58,0.07),transparent_60%)]"
            />
            <div className="relative flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gink-46">Live service</p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-forest-soft px-2.5 py-1 text-[10px] font-medium text-forest">
                <span aria-hidden="true" className="auth-live-dot size-1.5 rounded-full bg-forest" />
                One order
              </span>
            </div>

            <ol className="relative mt-4 space-y-2.5">
              {[
                { n: '01', place: 'Table 05', state: 'Order sent', detail: '2 dishes · one guest note', accent: 'bg-forest' },
                { n: '02', place: 'Kitchen', state: 'Preparing', detail: 'Table 05 · no app to install', accent: 'bg-brass' },
                { n: '03', place: 'Counter', state: 'Awaiting payment', detail: 'Check, then record at the counter', accent: 'bg-gink-28' },
              ].map((row) => (
                <li key={row.place} className="flex items-center gap-3 rounded-2xl border border-hair/80 bg-white/80 px-3.5 py-3 transition-colors duration-300 hover:border-forest/20 hover:bg-white">
                  <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${row.accent}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-gink">{row.place}</span>
                    <span className="block text-[11px] text-gink-46">{row.detail}</span>
                  </span>
                  <span className="shrink-0 text-[10.5px] font-medium text-forest">{row.state}</span>
                  <span aria-hidden="true" className="text-[9px] tabular-nums tracking-[0.12em] text-gink-28">{row.n}</span>
                </li>
              ))}
            </ol>

            <p className="relative mt-4 border-t border-hair/80 pt-3.5 text-[11px] leading-relaxed text-gink-46">
              Sending an order does not mark its bill as paid. Staff still check and record payment.
            </p>
          </div>

          <Link href="/#screens" className="mt-6 inline-flex min-h-11 items-center gap-2.5 text-[13px] font-medium text-forest transition-colors hover:text-forest-strong">
            Take a look around <span aria-hidden="true">↗</span>
          </Link>
        </aside>
      }
      notesTitle="Before you sign in"
      eyebrow="Welcome back"
      title={<>Sign in to your <em className="font-display font-normal italic text-forest">restaurant</em></>}
      lede="Use the email address you signed up with."
      action={{ prompt: 'New to AutoDine?', label: 'Create an account', href: '/signup' }}
      notes={[
        <span key="live">
          <strong>Ordering, the kitchen board and the counter are live in this preview.</strong> Not certified for live restaurant operations.
        </span>,
        <span key="plans">
          <strong>Plans are not on sale.</strong> New accounts start with {TRIAL_DAYS} trial days; existing workspaces keep their recorded end date. After it, access is read-only until extended.
        </span>,
        <span key="payments">
          <strong>Payments are recorded at the counter.</strong> AutoDine does not collect online payments.
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
