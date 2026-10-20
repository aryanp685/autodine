'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import {
  createDiningTableAction,
  issueTableQrAction,
  revokeTableQrAction,
  setDiningTableActiveAction,
} from '@/app/dashboard/tables/actions';

type TableQr = {
  id: string;
  public_token: string;
  revoked_at: string | null;
};

type ManagedTable = {
  id: string;
  label: string;
  seats: number;
  is_active: boolean;
  qrCodes: TableQr[];
};

export function LiveTableQrManager({ slug, initialTables, canManage }: { slug: string; initialTables: ManagedTable[]; canManage: boolean }) {
  const [tables, setTables] = useState(initialTables);
  const [origin, setOrigin] = useState('');
  const [label, setLabel] = useState('');
  const [seats, setSeats] = useState(2);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => setOrigin(window.location.origin), []);

  const addTable = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyId('new');
    setError('');
    const result = await createDiningTableAction(slug, label, seats);
    if (!result.ok) setError(result.error);
    else {
      setLabel('');
      setSeats(2);
      router.refresh();
    }
    setBusyId(null);
  };

  const issueQr = async (tableId: string) => {
    setBusyId(tableId);
    setError('');
    const result = await issueTableQrAction(slug, tableId);
    if (!result.ok) setError(result.error);
    else {
      setTables((current) => current.map((table) => table.id === tableId
        ? { ...table, qrCodes: [...table.qrCodes.map((qr) => ({ ...qr, revoked_at: qr.revoked_at ?? new Date().toISOString() })), result.value] }
        : table));
    }
    setBusyId(null);
  };

  const revokeQr = async (tableId: string, qrId: string) => {
    setBusyId(qrId);
    setError('');
    const result = await revokeTableQrAction(slug, qrId);
    if (!result.ok) setError(result.error);
    else setTables((current) => current.map((table) => table.id === tableId
      ? { ...table, qrCodes: table.qrCodes.map((qr) => qr.id === qrId ? { ...qr, revoked_at: new Date().toISOString() } : qr) }
      : table));
    setBusyId(null);
  };

  const toggleTable = async (table: ManagedTable) => {
    setBusyId(table.id);
    setError('');
    const result = await setDiningTableActiveAction(slug, table.id, !table.is_active);
    if (!result.ok) setError(result.error);
    else setTables((current) => current.map((item) => item.id === table.id ? { ...item, is_active: !item.is_active } : item));
    setBusyId(null);
  };

  return (
    <section className="live-qr-manager" aria-labelledby="live-qr-title">
      <div className="live-qr-manager__heading">
        <div>
          <div className="pg__kicker">Workspace data</div>
          <h2 id="live-qr-title">Tables and printed QR codes</h2>
          <p>Each QR opens its table menu and starts a one-hour guest ordering session.</p>
        </div>
        {canManage && <button type="button" className="pg__btn" onClick={() => window.print()}>Print QR sheet</button>}
      </div>

      {error && <p className="live-qr-manager__error" role="alert">{error}</p>}

      {canManage ? (
        <form className="live-qr-manager__add" onSubmit={addTable}>
          <label>
            Table label
            <input value={label} onChange={(event) => setLabel(event.currentTarget.value)} maxLength={32} required placeholder="e.g. Patio 4" />
          </label>
          <label>
            Seats
            <input type="number" value={seats} onChange={(event) => setSeats(Number(event.currentTarget.value))} min={1} max={30} required />
          </label>
          <button type="submit" className="pg__btn pg__btn--solid" disabled={busyId === 'new'}>
            {busyId === 'new' ? 'Adding…' : 'Add table'}
          </button>
        </form>
      ) : (
        <p className="live-qr-manager__empty">Table QR creation, rotation and revocation are restricted to restaurant owners and managers.</p>
      )}

      {tables.length === 0 ? (
        <p className="live-qr-manager__empty">No tables yet. Add a table to issue its printed QR.</p>
      ) : (
        <div className="live-qr-manager__grid">
          {tables.map((table) => {
            const activeQrs = table.qrCodes.filter((qr) => !qr.revoked_at);
            return (
              <article className={`live-qr-manager__card ${table.is_active ? '' : 'is-disabled'}`} key={table.id}>
                <div className="live-qr-manager__card-head">
                  <div>
                    <h3>{table.label}</h3>
                    <p>{table.seats} seats · {table.is_active ? 'Active' : 'Disabled'}</p>
                  </div>
                  <button type="button" className="pg__miniBtn" disabled={busyId === table.id} onClick={() => void toggleTable(table)}>
                    {table.is_active ? 'Disable table' : 'Enable table'}
                  </button>
                </div>

                {canManage ? (activeQrs.length === 0 ? (
                  <p className="live-qr-manager__empty">No active printed QR.</p>
                ) : (
                  <div className="live-qr-manager__codes">
                    {activeQrs.map((qr) => {
                      const url = origin ? `${origin}/q/${encodeURIComponent(qr.public_token)}` : '';
                      return (
                        <div className="live-qr-manager__qr" key={qr.id}>
                          {url ? <QRCodeSVG value={url} size={132} level="M" includeMargin /> : <div className="live-qr-manager__qr-placeholder">Preparing QR…</div>}
                          <span>Scan to order</span>
                          <button type="button" className="pg__miniBtn pg__miniBtn--danger" disabled={busyId === qr.id} onClick={() => void revokeQr(table.id, qr.id)}>
                            Revoke QR
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )) : null}

                {canManage && (
                  <button type="button" className="pg__btn" disabled={!table.is_active || Boolean(busyId)} onClick={() => void issueQr(table.id)}>
                    {busyId === table.id ? 'Issuing…' : activeQrs.length ? 'Replace QR and revoke old sessions' : 'Issue printed QR'}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="live-qr-manager__limitation">Anyone with an active QR link can open the menu and place an order. Revoke or replace the QR if it is shared outside the restaurant.</p>
    </section>
  );
}
