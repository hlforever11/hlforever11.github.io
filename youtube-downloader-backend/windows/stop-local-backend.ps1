[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$WindowsFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $WindowsFolder "backend.pid"

if (-not (Test-Path $PidFile)) {
    Write-Host "The local backend is not running."
    exit 0
}

$BackendPid = 0
if (-not [int]::TryParse((Get-Content $PidFile -Raw).Trim(), [ref]$BackendPid)) {
    Remove-Item $PidFile -Force
    Write-Host "Removed an invalid process record."
    exit 0
}

$Process = Get-Process -Id $BackendPid -ErrorAction SilentlyContinue
if ($null -ne $Process) {
    Stop-Process -Id $BackendPid -Force
    Write-Host "The local backend has stopped." -ForegroundColor Green
} else {
    Write-Host "The local backend was already stopped."
}
Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
Write-Host "The Tailscale Funnel configuration is preserved, so the same address will be reused."
