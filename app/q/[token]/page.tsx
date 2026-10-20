import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicTableQr } from '@/lib/db/table-verification';
import { getSingleSearchParam } from '@/lib/query-params';
import { verifyTableCodeAction } from '../actions';

export const metadata: Metadata = {
  title: 'Verify table · AutoDine',
  robots: { index: false, follow: false },
};

const STATUS_MESSAGES: Record<string, string> = {
  invalid: 'Enter the current six-digit code from restaurant staff.',
  incorrect: 'That code could not be verified. Please get the current code from restaurant staff.',
  cooldown: 'Too many attempts. Please wait before trying again, or ask restaurant staff for help.',
  unavailable: 'This table verification is unavailable. Please ask restaurant staff for the current code.',
};

export default async function VerifyTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const qr = await getPublicTableQr(token);
  if (!qr) notFound();
  const status = getSingleSearchParam(query.status);
  const message = status.valid && status.value ? STATUS_MESSAGES[status.value] : undefined;

  return (
    <main className="qr-verify">
      <section className="qr-verify__card" aria-labelledby="qr-verify-title">
        <a href="/" className="qr-verify__brand">AutoDine</a>
        <p className="qr-verify__eyebrow">{qr.restaurantName} · {qr.tableLabel}</p>
        <h1 id="qr-verify-title">Verify your table</h1>
        <p className="qr-verify__intro">Enter the current six-digit code displayed by restaurant staff to start ordering at this table.</p>
        {message && <p className="qr-verify__message" role="alert">{message}</p>}
        <form action={verifyTableCodeAction} className="qr-verify__form">
          <input type="hidden" name="qrToken" value={qr.publicToken} />
          <label htmlFor="qr-verification-code">Six-digit staff code</label>
          <input
            id="qr-verification-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            aria-describedby="qr-verify-help"
          />
          <p id="qr-verify-help" className="qr-verify__help">Codes refresh every five minutes. If yours expired, ask staff for the current one.</p>
          <button type="submit">Continue to menu</button>
        </form>
        <p className="qr-verify__note">A guest can photograph or share a live code; verification is not perfect physical-presence detection.</p>
      </section>
    </main>
  );
}
