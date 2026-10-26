import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/AuthShell';
import { Field, inputClass } from '@/components/owner/chrome';
import { isWellFormedInviteCode, joinPath, normaliseInviteCode } from '@/lib/team-invite';

export const metadata: Metadata = {
  title: 'Join your team · AutoDine',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Where a code goes when somebody types it instead of tapping a link.
 *
 * The link is the normal path; this exists because a link sent over a phone
 * call becomes a code read aloud, and "you must have the exact URL" is how a
 * staff member ends up on a video call with the owner instead of on the
 * kitchen board.
 *
 * A code in the query string here is a code the person typed, not one the
 * server handed out, so it is not the leak path the minting flow avoids: it is
 * looked at once, used to redirect to the canonical page, and never stored.
 */
export default async function JoinIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string }>;
}) {
  const { code, error } = await searchParams;
  const normalised = normaliseInviteCode(code);

  if (normalised && isWellFormedInviteCode(normalised)) {
    redirect(joinPath(normalised));
  }

  return (
    <AuthShell
      eyebrow="Team invitation"
      title="Paste your invitation code"
      lede="Your owner sent a link. If you are reading it out or typing it, the code is the last part of that link — four groups of four characters."
      notes={[
        <>
          <strong>The code is single use.</strong> It stops working once somebody joins with it, or
          when it expires.
        </>,
        <>
          <strong>No code to hand?</strong> Ask the owner. Every restaurant can create a fresh link
          from Settings → People in a few seconds.
        </>,
      ]}
      notesTitle="How this works"
    >
      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-[var(--alert)]"
        >
          {error}
        </div>
      ) : null}

      {code && !isWellFormedInviteCode(normalised) ? (
        <div
          role="status"
          className="mb-4 rounded-[10px] border border-[var(--p-accent)]/25 bg-accent-soft px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-gink-64"
        >
          That code is not the right length. An invitation code has 16 letters and numbers.
        </div>
      ) : null}

      <form method="get" action="/join" className="flex flex-col gap-3.5">
        <Field label="Invitation code" htmlFor="join-code" hint="For example K7QM-3XPD-9RTW-2HNJ.">
          <input
            id="join-code"
            className={inputClass}
            name="code"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            required
            maxLength={24}
            placeholder="K7QM-3XPD-9RTW-2HNJ"
          />
        </Field>
        <button
          type="submit"
          className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--p-accent)] px-5 text-[13px] font-semibold text-[var(--p-on-accent)] transition-colors hover:bg-[var(--p-accent-strong)]"
        >
          Continue
        </button>
      </form>
    </AuthShell>
  );
}
