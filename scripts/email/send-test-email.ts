/**
 * Controlled email deliverability test — sends ONE real email through the
 * real provider path (`lib/email/provider.ts`: bounded retry, one idempotency key per logical send, telemetry line) to ONE explicitly named
 * recipient.
 *
 *   BREVO_API_KEY=… AUTODINE_EMAIL_FROM=… npm run email:test-send -- --to you@example.com
 *
 * Use this to prove — with a real mailbox, not a mock — that the key, the
 * sender identity and the verified domain actually deliver, before wiring
 * the same values into a deployment. Source the values from your own shell
 * or password manager; never commit them, never paste them into chat.
 *
 * Safety rails:
 * - The recipient must be typed on the command line every run. There is no
 *   default, no list, no loop — this cannot become a bulk sender.
 * - Output is the fixed outcome vocabulary only (outcome / provider /
 *   attempts). The API key and the recipient address are never printed; the
 *   `[autodine:email]` line comes from the provider itself.
 * - Exit codes: 0 = provider accepted the message · 1 = attempted but failed
 *   after the bounded retries · 2 = not configured or bad usage (nothing
 *   was sent).
 */
import { isValidRecipient, sendEmail } from '../../lib/email/provider';

function recipientArg(argv: string[]): string | null {
  const flag = argv.indexOf('--to');
  if (flag === -1) return null;
  const value = argv[flag + 1];
  return typeof value === 'string' && isValidRecipient(value) ? value.trim() : null;
}

async function main(): Promise<number> {
  const to = recipientArg(process.argv.slice(2));
  if (!to) {
    console.error('Usage: npm run email:test-send -- --to <one-recipient@example.com>');
    console.error('One explicit, valid recipient is required. Nothing was sent.');
    return 2;
  }

  const stamp = new Date().toISOString();
  const delivery = await sendEmail('test', {
    to,
    subject: 'AutoDine email deliverability test',
    text: [
      'This is a controlled AutoDine deliverability test.',
      '',
      `Sent at ${stamp} through the AutoDine email provider (Brevo adapter).`,
      'If you received this in your inbox, the API key, sender identity and',
      'verified domain are working. No action is needed.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#faf7f0;font-family:Inter,system-ui,sans-serif;color:#181613;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#6f6a5e;margin:0 0 12px;">AutoDine deliverability test</p>
    <h1 style="font-size:22px;line-height:1.25;font-weight:600;margin:0 0 16px;">This mailbox can receive AutoDine mail</h1>
    <p style="font-size:14px;line-height:1.6;color:#3f3b33;margin:0;">Sent at ${stamp} through the AutoDine email provider (Brevo adapter). If this arrived in your inbox, the API key and verified Brevo sender are working. No action is needed.</p>
  </div>
</body></html>`,
  });

  console.log(
    JSON.stringify({
      event: 'email_test_send',
      outcome: delivery.outcome,
      provider: delivery.provider,
      attempts: delivery.attempts,
    }),
  );
  if (delivery.outcome === 'delivered') return 0;
  if (delivery.outcome === 'not_configured') {
    console.error(
      'No email provider is configured in this shell (BREVO_API_KEY / AUTODINE_EMAIL_FROM unset or malformed). Nothing was sent.',
    );
    return 2;
  }
  console.error('The provider did not accept the message. See the [autodine:email] line above for the status class.');
  return 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    // sendEmail never throws by contract; this guards the unexpected.
    console.error(JSON.stringify({ event: 'email_test_send', outcome: 'failed', provider: 'none', attempts: 0 }));
    process.exitCode = 1;
  });
