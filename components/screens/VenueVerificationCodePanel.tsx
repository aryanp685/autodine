'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MemberRole } from '@/lib/db/database';
import {
  getVenueVerificationCodeAction,
  rotateVenueVerificationCodeAction,
  setCashierCodeAccessAction,
  type VenueCodeView,
} from '@/app/q/actions';

export function VenueVerificationCodePanel({ slug, role }: { slug: string; role: MemberRole }) {
  const [result, setResult] = useState<VenueCodeView | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = role === 'owner' || role === 'manager';

  const refresh = useCallback(async () => {
    setBusy(true);
    const next = await getVenueVerificationCodeAction(slug);
    setResult(next);
    setBusy(false);
  }, [slug]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const load = async () => {
      const next = await getVenueVerificationCodeAction(slug);
      if (cancelled) return;
      setResult(next);
      // Re-check membership/opt-in access frequently, and clear an expired code before fetching its replacement.
      const untilExpiry = next.ok && next.validUntil
        ? Math.max(250, Date.parse(next.validUntil) - Date.now() + 250)
        : 15_000;
      timer = setTimeout(() => {
        if (next.ok && next.validUntil && Date.now() >= Date.parse(next.validUntil)) setResult(null);
        void load();
      }, Math.min(15_000, untilExpiry));
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [slug, role]);

  const rotate = async () => {
    setBusy(true);
    setResult(await rotateVenueVerificationCodeAction(slug));
    setBusy(false);
  };

  const changeCashierAccess = async (enabled: boolean) => {
    setBusy(true);
    setResult(await setCashierCodeAccessAction(slug, enabled));
    setBusy(false);
  };

  return (
    <section className="qr-code-panel" aria-labelledby="qr-code-panel-title">
      <div className="qr-code-panel__copy">
        <div className="pg__kicker">Venue verification</div>
        <h2 id="qr-code-panel-title">Current staff code</h2>
        <p>Guests scan their table QR, then enter this six-digit code. It refreshes every five minutes.</p>
        <p className="qr-code-panel__privacy">A guest can photograph or share the current code; this is not proof of physical presence.</p>
      </div>
      <div className="qr-code-panel__controls">
        {result?.ok && result.code ? (
          <>
            <output className="qr-code-panel__code" aria-label="Current six-digit verification code">{result.code}</output>
            <span className="qr-code-panel__expiry">Refreshes at {new Date(result.validUntil ?? '').toLocaleTimeString()}</span>
          </>
        ) : (
          <p className="qr-code-panel__message" role="status">
            {result?.error ?? (busy ? 'Loading current code…' : 'Code is unavailable.')}
          </p>
        )}
        <div className="qr-code-panel__actions">
          <button type="button" className="pg__miniBtn" disabled={busy} onClick={() => void refresh()}>
            Refresh
          </button>
          {canManage && (
            <button type="button" className="pg__miniBtn" disabled={busy} onClick={() => void rotate()}>
              Rotate now
            </button>
          )}
        </div>
        {canManage && result?.ok && (
          <label className="qr-code-panel__cashier">
            <input
              type="checkbox"
              checked={Boolean(result.cashierAccessEnabled)}
              disabled={busy}
              onChange={(event) => void changeCashierAccess(event.currentTarget.checked)}
            />
            Allow cashiers to view the current code
          </label>
        )}
      </div>
    </section>
  );
}
