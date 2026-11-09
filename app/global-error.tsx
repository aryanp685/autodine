'use client';

/** Last-resort recovery when the root layout itself fails. No server messages
 * or stack traces are rendered; this boundary must not depend on that layout. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body>
    <main>
      <h1>AutoDine could not load</h1>
      <p>Please retry. Do not submit an order or payment again until you have checked its recorded status.</p>
      <button type="button" onClick={reset}>Try again</button>
      <a href="/">Return home</a>
    </main>
  </body></html>;
}
