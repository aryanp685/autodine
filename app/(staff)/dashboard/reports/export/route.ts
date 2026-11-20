/**
 * CSV export for the sales report.
 *
 * A Route Handler rather than a server action: the browser needs to receive a
 * file with a filename, and `Content-Disposition` is not something a rendered
 * page can set.
 *
 * The caller's selected outlet and actual role come only from the trusted staff
 * context helper. Export access is checked here before the report RPC, and the
 * `report_sales()` database function independently enforces the same boundary.
 */

import { NextResponse } from 'next/server';
import { getStaffContextDetailed, type StaffContextResult } from '@/lib/db/staff';
import {
  getReportsScreenDataForStaff,
  getGstDocumentsForStaff,
  gstDocumentsCsv,
  isReportRangeKey,
  resolveRange,
  itemsCsv,
  ordersCsv,
  summaryCsv,
  type ReportsScreenData,
} from '@/lib/db/reports';
import { localDateKey } from '@/lib/db/time';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };
type ExportType = 'summary' | 'orders' | 'items' | 'gst';

function isExportType(value: string | null): value is ExportType {
  return value === 'summary' || value === 'orders' || value === 'items' || value === 'gst';
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/** RFC 4180-ish filename that survives Windows, macOS and the browser. */
function filename(type: ExportType, fromIso: string, timeZone: string): string {
  const day = localDateKey(timeZone, new Date(fromIso));
  return `autodine-${type}-${day}.csv`;
}

export async function GET(request: Request) {
  let staff: StaffContextResult;
  try {
    staff = await getStaffContextDetailed();
  } catch (error) {
    console.error('[reports-export] request failed', error instanceof Error ? error.name : 'Error');
    return jsonError('The report could not be exported. Please try again.', 503);
  }

  if (!staff.ok) {
    if (staff.reason === 'unconfigured') {
      return jsonError('The database is not configured, so there is nothing to export.', 503);
    }
    if (staff.reason === 'signed-out') {
      return jsonError('Sign in to export a report.', 401);
    }
    return jsonError('You do not have access to a restaurant report.', 403);
  }

  // This uses the actual membership role for the selected, membership-verified
  // outlet. A caller's query string or stale outlet cookie grants no authority.
  if (staff.context.role !== 'owner' && staff.context.role !== 'manager') {
    return jsonError('Owner or Manager permission is required to export reports.', 403);
  }

  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  if (!isExportType(type)) {
    return jsonError('type must be summary, orders, items or gst', 400);
  }

  if (type === 'gst') {
    const { timezone } = staff.context;
    const key = url.searchParams.get('range');
    const range = resolveRange(isReportRangeKey(key) ? key : 'today', timezone, new Date(), {
      from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined,
    });
    try {
      const documents = await getGstDocumentsForStaff(staff.context, range);
      if (!documents) return jsonError('GST document reporting is unavailable on this database.', 503);
      return csvResponse(gstDocumentsCsv(documents, range, timezone), type, range.fromIso, timezone);
    } catch {
      return jsonError('The GST report could not be exported. Please try again.', 503);
    }
  }

  let data: ReportsScreenData;
  try {
    data = await getReportsScreenDataForStaff(staff.context, {
      range: url.searchParams.get('range') ?? 'today',
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      // The line ledger only exists for the items export; asking for it on
      // every request would make a 30-day report twice as heavy for nothing.
      includeLines: type === 'items',
      // Exports are the whole ledger, not the hundred rows the screen shows.
      orderLimit: 10_000,
    });
  } catch (error) {
    console.error('[reports-export] request failed', error instanceof Error ? error.name : 'Error');
    return jsonError('The report could not be exported. Please try again.', 503);
  }

  const body =
    type === 'orders'
      ? ordersCsv(data.report, data.timezone)
      : type === 'items'
        ? itemsCsv(data.report, data.timezone)
        : summaryCsv(data.report, data.range, data.timezone);

  return csvResponse(body, type, data.range.fromIso, data.timezone);
}

function csvResponse(body: string, type: ExportType, fromIso: string, timeZone: string) {
  return new NextResponse(`\uFEFF${body}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename(type, fromIso, timeZone)}"`,
      // Takings are not public and must not sit in a shared cache.
      ...NO_STORE,
    },
  });
}
