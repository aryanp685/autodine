export type OperatingMode = 'mode_a' | 'mode_b';

export type KotHandoffStatus = 'pending' | 'entered_in_pos' | 'webhook_sent' | 'webhook_failed';

export const DEFAULT_OPERATING_MODE: OperatingMode = 'mode_b';

export const MAX_POS_INTEGRATION_NAME_LENGTH = 60;
export const MAX_WEBHOOK_SECRET_LENGTH = 120;

export const POS_INTEGRATION_PRESETS = [
  'Petpooja',
  'Posist',
  'Rista',
  'UrbanPiper',
  'SlickPOS',
  'Tally / Existing Billing',
] as const;

export const OPERATING_MODE_META: Record<
  OperatingMode,
  {
    code: string;
    title: string;
    shortLabel: string;
    summary: string;
    bestFor: string;
    capabilities: readonly string[];
  }
> = {
  mode_a: {
    code: 'Mode A',
    title: 'Alongside an existing POS',
    shortLabel: 'Mode A · Alongside POS',
    summary:
      'Keep your existing billing software. AutoDine handles QR table ordering, kitchen display (KDS), and defined KOT handoff so nothing is punched twice.',
    bestFor: 'Recommended entry strategy: try QR ordering & kitchen workflow without replacing your current POS.',
    capabilities: [
      'Guest QR menu & table ordering',
      'Live Kitchen Display System (KDS) & audio pass',
      'Defined KOT handoff (copy slip, mark entered in POS, CSV export, or HTTPS webhook)',
      'Existing POS remains the system of record for billing, GST & settlement',
    ],
  },
  mode_b: {
    code: 'Mode B',
    title: 'Primary operating system',
    shortLabel: 'Mode B · Full Restaurant OS',
    summary:
      'Run the full restaurant on AutoDine: QR ordering, staff and counter POS, kitchen display, GST billing & e-Invoicing, payment reconciliation, and owner reports.',
    bestFor: 'All-in-one operations when AutoDine is your primary POS and billing ledger.',
    capabilities: [
      'Guest QR ordering + waiter & counter POS',
      'Live Kitchen Display System (KDS)',
      'GST tax invoices, B2B e-Invoice IRN/QR, split bills & thermal printing',
      'Payment reconciliation, refunds & owner financial reports',
    ],
  },
};

export function normalizeOperatingMode(raw: unknown): OperatingMode {
  return raw === 'mode_a' ? 'mode_a' : 'mode_b';
}

export function normalizeKotHandoffStatus(raw: unknown): KotHandoffStatus {
  if (raw === 'entered_in_pos' || raw === 'webhook_sent' || raw === 'webhook_failed') {
    return raw;
  }
  return 'pending';
}

export function isModeA(mode: OperatingMode | null | undefined): boolean {
  return mode === 'mode_a';
}

export function kotHandoffLabel(status: KotHandoffStatus): string {
  switch (status) {
    case 'entered_in_pos':
      return 'Entered in POS';
    case 'webhook_sent':
      return 'Synced via webhook';
    case 'webhook_failed':
      return 'Webhook failed';
    default:
      return 'Awaiting POS entry';
  }
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  const match172 = /^172\.(\d+)\./.exec(host);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe80:/i.test(host)) return true;
  return false;
}

export type OperatingModeInputValidation =
  | {
      ok: true;
      value: {
        operatingMode: OperatingMode;
        posIntegrationName: string | null;
        webhookUrl: string | null;
        webhookSecret: string | null;
      };
    }
  | { ok: false; message: string };

export function validateOperatingModeInput(raw: {
  operatingMode?: unknown;
  posIntegrationName?: unknown;
  webhookUrl?: unknown;
  webhookSecret?: unknown;
}): OperatingModeInputValidation {
  const modeRaw = typeof raw.operatingMode === 'string' ? raw.operatingMode.trim().toLowerCase() : '';
  if (modeRaw !== 'mode_a' && modeRaw !== 'mode_b') {
    return { ok: false, message: 'Choose either Mode A (alongside POS) or Mode B (primary OS).' };
  }

  const posNameClean =
    typeof raw.posIntegrationName === 'string'
      ? raw.posIntegrationName.replace(/\s+/g, ' ').trim()
      : '';
  if (posNameClean.length > MAX_POS_INTEGRATION_NAME_LENGTH) {
    return {
      ok: false,
      message: `Existing POS name must be ${MAX_POS_INTEGRATION_NAME_LENGTH} characters or fewer.`,
    };
  }

  const webhookClean = typeof raw.webhookUrl === 'string' ? raw.webhookUrl.trim() : '';
  let validatedWebhook: string | null = null;
  if (webhookClean.length > 0) {
    let parsed: URL;
    try {
      parsed = new URL(webhookClean);
    } catch {
      return { ok: false, message: 'Enter a valid https:// webhook URL.' };
    }
    if (parsed.protocol !== 'https:') {
      return { ok: false, message: 'KOT handoff webhook URL must use https://.' };
    }
    if (isPrivateOrLoopbackHost(parsed.hostname)) {
      return {
        ok: false,
        message: 'KOT handoff webhook URL cannot target localhost or a private network address.',
      };
    }
    validatedWebhook = parsed.toString();
  }

  const secretClean = typeof raw.webhookSecret === 'string' ? raw.webhookSecret.trim() : '';
  if (secretClean.length > MAX_WEBHOOK_SECRET_LENGTH) {
    return {
      ok: false,
      message: `Webhook signing secret must be ${MAX_WEBHOOK_SECRET_LENGTH} characters or fewer.`,
    };
  }

  return {
    ok: true,
    value: {
      operatingMode: modeRaw,
      posIntegrationName: posNameClean || null,
      webhookUrl: validatedWebhook,
      webhookSecret: validatedWebhook ? secretClean || null : null,
    },
  };
}

export function formatKotHandoffSlip(
  ticket: {
    code: string;
    table: string;
    placedAt: string;
    note?: string;
    items: Array<{
      qty: number;
      name: string;
      portion?: string;
      addons?: string[];
      detail?: string;
    }>;
  },
  posName?: string | null,
): string {
  const header = posName ? `AUTODINE KOT HANDOFF -> ${posName.toUpperCase()}` : 'AUTODINE KOT HANDOFF';
  const lines = [
    header,
    `Ticket: ${ticket.code} | Table: ${ticket.table} | Time: ${ticket.placedAt}`,
    '----------------------------------------',
    ...ticket.items.map((item) => {
      const modifiers =
        item.portion || (item.addons && item.addons.length > 0)
          ? [item.portion, ...(item.addons ?? [])].filter(Boolean).join(', ')
          : item.detail;
      return modifiers
        ? `${item.qty} x ${item.name} (${modifiers})`
        : `${item.qty} x ${item.name}`;
    }),
  ];

  if (ticket.note) {
    lines.push(`Kitchen note: ${ticket.note}`);
  }
  lines.push('----------------------------------------');
  lines.push('Billing only in POS — kitchen already received via AutoDine KDS');
  return lines.join('\n');
}
