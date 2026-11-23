/**
 * Optional local ESC/POS & OS-Spooler Print Bridge client.
 *
 * Customer bills (58mm / 80mm / A4) only — KOT printing is permanently removed.
 *
 * Browser security & networking rules enforced here:
 *  - Loopback URLs (`http://127.0.0.1:<port>`, `http://localhost:<port>`, or `https://...`)
 *    are permitted by Content-Security-Policy (`connect-src`) and W3C Mixed Content.
 *  - Non-loopback plain `http://` LAN URLs (e.g. `http://192.168.1.50:19800`) are
 *    rejected proactively with clear guidance because modern HTTPS browsers block
 *    HTTPS → HTTP LAN Mixed Content / Private Network Access requests.
 *  - Requests carry a local Pairing Token (`X-AutoDine-Bridge-Token`) and an
 *    `Idempotency-Key` so malicious sites cannot hijack the printer and network
 *    retries never print duplicate customer bills.
 *  - Queue handoff uses a 5s timeout (`202 Accepted` async queue) followed by up
 *    to 12s status polling on `/jobs/:id` to tolerate slow USB/LAN printer wakeups.
 */

import type { ReceiptData } from '@/lib/db/invoice';

export const PRINT_BRIDGE_STORAGE_KEY = 'autodine_print_bridge_url';
export const PRINT_BRIDGE_TOKEN_STORAGE_KEY = 'autodine_print_bridge_token';
export const PRINT_BRIDGE_PRINTER_STORAGE_KEY = 'autodine_print_bridge_printer_id';

export const DEFAULT_LOCAL_BRIDGE_URL = 'http://127.0.0.1:19800';
export const DEFAULT_BRIDGE_URL = DEFAULT_LOCAL_BRIDGE_URL;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export type PrintBridgePrinterTarget = {
  printerId?: string | null;
  printerName?: string | null;
  connectionType?: 'windows_bridge' | 'network_tcp' | 'browser_os';
  bridgePrinterName?: string | null;
  networkHost?: string | null;
  networkPort?: number | null;
};

export type PrintBridgeJob = {
  invoiceId: string;
  invoiceNumber: string;
  widthMm: 58 | 80;
  paperFormat?: '58mm' | '80mm' | 'a4';
  isDuplicate: boolean;
  copyNumber: number;
  idempotencyKey?: string;
  documentType?: 'receipt' | 'gst_tax_invoice' | 'bill_of_supply';
  sellerName: string;
  sellerAddress: string;
  gstin?: string | null;
  fssaiNumber?: string | null;
  issuedAt: string;
  tableLabel: string | null;
  irn?: string | null;
  ackNo?: string | null;
  ackDate?: string | null;
  signedQrPayload?: string | null;
  printerTarget?: PrintBridgePrinterTarget;
  lines: Array<{
    qty: number;
    name: string;
    variant: string | null;
    addons: string[];
    amountPaise: number;
  }>;
  totals: {
    subtotalPaise: number;
    discountPaise: number;
    serviceChargePaise: number;
    packagingChargePaise: number;
    deliveryChargePaise: number;
    roundOffPaise: number;
    taxPaise: number;
    totalPaise: number;
  };
  footerNote?: string | null;
};

export type DiscoveredBridgePrinter = {
  id: string;
  name: string;
  connectionType: 'usb' | 'lan' | 'windows_spooler';
  status: 'connected' | 'offline' | 'unknown';
  paperWidths: Array<'58mm' | '80mm' | 'a4'>;
  isDefault?: boolean;
  host?: string | null;
  port?: number | null;
};

export type PrintBridgeStatusResult =
  | {
      ok: true;
      baseUrl: string;
      version: string;
      platform: string;
      printers: DiscoveredBridgePrinter[];
    }
  | { ok: false; error: string };

export type PrintBridgeResult =
  | { ok: true; message: string; jobId?: string }
  | { ok: false; error: string };

export type PrintBridgeCallOptions = {
  endpoint?: string | null;
  token?: string | null;
  handoffTimeoutMs?: number;
  pollTimeoutMs?: number;
};

