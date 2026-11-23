import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { encodeEscPosReceipt } from './escpos.mjs';
import { createPrintBridgeServer } from './server.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'autodine-bridge-test-'));
}

describe('AutoDine Windows Print Bridge', () => {
  it('encodes 58mm and 80mm ESC/POS buffers with duplicate banner, GST, IRN, and GS(k) QR code', () => {
    const buf = encodeEscPosReceipt({
      invoiceId: 'inv-1',
      invoiceNumber: 'INV/26-27/000042',
      widthMm: 58,
      isDuplicate: true,
      copyNumber: 2,
      documentType: 'gst_tax_invoice',
      sellerName: 'Billing V2 Bistro',
      sellerAddress: '10 MG Road, Nagpur',
      gstin: '27ABCDE1234F1Z5',
      fssaiNumber: '11524001000123',
      issuedAt: '21 Nov 2026, 8:42 pm',
      tableLabel: 'T1',
      irn: 'a'.repeat(64),
      ackNo: '1234567890',
      signedQrPayload: 'eyJTZWxsZXJHc3RpbiI6IjI3QUJDREUxMjM0RjFaNSJ9',
      lines: [{ qty: 2, name: 'Paneer Tikka', variant: 'Half', addons: ['Mint'], amountPaise: 52000 }],
      totals: {
        subtotalPaise: 52000,
        discountPaise: 5200,
        serviceChargePaise: 2340,
        packagingChargePaise: 0,
        deliveryChargePaise: 0,
        roundOffPaise: -40,
        taxPaise: 2340,
        totalPaise: 49100,
      },
    });
    const text = buf.toString('latin1');
    assert.ok(text.includes('DUPLICATE COPY #2'));
    assert.ok(text.includes('GSTIN: 27ABCDE1234F1Z5'));
    assert.ok(text.includes('FSSAI: 11524001000123'));
    assert.ok(text.includes('TOTAL PAYABLE'));
    assert.ok(text.includes('eyJTZWxsZXJHc3RpbiI6IjI3QUJDREUxMjM0RjFaNSJ9'));
    // ESC @ init + GS V cut bytes present
    assert.equal(buf[0], 0x1b);
    assert.equal(buf[1], 0x40);
  });

  it('enforces origin allowlist, PNA preflight, pairing token auth, idempotency, and retry queue', async () => {
    const tmpDir = makeTmpDir();
    let dispatchCount = 0;
    let failFirst = true;
    const printedBuffers = [];

    const { server, pairingToken } = createPrintBridgeServer({
      configDir: tmpDir,
      discoverPrinters: async () => [
        { id: 'win:Epson TM-T82', name: 'Epson TM-T82', connectionType: 'usb', status: 'connected', paperWidths: ['80mm'] },
      ],
      dispatchTransport: async (_target, bytes) => {
        dispatchCount += 1;
        if (failFirst) {
          failFirst = false;
          throw new Error('Printer busy waking up');
        }
        printedBuffers.push(bytes);
      },
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 1. PNA preflight from allowed origin
      const pna = await fetch(`${base}/print`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://autodine-preview.vercel.app',
          'Access-Control-Request-Private-Network': 'true',
        },
      });
      assert.equal(pna.status, 204);
      assert.equal(pna.headers.get('access-control-allow-private-network'), 'true');
      assert.equal(pna.headers.get('access-control-allow-origin'), 'https://autodine-preview.vercel.app');

      // 2. Malicious origin rejected with 403
      const badOrigin = await fetch(`${base}/health`, {
        headers: { Origin: 'https://evil-site.example' },
      });
      assert.equal(badOrigin.status, 403);

      // 3. Unauthenticated /printers rejected with 401
      const noToken = await fetch(`${base}/printers`, {
        headers: { Origin: 'https://autodine-preview.vercel.app' },
      });
      assert.equal(noToken.status, 401);

      // 4. Authenticated /printers discovers USB printer
      const printers = await fetch(`${base}/printers`, {
        headers: {
          Origin: 'https://autodine-preview.vercel.app',
          'x-autodine-bridge-token': pairingToken,
        },
      });
      assert.equal(printers.status, 200);
      const pJson = await printers.json();
      assert.equal(pJson.printers[0].name, 'Epson TM-T82');

      // 5. Print job queues (202), auto-retries transient failure, completes, and deduplicates same Idempotency-Key
      const body = JSON.stringify({
        invoiceId: 'inv-123',
        invoiceNumber: 'INV/26-27/000101',
        widthMm: 80,
        copyNumber: 1,
        sellerName: 'Test Kitchen',
        lines: [{ qty: 1, name: 'Dosa', amountPaise: 12000 }],
        totals: { subtotalPaise: 12000, taxPaise: 0, totalPaise: 12000 },
      });
      const r1 = await fetch(`${base}/print`, {
        method: 'POST',
        headers: {
          Origin: 'https://autodine-preview.vercel.app',
          'content-type': 'application/json',
          'x-autodine-bridge-token': pairingToken,
          'idempotency-key': 'inv-123:copy-1',
        },
        body,
      });
      assert.equal(r1.status, 202);
      const j1 = await r1.json();

      // Duplicate submission returns same job without double printing
      const rDup = await fetch(`${base}/print`, {
        method: 'POST',
        headers: {
          Origin: 'https://autodine-preview.vercel.app',
          'content-type': 'application/json',
          'x-autodine-bridge-token': pairingToken,
          'idempotency-key': 'inv-123:copy-1',
        },
        body,
      });
      const jDup = await rDup.json();
      assert.equal(jDup.jobId, j1.jobId);
      assert.equal(jDup.deduplicated, true);

      // Wait for retry & completion
      let status = 'queued';
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        const jr = await fetch(`${base}/jobs/${j1.jobId}`, {
          headers: { 'x-autodine-bridge-token': pairingToken },
        });
        const jj = await jr.json();
        status = jj.status;
        if (status === 'completed' || status === 'failed') break;
      }
      assert.equal(status, 'completed');
      assert.equal(dispatchCount, 2); // 1 failed + 1 retry succeeded
      assert.equal(printedBuffers.length, 1);
    } finally {
      server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
