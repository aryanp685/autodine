'use client';

import { useEffect, useState } from 'react';
import {
  DEFAULT_BRIDGE_URL,
  checkPrintBridgeStatus,
  readLocalBridgeConfig,
  sendBridgeTestPrint,
  validatePrintBridgeUrl,
  writeLocalBridgeConfig,
  type DiscoveredBridgePrinter,
} from '@/lib/print-bridge';
import type { PrinterSummary } from '@/lib/db/printers';
import {
  deletePrinterAction,
  reportPrinterStatusAction,
  savePrinterAction,
} from '@/app/(staff)/dashboard/settings/printer-actions';
import { Panel, Notice, Field, Tag, btn, inputClass } from '@/components/owner/chrome';

type Props = {
  printers: PrinterSummary[];
  canEdit: boolean;
  live: boolean;
  restaurantName: string;
};

const ROLE_LABEL: Record<PrinterSummary['role'], string> = {
  counter: 'Counter',
  office: 'Office',
  bar: 'Bar / Pass',
  other: 'Other',
};

const CONN_LABEL: Record<PrinterSummary['connectionType'], string> = {
  windows_bridge: 'Windows Print Bridge',
  network_tcp: 'Network LAN (TCP 9100)',
  browser_os: 'Browser / OS Print',
};

