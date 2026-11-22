# AutoDine Print Bridge — Windows Installer (User-scope, no Admin required)
$ErrorActionPreference = 'Stop'

$InstallDir = Join-Path $env:LOCALAPPDATA 'AutoDinePrintBridge'
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Installing AutoDine Print Bridge to $InstallDir ..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

foreach ($file in @('server.mjs', 'escpos.mjs', 'transports.mjs', 'README.md')) {
  Copy-Item -Force (Join-Path $SourceDir $file) (Join-Path $InstallDir $file)
}

$NodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $NodePath) {
  throw "Node.js 20+ is required on PATH. Install Node.js LTS from https://nodejs.org and re-run."
}

$Launcher = Join-Path $InstallDir 'start-bridge.cmd'
@"
@echo off
cd /d "$InstallDir"
"$NodePath" "$InstallDir\server.mjs" >> "$InstallDir\bridge.log" 2>&1
"@ | Set-Content -Encoding Ascii $Launcher

# Register auto-start on Windows user logon
$TaskName = 'AutoDinePrintBridge'
$Action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$Launcher`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null

# Start immediately in background and print pairing token
Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' -ArgumentList "/c `"$Launcher`""
Start-Sleep -Seconds 2

$ConfigPath = Join-Path $InstallDir 'config.json'
if (Test-Path $ConfigPath) {
  $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
  Write-Host ""
  Write-Host "AutoDine Print Bridge installed and running!" -ForegroundColor Green
  Write-Host "Bridge URL    : http://127.0.0.1:19800"
  Write-Host "Pairing Token : $($cfg.pairingToken)" -ForegroundColor Yellow
  Write-Host "Paste this Pairing Token into AutoDine -> Settings -> Printing & Devices."
}
