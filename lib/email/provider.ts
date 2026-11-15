/**
 * Transactional email for AutoDine — provider boundary, Resend adapter.
 *
 * WHY A BOUNDARY
 *
 * Exactly like the billing provider: when no provider is connected the product
 * must say so and keep working — never pretend a mail went out, never throw at
 * a user who clicked "invite". One decision point (`getEmailProvider`) owns the
 * answer; every caller consumes `sendEmail` and branches on `outcome`.
 *
 * WHAT THIS DOES NOT DO
 *
 * - It never sends through SMTP by itself and never talks to Supabase Auth.
 *   Signup confirmations and password recovery are GoTrue's mail; they are
 *   configured in the dashboard, not from here, and changing providers there is
 *   an owner step, not code.
 * - It carries no tenant identifiers, names, order details or credentials in
 *   logs. A delivery line names the fixed `kind`, the outcome and the attempt
 *   count — nothing else. The recipient address is never logged.
 * - It throws nothing. Callers branch on `outcome`; failure is a result, not an
 *   exception.
 */

import { deliverWithRetry } from '@/lib/monitoring-incidents';

export type EmailMessage = {
  /** One recipient only. No BCC, no lists — transactional mail is 1:1. */
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailKind = 'staff_invitation' | 'test';

export type EmailOutcome = 'delivered' | 'failed' | 'not_configured' | 'invalid_recipient';

export type EmailDelivery = {
  outcome: EmailOutcome;
  provider: 'resend' | 'none';
  attempts: number;
};

export type EmailProvider = {
  readonly name: 'resend';
  readonly from: string;
  send(kind: EmailKind, message: EmailMessage): Promise<EmailDelivery>;
};

const RECIPIENT_RE = /^[^\s@<>]{1,64}@[^\s@<>]{1,253}\.[^\s@<>]{2,}$/;

/** Validate the one thing every caller must get right. */
export function isValidRecipient(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && RECIPIENT_RE.test(value.trim());
}

const TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;

function logDelivery(kind: EmailKind, outcome: EmailOutcome, attempts: number, status?: number): void {
  const line = JSON.stringify({ event: 'email_delivery', kind, outcome, attempts, ...(status ? { status } : {}) });
  if (outcome === 'delivered') console.info(`[autodine:email] ${line}`);
  else if (outcome === 'not_configured') console.info(`[autodine:email] ${line}`);
  else console.warn(`[autodine:email] ${line}`);
}

/**
 * The Resend HTTPS adapter. Chosen because it is a documented, stable REST
 * API and needs no SDK dependency; swapping providers means replacing this one
 * class, not touching call sites.
 */
class ResendProvider implements EmailProvider {
  readonly name = 'resend' as const;
  constructor(private readonly apiKey: string, readonly from: string) {}

  async send(kind: EmailKind, message: EmailMessage): Promise<EmailDelivery> {
    const payload = JSON.stringify({
      from: this.from,
      to: [message.to.trim()],
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    let lastStatus: number | undefined;
    const result = await deliverWithRetry(async () => {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      lastStatus = response.status;
      if (!response.ok) throw new Error(`Email provider responded ${response.status}`);
    }, { maxAttempts: MAX_ATTEMPTS, baseDelayMs: 300 });
    const outcome: EmailOutcome = result.delivered ? 'delivered' : 'failed';
    logDelivery(kind, outcome, result.attempts, lastStatus);
    return { outcome, provider: this.name, attempts: result.attempts };
  }
}

/**
 * The single decision point. `null` means this deployment has no email
 * provider — callers must treat that as "say so and move on", never as an error.
 * Both values come from the server environment; neither is NEXT_PUBLIC.
 */
export function getEmailProvider(
  env: Record<string, string | undefined> = process.env,
): EmailProvider | null {
  const apiKey = env.RESEND_API_KEY?.trim() ?? '';
  const from = env.AUTODINE_EMAIL_FROM?.trim() ?? '';
  if (!apiKey || !from) return null;
  if (!/^re_[A-Za-z0-9_-]{8,}$/.test(apiKey)) return null;
  // "Name <mail@domain>" or bare "mail@domain".
  if (!/^([^<>]{1,80}\s*<)?[^<>@\s]{1,64}@[^<>@\s]{1,253}\.[^<>@\s]{2,}>?$/.test(from)) return null;
  return new ResendProvider(apiKey, from);
}

/**
 * Send one transactional message if — and only if — a provider is connected.
 * Never throws; `invalid_recipient` is returned before any network call.
 */
export async function sendEmail(
  kind: EmailKind,
  message: EmailMessage,
  env: Record<string, string | undefined> = process.env,
): Promise<EmailDelivery> {
  if (!isValidRecipient(message.to)) {
    logDelivery(kind, 'invalid_recipient', 0);
    return { outcome: 'invalid_recipient', provider: 'none', attempts: 0 };
  }
  const provider = getEmailProvider(env);
  if (!provider) {
    logDelivery(kind, 'not_configured', 0);
    return { outcome: 'not_configured', provider: 'none', attempts: 0 };
  }
  try {
    return await provider.send(kind, message);
  } catch {
    // deliverWithRetry already swallowed provider errors; this guards the
    // unexpected (DNS failure outside the retry boundary, programming error).
    logDelivery(kind, 'failed', MAX_ATTEMPTS);
    return { outcome: 'failed', provider: provider.name, attempts: MAX_ATTEMPTS };
  }
}
