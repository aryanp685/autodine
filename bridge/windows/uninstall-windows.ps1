# AutoDine Print Bridge — Windows Uninstaller
$ErrorActionPreference = 'SilentlyContinue'

$TaskName = 'AutoDinePrintBridge'
$InstallDir = Join-Path $env:LOCALAPPDATA 'AutoDinePrintBridge'

Write-Host "Stopping AutoDine Print Bridge..."
Stop-ScheduledTask -TaskName $TaskName
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*AutoDinePrintBridge*server.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if (Test-Path $InstallDir) {
  Remove-Item -Recurse -Force $InstallDir
}

Write-Host "AutoDine Print Bridge uninstalled cleanly." -ForegroundColor Green
