import type { Metadata } from 'next';
import { QrProblemScreen } from '@/components/screens/QrProblemScreen';
import { QR_PROBLEM_COPY, isQrProblemReason, type QrProblemReason } from '@/lib/qr-problem';

/**
 * The tab says the same thing as the page. See lib/qr-problem.ts.
 *
 * generateMetadata rather than a fixed `metadata` export, so a restaurant that
 * has simply not switched ordering on does not get a tab reading "This code
 * did not work". The two cannot be exported together.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}): Promise<Metadata> {
  const { r } = await searchParams;
  const reason: QrProblemReason = isQrProblemReason(r) ? r : 'unreadable';
  return {
    title: `${QR_PROBLEM_COPY[reason].title} · AutoDine`,
    robots: { index: false, follow: false },
  };
}

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

export default async function TableQrProblemPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}) {
  const { r } = await searchParams;

  // An unrecognised or missing code falls back to the plainest explanation
  // rather than rendering nothing at all.
  const reason: QrProblemReason = isQrProblemReason(r) ? r : 'unreadable';
  const copy = QR_PROBLEM_COPY[reason];

  return (
    <QrProblemScreen
      title={copy.title}
      detail={copy.detail}
      {...(copy.staffHint ? { staffHint: copy.staffHint } : {})}
    />
  );
}