export function validatePrintBridgeUrl(
  rawUrl: string | null | undefined,
): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = String(rawUrl ?? '').trim();
  if (!trimmed) {
    return {
      ok: false,
      error:
        'No Print Bridge URL configured. Use http://127.0.0.1:19800 on the billing PC or use Print / Save PDF.',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Print Bridge URL is invalid. Example: http://127.0.0.1:19800' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Print Bridge URL must start with http:// or https://.' };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(hostname)) {
    return {
      ok: false,
      error:
        'Plain http:// LAN addresses are blocked by HTTPS browser Mixed Content and Private Network Access rules. Run AutoDine Print Bridge on this billing PC at http://127.0.0.1:19800 (which bridges to USB or LAN printers), or serve the bridge over trusted HTTPS.',
    };
  }
  return { ok: true, url: parsed.toString().replace(/\/+$/, '') };
}

export function getConfiguredPrintBridgeUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = window.localStorage.getItem(PRINT_BRIDGE_STORAGE_KEY)?.trim() ?? '';
    if (!val) return null;
    const checked = validatePrintBridgeUrl(val);
    return checked.ok ? checked.url : null;
  } catch {
    return null;
  }
}

export function getConfiguredPrintBridgeToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = window.localStorage.getItem(PRINT_BRIDGE_TOKEN_STORAGE_KEY)?.trim() ?? '';
    return val || null;
  } catch {
    return null;
  }
}

export function getConfiguredBridgePrinterId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = window.localStorage.getItem(PRINT_BRIDGE_PRINTER_STORAGE_KEY)?.trim() ?? '';
    return val || null;
  } catch {
    return null;
  }
}

export function readLocalBridgeConfig(): {
  url: string | null;
  token: string | null;
  preferredPrinterName: string | null;
} {
  return {
    url: getConfiguredPrintBridgeUrl(),
    token: getConfiguredPrintBridgeToken(),
    preferredPrinterName: getConfiguredBridgePrinterId(),
  };
}

export function writeLocalBridgeConfig(cfg: {
  url?: string | null;
  token?: string | null;
  preferredPrinterName?: string | null;
}): void {
  saveLocalBridgeSettings({
    url: cfg.url,
    token: cfg.token,
    printerId: cfg.preferredPrinterName,
  });
}

export function buildThermalPrintJob(
  invoice: ReceiptData,
  options?: {
    widthMm?: 58 | 80;
    paperFormat?: '58mm' | '80mm' | 'a4';
    copyNumber?: number;
    printerTarget?: PrintBridgePrinterTarget;
  },
): PrintBridgeJob {
  const copyNumber = Math.max(1, options?.copyNumber ?? 1);
  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    widthMm: options?.widthMm ?? 80,
    paperFormat: options?.paperFormat ?? (options?.widthMm === 58 ? '58mm' : '80mm'),
    isDuplicate: copyNumber > 1,
    copyNumber,
    idempotencyKey: `${invoice.id}:copy-${copyNumber}`,
    documentType: invoice.documentType,
    sellerName: invoice.seller.name,
    sellerAddress: invoice.seller.address,
    gstin: invoice.seller.gstin,
    fssaiNumber: invoice.seller.fssaiNumber,
    issuedAt: invoice.issuedAt,
    tableLabel: invoice.tableLabel,
    irn: invoice.irn,
    ackNo: invoice.ackNo,
    ackDate: invoice.ackDate,
    signedQrPayload: invoice.signedQrPayload,
    printerTarget: options?.printerTarget,
    lines: invoice.lines.map((l) => ({
      qty: l.quantity,
      name: l.itemName,
      variant: l.variant,
      addons: l.addons,
      amountPaise: l.amountPaise,
    })),
    totals: {
      subtotalPaise: invoice.totals.subtotalPaise,
      discountPaise: invoice.totals.ticketDiscountPaise + invoice.totals.billDiscountPaise,
      serviceChargePaise: invoice.totals.serviceChargePaise ?? 0,
      packagingChargePaise: invoice.totals.packagingChargePaise ?? 0,
      deliveryChargePaise: invoice.totals.deliveryChargePaise ?? 0,
      roundOffPaise: invoice.totals.roundOffPaise ?? 0,
      taxPaise: invoice.totals.taxPaise,
      totalPaise: invoice.totals.totalPaise,
    },
    footerNote: invoice.seller.billFooterNote,
  };
}

