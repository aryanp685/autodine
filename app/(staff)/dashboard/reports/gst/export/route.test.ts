import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ staff:vi.fn(),rpc:vi.fn() }));
vi.mock('@/lib/db/staff', () => ({ getStaffContextDetailed:mocks.staff }));
import { GET } from './route';

const docs = [{ outlet_id:'selected', lifecycle:'held', profile:'other_than_specified_premises', id:'inv-fixture',number:'IR1/26-27/000003',issued_at:'2026-11-18T18:40:00Z',series:'IR1',financial_year:'26-27',
  kind:'gst_tax_invoice',billing:'regular',audience:'B2B',status:'issued',irp_status:'pending',effective_from:'2026-11-19',buyer_gstin:'29ZZZZZ0000Z1ZY',
  source_number:null,paid_at_issue:10500,gross:10500,taxable:10000,cgst:250,sgst:250,igst:0,rounding_delta:null }];
const base = { schema_version:2,scope:'selected',document_count:1,documents:docs,outlet:'selected',outlets:[{id:'selected',name:'Fixture Outlet'}],payments:[{outlet_id:'selected',status:'refunded',linked_to:'issued_sitting',count:1,amount_paise:1200}],buckets:[] };
const url = (query='from=2026-11-19&through=2026-11-19&series=IR1&audience=B2B') => new Request(`https://example.invalid/dashboard/reports/gst/export?${query}`);
const staff = (role: string) => ({ok:true,context:{role,restaurantId:'selected',supabase:{rpc:mocks.rpc}}});
beforeEach(() => { vi.resetAllMocks();mocks.staff.mockResolvedValue(staff('owner'));mocks.rpc.mockResolvedValue({data:base,error:null}); });
describe('GST ledger export', () => {
  it('binds outlet, India dates and filters; preserves held status, saved paise and separate refunds', async () => {
    const response = await GET(url());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('report_gst_finance',{p_outlet:'selected',p_scope:'selected',p_from:'2026-11-19',p_until:'2026-11-20',p_series:'IR1',p_audience:'B2B',p_detail_limit:10001});
    const csv = await response.text();
    expect(csv).toContain('not a GST return');
    expect(csv).toContain('gst_tax_invoice,regular,B2B,IRN hold,pending');
    expect(csv).toContain('105.00,100.00,2.50,2.50,0.00,105.00,');
    expect(csv).toContain('refunded,issued_sitting,1,12.00');
    expect(await (await GET(url())).text()).toBe(csv);
  });
  it('denies cashier and stale outlet and rejects invalid input before the ledger access', async () => {
    mocks.staff.mockResolvedValueOnce(staff('cashier'));
    expect((await GET(url())).status).toBe(403);
    expect((await GET(url('outlet=other'))).status).toBe(409);
    expect((await GET(url('from=2026-02-31'))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('allows Manager read; refuses instead of silently truncating a partial or oversized export', async () => {
    mocks.staff.mockResolvedValue(staff('manager'));
    mocks.rpc.mockResolvedValueOnce({data:{...base,document_count:10_001},error:null});
    expect((await GET(url())).status).toBe(422);
    mocks.rpc.mockResolvedValueOnce({data:{...base,document_count:2},error:null});
    expect((await GET(url())).status).toBe(503);
    expect((await GET(url())).status).toBe(200);
  });
  it('exports account-scoped results with cancellation separate from a hold and refuses an unexpected outlet', async () => {
    const sibling={id:'sibling',name:'=Synthetic outlet'};
    const exported={...base,scope:'account',outlets:[...base.outlets,sibling],document_count:2,
      documents:[...docs,{...docs[0],id:'cancelled-view-only',outlet_id:sibling.id,lifecycle:'cancelled',irp_status:'cancelled'}]};
    const account = url('scope=account&from=2026-11-19&through=2026-11-19');
    mocks.rpc.mockResolvedValueOnce({data:exported,error:null});
    const response=await GET(account);
    expect(response.status).toBe(200);
    const csv=await response.text();
    expect(csv).toContain("sibling,'=Synthetic outlet");
    expect(csv).toContain('IRP cancelled,cancelled');
    expect(csv).toContain('IRN hold,pending');
    expect(mocks.rpc).toHaveBeenCalledWith('report_gst_finance',expect.objectContaining({p_scope:'account',p_outlet:'selected'}));
    mocks.rpc.mockResolvedValueOnce({data:{...exported,outlets:base.outlets},error:null});
    expect((await GET(account)).status).toBe(503);
  });

});
