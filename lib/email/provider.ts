/**
 * Transactional email for AutoDine — provider boundary, Brevo adapter.
 *
 * WHY A BOUNDARY
 *
 * Exactly like the billing provider: when no provider is connected the product
 * must say so and keep working — never pretend a mail went out, never throw at
 * a user who clicked "invite". One decision point (`getEmailProvider`) owns the
 * answer; every caller consumes `sendEmail` and branches on `outcome`.
 *
 * PROVIDER DECISION
 *
 * Brevo is the selected transactional provider. This module deliberately does
 * not activate any other provider's credentials: an old `RESEND_API_KEY`, for
 * example, is ignored rather than silently sending through an unselected
 * service. Set `AUTODINE_EMAIL_PROVIDER=brevo` explicitly on deployments (the
 * only accepted value) together with the Brevo credentials below.
 *
 * WHAT THIS DOES NOT DO
 *
 * - It never sends through SMTP by itself and never talks to Supabase Auth.
 *   Signup confirmations and password recovery are GoTrue's mail; Brevo reaches
 *   those through Supabase's custom-SMTP setting (Brevo SMTP relay + an SMTP
 *   key — a different credential from this API key), configured by the owner in
 *   the dashboard, not from here.
 * - It carries no tenant identifiers, names, order details or credentials in
 *   logs. A delivery line names the fixed `kind`, the outcome and the attempt
 *   count — nothing else. The recipient address is never logged.
 * - It throws nothing. Callers branch on `outcome`; failure is a result, not an
 *   exception.
 */

import { deliverWithRetry } from '@/lib/monitoring-incidents';
import { recordDelivery } from '@/lib/delivery-telemetry';
import { HttpStatusError, isRetryableDeliveryError } from '@/lib/http-retryable';

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
  provider: 'brevo' | 'none';
  attempts: number;
};

export type EmailSender = {
  email: string;
  name?: string;
};

export type EmailProvider = {
  readonly name: 'brevo';
  readonly from: string;
  readonly sender: EmailSender;
  /** Configured reply-to identity, or null: replies then go to the sender. */
  readonly replyTo: EmailSender | null;
  send(kind: EmailKind, message: EmailMessage): Promise<EmailDelivery>;
};

/** The only provider this deployment may select. Anything else fails closed. */
export const EMAIL_PROVIDER_NAME = 'brevo';
export const EMAIL_PROVIDER_ENV = 'AUTODINE_EMAIL_PROVIDER';
export const BREVO_API_KEY_ENV = 'BREVO_API_KEY';
export const EMAIL_FROM_ENV = 'AUTODINE_EMAIL_FROM';
export const EMAIL_REPLY_TO_ENV = 'AUTODINE_EMAIL_REPLY_TO';

const RECIPIENT_RE = /^[^\s@<>]{1,64}@[^\s@<>]{1,253}\.[^\s@<>]{2,}$/;
const SENDER_RE = /^([^<>]{1,80}\s*<)?[^\s@<>]{1,64}@[^\s@<>]{1,253}\.[^\s@<>]{2,}>?$/;

/** Validate the one thing every caller must get right. */
export function isValidRecipient(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && RECIPIENT_RE.test(value.trim());
}

const cleanSenderPart = (value: string): string =>
  value.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Parse the configured sender identity into Brevo's `{ email, name }` shape.
 * Accepts the same two forms the boundary has always accepted — bare
 * `mail@domain` or `Display Name <mail@domain>` — and nothing else.
 */
export function parseEmailSender(value: unknown): EmailSender | null {
  if (typeof value !== 'string') return null;
  const from = value.trim();
  if (!from || from.length > 254 || !SENDER_RE.test(from)) return null;

  const bracketed = from.match(/^([^<>]{1,80})\s*<([^\s@<>]{1,64}@[^\s@<>]{1,253}\.[^\s@<>]{2,})>$/);
  if (bracketed) {
    const name = cleanSenderPart(bracketed[1]).slice(0, 80);
    const email = bracketed[2].trim();
    return RECIPIENT_RE.test(email) ? { email, ...(name ? { name } : {}) } : null;
  }

  const email = from.trim();
  return RECIPIENT_RE.test(email) ? { email } : null;
}

const TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;
const BREVO_EMAILS_URL = 'https://api.brevo.com/v3/smtp/email';

function logDelivery(kind: EmailKind, outcome: EmailOutcome, attempts: number, status?: number): void {
  const line = JSON.stringify({ event: 'email_delivery', kind, outcome, attempts, ...(status ? { status } : {}) });
  recordDelivery('email', outcome, attempts);
  if (outcome === 'delivered') console.info(`[autodine:email] ${line}`);
  else if (outcome === 'not_configured') console.info(`[autodine:email] ${line}`);
  else console.warn(`[autodine:email] ${line}`);
}

/** Read only Brevo's fixed error `code`; never surface its message text. */
async function brevoErrorCode(response: Response): Promise<string> {
  try {
    const candidate = response as Response & {
      json?: () => Promise<unknown>;
      text?: () => Promise<string>;
    };
    const body =
      typeof candidate.json === 'function'
        ? await candidate.json()
        : typeof candidate.text === 'function'
          ? JSON.parse(await candidate.text())
          : null;
    if (body && typeof body === 'object' && 'code' in body) {
      return String((body as { code?: unknown }).code ?? '')
        .trim()
        .toLowerCase()
        .slice(0, 64);
    }
  } catch {
    // A provider error body is diagnostic garnish, never control flow input
    // beyond the duplicate check below; an unreadable body changes nothing.
  }
  return '';
}

