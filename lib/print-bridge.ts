/**
 * Optional local ESC/POS thermal Print Bridge client.
 *
 * Customer bills (58mm / 80mm) only — KOT printing is permanently removed.
 * Fails closed and informs the cashier when no bridge endpoint is configured
 * or reachable.
 */

export const PRINT_BRIDGE_STORAGE_KEY = 'autodine_print_bridge_url';

export type PrintBridgeJob = {
  invoiceId: string;
  invoiceNumber: string;
  widthMm: 58 | 80;
  isDuplicate: boolean;
  copyNumber: number;
  sellerName: string;
  sellerAddress: string;
  gstin?: string | null;
  fssaiNumber?: string | null;
  issuedAt: string;
  tableLabel: string | null;
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

export type PrintBridgeResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export function getConfiguredPrintBridgeUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = window.localStorage.getItem(PRINT_BRIDGE_STORAGE_KEY)?.trim() ?? '';
    if (!val) return null;
    const parsed = new URL(val);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function sendToLocalPrintBridge(
  job: PrintBridgeJob,
  endpoint?: string | null,
): Promise<PrintBridgeResult> {
  const target = endpoint?.trim() || getConfiguredPrintBridgeUrl();
  if (!target) {
    return {
      ok: false,
      error:
        'No Print Bridge endpoint configured. Enter your ESC/POS bridge URL or use Print / Save PDF with 58 mm / 80 mm layout.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(job),
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `Print bridge returned HTTP ${res.status}. Use Print / Save PDF for browser thermal printing.`,
      };
    }
    return {
      ok: true,
      message: `Sent ${job.widthMm}mm ESC/POS job (${job.invoiceNumber}) to Print Bridge.`,
    };
  } catch {
    return {
      ok: false,
      error: 'Could not reach the configured Print Bridge. Use Print / Save PDF with 58 mm or 80 mm layout instead.',
    };
  } finally {
    clearTimeout(timer);
  }
}
