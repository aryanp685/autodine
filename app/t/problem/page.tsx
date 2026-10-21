import type { Metadata } from 'next';
import { QrProblemScreen } from '@/components/screens/QrProblemScreen';

export const metadata: Metadata = {
  title: 'This code did not work · AutoDine',
  robots: { index: false, follow: false },
};

/**
 * Where a scanned QR lands when it cannot be turned into a table.
 *
 * The reason arrives as a code in the query string, never as a message. The
 * handler that redirects here has just talked to the database, and echoing
 * what the database said into a URL would put caller-influenced text into a
 * page -- which is how a reflected error becomes something worse. A closed
 * set of codes means every sentence below is one we wrote.
 *
 * Each one says what to do next, because the person reading it is standing in
 * a busy room holding a phone, and "something went wrong" is no help to them.
 */

type Reason = 'unreadable' | 'revoked' | 'limited' | 'notserving' | 'nomenu' | 'offline' | 'failed';

const REASONS: Record<Reason, { title: string; detail: string; staffHint?: string }> = {
  unreadable: {
    title: 'This code did not work',
    detail: 'Please ask staff for the current code for your table.',
    staffHint:
      'If this code is printed and still failing, the table may have been taken out of service or its code replaced.',
  },
  revoked: {
    title: 'This code is no longer in use',
    detail: 'Your table has a newer code. Please ask staff for the current one.',
    staffHint: 'Codes stop working when a table is reset or its QR is replaced.',
  },
  limited: {
    title: 'Too many attempts',
    detail: 'Please wait a few minutes and scan again.',
    staffHint: 'Too many wrong codes were tried from this connection.',
  },
  notserving: {
    title: 'Not taking orders right now',
    detail: 'Please order with staff.',
    staffHint: 'The restaurant or this table may be switched off for the moment.',
  },
  nomenu: {
    title: 'No menu published yet',
    detail: 'This restaurant has not published a menu. Please order with staff.',
    staffHint: 'Publish the menu from the dashboard to start taking QR orders.',
  },
  offline: {
    title: 'Ordering is not switched on',
    detail: 'This restaurant has not connected its ordering system. Please order with staff.',
  },
  failed: {
    title: 'This code did not work',
    detail: 'Please try scanning again, or order with staff.',
  },
};

const isReason = (value: string | undefined): value is Reason =>
  typeof value === 'string' && value in REASONS;

export default async function TableQrProblemPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}) {
  const { r } = await searchParams;

  // An unrecognised or missing code falls back to the plainest explanation
  // rather than rendering nothing at all.
  const reason: Reason = isReason(r) ? r : 'unreadable';
  const copy = REASONS[reason];

  return (
    <QrProblemScreen
      title={copy.title}
      detail={copy.detail}
      {...(copy.staffHint ? { staffHint: copy.staffHint } : {})}
    />
  );
}
