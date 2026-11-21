/**
 * Transactional email templates. Plain text is the product; the HTML is the
 * same message with breathing room. Every interpolated value is escaped at
 * the boundary — a restaurant name is user input.
 */

export type StaffInvitationEmail = {
  subject: string;
  text: string;
  html: string;
};

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Long enough for a sentence, short enough that nothing rides in. */
const clean = (value: unknown, max = 120) =>
  String(value ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function staffInvitationEmail(input: {
  restaurantName: string;
  roleLabel: string;
  joinUrl: string;
  /** ISO timestamp of link expiry. */
  expiresAt: string;
}): StaffInvitationEmail {
  const restaurant = clean(input.restaurantName, 80);
  const roleLabelRaw = clean(input.roleLabel, 40);
  const role = roleLabelRaw.toLowerCase();
  const url = clean(input.joinUrl, 300);
  const expires = new Date(input.expiresAt);
  const when = Number.isNaN(expires.getTime())
    ? 'soon'
    : expires.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  const subject = `${restaurant} — you're invited to the AutoDine ${roleLabelRaw} login`;
  const text = [
    `You've been given a ${role} login for ${restaurant} on AutoDine.`,
    '',
    `Open this link to set it up: ${url}`,
    '',
    `It works once and expires on ${when}. If you weren't expecting it, ignore this email — nothing happens until the link is opened.`,
    '',
    'AutoDine — counter, kitchen and floor in one place.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"></head><body style="margin:0;padding:0;width:100%;background:#faf7f0;font-family:Inter,system-ui,sans-serif;color:#181613;">
  <div style="width:100%;max-width:520px;margin:0 auto;padding:32px 20px;box-sizing:border-box;">
    <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#6f6a5e;margin:0 0 12px;">AutoDine invitation</p>
    <h1 style="font-size:22px;line-height:1.25;font-weight:600;margin:0 0 16px;">You&rsquo;re invited to the ${escapeHtml(role)} login for ${escapeHtml(restaurant)}</h1>
    <p style="font-size:14px;line-height:1.6;color:#3f3b33;margin:0 0 20px;">Someone at ${escapeHtml(restaurant)} gave you access to AutoDine. This link works once and expires on ${escapeHtml(when)}.</p>
    <p style="margin:0 0 24px;"><a href="${escapeHtml(url)}" style="display:inline-block;max-width:100%;box-sizing:border-box;background:#1d5c3a;color:#faf7f0;text-decoration:none;font-size:14px;font-weight:600;border-radius:10px;padding:12px 22px;">Open your invitation</a></p>
    <p style="font-size:12px;line-height:1.6;color:#6f6a5e;margin:0;">If you weren&rsquo;t expecting this, ignore this email — nothing happens until the link is opened. If the button doesn&rsquo;t work, copy this address into your browser:<br><span style="word-break:break-all;">${escapeHtml(url)}</span></p>
  </div>
</body></html>`;

  return { subject, text, html };
}
