import { describe, expect, it, vi } from 'vitest';
import { getIrpAdapter } from '@/lib/gst/adapter';
import { NicGspIrpAdapter, toNicEinvoiceV103 } from './nic-gsp';
import type { IrpPayloadV1 } from './types';

const SAMPLE_PAYLOAD: IrpPayloadV1 = {
  schemaVersion: 'autodine.irp.v1',
  documentType: 'INV',
  documentNumber: 'INV/26-27/000042',
  issuedDate: '2026-11-21',
  supplyType: 'B2B',
  posKind: 'B2B',
  recipientType: 'B',
  placeOfSupplyStateCode: '27',
  seller: {
    gstin: '27AAAAA0000A1Z2',
    legalName: 'Billing V2 Bistro LLP',
    tradeName: 'Billing V2 Bistro',
    address1: '10 MG Road, Nagpur',
    address2: null,
    location: 'Nagpur',
    pincode: '440001',
    stateCode: '27',
    email: null,
    phone: '9876543210',
  },
  buyer: {
    gstin: '27BBBBB1111B1Z9',
    legalName: 'Buyer Foods Pvt Ltd',
    address1: 'MIDC Hingna, Nagpur',
    address2: null,
    location: 'Nagpur',
    pincode: '440016',
    stateCode: '27',
    email: 'accounts@buyer.in',
    phone: null,
    placeOfSupplyStateCode: '27',
  },
  lines: [
    {
      itemName: 'Paneer Tikka',
      hsnSac: '996331',
      quantity: 2,
      uom: 'NOS',
      unitPricePaise: 25000,
      grossAmountPaise: 50000,
      discountPaise: 0,
      taxablePaise: 50000,
      cgstPaise: 1250,
      sgstPaise: 1250,
      igstPaise: 0,
      rateBps: 500,
      totalItemValuePaise: 52500,
    },
  ],
  values: {
    taxablePaise: 50000,
    cgstPaise: 1250,
    sgstPaise: 1250,
    igstPaise: 0,
    otherChargesPaise: 0,
    totalPaise: 52500,
  },
  fingerprintSha256: 'b'.repeat(64),
};

describe('NIC / GSP e-Invoice adapter', () => {
  it('fails closed when AUTODINE_IRP_PROVIDER=nic_gsp is missing server credentials', () => {
    const res = getIrpAdapter({
      AUTODINE_IRP_PROVIDER: 'nic_gsp',
      AUTODINE_IRP_BASE_URL: 'https://gsp.example.in',
    } as unknown as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('AUTODINE_IRP_CLIENT_ID');
  });

  it('rejects non-HTTPS AUTODINE_IRP_BASE_URL', () => {
    const res = getIrpAdapter({
      AUTODINE_IRP_PROVIDER: 'nic_gsp',
      AUTODINE_IRP_BASE_URL: 'http://gsp.example.in',
      AUTODINE_IRP_CLIENT_ID: 'cid',
      AUTODINE_IRP_CLIENT_SECRET: 'csec',
      AUTODINE_IRP_USERNAME: 'u',
      AUTODINE_IRP_PASSWORD: 'p',
    } as unknown as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('HTTPS');
  });

  it('maps IrpPayloadV1 to NIC v1.03 JSON with DD/MM/YYYY date and rupee decimals', () => {
    const nic = toNicEinvoiceV103(SAMPLE_PAYLOAD) as {
      DocDtls: { Dt: string; No: string };
      ValDtls: { AssVal: number; CgstVal: number; TotInvVal: number };
    };
    expect(nic.DocDtls.Dt).toBe('21/11/2026');
    expect(nic.DocDtls.No).toBe('INV/26-27/000042');
    expect(nic.ValDtls.AssVal).toBe(500);
    expect(nic.ValDtls.CgstVal).toBe(12.5);
    expect(nic.ValDtls.TotInvVal).toBe(525);
  });

  it('authenticates, generates IRN + SignedQRCode, caches token, and cancels within 24h', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/eivital/v1.04/auth')) {
        return new Response(
          JSON.stringify({
            Status: 1,
            Data: { AuthToken: 'tok-live-1', TokenExpiry: new Date(Date.now() + 3600_000).toISOString() },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/eicore/v1.03/Invoice')) {
        return new Response(
          JSON.stringify({
            Status: 1,
            Data: {
              Irn: 'f'.repeat(64),
              AckNo: 112233445566,
              AckDt: '2026-11-21T12:00:00.000Z',
              SignedQRCode: 'SIGNED-QR-JWT-PAYLOAD',
              SignedInvoice: 'SIGNED-INV-JWS',
            },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/eicore/v1.03/Invoice/Cancel')) {
        return new Response(
          JSON.stringify({
            Status: 1,
            Data: { Irn: 'f'.repeat(64), CancelDate: '2026-11-21T12:30:00.000Z' },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const adapter = new NicGspIrpAdapter({
      baseUrl: 'https://gsp.example.in',
      clientId: 'cid',
      clientSecret: 'csec',
      username: 'u',
      password: 'p',
      sellerGstin: '27AAAAA0000A1Z2',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const gen = await adapter.generateIrn(SAMPLE_PAYLOAD);
    expect(gen.ok).toBe(true);
    if (gen.ok) {
      expect(gen.ack.irn).toBe('f'.repeat(64));
      expect(gen.ack.ackNo).toBe(112233445566);
      expect(gen.ack.signedQrCode).toBe('SIGNED-QR-JWT-PAYLOAD');
    }

    const cancel = await adapter.cancelIrn({
      irn: 'f'.repeat(64),
      reason: '2',
      remark: 'Buyer GSTIN typo',
    });
    expect(cancel.ok).toBe(true);
    // Token was cached across generateIrn -> cancelIrn (only 1 auth call)
    expect(calls.filter((u) => u.endsWith('/auth'))).toHaveLength(1);
  });
});
