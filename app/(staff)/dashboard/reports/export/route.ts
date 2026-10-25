/**
 * CSV export for the sales report.
 *
 * A Route Handler rather than a server action: the browser needs to receive a
 * file with a filename, and `Content-Disposition` is not something a rendered
 * page can set.
 *
 * The export re-runs the same loader the screen uses, from the same URL
 * params, rather than trusting a payload echoed back from the client. That
 * means the file and the screen can never disagree, and there is no path by
 * which a caller can ask for another restaurant's ledger -- the restaurant id
 * comes from the caller's session inside getStaffContextDetailed, never from
 * the query string.
 */

import { NextResponse } from 'next/server';
import { getReportsScreenData, itemsCsv, ordersCsv, summaryCsv } from '@/lib/db/reports';
import { localDateKey } from '@/lib/db/time';

export const dynamic = 'force-dynamic';

type ExportType = 'summary' | 'orders' | 'items';

function isExportType(value: string | null): value is ExportType {
  return value === 'summary' || value === 'orders' || value === 'items';
}

/** RFC 4180-ish filename that survives Windows, macOS and the browser. */
function filename(type: ExportType, fromIso: string, timeZone: string): string {
  const day = localDateKey(timeZone, new Date(fromIso));
  return `autodine-${type}-${day}.csv`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const range = url.searchParams.get('range') ?? 'today';
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;

  if (!isExportType(type)) {
    return NextResponse.json(
      { error: 'type must be summary, orders or items' },
      { status: 400 },
    );
  }

  let data;
  try {
    data = await getReportsScreenData({
      range,
      from,
      to,
      // The line ledger only exists for the items export; asking for it on
      // every request would make a 30-day report twice as heavy for nothing.
      includeLines: type === 'items',
      // Exports are the whole ledger, not the hundred rows the screen shows.
      orderLimit: 10_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: 'The database is not configured, so there is nothing to export.' },
      { status: 503 },
    );
  }

  if (data.blocked) {
    return NextResponse.json(
      { error: 'Sign in to export a report.' },
      { status: 401 },
    );
  }

  const body =
    type === 'orders'
      ? ordersCsv(data.report, data.timezone)
      : type === 'items'
        ? itemsCsv(data.report, data.timezone)
        : summaryCsv(data.report, data.range, data.timezone);

  return new NextResponse(`\uFEFF${body}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename(type, data.range.fromIso, data.timezone)}"`,
      // Takings are not public and must not sit in a shared cache.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
