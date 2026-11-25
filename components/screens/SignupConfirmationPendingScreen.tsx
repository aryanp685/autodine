import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { ResendSignupConfirmationForm } from '@/components/ResendSignupConfirmationForm';
import { SignupWelcome } from '@/components/auth/SignupWelcome';

export function SignupConfirmationPendingScreen({
  email,
  linkProblem = false,
}: {
  email: string | null;
  linkProblem?: boolean;
}) {
  return (
    <AuthShell
      visual={
        <aside className="pt-6" aria-label="Email confirmation guide">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/80">A secure first step</p>
          <h2 className="mt-6 max-w-[13ch] text-[clamp(2.25rem,3.6vw,3.1rem)] font-medium leading-[1.06] tracking-[-0.05em] text-white">
            Check your inbox.<br /><span className="text-[var(--auth-accent-bright)]">Then step in.</span>
          </h2>
          <p className="mt-5 max-w-[35ch] text-[14.5px] leading-relaxed text-white/80">
            Confirming the address protects the account and keeps sign-in tied to the right person.
          </p>
          <div aria-hidden="true" className="login-service-art relative mt-9 grid h-52 place-items-center overflow-hidden rounded-[26px] border border-white/15 bg-white/10">
            <div className="absolute size-40 rounded-full border border-white/15" />
            <div className="absolute size-56 rounded-full border border-[var(--auth-accent-bright)]/25" />
            <div className="relative grid size-24 place-items-center rounded-3xl border border-white/20 bg-white/10 text-white">
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="6" width="18" height="13" rx="3" />
                <path d="m4 8 8 6 8-6" />
                <path d="M8 3h8" stroke="var(--auth-accent-bright)" />
              </svg>
            </div>
          </div>
        </aside>
      }
      eyebrow="Confirm your email"
      title="Check your inbox"
      lede={
        email ? (
          <>
            If a signup for <strong className="break-all font-medium text-gink">{email}</strong> is waiting for confirmation, look for an AutoDine email. Check spam and junk too. This page cannot confirm delivery.
          </>
        ) : (
          'Enter the address you used to sign up. If a signup is waiting for confirmation, look for an AutoDine email and check spam or junk. This page cannot confirm delivery.'
        )
      }
      action={{ prompt: 'Already confirmed?', label: 'Sign in', href: '/login' }}
      notesTitle="If the link does not work"
      notes={[
        <span key="expired">
          <strong>Expired or already used?</strong> Request another confirmation below, then open the new link in the browser where you made the request.
        </span>,
        <span key="confirmed">
          <strong>Already confirmed?</strong> Return to sign in. This page does not reveal whether an address has an account.
        </span>,
        <span key="waiting">
          <strong>Still waiting?</strong> Check spam or junk. Auth may apply a sending cooldown; wait a few minutes before requesting again.
        </span>,
      ]}
    >
      {linkProblem ? (
        <p role="alert" className="mb-4 rounded-xl border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-3 text-[12.5px] leading-[1.55] text-[var(--alert)]">
          This confirmation link could not be completed. It may be expired or already used. If signup is still pending, request another below; if you have confirmed already, sign in. Nothing is deleted by this page.
        </p>
      ) : null}

      <div className="mb-5 rounded-xl border border-forest/10 bg-forest-soft/50 px-3.5 py-3 text-[12.5px] leading-[1.55] text-gink-64">
        Email confirmation is required before a new account can sign in. No new workspace is created by requesting another confirmation.
      </div>

      <ResendSignupConfirmationForm email={email} />

      <SignupWelcome />

      <p className="mt-5 text-center text-[12px] leading-[1.5] text-gink-46">
        <Link href="/login" className="font-medium text-gink underline decoration-hair-strong underline-offset-2">
          Return to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
