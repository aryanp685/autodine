import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkPrintBridgeStatus,
  sendBridgeTestPrint,
  sendToLocalPrintBridge,
  validatePrintBridgeUrl,
  type PrintBridgeJob,
} from './print-bridge';

const JOB: PrintBridgeJob = {
  invoiceId: '00000000-0000-4000-8000-000000000001',
  invoiceNumber: 'INV/26-27/000042',
  widthMm: 80,
  isDuplicate: false,
  copyNumber: 1,
  sellerName: 'Billing V2 Bistro',
  sellerAddress: '10 MG Road, Nagpur',
  issuedAt: '21 Nov 2026, 8:42 pm',
  tableLabel: 'T1',
  lines: [{ qty: 1, name: 'Paneer Tikka', variant: null, addons: [], amountPaise: 26000 }],
  totals: {
    subtotalPaise: 26000,
    discountPaise: 0,
    serviceChargePaise: 0,
    packagingChargePaise: 0,
    deliveryChargePaise: 0,
    roundOffPaise: 0,
    taxPaise: 1238,
    totalPaise: 26000,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('validatePrintBridgeUrl — browser Mixed Content & PNA guard', () => {
  it('allows http loopback (127.0.0.1 and localhost) and https origins', () => {
    expect(validatePrintBridgeUrl('http://127.0.0.1:19800/')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:19800',
    });
    expect(validatePrintBridgeUrl('http://localhost:19800')).toEqual({
      ok: true,
      url: 'http://localhost:19800',
    });
    expect(validatePrintBridgeUrl('https://counter-pc.local:19800')).toEqual({
      ok: true,
      url: 'https://counter-pc.local:19800',
    });
  });

  it('rejects plain http LAN IP addresses so browsers never silently hit Mixed Content', () => {
    const lan = validatePrintBridgeUrl('http://192.168.1.45:19800');
    expect(lan.ok).toBe(false);
    if (!lan.ok) expect(lan.error).toMatch(/Mixed Content/i);
  });
});

describe('sendToLocalPrintBridge — auth, idempotency, and 202 async queue', () => {
  it('sends pairing token + Idempotency-Key and polls 202 job to completion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, jobId: 'job-99', status: 'queued' }), { status: 202 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'job-99', status: 'completed' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const res = await sendToLocalPrintBridge(JOB, {
      endpoint: 'http://127.0.0.1:19800',
      token: 'pair-secret-123',
      pollTimeoutMs: 2000,
    });

    expect(res).toEqual({
      ok: true,
      jobId: 'job-99',
      message: 'Printed 80mm bill (INV/26-27/000042) via AutoDine Print Bridge.',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:19800/print');
    expect(init.headers['x-autodine-bridge-token']).toBe('pair-secret-123');
    expect(init.headers['idempotency-key']).toBe('00000000-0000-4000-8000-000000000001:copy-1');
  });

  it('surfaces 401 pairing error clearly without masking it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 })));
    const res = await sendToLocalPrintBridge(JOB, { endpoint: 'http://127.0.0.1:19800' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/pairing token/i);
  });

  it('checks bridge status + discovers printers and sends test print', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, version: '1.0.0', platform: 'win32' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            printers: [
              { id: 'usb-epson', name: 'Epson TM-T82', connectionType: 'usb', status: 'connected', paperWidths: ['80mm'] },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const status = await checkPrintBridgeStatus('http://127.0.0.1:19800', 'tok');
    expect(status.ok).toBe(true);
    if (status.ok) expect(status.printers).toHaveLength(1);

    const testRes = await sendBridgeTestPrint({
      endpoint: 'http://127.0.0.1:19800',
      token: 'tok',
      paperWidth: '80mm',
    });
    expect(testRes.ok).toBe(true);
  });
});
