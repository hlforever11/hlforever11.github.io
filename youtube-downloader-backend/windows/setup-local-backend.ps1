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
    Write-Host "Installing $DisplayName ..." -ForegroundColor Yellow
    & winget.exe install --id $PackageId --exact --source winget `
        --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "$DisplayName installation failed (winget exit code $LASTEXITCODE)."
    }
    Refresh-ProcessPath
}

if (-not (Test-Path $AppFile) -or -not (Test-Path $RequirementsFile)) {
    throw "Setup files are incomplete. Extract the entire ZIP before running this script."
}

Write-Host "YouTube Downloader - Local Backend Setup" -ForegroundColor Green
Write-Host "This setup installs missing components: Python, Node.js, FFmpeg, and Tailscale."

if ($null -eq (Get-Command "winget.exe" -ErrorAction SilentlyContinue)) {
    throw "winget was not found. Install or update App Installer from Microsoft Store, then run this setup again."
}

Write-Step "1/5 Check required software"
if (
    $null -eq (Get-Command "py.exe" -ErrorAction SilentlyContinue) -and
    $null -eq (Get-Command "python.exe" -ErrorAction SilentlyContinue)
) {
    Install-WingetPackage "Python 3.12" "Python.Python.3.12"
} else {
    Write-Host "Python is already installed."
}

if ($null -eq (Get-Command "node.exe" -ErrorAction SilentlyContinue)) {
    Install-WingetPackage "Node.js LTS" "OpenJS.NodeJS.LTS"
} else {
    Write-Host "Node.js is already installed."
}

if ($null -eq (Get-Command "ffmpeg.exe" -ErrorAction SilentlyContinue)) {
    Install-WingetPackage "FFmpeg" "Gyan.FFmpeg"
} else {
    Write-Host "FFmpeg is already installed."
}

if ($null -eq (Find-Tailscale)) {
    Install-WingetPackage "Tailscale" "Tailscale.Tailscale"
} else {
    Write-Host "Tailscale is already installed."
}

Refresh-ProcessPath

Write-Step "2/5 Create an isolated Python environment"
if (-not (Test-Path $VenvPython)) {
    $PyLauncher = Get-Command "py.exe" -ErrorAction SilentlyContinue
    if ($null -ne $PyLauncher) {
        & $PyLauncher.Source -3 -m venv $VenvFolder
    } else {
        $PythonCommand = Get-Command "python.exe" -ErrorAction Stop
        & $PythonCommand.Source -m venv $VenvFolder
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $VenvPython)) {
        throw "Could not create the Python virtual environment."
    }
}

& $VenvPython -m pip install --disable-pip-version-check --upgrade pip
if ($LASTEXITCODE -ne 0) {
    throw "pip update failed."
}
& $VenvPython -m pip install --disable-pip-version-check -r $RequirementsFile
if ($LASTEXITCODE -ne 0) {
    throw "Backend Python package installation failed."
}

Write-Step "3/5 Sign in to Tailscale"
$Tailscale = Find-Tailscale
if ($null -eq $Tailscale) {
    throw "tailscale.exe was not found after installation. Restart Windows and run this setup again."
}

& $Tailscale status *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "A browser will open for Tailscale sign-in." -ForegroundColor Yellow
    & $Tailscale up
    if ($LASTEXITCODE -ne 0) {
        throw "Tailscale sign-in did not finish. Sign in, then run this setup again."
    }
} else {
    Write-Host "Tailscale is signed in."
}

Write-Step "4/5 Create manual Start and Stop desktop shortcuts"
$StartupFolder = [Environment]::GetFolderPath("Startup")
$PreviousStartupShortcut = Join-Path $StartupFolder "YouTubeDownloaderBackend.lnk"
if (Test-Path $PreviousStartupShortcut) {
    Remove-Item $PreviousStartupShortcut -Force
    Write-Host "Removed the previous automatic startup shortcut."
}

$DesktopFolder = [Environment]::GetFolderPath("Desktop")
$Shell = New-Object -ComObject WScript.Shell

$StartShortcutPath = Join-Path $DesktopFolder "Start YouTube Downloader.lnk"
$StartShortcut = $Shell.CreateShortcut($StartShortcutPath)
$StartShortcut.TargetPath = Join-Path $WindowsFolder "start-local-backend.cmd"
$StartShortcut.WorkingDirectory = $WindowsFolder
$StartShortcut.Description = "Start the local backend and open the website"
$StartShortcut.Save()

$StopShortcutPath = Join-Path $DesktopFolder "Stop YouTube Downloader.lnk"
$StopShortcut = $Shell.CreateShortcut($StopShortcutPath)
$StopShortcut.TargetPath = Join-Path $WindowsFolder "stop-local-backend.cmd"
$StopShortcut.WorkingDirectory = $WindowsFolder
$StopShortcut.Description = "Stop the local YouTube downloader backend"
$StopShortcut.Save()

Write-Host "Created desktop shortcut: Start YouTube Downloader"
Write-Host "Created desktop shortcut: Stop YouTube Downloader"
Write-Host "The backend will not start automatically when you sign in to Windows." -ForegroundColor Green

Write-Step "5/5 Start the service and create its HTTPS address"
& (Join-Path $WindowsFolder "start-local-backend.ps1") -NoOpenSite
if ($LASTEXITCODE -ne 0) {
    throw "The local backend did not start."
}

Write-Host ""
Write-Host "Setup completed." -ForegroundColor Green
Write-Host "Open windows\public-url.txt and send me its https://...ts.net address." -ForegroundColor Green
Write-Host "Use the Start YouTube Downloader desktop shortcut when needed, and Stop YouTube Downloader when finished." -ForegroundColor Yellow
