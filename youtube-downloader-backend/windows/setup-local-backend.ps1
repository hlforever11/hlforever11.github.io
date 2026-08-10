[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$WindowsFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendFolder = Split-Path -Parent $WindowsFolder
$RequirementsFile = Join-Path $BackendFolder "requirements-local.txt"
$AppFile = Join-Path $BackendFolder "app.py"
$VenvFolder = Join-Path $BackendFolder ".venv-local"
$VenvPython = Join-Path $VenvFolder "Scripts\python.exe"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Refresh-ProcessPath {
    $MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$MachinePath;$UserPath"
}

function Find-Tailscale {
    $Command = Get-Command "tailscale.exe" -ErrorAction SilentlyContinue
    if ($null -ne $Command) {
        return $Command.Source
    }

    $InstalledPath = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
    if (Test-Path $InstalledPath) {
        return $InstalledPath
    }
    return $null
}

function Install-WingetPackage(
    [string]$DisplayName,
    [string]$PackageId
) {
    Write-Host "正在安装 $DisplayName ..." -ForegroundColor Yellow
    & winget.exe install --id $PackageId --exact --source winget `
        --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "$DisplayName 安装失败（winget 退出码 $LASTEXITCODE）。"
    }
    Refresh-ProcessPath
}

if (-not (Test-Path $AppFile) -or -not (Test-Path $RequirementsFile)) {
    throw "安装文件不完整。请先解压整个 ZIP，再双击此脚本。"
}

Write-Host "YouTube 下载助手 · 本机后端安装" -ForegroundColor Green
Write-Host "此脚本会安装 Python、Node.js、FFmpeg 和 Tailscale（仅安装缺少的项目）。"

if ($null -eq (Get-Command "winget.exe" -ErrorAction SilentlyContinue)) {
    throw "这台电脑未找到 winget。请先在 Microsoft Store 安装或更新“应用安装程序”，然后重试。"
}

Write-Step "1/5 检查运行环境"
if (
    $null -eq (Get-Command "py.exe" -ErrorAction SilentlyContinue) -and
    $null -eq (Get-Command "python.exe" -ErrorAction SilentlyContinue)
) {
    Install-WingetPackage "Python 3.12" "Python.Python.3.12"
} else {
    Write-Host "Python 已安装。"
}

if ($null -eq (Get-Command "node.exe" -ErrorAction SilentlyContinue)) {
    Install-WingetPackage "Node.js LTS" "OpenJS.NodeJS.LTS"
} else {
    Write-Host "Node.js 已安装。"
}

if ($null -eq (Get-Command "ffmpeg.exe" -ErrorAction SilentlyContinue)) {
    Install-WingetPackage "FFmpeg" "Gyan.FFmpeg"
} else {
    Write-Host "FFmpeg 已安装。"
}

if ($null -eq (Find-Tailscale)) {
    Install-WingetPackage "Tailscale" "Tailscale.Tailscale"
} else {
    Write-Host "Tailscale 已安装。"
}

Refresh-ProcessPath

Write-Step "2/5 创建独立 Python 环境"
if (-not (Test-Path $VenvPython)) {
    $PyLauncher = Get-Command "py.exe" -ErrorAction SilentlyContinue
    if ($null -ne $PyLauncher) {
        & $PyLauncher.Source -3 -m venv $VenvFolder
    } else {
        $PythonCommand = Get-Command "python.exe" -ErrorAction Stop
        & $PythonCommand.Source -m venv $VenvFolder
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $VenvPython)) {
        throw "无法创建 Python 独立环境。"
    }
}

& $VenvPython -m pip install --disable-pip-version-check --upgrade pip
if ($LASTEXITCODE -ne 0) {
    throw "pip 更新失败。"
}
& $VenvPython -m pip install --disable-pip-version-check -r $RequirementsFile
if ($LASTEXITCODE -ne 0) {
    throw "后端 Python 套件安装失败。"
}

Write-Step "3/5 登录 Tailscale"
$Tailscale = Find-Tailscale
if ($null -eq $Tailscale) {
    throw "Tailscale 安装完成后仍未找到 tailscale.exe。请重启电脑后再运行此脚本。"
}

& $Tailscale status *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "浏览器将打开 Tailscale 登录页。请使用任意支持的账号登录。" -ForegroundColor Yellow
    & $Tailscale up
    if ($LASTEXITCODE -ne 0) {
        throw "Tailscale 登录未完成。登录后重新运行本脚本即可。"
    }
} else {
    Write-Host "Tailscale 已登录。"
}

Write-Step "4/5 设置开机登录后自动运行"
$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "YouTubeDownloaderBackend.lnk"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $WindowsFolder 'start-local-backend.ps1')`" -Startup"
$Shortcut.WorkingDirectory = $BackendFolder
$Shortcut.Description = "启动 YouTube 下载助手本机后端"
$Shortcut.Save()
Write-Host "已创建启动项：$ShortcutPath"

Write-Step "5/5 启动服务并申请 HTTPS 地址"
& (Join-Path $WindowsFolder "start-local-backend.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "本机服务启动未完成。"
}

Write-Host ""
Write-Host "安装完成。" -ForegroundColor Green
Write-Host "请把 windows\public-url.txt 中的 https://...ts.net 地址发给我。" -ForegroundColor Green
Write-Host "重要：电脑接通电源时请关闭自动睡眠；电脑睡眠或关机后，网站下载功能会暂时离线。" -ForegroundColor Yellow

