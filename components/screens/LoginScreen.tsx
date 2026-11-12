import Link from 'next/link';
import { LoginSubmit } from '@/components/LoginSubmit';
import { AuthShell } from '@/components/AuthShell';
import { signInAction } from '@/app/auth/actions';
import { Field, inputClass } from '@/components/owner/chrome';
import { TRIAL_DAYS } from '@/lib/trial';

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
      visual={
        <aside className="hidden pt-6 lg:block" aria-label="Restaurant workspace overview">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-forest">Back to your service</p>
          <h2 className="mt-6 max-w-[13ch] text-[clamp(2.5rem,4.5vw,3.8rem)] font-medium leading-[1.06] tracking-[-0.05em]">The room moves.<br /><span className="text-forest">Stay connected.</span></h2>
          <p className="mt-6 max-w-[35ch] text-[15px] leading-relaxed text-gink-64">Your menu, kitchen tickets and counter, with a place for every part of service.</p>
          <div aria-hidden="true" className="login-service-art relative mt-10 flex h-52 items-center justify-center overflow-hidden rounded-[28px] border border-forest/10 bg-forest-soft/50">
            <div className="absolute size-40 rounded-full border border-forest/10" />
            <div className="absolute size-56 rounded-full border border-[#B98A4B]/20" />
            <div className="relative flex items-center gap-3">
              {['Menu', 'Kitchen', 'Counter'].map((label, i) => <div key={label} style={{ animationDelay: `${i * 120}ms` }} className="login-service-node grid h-20 w-24 place-content-center gap-2 rounded-2xl border border-forest/15 bg-white text-center shadow-[0_8px_24px_rgba(31,77,58,0.05)]"><span className="text-[10px] tracking-[0.15em] text-[#B98A4B]">0{i + 1}</span><span className="text-[12.5px] font-medium text-forest">{label}</span></div>)}
            </div>
          </div>
          <Link href="/#screens" className="mt-6 inline-flex min-h-11 items-center gap-3 text-[13px] font-medium text-forest">Take a look around <span aria-hidden="true">↗</span></Link>
        </aside>
      }
      notesTitle="Before you sign in"
      eyebrow="Welcome back"
      title="Sign in to your restaurant"
      lede="Use the email address you signed up with."
      action={{ prompt: 'New to AutoDine?', label: 'Create an account', href: '/signup' }}
      notes={[
        <>
          <strong>Ordering, the kitchen board and the counter are live in this preview.</strong> Not certified for live restaurant operations.
        </>,
        <>
          <strong>Plans are not on sale.</strong> New accounts start with {TRIAL_DAYS} trial days; existing workspaces keep their recorded end date. After it, access is read-only until extended.
        </>,
        <>
          <strong>Payments are recorded at the counter.</strong> AutoDine does not collect online payments.
        </>,
      ]}
    >
      {notice ? (
        <div
          role="status"
          className="mb-4 rounded-[10px] border border-[var(--p-accent)]/25 bg-accent-soft px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-gink-64"
        >
          {notice}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-[var(--alert)]"
        >
          {error}
        </div>
      ) : null}

      <form className="flex flex-col gap-4" action={signInAction}>
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

        <LoginSubmit />

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
