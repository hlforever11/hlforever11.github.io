[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$WindowsFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $WindowsFolder "backend.pid"

if (-not (Test-Path $PidFile)) {
    Write-Host "本机后端当前没有运行。"
    exit 0
}

$BackendPid = 0
if (-not [int]::TryParse((Get-Content $PidFile -Raw).Trim(), [ref]$BackendPid)) {
    Remove-Item $PidFile -Force
    Write-Host "已清理无效的进程记录。"
    exit 0
}

$Process = Get-Process -Id $BackendPid -ErrorAction SilentlyContinue
if ($null -ne $Process) {
    Stop-Process -Id $BackendPid -Force
    Write-Host "本机后端已停止。" -ForegroundColor Green
} else {
    Write-Host "本机后端已经停止。"
}
Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
Write-Host "Tailscale Funnel 配置已保留；下次启动后仍使用相同地址。"

