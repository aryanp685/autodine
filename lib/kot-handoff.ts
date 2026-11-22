import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/database';
import { kotHandoffLabel, normalizeKotHandoffStatus, type KotHandoffStatus } from './operating-mode';

export type KotHandoffWebhookPayload = {
  event: 'kot.handoff';
  restaurantId: string;
  orderId: string;
  code: string;
  table: string;
  placedAt: string;
  note: string | null;
  items: Array<{
    name: string;
    qty: number;
    detail?: string | null;
  }>;
};

/**
 * Send an optional signed HTTPS KOT handoff payload to the outlet's configured
 * POS integration endpoint. Credentials live in owner/manager-only
 * `restaurant_pos_integrations`; if none is configured or the caller lacks
 * integration read access, this returns `{ ok: false, skipped: true }`.
 */
export async function dispatchKotHandoffWebhook(params: {
  supabase: SupabaseClient<Database>;
  restaurantId: string;
  payload: KotHandoffWebhookPayload;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const { data: integration, error: loadError } = await params.supabase
    .from('restaurant_pos_integrations')
    .select('webhook_url, webhook_secret')
    .eq('restaurant_id', params.restaurantId)
    .maybeSingle();

  if (loadError) {
    return { ok: false, error: 'Could not read POS webhook integration settings.' };
  }

  const webhookUrl = integration?.webhook_url?.trim();
  if (!webhookUrl) {
    return { ok: false, skipped: true, error: 'No HTTPS KOT handoff webhook URL is configured.' };
  }

  const body = JSON.stringify(params.payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-autodine-event': 'kot.handoff',
    'x-autodine-order-id': params.payload.orderId,
  };
  if (integration?.webhook_secret) {
    const signature = createHmac('sha256', integration.webhook_secret).update(body).digest('hex');
    headers['x-autodine-signature'] = `sha256=${signature}`;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return { ok: false, error: `POS webhook returned HTTP ${res.status}.` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'POS webhook request failed.',
    };
  }
}

export function buildKotHandoffCsv(
  rows: Array<{
    code: string;
    tableLabel: string | null;
    placedAt: string;
    prepStatus: string;
    kotHandoffStatus?: KotHandoffStatus;
    kotHandoffRef?: string | null;
  }>,
): string {
  const escape = (val: string) => {
    const safe = /^[=+\-@\t\r]/.test(val) ? `'${val}` : val;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = ['Order code', 'Table', 'Placed at', 'Kitchen state', 'POS handoff', 'POS ref'];
  const lines = [header.map(escape).join(',')];
  for (const row of rows) {
    const status = normalizeKotHandoffStatus(row.kotHandoffStatus);
    lines.push(
      [
        row.code,
        row.tableLabel ?? 'Takeaway',
        row.placedAt,
        row.prepStatus,
        kotHandoffLabel(status),
        row.kotHandoffRef ?? '',
      ]
        .map(escape)
        .join(','),
    );
  }
  return lines.join('\r\n');
}
