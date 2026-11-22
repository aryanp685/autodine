# AutoDine Print Bridge (Windows)

Optional local thermal/spooler print bridge for **customer bills (`58mm` / `80mm`)**. Browser/OS printing (`Print / Save PDF`) continues to work without installing this bridge.

## Install on Windows Billing PC

1. Install Node.js 20+ LTS on the billing PC.
2. Double-click `install.bat` (or run `powershell -ExecutionPolicy Bypass -File install-windows.ps1`).
3. The installer registers automatic startup on Windows login (`AutoDinePrintBridge` Scheduled Task), binds strictly to `http://127.0.0.1:19800`, and prints your **Pairing Token**.
4. Open **AutoDine → Settings → Printing & Devices**, paste the Pairing Token, click **Check bridge & sync printers**, and run **Test print**.

## Uninstall

Run `powershell -ExecutionPolicy Bypass -File uninstall-windows.ps1`.
