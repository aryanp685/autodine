'use client';

import { useState } from 'react';

/**
 * Download and share the public menu QR.
 *
 * The panel has always shown the code, its link and a print button. These two
 * are the same code leaving by another door: the SVG as a file the owner can
 * drop into their own artwork, and the link through the phone's own share
 * sheet when there is one. Share falls back to copying, because a desktop has
 * no share sheet and "Share" that does nothing is worse than "Copy".
 *
 * The SVG is generated server-side by lib/qr.ts from a URL we build — there is
 * no path from anything a restaurant types to this string.
 */
export function MenuQrActions({
  svg,
  url,
  className = '',
}: {
  svg: string;
  url: string;
  /** Button classes, passed from the server side like PrintButton takes them. */
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const download = () => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = 'menu-qr.svg';
    a.click();
    URL.revokeObjectURL(objectUrl);
  };

  const share = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Our menu', url });
        setShared(true);
        return;
      } catch {
        // Dismissed or refused: fall through to copying, which always works.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard either (insecure context): the link is printed above and
      // selectable; say nothing rather than claim a copy that did not happen.
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" onClick={download} className={className}>
        Download QR
      </button>
      <button type="button" onClick={share} className={className}>
        {copied ? 'Link copied' : shared ? 'Shared' : 'Share link'}
      </button>
    </div>
  );
}