/**
 * The Brevo HTTPS adapter. A documented, stable REST API and no SDK
 * dependency; the boundary above means no call site knows Brevo exists.
 *
 * Brevo specifics that shape this class:
 * - Auth is the `api-key` header. The key lives only in this server module's
 *   closure and in that header — never in a log line, never client-side.
 * - The sender must be a sender/domain verified in the Brevo account; an
 *   unverified sender is a permanent 4xx-class refusal, correctly not retried.
 * - Idempotency rides in the body's `headers.idempotencyKey` (UUID). Brevo
 *   processes one send per key inside its short TTL (documented at ~15
 *   minutes) and answers a repeat with `duplicate_parameter`. Our bounded
 *   retry window is seconds, so a duplicate answer on a retry means the
 *   original ambiguous attempt WAS accepted — that is reported as delivered,
 *   not as a failure and never as a second send.
 */
class BrevoProvider implements EmailProvider {
  readonly name = 'brevo' as const;

  constructor(
    private readonly apiKey: string,
    readonly from: string,
    readonly sender: EmailSender,
    readonly replyTo: EmailSender | null = null,
  ) {}

  async send(kind: EmailKind, message: EmailMessage): Promise<EmailDelivery> {
    /**
     * One key per logical send, reused by every retry of that send.
     *
     * The retry below exists for ambiguous failures — a timeout or a dropped
     * connection AFTER Brevo may have accepted the message. Without a key,
     * the retry is a second, independent send and the recipient gets the
     * invitation twice. A new sendEmail call is a new logical send and mints
     * a new key, so two intentional invitations are never collapsed.
     */
    const idempotencyKey = crypto.randomUUID();
    const payload = JSON.stringify({
      sender: this.sender,
      ...(this.replyTo ? { replyTo: this.replyTo } : {}),
      to: [{ email: message.to.trim() }],
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html,
      headers: { idempotencyKey },
      tags: [`autodine_${kind}`],
    });
    let lastStatus: number | undefined;
    let duplicateAccepted = false;
    const result = await deliverWithRetry(async () => {
      const response = await fetch(BREVO_EMAILS_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': this.apiKey,
          'content-type': 'application/json',
        },
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      lastStatus = response.status;
      if (response.ok) return;
      // A repeat of a key Brevo already processed is the original send
      // succeeding, observed late. Collapse it into that delivery.
      if ((await brevoErrorCode(response)) === 'duplicate_parameter') {
        duplicateAccepted = true;
        return;
      }
      // A 4xx (bar 408/429) is a bad key, unverified sender or bad recipient —
      // not a transient outage. Do not burn the retry budget repeating it;
      // 429 (daily quota / rate limit) and 5xx are transient and do retry.
      throw new HttpStatusError(response.status, `Email provider responded ${response.status}`);
    }, { maxAttempts: MAX_ATTEMPTS, baseDelayMs: 300, shouldRetry: isRetryableDeliveryError });
    const outcome: EmailOutcome = result.delivered || duplicateAccepted ? 'delivered' : 'failed';
    logDelivery(kind, outcome, result.attempts, lastStatus);
    return { outcome, provider: this.name, attempts: result.attempts };
  }
}

/**
 * The single decision point. `null` means this deployment has no email
 * provider — callers must treat that as "say so and move on", never as an error.
 * All values come from the server environment; none is NEXT_PUBLIC.
 *
 * Fail-closed rules: the selected provider, if named, must be Brevo; the API
 * key must carry Brevo's `xkeysib-` prefix; the sender must parse. Any other
 * provider's leftover credentials are ignored on purpose.
 */
export function getEmailProvider(
  env: Record<string, string | undefined> = process.env,
): EmailProvider | null {
  const selected = env[EMAIL_PROVIDER_ENV]?.trim().toLowerCase() ?? '';
  if (selected && selected !== EMAIL_PROVIDER_NAME) return null;

  const apiKey = env[BREVO_API_KEY_ENV]?.trim() ?? '';
  const from = env[EMAIL_FROM_ENV]?.trim() ?? '';
  if (!apiKey || !from) return null;
  if (!/^xkeysib-[A-Za-z0-9_-]{8,}$/.test(apiKey)) return null;

  const sender = parseEmailSender(from);
  if (!sender) return null;

  // Optional reply-to identity (AUTODINE_EMAIL_REPLY_TO). Unset: Brevo
  // delivers replies to the sender mailbox, which in the domainless phase is
  // the owner's verified mailbox — the correct place. Set but malformed:
  // fail closed like any other identity misconfiguration, rather than
  // silently sending with replies going somewhere unintended.
  const replyToRaw = env[EMAIL_REPLY_TO_ENV]?.trim() ?? '';
  let replyTo: EmailSender | null = null;
  if (replyToRaw) {
    replyTo = parseEmailSender(replyToRaw);
    if (!replyTo) return null;
  }
  return new BrevoProvider(apiKey, from, sender, replyTo);
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
