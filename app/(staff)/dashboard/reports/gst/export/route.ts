import { getStaffContextDetailed } from '@/lib/db/staff';
import { getGstFilters, gstLedgerCsv, loadGstLedger } from '@/lib/db/gst-reconciliation';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers: privateHeaders });
export async function GET(request: Request) {
  try {
    const staff = await getStaffContextDetailed();
    if (!staff.ok) return failure('Sign in and select an authorized outlet.', staff.reason === 'signed-out' ? 401 : staff.reason === 'unconfigured' ? 503 : 403);
    if (staff.context.role !== 'owner' && staff.context.role !== 'manager') return failure('Owner or Manager permission is required.', 403);
    const params = new URL(request.url).searchParams;
    if (params.has('outlet') && params.get('outlet') !== staff.context.restaurantId) return failure('The selected outlet changed. Reload the report.',409);
    const filters = getGstFilters(params);
    if (!filters) return failure('Enter valid India dates and document filters (maximum 366 days).',400);
    const ledger = await loadGstLedger(staff.context, filters, 10_001);
    if (ledger.document_count > 10_000) return failure('Too many documents to export. Use a shorter date range.', 422);
    if (ledger.document_count !== ledger.documents.length) return failure('The export is incomplete. No CSV was returned.', 503);
    return new Response(`\uFEFF${gstLedgerCsv(ledger, filters)}`, { headers: { ...privateHeaders,
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="autodine-gst-ledger-${filters.from}.csv"` } });
  } catch {
    return failure('GST reconciliation is unavailable.', 503);
  }
}