export function saveLocalBridgeSettings(settings: {
  url?: string | null;
  token?: string | null;
  printerId?: string | null;
}): void {
  if (typeof window === 'undefined') return;
  try {
    if (settings.url !== undefined) {
      const clean = (settings.url ?? '').trim();
      if (clean) window.localStorage.setItem(PRINT_BRIDGE_STORAGE_KEY, clean);
      else window.localStorage.removeItem(PRINT_BRIDGE_STORAGE_KEY);
    }
    if (settings.token !== undefined) {
      const clean = (settings.token ?? '').trim();
      if (clean) window.localStorage.setItem(PRINT_BRIDGE_TOKEN_STORAGE_KEY, clean);
      else window.localStorage.removeItem(PRINT_BRIDGE_TOKEN_STORAGE_KEY);
    }
    if (settings.printerId !== undefined) {
      const clean = (settings.printerId ?? '').trim();
      if (clean) window.localStorage.setItem(PRINT_BRIDGE_PRINTER_STORAGE_KEY, clean);
      else window.localStorage.removeItem(PRINT_BRIDGE_PRINTER_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota / private mode failures.
  }
}

function buildBridgeHeaders(token: string | null | undefined, idempotencyKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const cleanToken = token?.trim();
  if (cleanToken) headers['x-autodine-bridge-token'] = cleanToken;
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  return headers;
}

function endpointPath(baseUrl: string, path: string): string {
  // If user configured a full endpoint ending in /print, normalize to base origin+path prefix.
  const normalized = baseUrl.endsWith('/print') ? baseUrl.slice(0, -'/print'.length) : baseUrl;
  return `${normalized}${path}`;
}

export async function checkPrintBridgeStatus(
  endpoint?: string | null,
  token?: string | null,
): Promise<PrintBridgeStatusResult> {
  const checked = validatePrintBridgeUrl(endpoint?.trim() || getConfiguredPrintBridgeUrl());
  if (!checked.ok) return { ok: false, error: checked.error };
  const resolvedToken = token !== undefined ? token : getConfiguredPrintBridgeToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const healthRes = await fetch(endpointPath(checked.url, '/health'), {
      method: 'GET',
      headers: resolvedToken ? { 'x-autodine-bridge-token': resolvedToken.trim() } : undefined,
      signal: controller.signal,
    });
    if (!healthRes.ok) {
      return { ok: false, error: `Print Bridge health check failed (HTTP ${healthRes.status}).` };
    }
    const healthJson = (await healthRes.json().catch(() => ({}))) as {
      version?: string;
      platform?: string;
    };

    const printersRes = await fetch(endpointPath(checked.url, '/printers'), {
      method: 'GET',
      headers: resolvedToken ? { 'x-autodine-bridge-token': resolvedToken.trim() } : undefined,
      signal: controller.signal,
    });
    if (printersRes.status === 401) {
      return {
        ok: false,
        error: 'Bridge rejected the pairing token (401). Copy the Pairing Token from the Windows Print Bridge tray and paste it here.',
      };
    }
    if (printersRes.status === 403) {
      return {
        ok: false,
        error: 'Bridge rejected this site origin (403). Add this AutoDine URL to the bridge allowlist.',
      };
    }
    const printersJson = printersRes.ok
      ? ((await printersRes.json().catch(() => ({ printers: [] }))) as { printers?: DiscoveredBridgePrinter[] })
      : { printers: [] };

    return {
      ok: true,
      baseUrl: checked.url,
      version: String(healthJson.version ?? '1.0'),
      platform: String(healthJson.platform ?? 'unknown'),
      printers: Array.isArray(printersJson.printers) ? printersJson.printers : [],
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Print Bridge did not respond within 3 seconds. Verify it is running on this PC.' };
    }
    return {
      ok: false,
      error:
        'Could not reach AutoDine Print Bridge (check it is installed/started on http://127.0.0.1:19800, or use Print / Save PDF).',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendBridgeTestPrint(input: {
  endpoint?: string | null;
  token?: string | null;
  printerTarget?: PrintBridgePrinterTarget;
  paperWidth?: '58mm' | '80mm' | 'a4';
  restaurantName?: string;
}): Promise<PrintBridgeResult> {
  const checked = validatePrintBridgeUrl(input.endpoint?.trim() || getConfiguredPrintBridgeUrl());
  if (!checked.ok) return { ok: false, error: checked.error };
  const resolvedToken = input.token !== undefined ? input.token : getConfiguredPrintBridgeToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(endpointPath(checked.url, '/test-print'), {
      method: 'POST',
      headers: buildBridgeHeaders(resolvedToken),
      body: JSON.stringify({
        paperWidth: input.paperWidth ?? '80mm',
        restaurantName: input.restaurantName ?? 'AutoDine',
        printerTarget: input.printerTarget ?? null,
      }),
      signal: controller.signal,
    });
    if (res.status === 401) {
      return { ok: false, error: 'Pairing token rejected (401). Check your Print Bridge pairing token.' };
    }
    if (res.status === 403) {
      return { ok: false, error: 'Bridge blocked this origin (403).' };
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error || `Test print failed (HTTP ${res.status}).` };
    }
    return { ok: true, message: 'Test print sent to printer.' };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Test print timed out after 5s waiting for the Print Bridge.' };
    }
    return { ok: false, error: 'Could not reach AutoDine Print Bridge for test print.' };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendToLocalPrintBridge(
  job: PrintBridgeJob,
  endpointOrOptions?: string | null | PrintBridgeCallOptions,
): Promise<PrintBridgeResult> {
  const options: PrintBridgeCallOptions =
    typeof endpointOrOptions === 'string' || endpointOrOptions == null
      ? { endpoint: endpointOrOptions }
      : endpointOrOptions;

  const checked = validatePrintBridgeUrl(options.endpoint?.trim() || getConfiguredPrintBridgeUrl());
  if (!checked.ok) return { ok: false, error: checked.error };

  const token = options.token !== undefined ? options.token : getConfiguredPrintBridgeToken();
  const idempotencyKey = job.idempotencyKey || `${job.invoiceId}:copy-${Math.max(1, job.copyNumber)}`;
  const handoffTimeoutMs = options.handoffTimeoutMs ?? 5000;
  const pollTimeoutMs = options.pollTimeoutMs ?? 12000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), handoffTimeoutMs);
  try {
    const res = await fetch(endpointPath(checked.url, '/print'), {
      method: 'POST',
      headers: buildBridgeHeaders(token, idempotencyKey),
      body: JSON.stringify({ ...job, idempotencyKey }),
      signal: controller.signal,
    });
    if (res.status === 401) {
      return {
        ok: false,
        error: 'Print Bridge rejected the pairing token (401). Pair this terminal under Settings → Printing & Devices.',
      };
    }
    if (res.status === 403) {
      return {
        ok: false,
        error: 'Print Bridge rejected this website origin (403). Check allowed origins in bridge config.',
      };
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        error:
          body.error ||
          `Print bridge returned HTTP ${res.status}. Use Print / Save PDF for browser thermal printing.`,
      };
    }

    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      jobId?: string;
      status?: string;
      error?: string;
    };

    if (res.status === 202 && body.jobId) {
      const deadline = Date.now() + pollTimeoutMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const pollRes = await fetch(endpointPath(checked.url, `/jobs/${encodeURIComponent(body.jobId)}`), {
          method: 'GET',
          headers: token ? { 'x-autodine-bridge-token': token.trim() } : undefined,
        }).catch(() => null);
        if (!pollRes || !pollRes.ok) continue;
        const jobState = (await pollRes.json().catch(() => ({}))) as {
          status?: string;
          error?: string | null;
        };
        if (jobState.status === 'completed') {
          return {
            ok: true,
            jobId: body.jobId,
            message: `Printed ${job.widthMm}mm bill (${job.invoiceNumber}) via AutoDine Print Bridge.`,
          };
        }
        if (jobState.status === 'failed') {
          return {
            ok: false,
            error:
              jobState.error ||
              'Printer failed after queue handoff. Check paper/power and retry printing — the invoice was saved.',
          };
        }
      }
      return {
        ok: true,
        jobId: body.jobId,
        message: `Queued ${job.widthMm}mm job (${job.invoiceNumber}) on Print Bridge — printer is still waking up.`,
      };
    }

    return {
      ok: true,
      jobId: body.jobId,
      message: `Sent ${job.widthMm}mm ESC/POS job (${job.invoiceNumber}) to Print Bridge.`,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        ok: false,
        error:
          'Print Bridge did not acknowledge within 5 seconds. Check that the bridge service is running, or use Print / Save PDF.',
      };
    }
    return {
      ok: false,
      error:
        'Could not reach the configured Print Bridge. Use Print / Save PDF with 58 mm or 80 mm layout instead.',
    };
  } finally {
    clearTimeout(timer);
  }
}
