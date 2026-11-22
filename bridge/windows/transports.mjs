import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Discover local Windows printers (USB / Spooler / Shared) and merge any
 * explicitly configured LAN RAW-TCP (9100) printers from config.
 */
export async function discoverPrinters(config = {}) {
  const configured = Array.isArray(config.printers) ? config.printers : [];
  const discovered = [];

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus,Default | ConvertTo-Json -Compress',
        ],
        { timeout: 5000 },
      );
      const parsed = JSON.parse(stdout || '[]');
      const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      for (const p of list) {
        const name = String(p.Name ?? '').trim();
        if (!name) continue;
        const port = String(p.PortName ?? '').toLowerCase();
        const isUsb = port.includes('usb');
        const isLan = port.startsWith('ip_') || /^\d+\.\d+\.\d+\.\d+$/.test(port);
        const rawStatus = String(p.PrinterStatus ?? '').toLowerCase();
        const status = rawStatus.includes('offline') || rawStatus.includes('error') ? 'offline' : 'connected';
        discovered.push({
          id: `win:${name}`,
          name,
          connectionType: isUsb ? 'usb' : isLan ? 'lan' : 'windows_spooler',
          status,
          paperWidths: /58|80|thermal|pos|tm-|rp-|epson/i.test(`${name} ${p.DriverName ?? ''}`)
            ? ['80mm', '58mm']
            : ['a4'],
          isDefault: Boolean(p.Default),
        });
      }
    } catch {
      // Ignore discovery failure if spooler service is temporarily stopped.
    }
  }

  for (const p of configured) {
    if (!p?.id || !p?.name) continue;
    if (!discovered.some((d) => d.id === p.id || d.name === p.name)) {
      discovered.push(p);
    }
  }

  return discovered;
}

export async function sendRawTcp(host, port, bytes, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => finish(new Error(`TCP printer ${host}:${port} timed out after ${timeoutMs}ms`)));
    socket.once('error', (err) => finish(err));
    socket.connect(Number(port || 9100), host, () => {
      socket.write(bytes, (writeErr) => {
        if (writeErr) finish(writeErr);
        else socket.end(() => finish(null));
      });
    });
  });
}

export async function sendWindowsRawSpooler(printerName, bytes) {
  if (process.platform !== 'win32') {
    throw new Error('Windows RAW Spooler transport requires Windows (win32).');
  }
  const tmpFile = path.join(os.tmpdir(), `autodine-escpos-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
  fs.writeFileSync(tmpFile, bytes);
  const psScript = `
$printerName = ${JSON.stringify(String(printerName))};
$filePath = ${JSON.stringify(tmpFile)};
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
  public static void SendFile(string printer, string path) {
    byte[] bytes = File.ReadAllBytes(path);
    IntPtr hPrinter;
    if (!OpenPrinter(printer, out hPrinter, IntPtr.Zero)) throw new Exception("OpenPrinter failed for " + printer);
    var di = new DOCINFOA { pDocName = "AutoDine Receipt", pDataType = "RAW" };
    if (!StartDocPrinter(hPrinter, 1, di)) { ClosePrinter(hPrinter); throw new Exception("StartDocPrinter failed"); }
    StartPagePrinter(hPrinter);
    IntPtr pUnmanaged = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, pUnmanaged, bytes.Length);
    int written;
    bool ok = WritePrinter(hPrinter, pUnmanaged, bytes.Length, out written);
    Marshal.FreeCoTaskMem(pUnmanaged);
    EndPagePrinter(hPrinter);
    EndDocPrinter(hPrinter);
    ClosePrinter(hPrinter);
    if (!ok || written != bytes.Length) throw new Exception("WritePrinter wrote incomplete buffer");
  }
}
"@
[RawPrinterHelper]::SendFile($printerName, $filePath)
`;
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      timeout: 10000,
    });
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore temp cleanup failure.
    }
  }
}

export function defaultTransportDispatch(target, bytes, config = {}) {
  const host = target?.networkHost || config.defaultNetworkHost;
  const port = target?.networkPort || config.defaultNetworkPort || 9100;
  if (target?.connectionType === 'network_tcp' || host) {
    return sendRawTcp(host, port, bytes);
  }
  const spoolName = target?.bridgePrinterName || target?.printerName || config.defaultPrinterName;
  if (spoolName) {
    return sendWindowsRawSpooler(spoolName, bytes);
  }
  throw new Error('No target printer is selected or configured on AutoDine Print Bridge.');
}
