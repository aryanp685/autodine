/**
 * Pure ESC/POS binary encoder for AutoDine PrintBridgeJob payloads.
 * Supports 58mm (32 cols) and 80mm (48 cols), duplicate banners,
 * GST summary fields, IRN text, and native ESC/POS QR code (`GS ( k`).
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function formatInr(paise) {
  const num = Number(paise ?? 0) / 100;
  return `Rs.${num.toFixed(2)}`;
}

function padRow(left, right, width) {
  const l = String(left ?? '');
  const r = String(right ?? '');
  if (l.length + r.length + 1 <= width) {
    return l + ' '.repeat(width - l.length - r.length) + r;
  }
  const maxLeft = Math.max(4, width - r.length - 1);
  return `${l.slice(0, maxLeft)} ${r}`;
}

function encodeQrCommands(data) {
  const payload = Buffer.from(String(data ?? ''), 'utf8');
  if (!payload.length) return Buffer.alloc(0);
  const storeLen = payload.length + 3;
  const pL = storeLen & 0xff;
  const pH = (storeLen >> 8) & 0xff;
  return Buffer.concat([
    // Center align
    Buffer.from([ESC, 0x61, 0x01]),
    // Model 2
    Buffer.from([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    // Module size 4
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x04]),
    // Error correction level M (49)
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
    // Store data
    Buffer.from([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
    payload,
    // Print QR
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
    Buffer.from([LF]),
    // Left align
    Buffer.from([ESC, 0x61, 0x00]),
  ]);
}

export function encodeEscPosReceipt(job) {
  const cols = job?.widthMm === 58 ? 32 : 48;
  const sep = '-'.repeat(cols);
  const chunks = [];

  const text = (str) => chunks.push(Buffer.from(`${str}\n`, 'ascii'));
  const raw = (bytes) => chunks.push(Buffer.from(bytes));

  // Initialize printer
  raw([ESC, 0x40]);

  if (job.isDuplicate) {
    raw([ESC, 0x61, 0x01, ESC, 0x45, 0x01]);
    text(`*** DUPLICATE COPY #${Math.max(2, Number(job.copyNumber ?? 2))} ***`);
    raw([ESC, 0x45, 0x00, ESC, 0x61, 0x00]);
    text(sep);
  }

  // Header
  raw([ESC, 0x61, 0x01, ESC, 0x45, 0x01]);
  text(String(job.sellerName ?? 'AutoDine').slice(0, cols));
  raw([ESC, 0x45, 0x00]);
  if (job.sellerAddress) {
    for (const line of String(job.sellerAddress).split(/\r?\n/)) {
      if (line.trim()) text(line.trim().slice(0, cols));
    }
  }
  if (job.gstin) text(`GSTIN: ${job.gstin}`);
  if (job.fssaiNumber) text(`FSSAI: ${job.fssaiNumber}`);
  const docLabel =
    job.documentType === 'gst_tax_invoice'
      ? 'TAX INVOICE'
      : job.documentType === 'bill_of_supply'
        ? 'BILL OF SUPPLY'
        : 'CUSTOMER RECEIPT';
  raw([ESC, 0x45, 0x01]);
  text(docLabel);
  raw([ESC, 0x45, 0x00, ESC, 0x61, 0x00]);
  text(sep);

  text(padRow(`No: ${job.invoiceNumber}`, job.tableLabel ? `Tbl ${job.tableLabel}` : '', cols));
  if (job.issuedAt) text(String(job.issuedAt).slice(0, cols));
  text(sep);

  // Items
  for (const line of job.lines ?? []) {
    const qtyName = `${line.qty}x ${line.name}`;
    text(padRow(qtyName, formatInr(line.amountPaise), cols));
    const meta = [line.variant, ...(line.addons ?? [])].filter(Boolean).join(', ');
    if (meta) text(`  ${meta}`.slice(0, cols));
  }
  text(sep);

  const totals = job.totals ?? {};
  text(padRow('Items total', formatInr(totals.subtotalPaise), cols));
  if ((totals.discountPaise ?? 0) > 0) {
    text(padRow('Discount', `-${formatInr(totals.discountPaise)}`, cols));
  }
  if ((totals.serviceChargePaise ?? 0) > 0) {
    text(padRow('Service charge', formatInr(totals.serviceChargePaise), cols));
  }
  if ((totals.packagingChargePaise ?? 0) > 0) {
    text(padRow('Packaging', formatInr(totals.packagingChargePaise), cols));
  }
  if ((totals.deliveryChargePaise ?? 0) > 0) {
    text(padRow('Delivery', formatInr(totals.deliveryChargePaise), cols));
  }
  if ((totals.taxPaise ?? 0) > 0) {
    text(padRow('Total GST', formatInr(totals.taxPaise), cols));
  }
  if ((totals.roundOffPaise ?? 0) !== 0) {
    const ro = Number(totals.roundOffPaise);
    text(padRow('Round-off', `${ro > 0 ? '+' : '-'}${formatInr(Math.abs(ro))}`, cols));
  }
  text(sep);
  raw([ESC, 0x45, 0x01]);
  text(padRow('TOTAL PAYABLE', formatInr(totals.totalPaise), cols));
  raw([ESC, 0x45, 0x00]);
  text(sep);

  if (job.irn) {
    text(`IRN: ${job.irn}`.slice(0, cols));
    if (String(job.irn).length > cols) text(String(job.irn).slice(cols, cols * 2));
  }
  if (job.ackNo) text(`Ack No: ${job.ackNo}`);
  if (job.signedQrPayload) {
    chunks.push(encodeQrCommands(job.signedQrPayload));
  }

  raw([ESC, 0x61, 0x01]);
  text(String(job.footerNote || 'Thank you for dining with us!').slice(0, cols));
  raw([ESC, 0x61, 0x00, LF, LF, LF]);

  // Partial cut (GS V 66 0)
  raw([GS, 0x56, 0x42, 0x00]);
  return Buffer.concat(chunks);
}

export function encodeTestSlip(paperWidth = '80mm', restaurantName = 'AutoDine') {
  return encodeEscPosReceipt({
    invoiceId: 'test-print',
    invoiceNumber: 'TEST-001',
    widthMm: paperWidth === '58mm' ? 58 : 80,
    isDuplicate: false,
    copyNumber: 1,
    documentType: 'receipt',
    sellerName: restaurantName,
    sellerAddress: 'AutoDine Print Bridge Test',
    issuedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    tableLabel: 'TEST',
    lines: [{ qty: 1, name: 'Printer Connectivity OK', variant: paperWidth, addons: [], amountPaise: 0 }],
    totals: {
      subtotalPaise: 0,
      discountPaise: 0,
      serviceChargePaise: 0,
      packagingChargePaise: 0,
      deliveryChargePaise: 0,
      roundOffPaise: 0,
      taxPaise: 0,
      totalPaise: 0,
    },
    footerNote: 'Printer ready.',
  });
}
