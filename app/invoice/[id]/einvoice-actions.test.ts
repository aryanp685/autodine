import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ staff: vi.fn(), rpc: vi.fn(), sources: vi.fn(), gate: vi.fn(), today: vi.fn() }));
vi.mock('@/lib/db/staff', () => ({ getStaffContextDetailed: mocks.staff }));
vi.mock('@/lib/gst/adapter', () => ({ getIrpPreflightGate: mocks.gate }));
vi.mock('@/lib/gst/einvoice-server', () => ({ loadEinvoiceSources: mocks.sources, localDateInTimeZone: mocks.today }));
import { attemptEinvoiceAction } from './einvoice-actions';
const ID = 'ee1bdc77-e632-40a2-b5f7-4c17139d6d85';
const SOURCES = {
  timeZone: 'Asia/Kolkata',
  invoice: {
    invoiceNumber: 'INV/26-27/000001',
    issuedLocalDate: '2026-11-14',
    irpStatus: 'pending',
    status: 'issued',
    documentType: 'gst_tax_invoice', irpEvidence: { applicability:'required',reportingCategory:'at_least_10cr' },
    gst: { rateBps: 500, taxablePaise: 10000, cgstPaise: 250, sgstPaise: 250, igstPaise: 0, placeOfSupplyStateCode: '27' },
    totals: { subtotalPaise: 10500, taxPaise: 500, totalPaise: 10500 },
    seller: { name: 'GST Test', tradeName: 'GST Test', address: 'Registered office, Test Lane, Nagpur - 440001', phone: null },
    recipient: { name: 'Buyer Foods LLP', gstin: '29ABCDE1234F1ZW', address: '1 Synthetic Buyer Lane', email: 'accounts@buyer.example',location:'Synthetic City',pincode:'560001' },
    lines: [{ itemName: 'Plate', quantity: 2, unitPricePaise: 5000, amountPaise: 10500 }],
  },
  profile: {
    mode: 'regular',
    registrationType: 'regular',
    gstin: '27AAAAA0000A1Z2',
    legalName: 'GST Test Kitchen LLP',
    tradeName: 'GST Test',
    address: 'Registered office, Test Lane, Nagpur - 440001',
    stateCode: '27',
    precedingFyTurnoverPaise: 6_000_000_000,
    einvoiceLocation: 'Nagpur',
    einvoicePincode: '440001',
    einvoiceHsnSac: '996331',
  },
};

const owner = (role = 'owner', canWrite = true) => ({ ok:true,
  context:{ role, entitlement:{ canWrite }, restaurantId:'outlet-a', supabase:{ rpc:mocks.rpc } } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.staff.mockResolvedValue(owner());
  mocks.gate.mockReturnValue({ ok:true });
  mocks.today.mockReturnValue('2026-11-19');
  mocks.sources.mockResolvedValue({ ok:true, sources:SOURCES });
  mocks.rpc.mockResolvedValue({ data:{ status:'prepared_offline',duplicate:false },error:null });
});
describe('offline preparation, not an IRP submission', () => {
  it('refuses invalid ids and an unavailable environment before any tenant access', async () => {
    expect(await attemptEinvoiceAction('T3')).toMatchObject({ ok:false });
    expect(mocks.gate).not.toHaveBeenCalled();
    mocks.gate.mockReturnValue({ ok:false,error:'Offline IRP disabled.' });
    expect(await attemptEinvoiceAction(ID)).toMatchObject({ ok:false,error:'Offline IRP disabled.' });
    expect(mocks.staff).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([owner('manager'),owner('cashier'),owner('kitchen'),owner('owner',false),{ok:false}])('rejects unauthorized actors (%j)', async (actor) => {
    mocks.staff.mockResolvedValue(actor);
    expect(await attemptEinvoiceAction(ID)).toMatchObject({ ok:false });
    expect(mocks.sources).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('preserves scope and does not record when the immutable source is unavailable', async () => {
    mocks.sources.mockResolvedValue({ ok:false,error:'No saved document.' });
    expect(await attemptEinvoiceAction(ID)).toEqual({ ok:false,error:'No saved document.' });
    expect(mocks.sources).toHaveBeenCalledWith({rpc:mocks.rpc},'outlet-a',ID,'invoice');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not record a profile/amount/schema error or an expired reporting window', async () => {
    mocks.sources.mockResolvedValueOnce({ ok:true,sources:{ ...SOURCES,profile:{...SOURCES.profile,einvoicePincode:null} } });
    expect(await attemptEinvoiceAction(ID)).toMatchObject({ ok:false,error:expect.stringMatching(/profile/i) });
    mocks.today.mockReturnValue('2026-12-14');
    expect(await attemptEinvoiceAction(ID)).toMatchObject({ ok:false,error:expect.stringMatching(/ended on 2026-12-13/i) });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('records only the validated immutable wire request; never updates invoice or invents IRP response', async () => {
    const result = await attemptEinvoiceAction(ID);
    expect(result).toEqual({ ok:true,duplicate:false,message:expect.stringMatching(/not submitted.*hold remains/i) });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('record_gst_irp_preflight',{
      p_outlet:'outlet-a',p_kind:'invoice',p_document:ID,p_canonical_sha256:expect.stringMatching(/^[a-f0-9]{64}$/),
      p_payload:expect.objectContaining({ Version:'1.1',DocDtls:{ Typ:'INV',No:'INV/26-27/000001',Dt:'14/11/2026' },ValDtls:expect.objectContaining({TotInvVal:105}) }),
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toMatch(/"(Irn|AckNo|SignedQRCode|SignedInvoice)"/);
  });
  it('prepares a linked note with its original date and number', async () => {
    mocks.sources.mockResolvedValue({ ok:true,sources:{ ...SOURCES,invoice:{ ...SOURCES.invoice,documentType:'credit_note',invoiceNumber:'CN/26-27/000001',
      originalInvoice:{documentType:'INV',documentNumber:'INV/26-27/000001',issuedDate:'2026-11-13'} } } });
    expect(await attemptEinvoiceAction(ID,'note')).toMatchObject({ ok:true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('record_gst_irp_preflight',expect.objectContaining({ p_kind:'note',p_payload:expect.objectContaining({
      RefDtls:{ PrecDocDtls:[{InvNo:'INV/26-27/000001',InvDt:'13/11/2026'}] } }) }));
  });
  it('reports an idempotent duplicate explicitly and never retries a failed RPC', async () => {
    mocks.rpc.mockResolvedValueOnce({ data:{ status:'prepared_offline',duplicate:true },error:null });
    expect(await attemptEinvoiceAction(ID)).toMatchObject({ ok:true,duplicate:true });
    mocks.rpc.mockResolvedValueOnce({ data:null,error:{ code:'23514' } });
    expect(await attemptEinvoiceAction(ID)).toMatchObject({ ok:false,error:expect.stringMatching(/hold is unchanged/) });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
