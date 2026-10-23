import Link from 'next/link';

/**
 * Shown when a staff screen is connected to the database but the caller has
 * no restaurant to display.
 *
 * Without this, a signed-out visitor sees a correctly rendered, completely
 * empty kitchen board. An empty board is what a quiet service looks like, so
 * the page reads as "no orders" when the truth is "you are not signed in".
 * Those two need to look different: one is fine, the other needs the user to
 * do something.
 *
 * WHY THIS IS NOT A RED ALERT
 *
 * It used to reuse .pg__alert, the error box, so "you are not signed in" wore
 * the same colour as "the order failed to save". Nothing went wrong here; the
 * screen simply has a question to ask. It is now a neutral panel with the two
 * actions as buttons rather than a sentence with two inline links, because on
 * a wall-mounted kitchen board a link inside a paragraph is not a target.
 */
export function SignInPrompt({
  reason,
  screen,
}: {
  reason: 'signed-out' | 'no-membership';
  screen: string;
}) {
  const signedOut = reason === 'signed-out';

  return (
    <div
      role="status"
      data-signin-prompt={reason}
      className="mb-5 flex flex-col gap-3 rounded-[14px] border border-hair-strong bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <strong className="text-[13.5px] font-semibold text-gink">
          {signedOut ? 'Sign in to see this screen.' : 'No restaurant on this account yet.'}
        </strong>
        <p className="mt-1 max-w-[62ch] text-[12.5px] leading-[1.55] text-gink-64">
          {signedOut ? (
            <>
              The {screen} reads real data, and it is filtered to the restaurant your account
              belongs to. Sign in and it will load.
            </>
          ) : (
            <>
              Your account is signed in but is not a member of any restaurant, so there is
              nothing this screen is allowed to show.
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Link
          href="/login"
          className="inline-flex h-9 items-center rounded-full bg-gink px-4 text-[12.5px] font-medium text-onink transition-colors hover:bg-gink/88"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="inline-flex h-9 items-center rounded-full border border-hair-strong px-4 text-[12.5px] font-medium text-gink transition-colors hover:bg-gink-07"
        >
          Create an account
        </Link>
      </div>
    </div>
  );
}