export function PrintingDevicesPanel({ printers, canEdit, live, restaurantName }: Props) {
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_BRIDGE_URL);
  const [pairingToken, setPairingToken] = useState('');
  const [terminalPrinter, setTerminalPrinter] = useState('');
  const [connectionType, setConnectionType] = useState<'windows_bridge' | 'network_tcp' | 'browser_os'>('windows_bridge');
  const [printerType, setPrinterType] = useState<'thermal' | 'a4'>('thermal');
  const [paperWidth, setPaperWidth] = useState<'58mm' | '80mm' | 'a4'>('80mm');
  const [discovered, setDiscovered] = useState<DiscoveredBridgePrinter[]>([]);
  const [bridgeStatus, setBridgeStatus] = useState<{
    tone: 'plain' | 'accent' | 'due';
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const cfg = readLocalBridgeConfig();
    if (cfg.url) setBridgeUrl(cfg.url);
    if (cfg.token) setPairingToken(cfg.token);
    if (cfg.preferredPrinterName) setTerminalPrinter(cfg.preferredPrinterName);
  }, []);

  async function handleCheckBridge() {
    const urlCheck = validatePrintBridgeUrl(bridgeUrl);
    if (!urlCheck.ok) {
      setBridgeStatus({ tone: 'due', text: urlCheck.error });
      return;
    }
    setBusy(true);
    setBridgeStatus(null);
    writeLocalBridgeConfig({
      url: urlCheck.url,
      token: pairingToken,
      preferredPrinterName: terminalPrinter,
    });
    const res = await checkPrintBridgeStatus(urlCheck.url, pairingToken);
    setBusy(false);
    if (!res.ok) {
      setDiscovered([]);
      setBridgeStatus({
        tone: 'due',
        text: res.error,
      });
      return;
    }
    setDiscovered(res.printers);
    setBridgeStatus({
      tone: 'accent',
      text: `Bridge connected (v${res.version}). Found ${res.printers.length} printer${res.printers.length === 1 ? '' : 's'} on this Windows terminal.`,
    });
  }

  async function handleSaveTerminalSettings() {
    const urlCheck = validatePrintBridgeUrl(bridgeUrl);
    if (!urlCheck.ok) {
      setBridgeStatus({ tone: 'due', text: urlCheck.error });
      return;
    }
    writeLocalBridgeConfig({
      url: urlCheck.url,
      token: pairingToken,
      preferredPrinterName: terminalPrinter,
    });
    setBridgeStatus({
      tone: 'accent',
      text: 'Saved pairing settings for this browser terminal.',
    });
  }

  async function handleTestPrinter(printer?: PrinterSummary) {
    const urlCheck = validatePrintBridgeUrl(bridgeUrl);
    if (!urlCheck.ok) {
      setBridgeStatus({ tone: 'due', text: urlCheck.error });
      return;
    }
    if (printer?.connectionType === 'browser_os') {
      window.print();
      return;
    }
    setBusy(true);
    const widthMm = printer?.paperWidth === '58mm' ? '58mm' : printer?.paperWidth === 'a4' ? 'a4' : '80mm';
    const res = await sendBridgeTestPrint({
      endpoint: urlCheck.url,
      token: pairingToken,
      printerTarget: printer
        ? {
            printerId: printer.id,
            printerName: printer.name,
            connectionType: printer.connectionType,
            bridgePrinterName: printer.bridgePrinterName,
            networkHost: printer.networkHost,
            networkPort: printer.networkPort,
          }
        : terminalPrinter
          ? { printerName: terminalPrinter, bridgePrinterName: terminalPrinter, connectionType: 'windows_bridge' }
          : undefined,
      paperWidth: widthMm,
      restaurantName: restaurantName || 'AutoDine',
    });
    if (printer) {
      await reportPrinterStatusAction({
        printerId: printer.id,
        status: res.ok ? 'connected' : 'offline',
        error: res.ok ? null : (res.error ?? 'Test print failed'),
      });
    }
    setBusy(false);
    setBridgeStatus(
      res.ok
        ? { tone: 'accent', text: `Test receipt sent to ${printer?.name ?? 'local printer'}.` }
        : { tone: 'due', text: res.error ?? 'Test print failed.' },
    );
  }

  const disabled = !live || !canEdit;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="This billing terminal (Windows Print Bridge)"
        meta="Optional — Browser Print / Save PDF always works without installing anything"
        bodyClassName="px-5 py-5"
      >
        <div className="flex flex-col gap-4">
          <p className="m-0 text-[12.5px] leading-[1.55] text-gink-64">
            Install the optional <strong>AutoDine Print Bridge</strong> on your Windows counter PC for
            one-click and automatic thermal bill printing (USB or LAN). Pairing stays scoped to this
            browser and requires your bridge pairing token.
          </p>

          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field label="Bridge URL" htmlFor="bridge-url" hint="Must stay http://127.0.0.1:19800 on HTTPS.">
              <input
                id="bridge-url"
                type="url"
                className={inputClass}
                value={bridgeUrl}
                onChange={(e) => setBridgeUrl(e.target.value)}
                placeholder={DEFAULT_BRIDGE_URL}
              />
            </Field>
            <Field
              label="Pairing token"
              htmlFor="bridge-token"
              hint="Printed by install.bat on Windows."
            >
              <input
                id="bridge-token"
                type="password"
                className={inputClass}
                value={pairingToken}
                onChange={(e) => setPairingToken(e.target.value)}
                placeholder="Paste pairing token"
              />
            </Field>
            <Field
              label="Terminal printer override"
              htmlFor="bridge-terminal-printer"
              hint="Optional printer name on this PC."
            >
              {discovered.length > 0 ? (
                <select
                  id="bridge-terminal-printer"
                  className={inputClass}
                  value={terminalPrinter}
                  onChange={(e) => setTerminalPrinter(e.target.value)}
                >
                  <option value="">Use outlet default printer</option>
                  {discovered.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name} ({p.connectionType})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="bridge-terminal-printer"
                  type="text"
                  className={inputClass}
                  value={terminalPrinter}
                  onChange={(e) => setTerminalPrinter(e.target.value)}
                  placeholder="Use outlet default"
                />
              )}
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btn('ghost', 'sm')}
              disabled={busy}
              onClick={handleCheckBridge}
            >
              {busy ? 'Checking…' : 'Check bridge & sync printers'}
            </button>
            <button
              type="button"
              className={btn('ghost', 'sm')}
              disabled={busy}
              onClick={handleSaveTerminalSettings}
            >
              Save for this browser
            </button>
            <button
              type="button"
              className={btn('ghost', 'sm')}
              disabled={busy}
              onClick={() => handleTestPrinter()}
            >
              Send test receipt
            </button>
          </div>

          {bridgeStatus ? (
            <Notice tone={bridgeStatus.tone} label="Bridge status" className="mb-0">
              {bridgeStatus.text}
            </Notice>
          ) : null}

          <div className="rounded-[var(--p-r-control)] border border-hair bg-paper-deep px-3.5 py-2.5 text-[11.5px] text-gink-64">
            <strong>Windows setup:</strong> Run <code className="font-mono">bridge/windows/install.bat</code> on
            the billing PC to auto-start on login, then paste the shown Pairing Token above.
          </div>
        </div>
      </Panel>

      <Panel
        title="Outlet printers"
        meta={`${printers.length} configured`}
        bodyClassName="px-5 py-5"
      >
        {printers.length > 0 ? (
          <ul className="m-0 mb-5 flex list-none flex-col divide-y divide-hair p-0">
            {printers.map((printer) => (
              <li key={printer.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gink">{printer.name}</span>
                    <Tag tone={printer.status === 'connected' ? 'live' : printer.status === 'offline' ? 'due' : 'neutral'}>
                      {printer.status === 'connected' ? 'Connected' : printer.status === 'offline' ? 'Offline' : 'Untested'}
                    </Tag>
                    {printer.isDefault ? <Tag tone="live">Default</Tag> : null}
                    {printer.autoPrintOnClose ? <Tag tone="neutral">Auto-print on close</Tag> : null}
                  </div>
                  <p className="mt-0.5 mb-0 text-[11.5px] text-gink-46">
                    {ROLE_LABEL[printer.role]} · {printer.paperWidth.toUpperCase()} · {CONN_LABEL[printer.connectionType]}
                    {printer.bridgePrinterName ? ` · Windows: ${printer.bridgePrinterName}` : ''}
                    {printer.networkHost ? ` · ${printer.networkHost}:${printer.networkPort ?? 9100}` : ''}
                  </p>
                  {printer.lastError ? (
                    <p className="mt-0.5 mb-0 text-[11.5px] text-[var(--p-alert)]">
                      Last error: {printer.lastError}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={btn('quiet', 'sm')}
                    disabled={busy}
                    onClick={() => handleTestPrinter(printer)}
                  >
                    Test print
                  </button>
                  {live && canEdit ? (
                    <form action={deletePrinterAction}>
                      <input type="hidden" name="printerId" value={printer.id} />
                      <button type="submit" className={btn('quiet', 'sm')}>
                        Remove
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-0 mb-4 text-[12.5px] text-gink-46">
            No logical printers saved yet. Add your counter thermal printer or office A4 printer below —
            Browser Print / Save PDF remains available even with none saved.
          </p>
        )}

        <form action={savePrinterAction} className="flex flex-col gap-4 border-t border-hair pt-4">
          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field label="Printer name" htmlFor="printer-name" hint="For example: Counter 80mm">
              <input
                id="printer-name"
                name="name"
                type="text"
                className={inputClass}
                placeholder="Counter 80mm"
                required
                maxLength={60}
                disabled={disabled}
              />
            </Field>
            <Field label="Area" htmlFor="printer-role">
              <select id="printer-role" name="role" className={inputClass} defaultValue="counter" disabled={disabled}>
                <option value="counter">Counter / Billing</option>
                <option value="office">Office / Back desk</option>
                <option value="bar">Bar / Service pass</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Printer format" htmlFor="printer-type">
              <select
                id="printer-type"
                name="printerType"
                className={inputClass}
                value={printerType}
                onChange={(e) => {
                  const v = e.target.value === 'a4' ? 'a4' : 'thermal';
                  setPrinterType(v);
                  setPaperWidth(v === 'a4' ? 'a4' : '80mm');
                }}
                disabled={disabled}
              >
                <option value="thermal">Thermal receipt (58mm / 80mm)</option>
                <option value="a4">A4 Laser / Inkjet</option>
              </select>
            </Field>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field label="Connection" htmlFor="printer-conn">
              <select
                id="printer-conn"
                name="connectionType"
                className={inputClass}
                value={connectionType}
                onChange={(e) => {
                  const val = e.target.value;
                  setConnectionType(
                    val === 'network_tcp' ? 'network_tcp' : val === 'browser_os' ? 'browser_os' : 'windows_bridge',
                  );
                }}
                disabled={disabled}
              >
                <option value="windows_bridge">Windows Print Bridge (USB / Installed)</option>
                <option value="network_tcp">Network LAN Thermal (TCP 9100)</option>
                <option value="browser_os">Browser / OS Print dialog</option>
              </select>
            </Field>
            <Field label="Paper width" htmlFor="printer-width">
              <select
                id="printer-width"
                name="paperWidth"
                className={inputClass}
                value={paperWidth}
                onChange={(e) => {
                  const val = e.target.value;
                  setPaperWidth(val === '58mm' ? '58mm' : val === 'a4' ? 'a4' : '80mm');
                }}
                disabled={disabled}
              >
                <option value="80mm">80mm thermal roll</option>
                <option value="58mm">58mm thermal roll</option>
                <option value="a4">A4 sheet</option>
              </select>
            </Field>

            {connectionType === 'windows_bridge' ? (
              <Field
                label="Windows printer name"
                htmlFor="printer-win-name"
                hint="Optional; leave blank to use Windows default."
              >
                <input
                  id="printer-win-name"
                  name="bridgePrinterName"
                  type="text"
                  className={inputClass}
                  placeholder="Epson TM-T82"
                  disabled={disabled}
                />
              </Field>
            ) : connectionType === 'network_tcp' ? (
              <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                <Field label="Printer LAN IP" htmlFor="printer-host">
                  <input
                    id="printer-host"
                    name="networkHost"
                    type="text"
                    className={inputClass}
                    placeholder="192.168.1.120"
                    disabled={disabled}
                  />
                </Field>
                <Field label="Port" htmlFor="printer-port">
                  <input
                    id="printer-port"
                    name="networkPort"
                    type="number"
                    className={inputClass}
                    defaultValue={9100}
                    min={1}
                    max={65535}
                    disabled={disabled}
                  />
                </Field>
              </div>
            ) : (
              <div className="flex items-end pb-1 text-[11.5px] text-gink-46">
                Uses the system print dialog or Save as PDF.
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-5 text-[12.5px] text-gink">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" name="isDefault" defaultChecked disabled={disabled} />
              Set as default printer
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" name="autoPrintOnClose" defaultChecked disabled={disabled} />
              Auto-print bill when session closes
            </label>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-hair pt-4">
            <span className="text-[11.5px] text-gink-46">
              {canEdit ? 'Saved printers appear immediately on Cashier & Invoices.' : 'Owner or manager role required.'}
            </span>
            <button type="submit" className={btn('primary')} disabled={disabled}>
              Save printer
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
