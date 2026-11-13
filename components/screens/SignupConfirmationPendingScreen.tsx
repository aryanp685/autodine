import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { ResendSignupConfirmationForm } from '@/components/ResendSignupConfirmationForm';

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
        <aside className="hidden pt-6 lg:block" aria-label="Email confirmation guide">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-forest">A secure first step</p>
          <h2 className="mt-6 max-w-[13ch] text-[clamp(2.5rem,4.5vw,3.8rem)] font-medium leading-[1.06] tracking-[-0.05em]">
            Check your inbox.<br /><span className="text-forest">Then step in.</span>
          </h2>
          <p className="mt-6 max-w-[35ch] text-[15px] leading-relaxed text-gink-64">
            Confirming the address protects the account and keeps sign-in tied to the right person.
          </p>
          <div aria-hidden="true" className="login-service-art relative mt-10 grid h-52 place-items-center overflow-hidden rounded-[28px] border border-forest/10 bg-forest-soft/50">
            <div className="absolute size-40 rounded-full border border-forest/10" />
            <div className="absolute size-56 rounded-full border border-[#B98A4B]/20" />
            <div className="relative grid size-24 place-items-center rounded-3xl border border-forest/15 bg-white shadow-[0_8px_24px_rgba(31,77,58,0.06)]">
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="text-forest">
                <rect x="3" y="6" width="18" height="13" rx="3" />
                <path d="m4 8 8 6 8-6" />
                <path d="M8 3h8" stroke="#B98A4B" />
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
        <>
          <strong>Expired or already used?</strong> Request another confirmation below, then open the new link in the browser where you made the request.
        </>,
        <>
          <strong>Already confirmed?</strong> Return to sign in. This page does not reveal whether an address has an account.
        </>,
        <>
          <strong>Still waiting?</strong> Check spam or junk. Auth may apply a sending cooldown; wait a few minutes before requesting again.
        </>,
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

      <p className="mt-5 text-center text-[12px] leading-[1.5] text-gink-46">
        <Link href="/login" className="font-medium text-gink underline decoration-hair-strong underline-offset-2">
          Return to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
