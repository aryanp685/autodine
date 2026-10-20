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
    <div className="pg__alert" role="status">
      <strong>{signedOut ? 'Sign in to see this screen.' : 'No restaurant on this account yet.'}</strong>
      <p>
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
      <p>
        <Link href="/login">Sign in</Link>
        {' · '}
        <Link href="/signup">Create an account</Link>
      </p>
    </div>
  );
}
