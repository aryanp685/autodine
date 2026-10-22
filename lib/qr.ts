/**
 * Real QR codes.
 *
 * For the record, on what this replaces: the dashboard used to render a
 * component called QrChip, which hashed a string into a 21x21 grid and drew
 * three finder squares in the corners. It produced something that reads as a
 * QR code to a human glance and decodes to nothing at all under a camera.
 * Every code the Tables screen ever showed was one of those. A restaurant
 * would have printed them, taped them to the tables, and found out during
 * Friday service.
 *
 * This module calls a real encoder. The output is a genuine, scannable QR.
 *
 * WHY SVG AND NOT A CANVAS OR AN IMAGE FILE
 *
 * SVG is a string, so it can be built on the server and inlined, and it needs
 * no client JavaScript, no image route, and no network round trip. It also
 * scales: the same markup is sharp on a screen and sharp on a printed A4
 * sheet, which matters because the primary consumer of these codes is a
 * laser printer.
 *
 * `crispEdges` is set on the output so a browser does not anti-alias the
 * module boundaries. Soft edges are what make a technically valid code fail
 * on a cheap phone camera.
 */

import QRCode from 'qrcode';

/**
 * Error correction level.
 *
 * 'M' recovers 15% of the symbol. 'H' recovers 30% and is tempting for a
 * printed card that will get stained, but it needs noticeably more modules
 * for the same text -- a denser code is harder to scan in low light, and
 * restaurant lighting is low light. For a flat card behind a menu stand,
 * 'M' is the better trade.
 *
 * 'L' would be smaller still but tolerates almost no damage, and these cards
 * sit on tables where things get spilled.
 */
const ERROR_CORRECTION: QRCode.QRCodeErrorCorrectionLevel = 'M';

/** Quiet zone in modules. The spec wants 4; 4 makes the symbol 8 modules
 *  larger in each direction. 2 still decodes reliably on a phone and keeps
 *  the printed card from shrinking to fit the margin. */
const MARGIN = 2;

/**
 * The origin these QR codes point at.
 *
 * Defined in lib/site-origin.ts so the password-reset mail can use the same
 * hostname without importing a QR encoder, and re-exported here for the
 * screens that already ask this module for it.
 */
export { siteOrigin } from './site-origin';

/**
 * The URL a printed table card encodes.
 *
 * This is the whole point of the scheme: the code carries an unguessable
 * token, not a link to the restaurant. `/menu?s=maddi` would be a shareable
 * link -- anyone could text it to a friend who is not in the building, and
 * worse, it names the restaurant in plaintext so it is trivially editable.
 * `/t/<token>` is 256 bits of random, bound to one table, exchangeable for a
 * session that expires.
 */
export function tableScanUrl(origin: string, publicToken: string): string {
  return `${origin.replace(/\/+$/, '')}/t/${encodeURIComponent(publicToken)}`;
}

/**
 * Encode text as an inline SVG string.
 *
 * Returns null rather than throwing when the encoder rejects the input --
 * a code that cannot be drawn must not take the whole dashboard page down
 * with it. The screen decides what to show instead: an empty box that looks
 * broken is honest, a plausible-looking fake is not.
 */
export async function qrSvg(text: string): Promise<string | null> {
  if (!text) return null;

  try {
    return await QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: ERROR_CORRECTION,
      margin: MARGIN,
      // The encoder's default colours are black on transparent. A transparent
      // background renders as black-on-black wherever the card sits on a dark
      // surface, which is unscannable. White is forced so the symbol is
      // always light-on-dark-contrast regardless of the page behind it.
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (error) {
    console.error('[qr] could not encode', error);
    return null;
  }
}

/**
 * A scannable QR for one table, as inline SVG.
 *
 * `svg` carries no width or height so it fills whatever box it is placed in;
 * the viewBox is what makes that work.
 */