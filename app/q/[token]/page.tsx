import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getCookieTableSession, getPublicTableQr } from '@/lib/db/table-verification';
import { getSingleSearchParam } from '@/lib/query-params';
import { startTableOrderingAction } from '../actions';

export const metadata: Metadata = {
  title: 'Open table menu · AutoDine',
  robots: { index: false, follow: false },
};

const STATUS_MESSAGES: Record<string, string> = {
  cooldown: 'Too many starts from this device. Please wait a little and try again.',
  unavailable: 'This table QR is unavailable. Please ask restaurant staff for help.',
};

export default async function TableQrPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const qr = await getPublicTableQr(token);
  if (!qr) notFound();

  const tableSession = await getCookieTableSession();
  if (tableSession?.qrCodeId === qr.id) {
    redirect(`/menu?s=${encodeURIComponent(qr.restaurantSlug)}`);
  }

  const status = getSingleSearchParam(query.status);
  const message = status.valid && status.value ? STATUS_MESSAGES[status.value] : undefined;

  return (
    <main className="qr-verify">
      <section className="qr-verify__card" aria-labelledby="qr-verify-title">
        <a href="/" className="qr-verify__brand">AutoDine</a>
        <p className="qr-verify__eyebrow">{qr.restaurantName} · {qr.tableLabel}</p>
        <h1 id="qr-verify-title">Order at your table</h1>
        <p className="qr-verify__intro">Open this table’s menu and submit an unpaid counter order to the restaurant.</p>
        {message && <p className="qr-verify__message" role="alert">{message}</p>}
        <form action={startTableOrderingAction} className="qr-verify__form">
          <input type="hidden" name="qrToken" value={qr.publicToken} />
          <button type="submit">Open menu</button>
        </form>
        <p className="qr-verify__note">Orders are linked to {qr.tableLabel}. Please scan the QR at your table.</p>
      </section>
    </main>
  );
}
